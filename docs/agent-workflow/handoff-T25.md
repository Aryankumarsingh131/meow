# Handoff — T25 train and select a small local model

- Task: T25 / REQ-005, REQ-019. Owner B/ML; carried by the agent.
- Status: **`[~]` built and verified on synthetic data.** Outstanding: real data, and a licence for the repository (none is declared; see the model card).

## What was built

| File | Purpose |
|---|---|
| `ml/train.py` | Baseline, kNN (k=5) and MLP 3-8-4 on the same frozen splits, chosen on validation only. Selection rule fixed before results: MLP exported if val accuracy ≥ baseline's |
| `ml/artifacts/syn-color-001-mlp.v1.json` | Weights, standardisation, run config (seed 0, scikit-learn 1.7.1). Self-checked against scikit-learn |
| `ml/export.py` | ONNX opset 13 / IR 8, same as the device-proven probe. Runs in a throwaway venv (`onnx` is not a repo dependency) |
| `apps/mobile/assets/syn-color-001-mlp.v1.onnx` | 896 bytes, 68 parameters, SHA-256 `597d667f…202e` |
| `apps/mobile/assets/model-manifest.json` | Model id, SHA, input/output contract, classes; calibration block from T27 |
| `ml/golden.py`, `apps/mobile/assets/model-golden.json` | 23 validation captures + 6 constructed probes with onnxruntime logits and expected decisions |
| `ml/tests/test_export_parity.py` | ONNX logits match the trained weights on all 480 development captures (< 1e-3); manifest describes the file |
| `ml/model-card.md`, `ml/reports/comparison.md` | Use, limits, licences; the comparison |

## Result

Validation: MLP 160/160, baseline 159/160, kNN 160/160. The gap is one capture, so the MLP is **not worse**, not better.

## Verification (2026-09-24)

`python -m ml.train`; export in the throwaway venv; `python -m unittest discover -s ml/tests -v` (19/19 with T24).
