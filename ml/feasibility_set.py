"""T23: synthetic, protocol-grounded feasibility set for SYN-COLOR-001.

SYNTHETIC. The blueprint's T23 needs a real kit, real preparations and a
laboratory reference method; none exists, so T23 itself stays blocked. What
this module builds instead: every record is a JPEG rendered from one of the
four SYN-COLOR-001 fixture colours (synthetic-demo-protocol.md), pushed
through a documented, simulated print -> light -> camera chain, then through
the REAL schema-v1 feature pipeline (tests/capture_golden_reference.py, T04's
Python leg). Only the photograph is simulated; the features come from the
same code path a capture takes.

Labels are the fixture that was rendered (`label_source: synthetic_render`):
known by construction, never produced by a model.

A `group_id` is one simulated physical preparation (one printed card). Its
captures share that card's printing error, so they are correlated and must
never be split across train/val/test (ml/splits.py). Each group is captured
in exactly one `domain`, so holding out a domain is also group-disjoint.

    python -m ml.feasibility_set           # regenerate the manifest
    python -m ml.feasibility_set --check   # re-render records and compare
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
from pathlib import Path
from uuid import UUID, uuid5

import numpy as np
from PIL import Image, ImageFilter
from PIL import __version__ as PIL_VERSION

from ml.quality_baseline import SYN_COLOR_001_SWATCHES
from tests.capture_golden_reference import compute_features, point_in_quad

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL_PATH = ROOT / "protocols" / "SYN-COLOR-001.v1.json"
MANIFEST_PATH = ROOT / "ml" / "data" / "syn-color-001.feasibility.v1.json"

SEED = 20260924
GROUPS_PER_CELL = 8  # per (class, domain)
CAPTURES_PER_GROUP = 5
W, H = 96, 72
PATCH = ((22.0, 14.0), (74.0, 17.0), (71.0, 58.0), (19.0, 55.0))  # printed tile, upright frame, TL TR BR BL
ORIENTATIONS = (1, 3, 6, 8)
_NAMESPACE = UUID("5d6f6a3e-1b1e-4c8e-9a53-7f0c2b8d9e41")

# Simulated capture domains: an illuminant cast (per-channel gain) and sensor
# noise. Illustrative values spanning warm/cool casts - NOT measured illuminants.
DOMAINS: dict[str, dict] = {
    "daylight_phone_a": {"cast": (1.00, 1.00, 1.00), "noise_sigma": 2.0},
    "tungsten_phone_a": {"cast": (1.12, 0.98, 0.80), "noise_sigma": 3.0},
    "fluorescent_phone_b": {"cast": (0.96, 1.06, 0.97), "noise_sigma": 4.0},
    "shade_phone_b": {"cast": (0.90, 0.97, 1.10), "noise_sigma": 5.0},
}


def load_protocol() -> dict:
    return json.loads(PROTOCOL_PATH.read_text(encoding="utf-8"))


def classes(protocol: dict) -> list[dict]:
    """Protocol bins in ordinal order, each with its fixture colour. A bin
    whose chart value has no documented colour is an error, never a guess."""
    out = []
    for b in sorted(protocol["bins"], key=lambda b: b["ordinal"]):
        rgb = SYN_COLOR_001_SWATCHES.get(b["chart_value"])
        if rgb is None:
            raise ValueError(f"no documented fixture colour for {b['chart_value']}")
        out.append({"key": b["key"], "chart_value": b["chart_value"], "rgb": tuple(rgb)})
    return out


def _mask(quad) -> np.ndarray:
    return np.array([[point_in_quad(x + 0.5, y + 0.5, quad) for x in range(W)] for y in range(H)])


_PATCH_MASK = _mask(PATCH)


def _stored(upright: np.ndarray, orientation: int) -> np.ndarray:
    """Physically stored pixels such that EXIF `orientation` corrects back to
    `upright`. Pinned by orientation_self_check(), not by reasoning."""
    return {1: upright, 3: np.rot90(upright, 2), 6: np.rot90(upright, 1), 8: np.rot90(upright, -1)}[orientation]


def _write_jpeg(pixels: np.ndarray, orientation: int, quality: int, blur: float, path: Path) -> None:
    img = Image.fromarray(pixels, "RGB")
    if blur > 0:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    exif = Image.Exif()
    exif[0x0112] = orientation
    Image.fromarray(_stored(np.asarray(img), orientation), "RGB").save(path, "JPEG", quality=quality, exif=exif)


def orientation_self_check(workdir: Path) -> None:
    """One quadrant red, the rest blue, ROI on that quadrant: each orientation
    must read back red. A wrong rotation reads blue and raises."""
    upright = np.zeros((H, W, 3), np.uint8)
    upright[:] = (0, 0, 255)
    upright[: H // 2, : W // 2] = (255, 0, 0)
    roi = [(4, 4), (40, 4), (40, 30), (4, 30)]
    for orientation in ORIENTATIONS:
        path = workdir / f"orient-{orientation}.jpg"
        _write_jpeg(upright, orientation, 95, 0.0, path)
        f = compute_features(path, roi)
        if (f["upright_width"], f["upright_height"]) != (W, H) or f["median_r"] < 200 or f["median_b"] > 60:
            raise AssertionError(f"orientation {orientation} did not round-trip: {f}")


def _group_params(group_index: int) -> dict:
    rng = np.random.default_rng([SEED, group_index])
    return {
        "print_gain": np.clip(rng.normal(1.0, 0.04, 3), 0.85, 1.15).round(4).tolist(),
        "print_offset": rng.normal(0.0, 5.0, 3).round(2).tolist(),
        "paper_rgb": rng.uniform(232, 248, 3).round(1).tolist(),
    }


def _capture_params(group_index: int, capture_index: int) -> dict:
    rng = np.random.default_rng([SEED, group_index, capture_index])
    sloppy = bool(rng.random() < 0.10)
    centroid = np.mean(PATCH, axis=0)
    jitter = rng.normal(0.0, 5.0 if sloppy else 1.5, (4, 2))
    roi = np.clip(centroid + 0.8 * (np.array(PATCH) - centroid) + jitter, 0, [W - 1, H - 1])
    glare = bool(rng.random() < 0.20)
    return {
        "exposure": round(float(rng.uniform(0.72, 1.18)), 4),
        "glare": {"x": round(float(rng.uniform(22, 74)), 1), "y": round(float(rng.uniform(14, 58)), 1),
                  "radius": round(float(rng.uniform(8, 18)), 1), "strength": round(float(rng.uniform(0.3, 0.75)), 3)}
        if glare else None,
        "blur": round(float(rng.uniform(0.0, 1.2)), 3) if rng.random() < 0.5 else 0.0,
        "jpeg_quality": int(rng.integers(70, 96)),
        "orientation": int(rng.choice(ORIENTATIONS)),
        "sloppy_roi": sloppy,
        "roi_corners_upright": roi.round(2).tolist(),
        "noise_seed": int(rng.integers(0, 2**31 - 1)),
    }


def render(base_rgb, group: dict, domain: dict, capture: dict) -> np.ndarray:
    img = np.empty((H, W, 3))
    img[:] = group["paper_rgb"]
    printed = np.clip(np.array(base_rgb) * group["print_gain"] + group["print_offset"], 0, 255)
    img[_PATCH_MASK] = printed
    img = img * np.array(domain["cast"]) * capture["exposure"]
    if capture["glare"]:
        g = capture["glare"]
        yy, xx = np.mgrid[0:H, 0:W]
        alpha = g["strength"] * np.exp(-(((xx + 0.5 - g["x"]) ** 2 + (yy + 0.5 - g["y"]) ** 2) / g["radius"] ** 2))
        img = img * (1 - alpha[..., None]) + 255.0 * alpha[..., None]
    img = img + np.random.default_rng(capture["noise_seed"]).normal(0.0, domain["noise_sigma"], img.shape)
    return np.clip(np.rint(img), 0, 255).astype(np.uint8)


def _record(cls: dict, group_id: str, group_index: int, domain_name: str, capture_index: int,
            protocol: dict, workdir: Path) -> dict:
    group = _group_params(group_index)
    capture = _capture_params(group_index, capture_index)
    pixels = render(cls["rgb"], group, DOMAINS[domain_name], capture)
    path = workdir / f"{group_id}-{capture_index}.jpg"
    _write_jpeg(pixels, capture["orientation"], capture["jpeg_quality"], capture["blur"], path)
    features = compute_features(path, [tuple(p) for p in capture["roi_corners_upright"]])
    return {
        "record_id": str(uuid5(_NAMESPACE, f"{group_id}/{capture_index}")),
        "group_id": group_id,
        "capture_index": capture_index,
        "domain": domain_name,
        "label": cls["key"],
        "label_chart_value": cls["chart_value"],
        "label_source": "synthetic_render",
        "data_mode": "synthetic",
        "protocol": {"id": protocol["id"], "version": protocol["version"]},
        "render": {"group": group, "capture": capture, "domain": DOMAINS[domain_name]},
        "features": features,
        "permissions": {"personal_data": False, "consent": "not_applicable_synthetic", "reuse": "unrestricted_synthetic"},
    }


def _plan(protocol: dict):
    """Every (class, domain, group, capture) in a fixed order."""
    group_index = 0
    for cls in classes(protocol):
        for domain_name in DOMAINS:
            for _ in range(GROUPS_PER_CELL):
                group_index += 1
                for capture_index in range(CAPTURES_PER_GROUP):
                    yield cls, f"syn-prep-{group_index:04d}", group_index, domain_name, capture_index


def generate() -> dict:
    protocol = load_protocol()
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        orientation_self_check(workdir)
        records = [_record(*step, protocol, workdir) for step in _plan(protocol)]
    return {
        "manifest_version": 1,
        "status": "SYNTHETIC - rendered fixture colours through a simulated capture chain. Not a real-kit "
                  "feasibility set; nothing measured here says anything about any water sample or any kit.",
        "protocol": {"id": protocol["id"], "version": protocol["version"]},
        "generator": {"module": "ml/feasibility_set.py", "seed": SEED, "numpy": np.__version__, "pillow": PIL_VERSION,
                      "feature_pipeline": "tests/capture_golden_reference.py (schema_version 1)"},
        "classes": [{"key": c["key"], "chart_value": c["chart_value"], "fixture_rgb": list(c["rgb"])}
                    for c in classes(protocol)],
        "domains": DOMAINS,
        "record_count": len(records),
        "group_count": len({r["group_id"] for r in records}),
        "records": records,
    }


def digest(manifest: dict) -> str:
    """Over parsed content, so a CRLF checkout (core.autocrlf) hashes the same."""
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write(manifest: dict, path: Path = MANIFEST_PATH) -> None:
    head = {k: v for k, v in manifest.items() if k != "records"}
    lines = [json.dumps(r, sort_keys=True, separators=(",", ":")) for r in manifest["records"]]
    body = json.dumps(head, indent=1)[:-2] + ',\n "records": [\n' + ",\n".join(lines) + "\n ]\n}\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def load(path: Path = MANIFEST_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def check(sample_every: int = 53) -> None:
    """Re-render a spread of records from their stored parameters and require
    identical features: the manifest is reproducible, not hand-edited."""
    manifest, protocol = load(), load_protocol()
    by_key = {c["key"]: c for c in classes(protocol)}
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        orientation_self_check(workdir)
        for step in list(_plan(protocol))[::sample_every]:
            cls, group_id, group_index, domain_name, capture_index = step
            again = json.loads(json.dumps(
                _record(by_key[cls["key"]], group_id, group_index, domain_name, capture_index, protocol, workdir)))
            stored = next(r for r in manifest["records"] if r["record_id"] == again["record_id"])
            if stored != again:
                raise AssertionError(f"{again['record_id']} does not re-derive")
    print(f"ok: {len(list(_plan(protocol))[::sample_every])} records re-derived exactly; digest {digest(manifest)}")


if __name__ == "__main__":
    if "--check" in sys.argv:
        check()
    else:
        m = generate()
        write(m)
        print(f"wrote {m['record_count']} records / {m['group_count']} groups -> {MANIFEST_PATH.relative_to(ROOT)}")
        print(f"digest {digest(m)}")
