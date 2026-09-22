"""T04 golden-vector reference implementation (Python leg).

Independently re-implements the same capture-native pipeline as
modules/capture-native/index.ts (JS leg) and CaptureModule.kt (native leg,
not executable in this environment - see docs/feature-schema.md). Used to
generate tests/capture-golden.json and to check JS/Python agreement for real,
not by inspection.

No calibration claim: median RGB values below are raw pixel statistics of a
synthetic fixture, not any analytical concentration or safety threshold.
"""

import hashlib
import json
import sys
import time
import tracemalloc
from pathlib import Path

from PIL import Image

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "capture-golden-source.jpg"
GOLDEN_PATH = Path(__file__).parent / "capture-golden.json"

# Known ROI corners in the UPRIGHT (orientation-1) reference frame, i.e. the
# frame a correctly-oriented display would show. Order: top-left, top-right,
# bottom-right, bottom-left. Deliberately not a perfect rectangle so the
# homography step is a real perspective transform, not just a crop.
UPRIGHT_W, UPRIGHT_H = 120, 90
CORNERS_UPRIGHT = [(20, 15), (95, 20), (90, 75), (15, 70)]
ROI_FILL_COLOR = (120, 40, 200)
BACKGROUND_COLOR = (30, 30, 30)
OUT_SIZE = 16  # oriented ROI raster side length in the schema-v1 feature step
EXIF_ORIENTATION_TAG = 0x0112
EXIF_ORIENTATION_USED = 6  # "rotate 90 CW to correct" - see docs/feature-schema.md


def point_in_quad(px, py, quad):
    # standard even-odd ray casting for a 4-point polygon
    inside = False
    n = len(quad)
    j = n - 1
    for i in range(n):
        xi, yi = quad[i]
        xj, yj = quad[j]
        if ((yi > py) != (yj > py)) and (
            px < (xj - xi) * (py - yi) / (yj - yi) + xi
        ):
            inside = not inside
        j = i
    return inside


def build_upright_pixels():
    """Row-major list of (r,g,b), upright[y][x]."""
    pixels = [[BACKGROUND_COLOR for _ in range(UPRIGHT_W)] for _ in range(UPRIGHT_H)]
    for y in range(UPRIGHT_H):
        for x in range(UPRIGHT_W):
            if point_in_quad(x + 0.5, y + 0.5, CORNERS_UPRIGHT):
                pixels[y][x] = ROI_FILL_COLOR
    return pixels


def rotate_90_ccw(pixels, h, w):
    """out[y][x] = in[x][w-1-y], out shape (w,h). Verified against
    numpy.rot90(k=1) on a labelled test array before use here."""
    out = [[None] * h for _ in range(w)]
    for y in range(w):
        for x in range(h):
            out[y][x] = pixels[x][w - 1 - y]
    return out


def generate_fixture():
    """Write the synthetic JPEG fixture: physically-stored pixels are the
    upright layout rotated 90 deg CCW; EXIF Orientation tag is set to 6
    ("rotate 90 CW to correct"), so a spec-correct reader must recover the
    known upright corners exactly."""
    upright = build_upright_pixels()
    stored = rotate_90_ccw(upright, UPRIGHT_H, UPRIGHT_W)  # shape (120, 90) -> rows=120
    stored_h = len(stored)
    stored_w = len(stored[0])
    img = Image.new("RGB", (stored_w, stored_h))
    img.putdata([px for row in stored for px in row])
    exif = img.getexif()
    exif[EXIF_ORIENTATION_TAG] = EXIF_ORIENTATION_USED
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    img.save(FIXTURE_PATH, format="JPEG", quality=90, exif=exif)
    return FIXTURE_PATH


def read_exif_orientation(jpeg_bytes: bytes) -> int:
    """Minimal EXIF Orientation (tag 0x0112) parser, independent of PIL's
    own EXIF handling, so the Python leg exercises the same hand-rolled
    parsing logic as the JS leg rather than relying on a library black box
    for this specific step."""
    if jpeg_bytes[0:2] != b"\xff\xd8":
        return 1
    pos = 2
    while pos < len(jpeg_bytes) - 4:
        if jpeg_bytes[pos] != 0xFF:
            pos += 1
            continue
        marker = jpeg_bytes[pos + 1]
        if marker == 0xE1:  # APP1
            seg_len = int.from_bytes(jpeg_bytes[pos + 2 : pos + 4], "big")
            seg = jpeg_bytes[pos + 4 : pos + 2 + seg_len]
            if seg[0:4] == b"Exif":
                return _parse_tiff_orientation(seg[6:])
            pos += 2 + seg_len
        elif marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            pos += 2
        elif marker == 0xDA:  # start of scan - EXIF must appear before this
            break
        else:
            seg_len = int.from_bytes(jpeg_bytes[pos + 2 : pos + 4], "big")
            pos += 2 + seg_len
    return 1


def _parse_tiff_orientation(tiff: bytes) -> int:
    if tiff[0:2] == b"II":
        endian = "little"
    elif tiff[0:2] == b"MM":
        endian = "big"
    else:
        return 1
    ifd0_offset = int.from_bytes(tiff[4:8], endian)
    num_entries = int.from_bytes(tiff[ifd0_offset : ifd0_offset + 2], endian)
    for i in range(num_entries):
        entry_off = ifd0_offset + 2 + i * 12
        tag = int.from_bytes(tiff[entry_off : entry_off + 2], endian)
        if tag == EXIF_ORIENTATION_TAG:
            value = int.from_bytes(tiff[entry_off + 8 : entry_off + 10], endian)
            return value
    return 1


