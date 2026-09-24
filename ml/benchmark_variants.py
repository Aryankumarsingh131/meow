"""T27: is an int8 variant worth shipping instead of fp32?

Adoption rule, fixed before measuring: int8 replaces fp32 only if it changes
NO validation prediction, AND its file is at least 25% smaller, AND its median
single-capture latency is at least 10% lower. Anything less is not a paired
benefit, and fp32 stays.

Two steps, because quantization needs `onnx` (not a repo dependency):

    <throwaway venv>/python -m ml.benchmark_variants quantize   # writes the int8 file
    python -m ml.benchmark_variants                              # compares (validation only)

Module-level imports are stdlib only, so the quantize step needs nothing
beyond onnx + onnxruntime in the throwaway environment.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FP32 = ROOT / "apps" / "mobile" / "assets" / "syn-color-001-mlp.v1.onnx"
INT8 = ROOT / "ml" / "artifacts" / "syn-color-001-mlp.v1.int8.onnx"
MIN_SIZE_SAVING = 0.25
MIN_LATENCY_SAVING = 0.10
LATENCY_RUNS = 2000


def quantize() -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(str(FP32), str(INT8), weight_type=QuantType.QInt8)
    print(f"wrote {INT8.relative_to(ROOT)} ({INT8.stat().st_size} bytes)")


def _median_latency_us(session, rows) -> float:
    import numpy as np

    for row in rows[:50]:
        session.run(["logits"], {"features": row})
    times = []
    for i in range(LATENCY_RUNS):
        row = rows[i % len(rows)]
        started = time.perf_counter()
        session.run(["logits"], {"features": row})
        times.append(time.perf_counter() - started)
    return float(np.median(times) * 1e6)


def compare(x) -> dict:
    """Paired comparison of fp32 and int8 on the same inputs."""
    import numpy as np
    import onnxruntime as ort

    fp32, int8 = (ort.InferenceSession(str(p), providers=["CPUExecutionProvider"]) for p in (FP32, INT8))
    x32 = np.asarray(x, dtype=np.float32)
    a, b = (s.run(["logits"], {"features": x32})[0] for s in (fp32, int8))
    rows = [x32[i:i + 1] for i in range(len(x32))]
    return {
        "fp32_bytes": FP32.stat().st_size,
        "int8_bytes": INT8.stat().st_size,
        "fp32_latency_us": _median_latency_us(fp32, rows),
        "int8_latency_us": _median_latency_us(int8, rows),
        "changed_predictions": int((a.argmax(1) != b.argmax(1)).sum()),
        "max_logit_difference": float(np.abs(a - b).max()),
        "fp32_pred": a.argmax(1),
        "int8_pred": b.argmax(1),
        "n": len(x32),
    }


def adopt(result: dict) -> tuple[bool, list[str]]:
    size_saving = 1 - result["int8_bytes"] / result["fp32_bytes"]
    latency_saving = 1 - result["int8_latency_us"] / result["fp32_latency_us"]
    reasons = [
        f"changed predictions: {result['changed_predictions']}/{result['n']} (needs 0)",
        f"file size: {result['fp32_bytes']} → {result['int8_bytes']} bytes, saving {100 * size_saving:.0f}% "
        f"(needs ≥ {100 * MIN_SIZE_SAVING:.0f}%)",
        f"median latency: {result['fp32_latency_us']:.1f} → {result['int8_latency_us']:.1f} µs, saving "
        f"{100 * latency_saving:.0f}% (needs ≥ {100 * MIN_LATENCY_SAVING:.0f}%)",
    ]
    ok = (result["changed_predictions"] == 0 and size_saving >= MIN_SIZE_SAVING
          and latency_saving >= MIN_LATENCY_SAVING)
    return ok, reasons


if __name__ == "__main__":
    if sys.argv[1:] == ["quantize"]:
        quantize()
    else:
        from ml import evaluate

        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
        outcome = compare(evaluate.matrix(evaluate.records("val")))
        adopted, why = adopt(outcome)
        print("\n".join(why))
        print("int8 ADOPTED" if adopted else "int8 NOT adopted: fp32 stays")
