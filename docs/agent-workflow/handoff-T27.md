# Handoff — T27 calibrate and evaluate optimized variants

- Task: T27 / REQ-005, REQ-019. Owner B/ML; carried by the agent.
- Status: **`[~]` evaluated; model status stays RESEARCH.** It cannot be approved: synthetic data (G1), too few test preparations (G2, G3), no domain review (G6).

## What was built

| File | Purpose |
|---|---|
| `ml/calibrate.py` | Validation only. Temperature floored at 1 (no validation errors, so NLL would falsely favour sharpening); threshold 0.90 as policy; **range guard** added because black and magenta scored 100% as SYN-D |
| `ml/benchmark_variants.py` | fp32 vs int8. Rule fixed first: no changed prediction, ≥ 25% smaller, ≥ 10% faster |
| `ml/release_evaluation.py`, `ml/reports/release-evaluation.md` | The only code that opens the locked test; reads calibration, never writes it. Six release gates |

## Results

- Locked test: MLP 160/160, baseline 159/160; no abstentions. Preparation accuracy ≥ 89.3% (Wilson); ≥ 90% needs 35 perfect preparations, ≥ 95% needs 73.
- Leave one domain out: 40/40 in every held-out domain (baseline 39/40 on tungsten).
- Probes: paper, black, grey, magenta abstain (range); blue/green midpoint abstains (uncertain); **amber/red midpoint is still suggested confidently** — a real limitation for adjacent-shade kits.
- int8: 0 changed predictions, but 107% larger and ~25% slower → **not adopted**.
- ECE ≈ 0 (val 0.00028, test 0.00008).

## Disclosed change

G3 first used the cluster-bootstrap bound, which collapses to 100% at perfect accuracy; after the first run it was replaced with the stricter Wilson bound. Model, calibration and data unchanged.

## Verification (2026-09-24)

`python -m ml.calibrate`, `python -m ml.golden`, `python -m ml.release_evaluation`; ML tests 19/19; model-parity 9/9; on-device 29/29 (T26).
