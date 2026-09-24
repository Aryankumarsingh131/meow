# Release evaluation (T27)

**Status: RESEARCH.** SYNTHETIC data only (docs/data-protocol.md). This report says nothing about any water sample or any kit, and the model cannot be approved on it.

This is the **only** evaluation of the locked test split. The model, its selection rule, its calibration and the int8 rule were all frozen before this ran, and this run only reads them.

## What was frozen before this run

- Model `syn-color-001-mlp@1`, SHA-256 `597d667fa37a90c10b06263b2cac38b3f8771e77c4ec58e526ce384869e0202e`
- Calibration `cal-v1`: temperature 1.0 (validation NLL, floored at 1), abstain below 0.9 (policy), range guard 109.177 RGB (1.25 × largest train distance 87.342)
- Why the temperature sits at the floor: the model makes no validation errors, so validation NLL keeps falling as T falls (at T=1: 0.00027964). There is no evidence for sharpening, so none is applied.

## Locked test: 160 captures, 32 preparations

| Model / split | Records answered | Accuracy (cluster-bootstrap 95% CI) | Preparations correct (Wilson 95% CI) |
|---|---|---|---|
| MLP, raw argmax | 160/160 (100.0%) | 160/160 = 100.0% [100.0%, 100.0%] | 32/32 [89.3%, 100.0%] |
| MLP with calibration (as the app runs it) | 160/160 (100.0%) | 160/160 = 100.0% [100.0%, 100.0%] | 32/32 [89.3%, 100.0%] |
| Baseline (nearest fixture colour) | 160/160 (100.0%) | 159/160 = 99.4% [98.1%, 100.0%] | 32/32 [89.3%, 100.0%] |

Abstentions on test: none.

### MLP test detail

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

### Calibration error (10-bin ECE, at the fitted temperature)

- validation: 0.00028 over 160 captures
- test: 0.00008 over 160 captures

Near zero because nearly every capture is correct at near-certain probability. On data with real errors this would be the number to watch.

## Validation risk-coverage (for choosing a threshold; test not used)

| Threshold | Answered | Correct when answered |
|---|---|---|
| 0.5 | 160/160 (100.0%) | 160/160 |
| 0.7 | 160/160 (100.0%) | 160/160 |
| 0.8 | 160/160 (100.0%) | 160/160 |
| 0.9 | 160/160 (100.0%) | 160/160 |
| 0.95 | 160/160 (100.0%) | 160/160 |
| 0.99 | 159/160 (99.4%) | 159/159 |
| 0.999 | 157/160 (98.1%) | 157/157 |

## Leave one domain out

Retrained with identical settings on train preparations from the other three domains, tested on the held-out domain's test preparations. Every preparation belongs to one domain, so this is also preparation-disjoint.

| Held-out domain | Trained on | MLP | Baseline |
|---|---|---|---|
| daylight_phone_a | 240 captures | 40/40 (100.0%), preparations [67.6%, 100.0%] | 40/40 (100.0%) |
| fluorescent_phone_b | 240 captures | 40/40 (100.0%), preparations [67.6%, 100.0%] | 40/40 (100.0%) |
| shade_phone_b | 240 captures | 40/40 (100.0%), preparations [67.6%, 100.0%] | 40/40 (100.0%) |
| tungsten_phone_a | 240 captures | 40/40 (100.0%), preparations [67.6%, 100.0%] | 39/40 (97.5%) |

## Constructed probes (not captures)

| Probe | RGB | Deployed decision |
|---|---|---|
| bare paper | (240, 240, 235) | abstain out_of_range |
| black | (10, 10, 10) | abstain out_of_range |
| mid grey | (128, 128, 128) | abstain out_of_range |
| blue/green midpoint | (37, 157, 187) | abstain model_uncertain |
| amber/red midpoint | (242, 113, 40) | suggest bin_2 |
| magenta | (230, 40, 230) | abstain out_of_range |

Without the range guard, black and magenta score 100% as SYN-D and mid grey 99% as SYN-A: a probability threshold cannot catch inputs unlike any fixture, so the range guard does. **The amber/red midpoint is still suggested as SYN-C with high confidence.** The training data has no captures near that boundary, so the model has never learned to be unsure there. For a real kit with adjacent shades this is the failure to expect; it needs boundary examples in training or a different abstention method, not a tighter threshold.

## int8 variant

Rule (fixed before measuring): adopt only with no changed validation prediction, ≥ 25% smaller file and ≥ 10% lower median latency.

- changed predictions: 0/160 (needs 0)
- file size: 896 → 1859 bytes, saving -107% (needs ≥ 25%)
- median latency: 47.3 → 21.8 µs, saving 54% (needs ≥ 10%)
- on the locked test: 0/160 predictions changed
- **Not adopted: fp32 stays.** For a 68-parameter model, quantization adds more graph than it removes.

Latency is desktop CPU (onnxruntime, one capture per call); the phone's figure comes from the Model check screen.

## Release gates

| Gate | Result | Evidence |
|---|---|---|
| G1 data | **FAIL** | trained and tested only on SYNTHETIC renders (data_mode synthetic) |
| G2 test | **FAIL** | preparation accuracy Wilson lower bound 89.3% (needs ≥ 90%) |
| G3 coverage | **FAIL** | coverage 100.0%, selective accuracy over answered preparations, Wilson lower bound 89.3% (needs ≥ 90% and ≥ 95%). Tightened after the first run: that run used the cluster-bootstrap bound, which collapses to 100% at perfect accuracy |
| G4 domains | pass | worst held-out domain 100.0% (needs ≥ 90%) |
| G5 probes | pass | non-fixture probes abstain: bare paper, black, mid grey, magenta |
| G6 review | **FAIL** | no domain reviewer has seen this model |

**Model status: research.** `model-manifest.json` keeps `status: research`, and the app labels every suggestion as research-only.

Why G2 and G3 fail even at 100% observed accuracy: 32 test preparations cannot establish more than 89.3% with 95% confidence. Showing ≥ 90% needs at least 35 preparations, all correct; ≥ 95% needs at least 73. The next test set must be sized for the claim it is meant to support.

## Provenance

- manifest_digest: `e359caf4cecd36ed5dfd540ea97df6381fddd344667e3625d0d5c2eda4f0b4fd`
- splits_salt: `jalsakshi-splits-v1`
- git_commit_at_run: `a108440`
- python: `3.13.7`
- numpy: `2.3.2`
- generated_at: `2026-09-24 16:35 UTC`
- test split opened with allow_locked_test=True by: `python -m ml.release_evaluation`
