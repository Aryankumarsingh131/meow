# Handoff — T11 indicative review and manual fallback

- Task ID: T11
- Owner / reviewer: Codex, role A; five-axis self-review completed 24 September 2026 IST
- Status: complete as an engineering slice; research-only until a real kit profile is approved
- Requirement and acceptance IDs: REQ-006 / AC-006, plus T11's portion of REQ-009 / AC-009
- Branch and base commit: `feature/t11-review`, based on `c80c4c0`
- Files changed: `apps/mobile/src/analysis/baseline.ts`, `apps/mobile/src/review.tsx`, `tests/review.test.ts`, the demo-harness wiring in `App.tsx`, browser-only ONNX loading in `demo-workflow.tsx`, screenshots and current-state documentation
- Inputs: T04 schema-v1 median RGB features, T10 quality decision/reasons, timing validity and an explicitly supplied versioned profile; the harness profile and bins are fictional research fixtures
- Outputs: deterministic bin suggestion or honest abstention, plus an observation that retains machine bin, manual bin, selected bin, method, reason and version provenance separately

## Acceptance evidence

- Camera-denied / missing features yields `manual_required`; manual entry still records a kit bin and required reason.
- `review` quality abstains and `retake` quality never fabricates a bin.
- Human disagreement preserves both `machineBin` and `manualBin`; the manual choice never overwrites the suggestion.
- Invalid timing blocks assisted interpretation and preserves the `invalid` flag on a manual observation.
- Profiles with missing data, invalid RGB references or non-contiguous ordinals are rejected. Protocol ordinals are enforced as contiguous from zero.
- The UI says “Indicative screening,” “Experimental suggestion,” and “not a complete water-safety assessment.” It renders no calibrated percentage and makes no potable/certified claim.
- Manual reason input is required and bounded to the contract's existing 2,000-character text limit. Free text is not written to the demo console.

## Runtime and build evidence

- Microsoft Edge via Playwright, Expo web, 412×915: suggestion and human-override flows completed with zero console errors/warnings. Accessibility snapshot exposed named buttons, a radio group/radios and labelled textbox. Width checks at 320, 768, 1024 and 1440 pixels had no document overflow.
- `docs/evidence/screenshots/t11-review-suggestion.png`
- `docs/evidence/screenshots/t11-review-manual-override.png`
- Web launch initially exposed a pre-existing crash: `demo-workflow.tsx` imported the native-only ONNX binding at module load. The minimal platform fix keeps the same pinned native runtime but loads it only when the Android/iOS probe is invoked; web now renders cleanly.
- Android debug build: JDK 17, Gradle 9.3.1, compile/target SDK 36, min SDK 26, Kotlin 2.1.20; all four configured ABIs; `BUILD SUCCESSFUL` in 9m52s, 227 tasks.
- Native quality tests: 4 tests, 0 failures/errors/skips.
- Debug APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 307,854,552 bytes, SHA-256 `6e1cdfd369e826f0a272d6c6ab413c1911c37345d14a266f84b956c30c74ccbe` (ignored build artifact; recreate with Gradle).

## Tests actually run

- `node tests/review.test.ts` — 12 scenarios passed.
- Full Node matrix plus demo test — 125 checks passed; capture golden harness completed.
- `services/api/.venv/Scripts/python.exe -m pytest -q` from repository root — 114 passed, 12 PostgreSQL tests skipped because `TEST_DATABASE_URL` was unset, 35 subtests passed.
- `python ml/quality_fixtures_run.py` — 8/8 matched, 0 mismatches, one known low-texture false reject retained.
- Root and mobile `tsc --noEmit` — clean.
- Root `npm audit` — 0 vulnerabilities. Mobile production audit — 10 moderate reports through Expo's build/config chain (`xcode` → `uuid`); no critical/high finding and no T11 runtime path. The offered forced remediation downgrades Expo to 46, so it was not applied to the pinned Expo 57 stack.
- `git diff --check` — clean apart from informational LF→CRLF notices.

## Limits and next action

- No real manufacturer profile, kit, lab comparison, calibrated confidence or approved operational threshold exists. The harness is visibly fictional/research-only and proves workflow mechanics, not chemistry.
- The screen is wired to the temporary demo tab shell, not production navigation. Durable save/outbox remains T12.
- The blueprint checkbox stays untouched because `jalsakshi-blueprint/` is this repository's checked-in reference package.
- Next exact action: T12 persists the confirmed observation and local asset crash-safely, preserving the separate provenance fields established here.
