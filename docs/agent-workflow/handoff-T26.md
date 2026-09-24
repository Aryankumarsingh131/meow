# Handoff — T26 integrate bundled model offline

- Task: T26 / REQ-005. Owner B/mobile-ML; carried by the agent.
- Status: **`[~]` built and verified on the Android 15 emulator.** Outstanding: a physical phone; cancel/retake with a model suggestion live (the live capture flow never reaches the model, below).

## Project-owner decision (2026-09-24)

SYN-COLOR-001 requires a reference card and no card locator exists, so capture quality is recorded as not assessed and the quality gate never passes. **The gate is kept.** The model is wired into the review step and suggests only when timing, quality and features pass; today that means every live reading stays manual. A **Model check (research)** screen runs the model offline on the golden set.

## What was built

| File | Purpose |
|---|---|
| `apps/mobile/src/analysis/model.ts` | Pure logic: manifest check (protocol, classes, feature schema, calibration), SHA-256 check, `decide` (same rule and order as `ml/golden.py`), `analyseWithModel`. Every failure is a typed problem → manual reading with the reason |
| `apps/mobile/src/analysis/modelLoader.ts` | Verifies manifest and file hash **before** onnxruntime-react-native opens the file |
| `apps/mobile/src/analysis/baseline.ts` | `gate()` extracted and shared; optional `calibrationVersion`/`modelProblem` fields |
| `apps/mobile/src/modelCheck.tsx`, `workerApp.tsx`, `review.tsx`, `sample.ts` | Model check screen; review step uses the model path; new reasons worded; `calibration_version` reaches the sample |
| `tests/model-parity.test.ts` | 9 tests: golden replay, one-byte tamper, protocol/schema/class/calibration mismatch, gates stop the model, every fallback, research label, provenance in the sample |

## Verification (2026-09-24)

- Node: model-parity 9/9, review 12/12, status-label 12/12 (now also scans `modelCheck.tsx`), sync-client 15/15. Mobile and root `tsc` clean.
- **Emulator** (Android 15, debug build, JS from Metro; local API): signed in as `worker` → Model check → **SHA-256 verified on the phone, calibration cal-v1, 29 of 29 checks match the desktop build, 1.7 ms median per analysis**. Screenshots `docs/evidence/screenshots/t26-0*.png`.
- To run the device check, port 8000 was freed by stopping the user's unrelated `munim` server (with permission); it must be restarted by the user.

## Limits

Emulator ≠ phone; JS came from Metro (a release build embeds it). The live flow never asks the model until a card locator exists.