def correct_orientation(pixels, h, w, orientation):
    """pixels[y][x] = (r,g,b), as stored. Returns (corrected, out_h, out_w)."""
    if orientation == 1:
        return pixels, h, w
    if orientation == 2:  # mirror horizontal
        out = [[pixels[y][w - 1 - x] for x in range(w)] for y in range(h)]
        return out, h, w
    if orientation == 3:  # rotate 180
        out = [[pixels[h - 1 - y][w - 1 - x] for x in range(w)] for y in range(h)]
        return out, h, w
    if orientation == 4:  # mirror vertical
        out = [[pixels[h - 1 - y][x] for x in range(w)] for y in range(h)]
        return out, h, w
    if orientation == 5:  # transpose
        out = [[pixels[x][y] for x in range(h)] for y in range(w)]
        return out, w, h
    if orientation == 6:  # rotate 90 CW to correct; verified formula
        out = [[pixels[h - 1 - x][y] for x in range(h)] for y in range(w)]
        return out, w, h
    if orientation == 7:  # transverse
        out = [[pixels[h - 1 - x][w - 1 - y] for x in range(h)] for y in range(w)]
        return out, w, h
    if orientation == 8:  # rotate 90 CCW to correct
        out = [[pixels[x][w - 1 - y] for x in range(h)] for y in range(w)]
        return out, w, h
    return pixels, h, w


def square_to_quad_coeffs(quad):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = quad
    dx1, dx2, dx3 = x1 - x2, x3 - x2, x0 - x1 + x2 - x3
    dy1, dy2, dy3 = y1 - y2, y3 - y2, y0 - y1 + y2 - y3
    if dx3 == 0 and dy3 == 0:
        a, b, c = x1 - x0, x2 - x1, x0
        d, e, f = y1 - y0, y2 - y1, y0
        g, h = 0.0, 0.0
    else:
        denom = dx1 * dy2 - dx2 * dy1
        g = (dx3 * dy2 - dx2 * dy3) / denom
        h = (dx1 * dy3 - dx3 * dy1) / denom
        a, b, c = x1 - x0 + g * x1, x3 - x0 + h * x3, x0
        d, e, f = y1 - y0 + g * y1, y3 - y0 + h * y3, y0
    return a, b, c, d, e, f, g, h


def map_unit_square_to_quad(u, v, coeffs):
    a, b, c, d, e, f, g, h = coeffs
    denom = g * u + h * v + 1.0
    x = (a * u + b * v + c) / denom
    y = (d * u + e * v + f) / denom
    return x, y


def perspective_sample(pixels, h, w, corners, out_size):
    coeffs = square_to_quad_coeffs(corners)
    samples = []
    for j in range(out_size):
        v = (j + 0.5) / out_size
        for i in range(out_size):
            u = (i + 0.5) / out_size
            x, y = map_unit_square_to_quad(u, v, coeffs)
            px = min(max(int(x), 0), w - 1)
            py = min(max(int(y), 0), h - 1)
            samples.append(pixels[py][px])
    return samples


def median_channel(samples, idx):
    values = sorted(s[idx] for s in samples)
    n = len(values)
    mid = n // 2
    if n % 2 == 1:
        return values[mid]
    return (values[mid - 1] + values[mid]) / 2


def compute_features(jpeg_path: Path, corners=CORNERS_UPRIGHT, out_size=OUT_SIZE):
    jpeg_bytes = jpeg_path.read_bytes()
    orientation = read_exif_orientation(jpeg_bytes)
    img = Image.open(jpeg_path).convert("RGB")
    stored_w, stored_h = img.size
    flat = list(img.getdata())
    stored_pixels = [flat[y * stored_w : (y + 1) * stored_w] for y in range(stored_h)]
    upright_pixels, up_h, up_w = correct_orientation(
        stored_pixels, stored_h, stored_w, orientation
    )
    samples = perspective_sample(upright_pixels, up_h, up_w, corners, out_size)
    return {
        "schema_version": 1,
        "roi_width": out_size,
        "roi_height": out_size,
        "median_r": median_channel(samples, 0),
        "median_g": median_channel(samples, 1),
        "median_b": median_channel(samples, 2),
        "sample_count": len(samples),
        "orientation_read": orientation,
        "upright_width": up_w,
        "upright_height": up_h,
    }


def main():
    if "--generate" in sys.argv:
        path = generate_fixture()
        print(f"fixture written: {path}", file=sys.stderr)

    tracemalloc.start()
    t0 = time.perf_counter()
    features = compute_features(FIXTURE_PATH)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    _current, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    sha256 = hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()

    result = {
        "language": "python",
        "python_version": sys.version.split()[0],
        "pillow_version": __import__("PIL").__version__,
        "fixture_path": str(FIXTURE_PATH.relative_to(FIXTURE_PATH.parents[2])).replace("\\", "/"),
        "fixture_sha256": sha256,
        "corners_upright": CORNERS_UPRIGHT,
        "expected_roi_fill_color": list(ROI_FILL_COLOR),
        "features": features,
        "time_ms": round(elapsed_ms, 4),
        "peak_memory_bytes": peak_bytes,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
