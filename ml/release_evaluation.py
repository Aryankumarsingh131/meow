"""T27: release evaluation - the ONLY code that opens the locked test split.

Everything it judges was frozen beforehand and is only READ here: the model
file and selection rule (T25), the calibration block (ml/calibrate.py:
temperature, threshold, range guard), and the int8 adoption rule. Nothing is
refitted after the test split is seen; the manifest is never written.

Release gates, fixed in this file before its first run:
  G1 data      the model was trained and tested on real, non-synthetic data
  G2 test      locked-test preparation accuracy, Wilson 95% lower bound >= 90%
  G3 coverage  at the policy threshold: coverage >= 90% and selective
               accuracy over answered preparations (Wilson 95% lower bound)
               >= 95%. (First run used the cluster-bootstrap bound, which
               collapses to 100% at perfect accuracy; replaced after that run
               with this stricter bound. Model, calibration, data unchanged.)
  G4 domains   every held-out domain (leave-one-domain-out) >= 90% accuracy
  G5 probes    every constructed non-fixture probe (paper, black, grey,
               magenta) abstains
  G6 review    a domain reviewer has signed off
A model is "approved" only if all pass. G1 and G6 fail by construction here.

    python -m ml.release_evaluation      # writes ml/reports/release-evaluation.md
"""

from __future__ import annotations

import json
from collections import Counter

import numpy as np

from ml import benchmark_variants, evaluate, feasibility_set, golden, train

REPORT_PATH = feasibility_set.ROOT / "ml" / "reports" / "release-evaluation.md"
NON_FIXTURE_PROBES = ("bare paper", "black", "mid grey", "magenta")
THRESHOLD_GRID = (0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 0.999)


def decisions(x: np.ndarray, manifest: dict) -> list[dict]:
    logits = golden.onnx_logits(x)
    return [golden.decide(logits[i], manifest, x[i]) for i in range(len(x))]


def minimum_perfect_n(target: float) -> int:
    """Smallest n for which n/n correct gives a Wilson 95% lower bound >= target."""
    n = 1
    while evaluate.wilson(n, n)[0] < target:
        n += 1
    return n


def ece(probabilities: np.ndarray, correct: np.ndarray, bins: int = 10) -> float:
    top = probabilities.max(1)
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (top > lo) & (top <= hi)
        if mask.any():
            total += mask.mean() * abs(correct[mask].mean() - top[mask].mean())
    return float(total)


def leave_one_domain_out(train_recs: list[dict], test_recs: list[dict], classes: list[str], baseline) -> list[dict]:
    rows = []
    for domain in sorted({r["domain"] for r in train_recs}):
        fit = [r for r in train_recs if r["domain"] != domain]
        held = [r for r in test_recs if r["domain"] == domain]
        x_fit, x_held = evaluate.matrix(fit), evaluate.matrix(held)
        mean, std = x_fit.mean(0), x_fit.std(0)
        mlp = train.fit_mlp((x_fit - mean) / std, evaluate.labels(fit))
        if list(mlp.classes_) != classes:
            raise AssertionError("a leave-one-domain-out fold lost a class")
        rows.append({"domain": domain, "train_records": len(fit),
                     "mlp": evaluate.metrics(held, list(mlp.predict((x_held - mean) / std))),
                     "baseline": evaluate.metrics(held, baseline(x_held))})
    return rows


