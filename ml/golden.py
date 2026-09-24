"""Golden vectors for app-side parity (T26), from the ACTUAL ONNX file.

Two lists, both replayed by the app's Node test and the on-device Model check
screen:

- `vectors`: validation captures only (the test split stays locked), one per
  (class, domain) plus the eight least confident. Features, the logits
  onnxruntime (CPU) produced for them, and the decision the app must reach.
- `probes`: constructed inputs that are NOT captures (bare paper, black,
  grey, colour midpoints, magenta), which exercise the out-of-range guard and
  the abstention threshold.

    python -m ml.golden     # rerun after ml.export or ml.calibrate
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import onnxruntime as ort

from ml import evaluate, feasibility_set, train

ASSETS = feasibility_set.ROOT / "apps" / "mobile" / "assets"
MODEL_PATH = ASSETS / "syn-color-001-mlp.v1.onnx"
MANIFEST_PATH = ASSETS / "model-manifest.json"
GOLDEN_PATH = ASSETS / "model-golden.json"
LOGIT_TOLERANCE = 1e-3

PROBES = {
    "bare paper": [240.0, 240.0, 235.0],
    "black": [10.0, 10.0, 10.0],
    "mid grey": [128.0, 128.0, 128.0],
    "blue/green midpoint": [37.0, 157.0, 187.0],
    "amber/red midpoint": [242.0, 113.0, 40.0],
    "magenta": [230.0, 40.0, 230.0],
}


def onnx_logits(x: np.ndarray) -> np.ndarray:
    session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    return session.run(["logits"], {"features": x.astype(np.float32)})[0]


def decide(logits, manifest: dict, rgb) -> dict:
    """The rule apps/mobile/src/analysis/model.ts implements, stated once here.
    Order matters and is the same in both: calibration, output, range, threshold."""
    calibration = manifest["calibration"]
    if calibration is None:
        return {"kind": "abstain", "reason": "not_calibrated"}
    logits = np.asarray(logits, dtype=np.float64)
    if logits.shape != (len(manifest["output"]["classes"]),) or not np.isfinite(logits).all():
        return {"kind": "abstain", "reason": "output_invalid"}
    centroids = np.asarray(calibration["range"]["centroids"], dtype=np.float64)
    if np.sqrt(((centroids - np.asarray(rgb, dtype=np.float64)) ** 2).sum(1)).min() > calibration["range"]["max_distance"]:
        return {"kind": "abstain", "reason": "out_of_range"}
    p = train.softmax(logits, calibration["temperature"])
    best = int(p.argmax())
    if p[best] < calibration["abstain_below"]:
        return {"kind": "abstain", "reason": "model_uncertain"}
    return {"kind": "suggest", "bin": manifest["output"]["classes"][best]}


def select(val: list[dict], logits: np.ndarray) -> list[int]:
    chosen: dict[tuple[str, str], int] = {}
    for i, r in enumerate(val):
        chosen.setdefault((r["label"], r["domain"]), i)
    margin = np.sort(train.softmax(logits), axis=1)
    hardest = np.argsort(margin[:, -1] - margin[:, -2])[:8]
    return sorted(set(chosen.values()) | {int(i) for i in hardest})


def _entry(features, logits, manifest) -> dict:
    stored = [round(float(v), 6) for v in logits]
    # Decide on the stored (rounded) logits, so the app replays identical inputs.
    return {"features": [float(v) for v in features], "logits": stored, "expected": decide(stored, manifest, features)}


def write() -> dict:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest() != manifest["sha256"]:
        raise AssertionError("model file does not match model-manifest.json")
    val = evaluate.records("val")
    x = evaluate.matrix(val)
    logits = onnx_logits(x)
    probe_x = np.array(list(PROBES.values()))
    probe_logits = onnx_logits(probe_x)
    golden = {
        "status": "SYNTHETIC validation captures and constructed probes; parity fixtures, not water readings.",
        "model_sha256": manifest["sha256"],
        "calibration_version": (manifest["calibration"] or {}).get("version"),
        "logit_tolerance": LOGIT_TOLERANCE,
        "vectors": [{"record_id": val[i]["record_id"], "label": val[i]["label"], "domain": val[i]["domain"],
                     **_entry(x[i], logits[i], manifest)} for i in select(val, logits)],
        "probes": [{"name": name, **_entry(probe_x[i], probe_logits[i], manifest)} for i, name in enumerate(PROBES)],
    }
    GOLDEN_PATH.write_text(json.dumps(golden, indent=1) + "\n", encoding="utf-8")
    return golden


if __name__ == "__main__":
    g = write()
    print(f"wrote {len(g['vectors'])} vectors + {len(g['probes'])} probes (calibration {g['calibration_version']})")
