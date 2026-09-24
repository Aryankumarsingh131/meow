"""T24: metrics with denominators and confidence intervals, plus the baseline.

Every number is reported with its denominator. Captures of one preparation are
correlated, so record-level accuracy gets a cluster bootstrap over
preparations, and preparation-level (majority vote) accuracy gets a Wilson
interval with n = preparations. A Wilson bound is also what stays honest at
100% observed accuracy, where a bootstrap collapses to [1, 1].

The test split is LOCKED: records("test") raises unless the caller passes
allow_locked_test=True. Only ml/release_evaluation.py does, once, after every
choice has been made on train/val.

    python -m ml.evaluate      # writes ml/reports/baseline.md
"""

from __future__ import annotations

import math
import platform
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Callable, Sequence

import numpy as np

from ml import feasibility_set, splits

FEATURES = ("median_r", "median_g", "median_b")
Predict = Callable[[np.ndarray], Sequence[str | None]]  # None = abstained


class LockedSplitError(PermissionError):
    pass


def records(split: str, *, allow_locked_test: bool = False) -> list[dict]:
    if split == "test" and not allow_locked_test:
        raise LockedSplitError("the test split is locked until release evaluation (T27)")
    manifest = feasibility_set.load()
    assignment = splits.assert_frozen(manifest)
    return splits.split_records(manifest, assignment)[split]


def matrix(recs: Sequence[dict]) -> np.ndarray:
    return np.array([[r["features"][f] for f in FEATURES] for r in recs], dtype=np.float64)


def labels(recs: Sequence[dict]) -> np.ndarray:
    return np.array([r["label"] for r in recs])


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (math.nan, math.nan)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


def cluster_bootstrap(correct: dict[str, list[bool]], reps: int = 2000, seed: int = 0) -> tuple[float, float]:
    groups = list(correct)
    if not groups:
        return (math.nan, math.nan)
    rng = np.random.default_rng(seed)
    hits = np.array([sum(correct[g]) for g in groups])
    sizes = np.array([len(correct[g]) for g in groups])
    draws = rng.integers(0, len(groups), (reps, len(groups)))
    rates = hits[draws].sum(1) / sizes[draws].sum(1)
    return (float(np.percentile(rates, 2.5)), float(np.percentile(rates, 97.5)))


def metrics(recs: Sequence[dict], predicted: Sequence[str | None]) -> dict:
    """`predicted[i] is None` means the model abstained on record i."""
    truth = labels(recs)
    answered = [i for i, p in enumerate(predicted) if p is not None]
    correct_by_group: dict[str, list[bool]] = defaultdict(list)
    for i in answered:
        correct_by_group[recs[i]["group_id"]].append(predicted[i] == truth[i])
    k = sum(predicted[i] == truth[i] for i in answered)
    majority = {g: sum(v) * 2 > len(v) for g, v in correct_by_group.items()}
    per_class = {c: (sum(predicted[i] == c for i in answered if truth[i] == c), int((truth == c).sum()))
                 for c in sorted(set(truth))}
    per_domain: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for i in answered:
        per_domain[recs[i]["domain"]][0] += predicted[i] == truth[i]
        per_domain[recs[i]["domain"]][1] += 1
    return {
        "records": len(recs),
        "groups": len({r["group_id"] for r in recs}),
        "answered": len(answered),
        "coverage": len(answered) / len(recs) if recs else math.nan,
        "correct": int(k),
        "accuracy": k / len(answered) if answered else math.nan,
        "accuracy_ci_cluster_bootstrap": cluster_bootstrap(correct_by_group),
        "group_majority_correct": sum(majority.values()),
        "group_majority_n": len(majority),
        "group_accuracy_ci_wilson": wilson(sum(majority.values()), len(majority)),
        "per_class_recall": per_class,
        "per_domain": {d: tuple(v) for d, v in sorted(per_domain.items())},
        "confusion": Counter((str(truth[i]), str(predicted[i])) for i in answered if predicted[i] != truth[i]),
    }


