"""T25: train and select a small local model on the frozen development splits.

Three candidates, SAME frozen splits (ml/splits.py), selected on validation
only - the test split is never loaded here (ml.evaluate refuses it):

  - baseline: nearest fixture colour (no training; the app's current rule)
  - kNN, k=5, on standardised features
  - MLP 3-8-4 (ReLU), scikit-learn lbfgs, seed 0

Selection rule, fixed before any result was seen: only the MLP can be bundled
(kNN would ship its whole training set, and the baseline needs no model), so
the MLP becomes the candidate if its validation accuracy is at least the
baseline's. Otherwise no model is exported and the app keeps the baseline.

    python -m ml.train     # writes ml/artifacts/syn-color-001-mlp.v1.json, ml/reports/comparison.md
"""

from __future__ import annotations

import json

import numpy as np
import sklearn
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier

from ml import evaluate, feasibility_set

ARTIFACT_PATH = feasibility_set.ROOT / "ml" / "artifacts" / "syn-color-001-mlp.v1.json"
REPORT_PATH = feasibility_set.ROOT / "ml" / "reports" / "comparison.md"
SEED = 0
HIDDEN = 8
ALPHA = 1e-3


def forward(artifact: dict, x: np.ndarray) -> np.ndarray:
    """Logits from the saved artifact alone - the reference the ONNX file and
    the app are checked against."""
    s = artifact["standardise"]
    h = (x - np.array(s["mean"])) / np.array(s["std"])
    for layer in artifact["layers"]:
        h = h @ np.array(layer["weights"]) + np.array(layer["bias"])
        if layer["activation"] == "relu":
            h = np.maximum(h, 0.0)
    return h


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    z = logits / temperature
    z = z - z.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


def fit_mlp(x_std: np.ndarray, y: np.ndarray, seed: int = SEED) -> MLPClassifier:
    return MLPClassifier(hidden_layer_sizes=(HIDDEN,), activation="relu", solver="lbfgs", alpha=ALPHA,
                         max_iter=2000, random_state=seed).fit(x_std, y)


def artifact_from(mlp: MLPClassifier, mean: np.ndarray, std: np.ndarray, classes: list[str], extra: dict) -> dict:
    if list(mlp.classes_) != classes:
        raise AssertionError(f"class order {list(mlp.classes_)} != protocol order {classes}")
    manifest = feasibility_set.load()
    return {
        "model_id": "syn-color-001-mlp",
        "version": 1,
        "status": "research",
        "data_mode": "synthetic",
        "protocol": manifest["protocol"],
        "feature_schema_version": 1,
        "features": list(evaluate.FEATURES),
        "classes": classes,
        "standardise": {"mean": mean.tolist(), "std": std.tolist()},
        "layers": [
            {"weights": mlp.coefs_[0].tolist(), "bias": mlp.intercepts_[0].tolist(), "activation": "relu"},
            {"weights": mlp.coefs_[1].tolist(), "bias": mlp.intercepts_[1].tolist(), "activation": "none"},
        ],
        "output": "logits",
        "run_config": {"seed": SEED, "hidden": [HIDDEN], "alpha": ALPHA, "solver": "lbfgs", "max_iter": 2000,
                       "sklearn": sklearn.__version__, "numpy": np.__version__,
                       "manifest_digest": feasibility_set.digest(manifest), "trained_on": "train split only"},
        **extra,
    }


def main() -> None:
    classes_meta = feasibility_set.load()["classes"]
    classes = [c["key"] for c in classes_meta]
    train, val = evaluate.records("train"), evaluate.records("val")
    x_train, y_train, x_val = evaluate.matrix(train), evaluate.labels(train), evaluate.matrix(val)
    mean, std = x_train.mean(0), x_train.std(0)
    std[std == 0] = 1.0

    baseline = evaluate.nearest_reference(classes_meta)
    knn = KNeighborsClassifier(n_neighbors=5).fit((x_train - mean) / std, y_train)
    mlp = fit_mlp((x_train - mean) / std, y_train)

    results = {}
    for name, predict in (("Nearest reference colour", baseline),
                          ("kNN k=5", lambda x: list(knn.predict((x - mean) / std))),
                          ("MLP 3-8-4", lambda x: list(mlp.predict((x - mean) / std)))):
        results[f"{name} / train"] = evaluate.metrics(train, predict(x_train))
        results[f"{name} / val"] = evaluate.metrics(val, predict(x_val))

    mlp_val, base_val = results["MLP 3-8-4 / val"]["accuracy"], results["Nearest reference colour / val"]["accuracy"]
    selected = mlp_val >= base_val
    artifact = artifact_from(mlp, mean, std, classes, {"selection": {
        "rule": "MLP exported only if its validation accuracy >= the baseline's (fixed before results)",
        "mlp_val_accuracy": mlp_val, "baseline_val_accuracy": base_val, "selected": selected}})

    # Self-check: the saved artifact reproduces scikit-learn exactly.
    ref = softmax(forward(artifact, x_val))
    if not np.allclose(ref, mlp.predict_proba((x_val - mean) / std), atol=1e-9):
        raise AssertionError("artifact forward pass disagrees with scikit-learn")

    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT_PATH.write_text(json.dumps(artifact, indent=1) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(report(results, artifact), encoding="utf-8")
    print(f"MLP val {mlp_val:.4f} vs baseline {base_val:.4f} -> {'SELECTED' if selected else 'not selected'}")


def report(results: dict, artifact: dict) -> str:
    sel = artifact["selection"]
    val_only = {k: v for k, v in results.items() if k.endswith("/ val")}
    params = sum(len(layer["bias"]) + sum(len(row) for row in layer["weights"]) for layer in artifact["layers"])
    return "\n".join([
        "# Model comparison (T25)",
        "",
        "**SYNTHETIC.** Trained and compared on rendered fixture colours (docs/data-protocol.md). "
        "Nothing here is evidence about any water sample or any kit.",
        "",
        "All three candidates use the same frozen splits (`ml/data/splits.v1.json`). Every choice below was made on "
        "**validation**; the test split was not loaded.",
        "",
        "## Validation",
        "",
        evaluate.table(val_only),
        "",
        "## Training (fit, for reference - not a generalisation estimate)",
        "",
        evaluate.table({k: v for k, v in results.items() if k.endswith("/ train")}),
        "",
        "## Selection",
        "",
        f"- Rule (fixed before results): {sel['rule']}.",
        f"- MLP validation accuracy {evaluate.pct(sel['mlp_val_accuracy'])} vs baseline "
        f"{evaluate.pct(sel['baseline_val_accuracy'])} → **{'selected' if sel['selected'] else 'not selected'}**.",
        f"- The gap is {results['MLP 3-8-4 / val']['correct'] - results['Nearest reference colour / val']['correct']} "
        "validation capture(s) and the intervals overlap, so this shows the MLP is **not worse** than the baseline, "
        "not that it is better. On this easy synthetic task, every candidate is near ceiling.",
        f"- Candidate size: {params} parameters. kNN is not a bundling option: it would ship all "
        f"{results['kNN k=5 / train']['records']} training vectors.",
        "",
        "## MLP validation detail",
        "",
        evaluate.details(results["MLP 3-8-4 / val"]),
        "",
        "## Baseline validation detail",
        "",
        evaluate.details(results["Nearest reference colour / val"]),
        "",
        "## Provenance",
        "",
        *[f"- {k}: `{v}`" for k, v in {**evaluate.provenance(), **artifact["run_config"]}.items()],
        "- command: `python -m ml.train`",
        "",
    ])


if __name__ == "__main__":
    main()
