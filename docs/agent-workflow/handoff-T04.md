# Task handoff — T04

- Task ID / child ID: T04 — Prove file-to-feature preprocessing
- Owner / reviewer: agent (role B) / pending human review
- Status: **partial — JS and Python legs real, actually run, and honestly compared; native leg real source but unexecuted; fixture is synthetic, not a real camera file**
- Requirement and acceptance IDs: REQ-003 (per jalsakshi-blueprint/docs/requirements.md); AC-003 real-device check not attempted (needs the same missing Android toolchain as T03)
- Branch/worktree and base commit, if applicable: base commit `1c37104` on `main` at session start; no new branch/worktree used
- Files changed:
  - `modules/capture-native/index.ts` (new) — JS/TS reference implementation + native bridge stub that throws rather than fabricating a result
  - `modules/capture-native/android/CaptureModule.kt` (new) — real Kotlin source, mirrors the same algorithm, **never compiled or executed**
  - `tests/capture_golden_reference.py` (new) — Python reference implementation + fixture generator
  - `tests/run-capture-golden.ts` (new) — Node harness that decodes the fixture with `jpeg-js` and runs `computeFeaturesJs`; not in the task's literal file-scope list but required to actually execute `index.ts` against the fixture rather than leaving it unexercised
  - `tests/fixtures/capture-golden-source.jpg` (new) — the synthetic fixture itself; not in the literal file-scope list but required supporting data for `tests/capture-golden.json`
  - `tests/capture-golden.json` (new)
  - `docs/feature-schema.md` (new)
  - `package.json`, `package-lock.json` (new, root-level) — minimal dev-dependency scaffold (`jpeg-js` only) for this cross-language harness; not explicitly in T04's file-scope list but necessary since apps/mobile's package.json is scoped to the Expo app, not shared test tooling
  - `docs/agent-workflow/current-state.md` (updated)
  - `docs/agent-workflow/handoff-T04.md` (new, this file)
- Inputs, build/device/model/dataset versions:
  - Python 3.13.7, Pillow 12.1.0 (Python leg)
  - Node v24.19.0, jpeg-js 0.4.4 (JS leg, run via Node's built-in TypeScript type-stripping, no ts-node/tsc build step)
  - Kotlin/Android: **none** — no compiler, SDK, or device available (native leg unexecuted)
  - Fixture: `tests/fixtures/capture-golden-source.jpg`, sha256 `20a6655325ef7d6eb0f9f399e867726e187da5eec4a0252a1d9a96a2a70ffe08`
- Decisions and authoritative docs updated: none of jalsakshi-blueprint's own docs were edited. Reused the capture-pipeline description from `jalsakshi-blueprint/docs/architecture/system-design.md` (steps 3-5) as the algorithm spec.
- Tests actually run: exact command/procedure; exit/result; timestamp (all 2026-09-22):
  - `python tests/capture_golden_reference.py --generate` → generated the fixture and ran the Python leg: `median_r=120.0, median_g=40.0, median_b=201.0, orientation_read=6, upright 120x90, time_ms=46.591, peak_memory_bytes=1095352`.
  - `node tests/run-capture-golden.ts` → ran the JS leg on the same fixture (verified same sha256): `median_r=119, median_g=39, median_b=200, orientation_read=6, upright 120x90, time_ms=20.457, heap_used_delta_bytes=1960160`.
  - Direct raw-pixel isolation check (`img.getpixel((45,60))` in Python vs `jpeg.decode(...)` at the same coordinate in Node) → PIL: `(120,40,201)`, jpeg-js: `(119,39,200)` — proved the discrepancy is in JPEG decode itself, before any shared orientation/homography/median code runs. This is the "known corner/color fixtures" verification step, run for real, not described.
  - `grep -rn "calibration claim"` across all three implementation files and the docs → confirmed the "no blanket calibration claim" language is present in the actual source comments, not only in prose docs. This is the second required verification step, run for real.
- Tests not run and reason:
  - Real camera file test — user explicitly chose the synthetic-fixture path over providing/authorizing a real photo (see AskUserQuestion exchange). Recorded as an open blocker, not silently substituted without disclosure.
  - Native (Kotlin) golden vector — requires an Android SDK/Kotlin compiler/device, none of which exist in this environment (same blocker as T03). `CaptureModule.kt` was written but never compiled.
- Evidence locations: `tests/capture-golden.json` (full comparison block with root-cause isolation); `docs/feature-schema.md`; this file.
- Security/privacy/domain checks: N/A — no PII, no credentials. Domain rule "no fabricated precision"/"no blanket calibration claim" checked: the measured ±1/channel decoder discrepancy is reported as-is rather than rounded away or ignored; feature values are explicitly labeled as raw pixel statistics, never a water-quality claim.
- Deviations from plan and approved scope changes:
  - T04's dependency gate ("T01+T03 reviewed") was not actually satisfied — user explicitly authorized waiving it, same pattern as T02/T03.
  - "One real camera file" verification input was replaced with a synthetic EXIF-tagged JPEG, per explicit user choice ("Waive gates, do JS+Python only, stub native").
  - Two extra files beyond the literal scope list (`tests/run-capture-golden.ts`, `tests/fixtures/capture-golden-source.jpg`) and a root `package.json`/lockfile were added because they are load-bearing for the acceptance criteria (nothing in scope can actually execute without them) — not scope creep beyond what the acceptance criteria themselves require.
- Remaining issues/risks: the ±1/channel decoder discrepancy is real and will recur for any future JS-vs-Python comparison using these same two libraries; anyone adding a third decoder (e.g. the real native Android `BitmapFactory` path) should expect a similar small offset and should widen or justify tolerance rather than assume bit-exactness. Only EXIF orientation 6 is empirically verified; 2/3/4/5/7/8 are implemented but untested by any fixture.
- Next exact action and responsible owner: whoever gets a real Android/Kotlin toolchain compiles and runs `CaptureModule.kt` against the existing fixture and known corners, then appends (not overwrites) a `native_leg` result to `tests/capture-golden.json`. Whoever gets a real camera photo adds it as a second fixture alongside (not replacing) the synthetic one.
- Integration dependencies and shared files needing coordination: `modules/capture-native/index.ts`'s `computeFeaturesNative` stub throws by design — any future task (e.g. T09/T10 capture flow) calling it must handle that rejection as a real "native unavailable" state, not treat a caught exception as success.

## Completion reminder acknowledgment

This does **not** fully satisfy T04's acceptance criteria — three-way
JS/Python/native agreement is not established (native never ran), and "one
real camera file" was not used. What *is* real and demonstrated: EXIF
rotation handling (orientation 6, verified end-to-end), real perspective
(homography, not just a crop) handling, a precisely root-caused ±1/channel
JS/Python decoder discrepancy (not glossed over), and real time/memory
figures for both executed legs. The to-do.md checkbox is **not** checked by
this handoff.
