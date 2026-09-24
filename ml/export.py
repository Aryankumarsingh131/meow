"""T25: export the selected candidate to ONNX for the app.

Opset 13 / IR 8, the same settings as the probe model the device runtime
already runs (apps/mobile/make_probe_model.py). Graph:

    features[N,3] -> (x - mean) / std -> MatMul+Add -> Relu -> MatMul+Add -> logits[N,4]

Calibration (temperature, abstention threshold) is deliberately NOT in the
graph. It lives in model-manifest.json as its own versioned block (T27), so
recalibrating never changes the model file or its SHA-256.

Needs the `onnx` package, which is not a repo dependency. Like the probe model
(toolchain-matrix.md), run it in a throwaway environment:

    python -m venv %TEMP%\\jalsakshi-onnx-export
    %TEMP%\\jalsakshi-onnx-export\\Scripts\\pip install onnx==1.19.1
    %TEMP%\\jalsakshi-onnx-export\\Scripts\\python -m ml.export

Standalone on purpose: stdlib, numpy and onnx only.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_PATH = ROOT / "ml" / "artifacts" / "syn-color-001-mlp.v1.json"
MODEL_PATH = ROOT / "apps" / "mobile" / "assets" / "syn-color-001-mlp.v1.onnx"
MANIFEST_PATH = ROOT / "apps" / "mobile" / "assets" / "model-manifest.json"


def build(artifact: dict) -> onnx.ModelProto:
    n_in, n_out = len(artifact["features"]), len(artifact["classes"])
    (l1, l2) = artifact["layers"]
    f32 = lambda v, name: numpy_helper.from_array(np.asarray(v, dtype=np.float32), name)  # noqa: E731
    inits = [
        f32(np.reshape(artifact["standardise"]["mean"], (1, n_in)), "mean"),
        f32(np.reshape(artifact["standardise"]["std"], (1, n_in)), "std"),
        f32(l1["weights"], "w1"), f32(l1["bias"], "b1"),
        f32(l2["weights"], "w2"), f32(l2["bias"], "b2"),
    ]
    nodes = [
        helper.make_node("Sub", ["features", "mean"], ["centred"]),
        helper.make_node("Div", ["centred", "std"], ["scaled"]),
        helper.make_node("MatMul", ["scaled", "w1"], ["h1"]),
        helper.make_node("Add", ["h1", "b1"], ["a1"]),
        helper.make_node("Relu", ["a1"], ["r1"]),
        helper.make_node("MatMul", ["r1", "w2"], ["h2"]),
        helper.make_node("Add", ["h2", "b2"], ["logits"]),
    ]
    graph = helper.make_graph(
        nodes, "syn_color_001_mlp_v1",
        [helper.make_tensor_value_info("features", TensorProto.FLOAT, ["N", n_in])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["N", n_out])],
        inits,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_operatorsetid("", 13)], ir_version=8,
                              producer_name="jalsakshi-ml-export", doc_string=(
                                  "SYNTHETIC research model for SYN-COLOR-001. Classifies a schema-v1 median RGB into "
                                  "a fixture bin. Not a water-quality, safety or potability model."))
    for key in ("model_id", "version", "status", "data_mode"):
        model.metadata_props.add(key=key, value=str(artifact[key]))
    onnx.checker.check_model(model)
    return model


def manifest_block(artifact: dict, data: bytes) -> dict:
    return {
        "model_id": artifact["model_id"],
        "version": artifact["version"],
        "status": artifact["status"],
        "data_mode": artifact["data_mode"],
        "file": MODEL_PATH.name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "protocol": artifact["protocol"],
        "input": {"name": "features", "shape": ["N", len(artifact["features"])], "dtype": "float32",
                  "feature_schema_version": artifact["feature_schema_version"], "features": artifact["features"]},
        "output": {"name": "logits", "classes": artifact["classes"]},
    }


def main() -> None:
    artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
    if not artifact["selection"]["selected"]:
        raise SystemExit("candidate was not selected (ml/reports/comparison.md); nothing to export")
    data = build(artifact).SerializeToString()
    MODEL_PATH.write_bytes(data)
    existing = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else {}
    block = manifest_block(artifact, data)
    if existing.get("sha256") != block["sha256"]:
        existing["calibration"] = None  # a new model file invalidates any previous calibration
    manifest = {"manifest_version": 1, **block, "calibration": existing.get("calibration")}
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {MODEL_PATH.name} ({len(data)} bytes, sha256 {block['sha256'][:16]}...)")


if __name__ == "__main__":
    main()
