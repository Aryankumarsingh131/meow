# Handoff — T09 Guided camera and manual ROI

Owner: agent, role A (product/mobile). Requirement REQ-003, acceptance AC-003.
Date: 2026-09-22. Branch: `integrate-meow`.

**Status: all three acceptance criteria implemented and tested, two of the
three device checks genuinely run on an emulator. The cancel device check was
NOT successfully exercised** — see Verification below. Not a device; not
domain-validated.

## Dependency gate

Gate: **T04 T08** complete, reviewed, reflected in current-state with real
evidence.

- **T04 — satisfied for what T09 consumes.** Its JS leg (`computeFeaturesJs`,
  `readExifOrientation`, `correctOrientation`) is real and golden-tested. T09
  does not depend on its Kotlin leg, which has still never been compiled.
- **T08 — complete as a mechanism**, and T09 consumes only its lifecycle
  shape, not any kit value. T08 remains domain-blocked on T01.
- **Neither has had real human review.** Unchanged across this repo. Stated,
  not waived silently.

Worked on `integrate-meow` rather than `main` because T09 needs `expo-camera`,
which only exists after the `meow` integration.

## Changed files

| File | What |
|---|---|
| `apps/mobile/src/captureJob.ts` | **New.** Job lifecycle (supersede/cancel/settle), typed failure reasons, ROI validation, orientation mapping |
| `apps/mobile/src/capture.tsx` | **New.** S04 screen: preview, guide frame, permission recovery, missing-card prompt, manual ROI, cancel |
| `tests/capture-flow.test.ts` | **New.** 31 tests |

### Outside the card's three files

- `apps/mobile/metro.config.js` — **required, see the defect below.**
- `apps/mobile/App.tsx` — one tab added to the existing demo harness so the
  screen is reachable on device. Harness only, not a deliverable.

`modules/capture-native/` was **not touched** — the card says "No shared
capture edits with B", and T09 only imports from it.

## A real defect only the device found

The first on-device launch failed with a red screen:

```
Unable to resolve module ../../../modules/capture-native/index
from apps/mobile/src/capture.tsx
```

**Metro sandboxes resolution to its project root (`apps/mobile`)**, so it
cannot see `modules/` at the repo root — even though Node and `tsc` resolve it
fine, which is exactly why 31 passing tests and a clean type-check did not
catch it. T09 is the first task to import the native bridge from app code, so
Metro had never needed the configuration.

Fixed by adding `watchFolders` and `nodeModulesPaths` to
`apps/mobile/metro.config.js`. That file came from the `meow` integration and
is not claimed by any task card. Flagged here.

## Exact commands and results

Node v24.19.0, Python 3.13.7. Emulator `jalsakshi_pixel`, Android 15
(API 35, x86_64), `emulator-5554`. App `org.jalsakshi.mobile`.

```
node tests/capture-flow.test.ts                          -> 31/31 passed
npx tsc --noEmit                                         -> 0 errors
cd apps/mobile && npx tsc --noEmit -p tsconfig.json      -> 0 errors

# regressions, unchanged by T09
node tests/protocol.test.ts                              -> 39/39 passed
node tests/sources_client.test.ts                        -> 22/22 passed
node tests/auth_client.test.ts                           -> 12/12 passed
node tests/contracts.test.ts                             -> ALL CHECKS PASSED
python -m unittest tests.sources_test tests.auth_test \
       services.api.app.tests.test_schemas               -> Ran 102 ... OK
python -m pytest services/api/tests -q                   -> 12 passed
```

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| **Permission error recovers** | Verified on device with permission **actually revoked** (`adb shell pm revoke … CAMERA`), not simulated. Screen offers "Allow camera" **and** "Enter kit reading manually"; tapping Allow raised the real `GrantPermissionsActivity`; granting it opened the live preview. Unit side: `permission_denied` is `recoverable`, `canStartCapture` stays true, `manualEntryAvailable` true in every state |
| **Missing card prompts** | On device: capture produced "The reference card was not found in the photo. Place the card beside the strip and retake, or mark the region by hand," then switched to the "Mark the strip" ROI editor. A missing card is asserted never to yield `succeeded`. Every prompt is asserted to name an action and to contain no water judgement (`safe/potable/contaminated/pass/fail`) |
| **Old job cannot overwrite retake** | 8 dedicated tests. A late result from a superseded job returns `discarded_superseded` and **leaves state byte-identical** (asserted via JSON compare). A late result cannot overwrite an already-applied retake — the `RETAKE` marker survives a `STALE` arrival. Reusing a job id throws. Superseded/cancelled attempts are retained as evidence, not erased |

## Verification from the card

`Device capture/rotate/cancel tests.`

1. **Capture — RUN on emulator.** Permission revoke → denial screen → real OS
   grant → live preview with reference guide → shutter → missing-card prompt →
   manual ROI editor with four corner chips. Screenshots
   `t09-dev-01`…`t09-dev-04`.
