# Model card — syn-color-001-mlp v1

**Status: RESEARCH ONLY, trained on SYNTHETIC data.** This model cannot be
approved for operational use: nothing it has seen is a real photograph, a
real kit or a real water sample.

## What it is

| | |
|---|---|
| Task | Given the schema-v1 median RGB of a hand-marked region in a photo of a SYN-COLOR-001 fixture, name which of the four fixture bins it shows |
| Architecture | Standardise → dense 3→8 → ReLU → dense 8→4 → logits. 68 parameters |
| File | `apps/mobile/assets/syn-color-001-mlp.v1.onnx`, 896 bytes, ONNX opset 13 / IR 8. SHA-256 in `apps/mobile/assets/model-manifest.json` |
| Runs | On the phone, offline, through the already-bundled `onnxruntime-react-native` |
| Output | Four logits. The app turns them into a suggestion or an abstention using the manifest's separately versioned calibration block (T27); no confidence number is shown to anyone |
| Training | scikit-learn `MLPClassifier`, lbfgs, α = 1e-3, seed 0, on the frozen **train** split only (`python -m ml.train`) |

## Intended use

- Demonstrating and testing, end to end, that a bundled model can run offline
  on the phone and that its output flows through the review step correctly.
- In the app it only ever **suggests** a bin, labelled research-only, and only
  when timing and capture quality pass. The worker always makes the reading.

## Not for

- Any statement about water: quality, safety, potability or concentration.
- Any real kit. SYN-COLOR-001 is a printed colour card with no chemistry.
- Any decision without a human reading. It never closes, opens or changes a
  case.

## Data

Synthetic feasibility set (`docs/data-protocol.md`): 4 fixture colours ×
4 simulated capture domains × 8 simulated printed preparations × 5 captures =
640 captures, 128 preparations. Split by preparation, 64/32/32 preparations
(320/160/160 captures). Labels are the rendered fixture, never a model's
output.

## Evaluation so far

Validation, 160 captures from 32 preparations (`ml/reports/comparison.md`):
MLP 160/160, baseline (nearest fixture colour) 159/160. Its one miss is blue
read as green under a warm tungsten cast at low exposure. With 32
preparations, a perfect score only establishes accuracy above about 89%
(Wilson 95% lower bound). The gap is one capture, so this shows the MLP is not
worse than the baseline, not that it is better.

The locked test split, calibration, abstention/coverage, leave-one-domain-out
and the int8 decision are reported in `ml/reports/release-evaluation.md` (T27).

## Limitations

- **Easy, synthetic task.** Four very different colours; every candidate is
  near ceiling. A real kit's adjacent shades would be much harder, and nothing
  here predicts how the model would do on them.
- **The nuisance model is illustrative.** Illuminant casts, noise and glare
  ranges were chosen by the agent, not measured.
- **Inputs are one median colour.** The model cannot see glare, blur or the
  reference card. Those are the quality gate's job (T10), and in the live
  capture flow that gate cannot pass yet because no card locator exists, so
  the model does not suggest there.

## Licences

| Component | Licence | Shipped? |
|---|---|---|
| This repository's code, including training and export | **None declared.** No LICENSE file exists. The project owner must choose one before distribution | — |
| Model weights | Derived only from data this repository generated. No third-party data or third-party rights involved | Yes |
| scikit-learn 1.7.1 | BSD-3-Clause | No (training only) |
| NumPy 2.3.2 | BSD-3-Clause | No (training only) |
| onnx 1.19.1 | Apache-2.0 | No (export only, in a throwaway environment) |
| ONNX Runtime (via onnxruntime-react-native 1.24.3) | MIT | Yes, already a dependency |

## Reproducing

```
python -m ml.feasibility_set          # data (or --check to verify)
python -m ml.splits                   # only if the manifest changes
python -m ml.train                    # candidates, selection, artifact
<throwaway venv>/python -m ml.export  # ONNX + manifest (see ml/export.py)
python -m ml.golden                   # app parity vectors
python -m unittest discover -s ml/tests -v
```
