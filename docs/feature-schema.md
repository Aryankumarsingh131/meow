# Capture feature schema — v1 (T04)

Defines the shape produced by the capture-native pipeline described in
[jalsakshi-blueprint/docs/architecture/system-design.md](../jalsakshi-blueprint/docs/architecture/system-design.md)'s
capture pipeline steps 3-5 (orient, extract ROI, extract robust median
features). Implemented three times for this task: JS/TS reference
(`modules/capture-native/index.ts`), Python reference
(`tests/capture_golden_reference.py`), and Kotlin native source
(`modules/capture-native/android/CaptureModule.kt`, **unexecuted** — see
below). Values are raw pixel statistics; **this is never a water-quality
measurement or threshold.**

## FeatureVectorV1

```json
{
  "schema_version": 1,
  "roi_width": 16,
  "roi_height": 16,
  "median_r": 0,
  "median_g": 0,
  "median_b": 0,
  "sample_count": 256,
  "orientation_read": 1,
  "upright_width": 0,
  "upright_height": 0
}
```

| Field | Meaning |
|---|---|
| `schema_version` | Always `1` for this shape. A future breaking change gets `2`, not a silently mutated `1`. |
| `roi_width`, `roi_height` | Side length of the square raster the ROI was resampled to (16 in the current golden fixture — a structural choice, not a validated production value). |
| `median_r/g/b` | Per-channel median of `sample_count` nearest-neighbor samples inside the perspective-corrected ROI. **Raw pixel statistic, not a calibrated concentration or any pass/fail signal.** |
| `sample_count` | Number of samples the median was computed over (`roi_width * roi_height`). |
| `orientation_read` | The raw EXIF Orientation tag value (1-8) actually read from the file, kept for audit — not folded away after correction. |
| `upright_width`, `upright_height` | Dimensions of the image after EXIF orientation correction, before perspective sampling. |

## Pipeline (all three legs implement the same four steps)

1. **Read EXIF orientation** (tag `0x0112`) directly from JPEG bytes. Default `1` (no correction) if absent — never guessed from image aspect ratio.
2. **Decode JPEG** to a row-major RGB pixel grid. Decoder differs per leg (jpeg-js in JS, Pillow/libjpeg in Python, `android.graphics.BitmapFactory` in Kotln) — **see "known cross-decoder discrepancy" below, this is not assumed to be bit-identical.**
3. **Correct orientation**: apply the standard 8-case EXIF transform to recover the upright frame. Formulas for cases 6 and 8 were derived and verified against `numpy.rot90` on a labelled test array before being ported into all three legs (see comments in `tests/capture_golden_reference.py`); only orientation 6 is exercised end-to-end by the current golden fixture.
4. **Perspective-sample the ROI**: given four known corner points in the upright frame (Heckbert square-to-quad projective mapping, not just an axis-aligned crop — this is real perspective handling, not a stand-in for it), nearest-neighbor sample a `roi_width x roi_height` raster and take the per-channel median.

## Known cross-decoder discrepancy (measured, not assumed)

Running the identical fixture file through the JS leg (`jpeg-js`) and the
Python leg (`Pillow`/libjpeg) produces median values that differ by exactly
**−1 per channel** (JS: 119/39/200, Python: 120/40/201). This was isolated
by direct raw-pixel comparison at a fixed coordinate *before* any
orientation/homography/median code runs — both decoders read the same JPEG
bytes but round their internal YCbCr→RGB conversion differently by one
least-significant bit. The shared pipeline logic (EXIF parsing, orientation
correction, homography, median) is verified consistent between JS and
Python: they agree exactly on `orientation_read`, `upright_width`,
`upright_height`, and `sample_count`. **No blanket "golden vectors agree"
claim is made** — see `tests/capture-golden.json`'s `comparison` block for
the full, measured breakdown, and treat ±1/channel as the honest current
tolerance between decoder libraries, not zero.

## Native (Kotlin) leg status

`modules/capture-native/android/CaptureModule.kt` is real, hand-written
source implementing the identical algorithm using
`android.graphics.BitmapFactory` and `androidx.exifinterface`. It has
**never been compiled or executed** — this environment has no Android SDK,
`adb`, or device (same blocker recorded in T03's
`docs/toolchain-matrix.md`). Its actual output is unknown. Three-way
JS/Python/native agreement is therefore **not established**, only two-way
JS/Python agreement (to the ±1/channel tolerance above).

## Open blockers (real, not fictional)

- Native leg unexecuted — needs the same Android SDK/adb/device T03 is
  blocked on.
- Only EXIF orientation 6 is empirically verified; orientations 2-5, 7, 8
  are implemented per the same derivation method but untested by any
  fixture.
- No real camera-captured JPEG has been used as a fixture — the current
  fixture is a synthetically constructed JPEG with a hand-set EXIF tag, not
  an actual phone photo. See `docs/agent-workflow/handoff-T04.md`.
- `roi_width`/`roi_height` = 16 and the corner coordinates are structural
  choices for this test, not a validated production ROI size for any real
  kit.