2. **Rotate — RUN, with a caveat.** `user_rotation=1` was applied and the
   activity survived with capture state intact (still "Mark the strip", same
   photo, same selected corner, no crash). **The UI did not rotate, because
   `app.config.ts` sets `orientation: "portrait"` — the app is deliberately
   portrait-locked.** So this exercised config-change survival, not a
   landscape layout. Separately, AC-003's *photo* rotation is covered by a
   unit test that round-trips every pixel through T04's **real**
   `correctOrientation` for all 8 EXIF orientations; the emulator camera only
   ever produces orientation 1, so a non-1 EXIF photo was never exercised on
   device.
3. **Cancel — NOT successfully exercised on device.** The capture settles
   faster than two sequential `adb` taps, so the Cancel button had already
   disappeared by the time the second tap landed; the run ended on the ROI
   screen. No crash (0 fatal exceptions). **I am not claiming this as a device
   pass.** Cancel is covered by three unit tests (cancel clears `active`; a
   stale cancel does not kill the active retake; a cancelled job's late result
   returns `discarded_cancelled`). A human tapping Cancel during a slow
   capture, or an instrumented test harness, is still needed.

## Mutation testing

`captureJob.ts` re-run against 13 deliberately broken copies. **All 13
CAUGHT:** settle ignores the active-job check; settle accepts any job id;
start does not supersede; cancel leaves `active` set; cancel ignores the job
id; discarded list not retained; reused job id allowed; permission not
recoverable; out-of-bounds ROI accepted; degenerate ROI accepted; wrong corner
count accepted; orientation-6 mapping wrong; upright size never transposes.

Two initially survived. One (`M4`) used a multi-line `sed` that **never
applied** — a meaningless result, re-run properly. The other (`M5`) was a
**real test gap**: nothing cancelled a wrong or absent job id, so a mutation
letting `cancelJob` ignore the id went unnoticed. That matters — a stale
cancel button must not kill the retake the worker is waiting on. Three tests
added; both now caught.

## Corrections to my own process

Mid-run I reported the ROI editor as a bug because the screen still showed the
camera. **That was wrong** — my screenshot was taken before camera
initialisation finished. Re-run with a clean logcat, the ROI editor rendered
correctly. The code was never at fault.

## Blockers — none hidden

1. **`computeFeaturesNative` rejects by design.** The Kotlin module
   (`modules/capture-native/android/CaptureModule.kt`, T04, role B) has never
   been compiled, so **no real feature vector is produced on device**. The
   screen surfaces this as `native_unavailable` and opens the manual route
   rather than fabricating one. Any end-to-end assisted reading is blocked on
   role B compiling that module.
2. **No reference-card detection exists anywhere.** The bridge takes corners
   as input. So "the reference card was not found" is currently the *only*
   outcome when a protocol requires a card — it is honest, but it is not
   detection. Automatic detection and the glare/blur quality reasons in S04
   are **T10**, unbuilt.
3. **Emulator is not a device.** Synthetic camera scene, x86_64, no real
   optics, no real lighting, EXIF orientation always 1. Nothing here says the
   guided capture works in a field worker's hands.
4. **Cancel unverified on device** (above).
5. **`MIN_ROI_AREA_PX = 16` is an engineering floor I chose**, not a domain
   threshold. The real quality thresholds (`min_roi_pixels`, blur, glare) live
   in the protocol's `quality_policy` and are fitted in T10 — deliberately not
   guessed here.
6. **The ROI editor is tap-to-move, not drag.** Functional and testable, but
   coarser than the drag interaction S04 implies. No gesture library was added
   (that would be another mobile lockfile change).
7. **Nothing is persisted.** Capture state is component state; a process kill
   loses it. Durable drafts are T12's boundary.

## Proposed status update (for the reviewer, not applied)

The T09 box in `to-do.md` is **not** checked — the card reserves it for after
review, and `jalsakshi-blueprint/` is a reference package this repo does not
edit. Proposed wording:

> T09 — capture job lifecycle, permission recovery, missing-card prompting and
> manual ROI implemented and tested; capture and rotate exercised on an
> emulator; **cancel not verified on device**; no native analysis and no card
> detection exist, so no real assisted reading is possible yet.

## Artifact locations

- Code: `apps/mobile/src/captureJob.ts`, `apps/mobile/src/capture.tsx`
- Tests: `tests/capture-flow.test.ts` (31)
- Device evidence: `docs/evidence/screenshots/t09-dev-01-permission-denied.png`,
  `t09-dev-02-permission-prompt.png`, `t09-dev-03-camera-live.png`,
  `t09-dev-04-missing-card-roi.png`, `t09-dev-05-rotated-landscape.png`,
  `t09-dev-06-retake.png`, `t09-dev-07-cancel.png`
