# Data protocol — feasibility set (T23)

Status: **SYNTHETIC ONLY.** No real kit, preparation, photograph or laboratory
reference exists yet, so this set cannot say anything about water or about any
kit. It exists to build and test the ML pipeline (T24–T27) end to end, so that
real data can drop in later without the pipeline changing shape.

## What a record is

One record is one capture of one preparation:

- **Preparation (`group_id`)**: one printed SYN-COLOR-001 tile (a simulated
  physical object). Each tile has its own printing error (per-channel gain and
  offset) and its own paper colour, shared by every capture of it.
- **Capture (`capture_index`)**: one photograph of that tile. Five per tile,
  each with its own exposure, possible glare, possible blur, JPEG quality,
  EXIF orientation, and a hand-marked region of interest (about 10% are sloppy
  enough to include some paper).
- **Domain (`domain`)**: the lighting and phone the tile was photographed
  under. Each tile is photographed in exactly one domain, as a real strip would
  be photographed where it was tested.

Features come from the **real** schema-v1 pipeline
(`tests/capture_golden_reference.py`: EXIF orientation → perspective sample →
median RGB). Only the photograph is simulated.

## Labels

`label` is the protocol bin of the fixture colour that was rendered
(`label_source: synthetic_render`). Labels are known by construction. The
schema (`ml/data/manifest.schema.json`) only allows `synthetic_render` or, for
real data, `reference_method`, so a label can never come from a model's
output.

## Size and balance

4 classes × 4 domains × 8 preparations = **128 preparations**, × 5 captures =
**640 records**. Every (class, domain) cell has the same number of
preparations.

## The simulated chain

| Stage | Level | Range | Why |
|---|---|---|---|
| Fixture colour | class | the four digital values in `synthetic-demo-protocol.md` | the protocol's own definition |
| Print gain / offset | preparation | gain N(1, 0.04) clipped 0.85–1.15; offset N(0, 5) | printer and paper vary per print |
| Illuminant cast | domain | e.g. tungsten ×(1.12, 0.98, 0.80) | warm/cool light shifts every channel |
| Exposure | capture | ×0.72–1.18 | handheld phones vary |
| Glare | capture | 20% of captures, blend toward white | specular reflection off the card |
| Sensor noise | domain | σ 2–5 | different phones |
| Blur | capture | 50% of captures, Gaussian radius ≤ 1.2 | focus and hand shake |
| JPEG | capture | quality 70–95 | camera compression |
| Orientation | capture | EXIF 1, 3, 6, 8 | exercises the orientation-correction step |

These values are illustrative, not measurements. Their job is to make the
task realistically imperfect: under a warm cast and low exposure, blue (SYN-A)
drifts toward green (SYN-B), which is exactly where a naive nearest-colour
reading fails.

## Reproducing and checking

```
python -m ml.feasibility_set           # regenerate ml/data/syn-color-001.feasibility.v1.json
python -m ml.feasibility_set --check   # re-render a spread of records; features must match exactly
node tests/ml-manifest.test.ts         # schema conformance and refusals
```

The manifest digest is computed over parsed JSON, so a Windows CRLF checkout
hashes the same as an LF one.

## What must change for real data

1. Choose a real kit and its reference method (T01), with a laboratory able
   to measure every preparation.
2. A preparation becomes a real reacted strip from a real water sample. Every
   photograph of it keeps its `group_id`.
3. `label_source` becomes `reference_method`, with the laboratory result as
   the label, never the phone's reading.
4. `data_mode` becomes `research`, and `permissions.consent` becomes
   `recorded` with the consent reference (see `docs/data-permissions.md`).
5. A domain reviewer audits a random sample of records and the count of
   independent preparations, which is T23's verification step and has not
   happened.
