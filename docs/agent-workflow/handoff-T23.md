# Handoff — T23 protocol-grounded feasibility set (SYNTHETIC)

- Task: T23 / REQ-019. Owner B/domain; carried by the agent. The project owner chose a synthetic set (2026-09-24) because no real kit, preparations or lab access exist.
- Status: **`[!]` blocked for its real purpose.** A real set needs a selected kit, a laboratory reference method and a domain reviewer's audit. What exists is a synthetic stand-in that lets T24–T27 run end to end.

## What was built

| File | Purpose |
|---|---|
| `ml/feasibility_set.py` | Renders the four SYN-COLOR-001 fixture colours through a simulated print → light → camera chain, then runs the **real** schema-v1 feature pipeline (`tests/capture_golden_reference.py`). Orientation self-check; `--check` re-derives records exactly |
| `ml/data/syn-color-001.feasibility.v1.json` | 640 captures of 128 preparations (4 classes × 4 domains × 8 preparations × 5 captures). Manifest digest `e359caf4…b4fd` |
| `ml/data/manifest.schema.json` | JSON Schema. `label_source` can only be `synthetic_render` or `reference_method`, never a model; real data must carry recorded consent |
| `tests/ml-manifest.test.ts` | Validates the manifest and 5 refusals |
| `docs/data-protocol.md`, `docs/data-permissions.md` | How the set is built, what must change for real data, and the permissions a real collection needs |

## Acceptance

- **Traceable labels and context:** every record has its preparation, domain, all render parameters and seeds.
- **No generated ground truth:** labels are the rendered fixture; the schema refuses model labels.
- **Lawful reuse and consent captured:** synthetic, no personal data, marked per record.
- **Domain reviewer audits records and counts independent samples:** **not done.**

## Verification (2026-09-24)

`python -m ml.feasibility_set --check` (13 records re-derived exactly), `node tests/ml-manifest.test.ts` (7/7).

## Finding

A plain nearest-colour reading confuses blue with green under a warm tungsten cast at low exposure: realistic, and it gives the later tasks a real failure mode to measure.
