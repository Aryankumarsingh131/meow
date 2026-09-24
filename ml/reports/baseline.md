# Baseline report (T24)

**SYNTHETIC.** Rendered fixture colours through a simulated capture chain (docs/data-protocol.md). Nothing here is evidence about any water sample or any kit.

Baseline: nearest SYN-COLOR-001 fixture colour by squared RGB distance, the same rule as the app's `analyseBaseline`. It has no trained parameters.

The **test split is locked**. Its only evaluation is in `ml/reports/release-evaluation.md` (T27).

| Model / split | Records answered | Accuracy (cluster-bootstrap 95% CI) | Preparations correct (Wilson 95% CI) |
|---|---|---|---|
| Nearest reference colour / train | 320/320 (100.0%) | 315/320 = 98.4% [96.2%, 100.0%] | 64/64 [94.3%, 100.0%] |
| Nearest reference colour / val | 160/160 (100.0%) | 159/160 = 99.4% [98.1%, 100.0%] | 32/32 [89.3%, 100.0%] |

## Validation detail

| Class | Recall |
|---|---|
| bin_0 | 39/40 |
| bin_1 | 40/40 |
| bin_2 | 40/40 |
| bin_3 | 40/40 |

| Domain | Correct |
|---|---|
| daylight_phone_a | 40/40 |
| fluorescent_phone_b | 40/40 |
| shade_phone_b | 40/40 |
| tungsten_phone_a | 39/40 |

Errors (truth→predicted): bin_0→bin_1 ×1

## Provenance

- manifest_digest: `e359caf4cecd36ed5dfd540ea97df6381fddd344667e3625d0d5c2eda4f0b4fd`
- splits_salt: `jalsakshi-splits-v1`
- git_commit_at_run: `a108440`
- python: `3.13.7`
- numpy: `2.3.2`
- generated_at: `2026-09-24 16:17 UTC`
- command: `python -m ml.evaluate`
