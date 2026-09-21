# Current state — meow1 (JalSakshi implementation, using jalsakshi-blueprint as reference)

Updated: 2026-09-22.

## What exists

`jalsakshi-blueprint/` — planning/reference package only, untouched, not edited by this task.

`docs/protocol-selection.md`, `docs/event-confirmation.md` — T01 deliverables.
Both are **fictional demo templates**, explicitly authorized by the user in
place of real kit/event data (real data was not available). No real kit,
lot, manufacturer, or event exists yet.

`docs/pilot-interviews.md`, `docs/alternative-evaluation.md` — T02 deliverables.
Both are **fictional demo templates**. The T02 dependency gate ("T01 reviewed,
not just checkbox-complete") was explicitly waived by the user for this pass;
T01 itself is still not really reviewed. No real worker/supervisor/buyer/lab
partner exists, and no real mWater/ODK sandbox trial has been performed.

`apps/mobile/` — real Expo/TypeScript scaffold (T03), not fictional. Real
`npm install`/`npx expo config` succeeded on this build host; real dependency
versions are resolved and recorded in `docs/toolchain-matrix.md`. `npx expo
run:android` was actually attempted and genuinely failed (no Android SDK, no
`adb`, no device) — that failure is recorded as-is, not mocked. APK
install/offline-tensor acceptance criteria remain unmet.

## Active claims

- T01 (Protocol and event gate) — owner: agent (role A), acting on explicit
  user authorization to build a fictional/illustrative version since no real
  kit or event information was available. See [handoff-T01.md](handoff-T01.md).
- T02 (Validate the user job and alternatives) — owner: agent (role A), acting
  on explicit user authorization to waive the T01-reviewed dependency gate and
  build a fictional/illustrative version since no real interview subjects or
  competitor sandbox access were available. See [handoff-T02.md](handoff-T02.md).
- T03 (Prove the native toolchain) — owner: agent (role B), acting on explicit
  user authorization to scaffold real config/dependencies while leaving
  device-dependent acceptance criteria explicitly blocked (no Android SDK/
  adb/device in this environment). See [handoff-T03.md](handoff-T03.md).

## Open blockers

- Real kit/manufacturer/lot/read-window: not selected. `docs/protocol-selection.md`
  is a structural template only.
- Real event/organizer/pre-event rules: not confirmed. `docs/event-confirmation.md`
  is a structural template only; its mandated organizer cross-check verification
  has not been run and cannot be run against a fictional event.
- T01 has not received real human review despite gating T02's dependency; the
  gate was explicitly waived by the user rather than satisfied.
- No real worker/supervisor interview has been conducted; buyer and lab access
  remain genuinely unknown (not invented) per `docs/pilot-interviews.md`.
- No real mWater/ODK sandbox trial has been performed; the configure-versus-build
  question in `docs/alternative-evaluation.md` remains open, not answered.
- Any downstream task (T03/T08 for T01; T38 for T02; anything assuming a real
  reviewed protocol, confirmed event, real interview evidence, or a real
  platform decision) remains blocked on the above.

## Next exact action

If/when real kit and event information becomes available, replace (not append
to) both T01 files with the real transcribed values and a cited source, then
re-run the manual organizer cross-check for real.

If/when a real worker/supervisor interview or a real mWater/ODK sandbox trial
becomes available, replace (not append to) the T02 files with real notes and
a real recommendation, and get explicit user approval before treating any
resulting configure-versus-build recommendation as an architecture change.

If/when a real Android phone plus Android SDK/adb becomes available (on this
or any machine), run `cd apps/mobile && npx expo run:android`, fix the Java
17 gap noted in `docs/toolchain-matrix.md` if it recurs, install the
resulting APK, and run a known ONNX tensor through the bundled
`onnxruntime-react-native` runtime to complete T03's real acceptance
criteria.
