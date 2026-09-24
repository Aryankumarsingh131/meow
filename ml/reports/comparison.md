# Model comparison (T25)

**SYNTHETIC.** Trained and compared on rendered fixture colours (docs/data-protocol.md). Nothing here is evidence about any water sample or any kit.

All three candidates use the same frozen splits (`ml/data/splits.v1.json`). Every choice below was made on **validation**; the test split was not loaded.

## Validation

| Model / split | Records answered | Accuracy (cluster-bootstrap 95% CI) | Preparations correct (Wilson 95% CI) |
|---|---|---|---|
| Nearest reference colour / val | 160/160 (100.0%) | 159/160 = 99.4% [98.1%, 100.0%] | 32/32 [89.3%, 100.0%] |
| kNN k=5 / val | 160/160 (100.0%) | 160/160 = 100.0% [100.0%, 100.0%] | 32/32 [89.3%, 100.0%] |
| MLP 3-8-4 / val | 160/160 (100.0%) | 160/160 = 100.0% [100.0%, 100.0%] | 32/32 [89.3%, 100.0%] |

## Training (fit, for reference - not a generalisation estimate)

| Model / split | Records answered | Accuracy (cluster-bootstrap 95% CI) | Preparations correct (Wilson 95% CI) |
|---|---|---|---|
| Nearest reference colour / train | 320/320 (100.0%) | 315/320 = 98.4% [96.2%, 100.0%] | 64/64 [94.3%, 100.0%] |
| kNN k=5 / train | 320/320 (100.0%) | 320/320 = 100.0% [100.0%, 100.0%] | 64/64 [94.3%, 100.0%] |
| MLP 3-8-4 / train | 320/320 (100.0%) | 320/320 = 100.0% [100.0%, 100.0%] | 64/64 [94.3%, 100.0%] |

## Selection

- Rule (fixed before results): MLP exported only if its validation accuracy >= the baseline's (fixed before results).
- MLP validation accuracy 100.0% vs baseline 99.4% → **selected**.
- The gap is 1 validation capture(s) and the intervals overlap, so this shows the MLP is **not worse** than the baseline, not that it is better. On this easy synthetic task, every candidate is near ceiling.
- Candidate size: 68 parameters. kNN is not a bundling option: it would ship all 320 training vectors.

## MLP validation detail

| Class | Recall |
|---|---|
| bin_0 | 40/40 |
| bin_1 | 40/40 |
| bin_2 | 40/40 |
| bin_3 | 40/40 |

| Domain | Correct |
|---|---|
| daylight_phone_a | 40/40 |
| fluorescent_phone_b | 40/40 |
| shade_phone_b | 40/40 |
| tungsten_phone_a | 40/40 |

Errors (truth→predicted): none

## Baseline validation detail

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
- generated_at: `2026-09-24 16:19 UTC`
- seed: `0`
- hidden: `[8]`
- alpha: `0.001`
- solver: `lbfgs`
- max_iter: `2000`
- sklearn: `1.7.1`
- trained_on: `train split only`
- command: `python -m ml.train`
