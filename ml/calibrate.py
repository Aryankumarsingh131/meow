"""T27: calibrate the exported model, on validation only.

Writes the manifest's `calibration` block. Nothing here reads the test split.
All three rules are fixed in this file BEFORE the locked test is evaluated
(ml/release_evaluation.py), and none is ever refitted after it.

1. Temperature T: minimises validation NLL over T in [1, 20]. Floored at 1:
   calibration may soften the model, never sharpen it. On this synthetic
   validation set the model makes no errors, so NLL keeps falling below 1 -
   there is no evidence for sharpening, and the floor is where it lands.
2. Abstention threshold: 0.90, a POLICY value, not fitted. With no validation
   errors there is nothing to fit it against; ml/reports/release-evaluation.md
   shows the validation risk-coverage trade-off around it.
3. Range guard: abstain when the input's RGB is further from every class
   centroid than 1.25 x the largest distance any TRAIN capture has from its
   own class centroid. A softmax threshold cannot catch inputs unlike any
   fixture (black and magenta score 100% as SYN-D), so this guard does.

    python -m ml.calibrate      # then python -m ml.golden
"""

from __future__ import annotations

import json

import numpy as np

from ml import evaluate, golden, train

VERSION = "cal-v1"
T_GRID = np.round(np.concatenate([np.arange(1.0, 3.0, 0.01), np.arange(3.0, 20.01, 0.25)]), 4)
ABSTAIN_BELOW = 0.90
RANGE_MARGIN = 1.25


def nll(logits: np.ndarray, truth_index: np.ndarray, temperature: float) -> float:
    p = train.softmax(logits, temperature)
    return float(-np.log(np.clip(p[np.arange(len(truth_index)), truth_index], 1e-300, 1.0)).mean())


def fit_temperature(logits: np.ndarray, truth_index: np.ndarray) -> tuple[float, dict[float, float]]:
    curve = {float(t): nll(logits, truth_index, float(t)) for t in T_GRID}
    return min(curve, key=curve.get), curve


def fit_range(train_recs: list[dict], classes: list[str]) -> dict:
    x, y = evaluate.matrix(train_recs), evaluate.labels(train_recs)
    centroids = np.array([x[y == c].mean(0) for c in classes])
    own = np.sqrt(((x - centroids[[classes.index(v) for v in y]]) ** 2).sum(1))
    return {"centroids": np.round(centroids, 3).tolist(), "max_distance": round(float(own.max() * RANGE_MARGIN), 3),
            "train_max_distance": round(float(own.max()), 3), "margin": RANGE_MARGIN}


def main() -> None:
    manifest = json.loads(golden.MANIFEST_PATH.read_text(encoding="utf-8"))
    classes = manifest["output"]["classes"]
    val = evaluate.records("val")
    logits = golden.onnx_logits(evaluate.matrix(val)).astype(np.float64)
    truth = np.array([classes.index(v) for v in evaluate.labels(val)])
    temperature, curve = fit_temperature(logits, truth)
    manifest["calibration"] = {
        "version": VERSION,
        "temperature": temperature,
        "abstain_below": ABSTAIN_BELOW,
        "range": fit_range(evaluate.records("train"), classes),
        "fitted_on": "temperature: validation NLL (floored at 1); range: train split; threshold: policy",
        "validation_nll": {"at_1": round(curve[1.0], 8), "at_fitted": round(curve[temperature], 8)},
    }
    golden.MANIFEST_PATH.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(f"{VERSION}: T={temperature}, abstain_below={ABSTAIN_BELOW}, range={manifest['calibration']['range']['max_distance']}")


if __name__ == "__main__":
    main()