def nearest_reference(classes: Sequence[dict]) -> Predict:
    """The T11 baseline (apps/mobile/src/analysis/baseline.ts): nearest
    fixture colour by squared RGB distance, ties to the lower ordinal."""
    keys = [c["key"] for c in classes]
    refs = np.array([c["fixture_rgb"] for c in classes], dtype=np.float64)

    def predict(x: np.ndarray) -> list[str]:
        d = ((x[:, None, :] - refs[None, :, :]) ** 2).sum(-1)
        return [keys[i] for i in d.argmin(1)]

    return predict


def provenance() -> dict:
    manifest = feasibility_set.load()
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                                cwd=feasibility_set.ROOT, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = "unknown"
    return {
        "manifest_digest": feasibility_set.digest(manifest),
        "splits_salt": splits.load_frozen()["salt"],
        "git_commit_at_run": commit,
        "python": platform.python_version(),
        "numpy": np.__version__,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }


def pct(x: float) -> str:
    return "n/a" if math.isnan(x) else f"{100 * x:.1f}%"


def ci(pair: tuple[float, float]) -> str:
    return f"[{pct(pair[0])}, {pct(pair[1])}]"


def table(named: dict[str, dict]) -> str:
    rows = ["| Model / split | Records answered | Accuracy (cluster-bootstrap 95% CI) | Preparations correct (Wilson 95% CI) |",
            "|---|---|---|---|"]
    for name, m in named.items():
        rows.append(f"| {name} | {m['answered']}/{m['records']} ({pct(m['coverage'])}) | "
                    f"{m['correct']}/{m['answered']} = {pct(m['accuracy'])} {ci(m['accuracy_ci_cluster_bootstrap'])} | "
                    f"{m['group_majority_correct']}/{m['group_majority_n']} {ci(m['group_accuracy_ci_wilson'])} |")
    return "\n".join(rows)


def details(m: dict) -> str:
    lines = ["| Class | Recall |", "|---|---|"]
    lines += [f"| {c} | {k}/{n} |" for c, (k, n) in m["per_class_recall"].items()]
    lines += ["", "| Domain | Correct |", "|---|---|"]
    lines += [f"| {d} | {k}/{n} |" for d, (k, n) in m["per_domain"].items()]
    errors = ", ".join(f"{t}→{p} ×{n}" for (t, p), n in m["confusion"].most_common()) or "none"
    return "\n".join(lines) + f"\n\nErrors (truth→predicted): {errors}"


def baseline_report() -> str:
    classes = feasibility_set.load()["classes"]
    predict = nearest_reference(classes)
    results = {f"Nearest reference colour / {s}": metrics(rs, predict(matrix(rs)))
               for s, rs in (("train", records("train")), ("val", records("val")))}
    prov = provenance()
    return "\n".join([
        "# Baseline report (T24)",
        "",
        "**SYNTHETIC.** Rendered fixture colours through a simulated capture chain "
        "(docs/data-protocol.md). Nothing here is evidence about any water sample or any kit.",
        "",
        "Baseline: nearest SYN-COLOR-001 fixture colour by squared RGB distance, the same rule as the app's "
        "`analyseBaseline`. It has no trained parameters.",
        "",
        "The **test split is locked**. Its only evaluation is in `ml/reports/release-evaluation.md` (T27).",
        "",
        table(results),
        "",
        "## Validation detail",
        "",
        details(results["Nearest reference colour / val"]),
        "",
        "## Provenance",
        "",
        *[f"- {k}: `{v}`" for k, v in prov.items()],
        "- command: `python -m ml.evaluate`",
        "",
    ])


if __name__ == "__main__":
    out = feasibility_set.ROOT / "ml" / "reports" / "baseline.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(baseline_report(), encoding="utf-8")
    print(f"wrote {out.relative_to(feasibility_set.ROOT)}")