def run() -> str:
    manifest = json.loads(golden.MANIFEST_PATH.read_text(encoding="utf-8"))
    cal = manifest["calibration"]
    if cal is None:
        raise SystemExit("not calibrated: run python -m ml.calibrate first")
    classes = manifest["output"]["classes"]
    meta_classes = feasibility_set.load()["classes"]
    baseline = evaluate.nearest_reference(meta_classes)
    val, test = evaluate.records("val"), evaluate.records("test", allow_locked_test=True)
    x_val, x_test = evaluate.matrix(val), evaluate.matrix(test)

    raw_test = [classes[i] for i in golden.onnx_logits(x_test).argmax(1)]
    decided = decisions(x_test, manifest)
    gated_test = [d["bin"] if d["kind"] == "suggest" else None for d in decided]
    m_raw = evaluate.metrics(test, raw_test)
    m_gated = evaluate.metrics(test, gated_test)
    m_base = evaluate.metrics(test, baseline(x_test))
    abstain_reasons = Counter(d["reason"] for d in decided if d["kind"] == "abstain")

    val_logits = golden.onnx_logits(x_val).astype(np.float64)
    val_p = train.softmax(val_logits, cal["temperature"])
    val_truth = evaluate.labels(val)
    val_correct = np.array([classes[i] for i in val_p.argmax(1)]) == val_truth
    test_p = train.softmax(golden.onnx_logits(x_test).astype(np.float64), cal["temperature"])
    test_correct = np.array(raw_test) == evaluate.labels(test)
    risk = []
    for t in THRESHOLD_GRID:
        answered = val_p.max(1) >= t
        risk.append((t, int(answered.sum()), int((answered & val_correct).sum())))

    lodo = leave_one_domain_out(evaluate.records("train"), test, classes, baseline)
    probes = json.loads(golden.GOLDEN_PATH.read_text(encoding="utf-8"))["probes"]

    variant_val = benchmark_variants.compare(x_val)
    variant_test = benchmark_variants.compare(x_test)
    adopted, variant_reasons = benchmark_variants.adopt(variant_val)

    group_lo = m_raw["group_accuracy_ci_wilson"][0]
    sel_lo = m_gated["group_accuracy_ci_wilson"][0]
    worst = min(row["mlp"]["accuracy"] for row in lodo)
    probe_ok = all(p["expected"]["kind"] == "abstain" for p in probes if p["name"] in NON_FIXTURE_PROBES)
    gates = [
        ("G1 data", False, "trained and tested only on SYNTHETIC renders (data_mode synthetic)"),
        ("G2 test", group_lo >= 0.90, f"preparation accuracy Wilson lower bound {evaluate.pct(group_lo)} (needs ≥ 90%)"),
        ("G3 coverage", m_gated["coverage"] >= 0.90 and sel_lo >= 0.95,
         f"coverage {evaluate.pct(m_gated['coverage'])}, selective accuracy over answered preparations, Wilson lower "
         f"bound {evaluate.pct(sel_lo)} (needs ≥ 90% and ≥ 95%). Tightened after the first run: that run used the "
         "cluster-bootstrap bound, which collapses to 100% at perfect accuracy"),
        ("G4 domains", worst >= 0.90, f"worst held-out domain {evaluate.pct(worst)} (needs ≥ 90%)"),
        ("G5 probes", probe_ok, f"non-fixture probes abstain: {', '.join(NON_FIXTURE_PROBES)}"),
        ("G6 review", False, "no domain reviewer has seen this model"),
    ]
    status = "approved" if all(ok for _, ok, _ in gates) else "research"
    prov = evaluate.provenance()

    return "\n".join([
        "# Release evaluation (T27)",
        "",
        f"**Status: {status.upper()}.** SYNTHETIC data only (docs/data-protocol.md). This report says nothing about any "
        "water sample or any kit, and the model cannot be approved on it.",
        "",
        "This is the **only** evaluation of the locked test split. The model, its selection rule, its calibration and the "
        "int8 rule were all frozen before this ran, and this run only reads them.",
        "",
        "## What was frozen before this run",
        "",
        f"- Model `{manifest['model_id']}@{manifest['version']}`, SHA-256 `{manifest['sha256']}`",
        f"- Calibration `{cal['version']}`: temperature {cal['temperature']} (validation NLL, floored at 1), "
        f"abstain below {cal['abstain_below']} (policy), range guard {cal['range']['max_distance']} RGB "
        f"(1.25 × largest train distance {cal['range']['train_max_distance']})",
        "- Why the temperature sits at the floor: the model makes no validation errors, so validation NLL keeps falling as T "
        f"falls (at T=1: {cal['validation_nll']['at_1']}). There is no evidence for sharpening, so none is applied.",
        "",
        "## Locked test: 160 captures, 32 preparations",
        "",
        evaluate.table({"MLP, raw argmax": m_raw, "MLP with calibration (as the app runs it)": m_gated,
                        "Baseline (nearest fixture colour)": m_base}),
        "",
        f"Abstentions on test: {dict(abstain_reasons) or 'none'}.",
        "",
        "### MLP test detail",
        "",
        evaluate.details(m_raw),
        "",
        "### Calibration error (10-bin ECE, at the fitted temperature)",
        "",
        f"- validation: {ece(val_p, val_correct):.5f} over {len(val)} captures",
        f"- test: {ece(test_p, test_correct):.5f} over {len(test)} captures",
        "",
        "Near zero because nearly every capture is correct at near-certain probability. On data with real errors this "
        "would be the number to watch.",
        "",
        "## Validation risk-coverage (for choosing a threshold; test not used)",
        "",
        "| Threshold | Answered | Correct when answered |",
        "|---|---|---|",
        *[f"| {t} | {a}/{len(val)} ({evaluate.pct(a / len(val))}) | {c}/{a} |" for t, a, c in risk],
        "",
        "## Leave one domain out",
        "",
        "Retrained with identical settings on train preparations from the other three domains, tested on the held-out "
        "domain's test preparations. Every preparation belongs to one domain, so this is also preparation-disjoint.",
        "",
        "| Held-out domain | Trained on | MLP | Baseline |",
        "|---|---|---|---|",
        *[f"| {row['domain']} | {row['train_records']} captures | {row['mlp']['correct']}/{row['mlp']['answered']} "
          f"({evaluate.pct(row['mlp']['accuracy'])}), preparations {evaluate.ci(row['mlp']['group_accuracy_ci_wilson'])} | "
          f"{row['baseline']['correct']}/{row['baseline']['answered']} ({evaluate.pct(row['baseline']['accuracy'])}) |"
          for row in lodo],
        "",
        "## Constructed probes (not captures)",
        "",
        "| Probe | RGB | Deployed decision |",
        "|---|---|---|",
        *[f"| {p['name']} | {tuple(int(v) for v in p['features'])} | "
          f"{p['expected']['kind']} {p['expected'].get('bin') or p['expected'].get('reason')} |" for p in probes],
        "",
        "Without the range guard, black and magenta score 100% as SYN-D and mid grey 99% as SYN-A: a probability "
        "threshold cannot catch inputs unlike any fixture, so the range guard does. **The amber/red midpoint is still "
        "suggested as SYN-C with high confidence.** The training data has no captures near that boundary, so the model "
        "has never learned to be unsure there. For a real kit with adjacent shades this is the failure to expect; it "
        "needs boundary examples in training or a different abstention method, not a tighter threshold.",
        "",
        "## int8 variant",
        "",
        f"Rule (fixed before measuring): adopt only with no changed validation prediction, ≥ "
        f"{100 * benchmark_variants.MIN_SIZE_SAVING:.0f}% smaller file and ≥ "
        f"{100 * benchmark_variants.MIN_LATENCY_SAVING:.0f}% lower median latency.",
        "",
        *[f"- {line}" for line in variant_reasons],
        f"- on the locked test: {variant_test['changed_predictions']}/{variant_test['n']} predictions changed",
        f"- **{'Adopted' if adopted else 'Not adopted: fp32 stays.'}** For a 68-parameter model, quantization adds more "
        "graph than it removes.",
        "",
        "Latency is desktop CPU (onnxruntime, one capture per call); the phone's figure comes from the Model check screen.",
        "",
        "## Release gates",
        "",
        "| Gate | Result | Evidence |",
        "|---|---|---|",
        *[f"| {name} | {'pass' if ok else '**FAIL**'} | {why} |" for name, ok, why in gates],
        "",
        f"**Model status: {status}.** `model-manifest.json` keeps `status: research`, and the app labels every suggestion "
        "as research-only.",
        "",
        f"Why G2 and G3 fail even at 100% observed accuracy: {m_raw['group_majority_n']} test preparations cannot "
        f"establish more than {evaluate.pct(group_lo)} with 95% confidence. Showing ≥ 90% needs at least "
        f"{minimum_perfect_n(0.90)} preparations, all correct; ≥ 95% needs at least {minimum_perfect_n(0.95)}. The next "
        "test set must be sized for the claim it is meant to support.",
        "",
        "## Provenance",
        "",
        *[f"- {k}: `{v}`" for k, v in prov.items()],
        f"- test split opened with allow_locked_test=True by: `python -m ml.release_evaluation`",
        "",
    ])


if __name__ == "__main__":
    REPORT_PATH.write_text(run(), encoding="utf-8")
    print(f"wrote {REPORT_PATH.relative_to(feasibility_set.ROOT)}")
