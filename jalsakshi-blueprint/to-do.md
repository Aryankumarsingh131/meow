# Implementation task cards

Every checkbox started unchecked as planned work. Status legend (added 2026-09-24; state source of truth remains [current-state](../docs/agent-workflow/current-state.md)):

- `[x]` done — acceptance and verification re-run with recorded evidence.
- `[~]` built and tests pass, but a named Definition-of-Done item is still outstanding (usually AGENTS.md's independent review, or one missing verification). Not done.
- `[!]` **blocked / errored** on an external dependency or a failing check, named inline. Not done.
- `[ ]` not started.

Owners: **A** product/mobile/web and domain coordination; **B** native imaging/ML/performance; **C** backend/security/operations. Names can be assigned later. Astra/Fable are assistants to these owners, not substitutes for review or domain evidence.

Claim one focused task in [current-state](docs/agent-workflow/current-state.md). Dependencies, not numerical order, determine readiness. T43–T48 split reporting/security/policy work out of larger slices. Every task inherits the [definition of done](AGENTS.md) and relevant [acceptance criteria](docs/delivery/acceptance-criteria.md). Files below are proposed; avoid scaffolding unused files.

**Sizing rule:** estimates exclude external waits and are uncertain. A task marked “slice/sessions” must be split into named, dependency-linked child cards before implementation if it exceeds one focused ~2-hour session or five files. Data collection/pilot execution is an operational protocol repeated in sessions, not one giant coding task. Do not mark a parent done until all children/evidence are complete.

## T01 — Protocol and event gate

- [!] T01 complete with evidence — BLOCKED: no real kit/lot/read window or confirmed event; docs are user-authorised fictional templates.

- Requirements: REQ-002 REQ-009.
- Owner: A/domain lead. Estimated effort: 1–2 h + external waits.
- Dependencies: None. Parallel safety: No.
- Files/modules: `docs/protocol-selection.md`, `docs/event-confirmation.md`.
- Inputs → outputs: Actual kit instructions, event listing and user answers → approved protocol/eligibility record or explicit blockers.
- Acceptance: Record kit/lot/read-window provenance; distinguish synthetic demo from operational use; verify participation and pre-event rules.
- Verification: Manual source cross-check with operator/organizer; no invented thresholds.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T02 — Validate the user job and alternatives

- [!] T02 complete with evidence — BLOCKED: no real worker/supervisor interview or mWater/ODK sandbox trial; docs are fictional templates.

- Requirements: REQ-026.
- Owner: A/product. Estimated effort: 1–2 h + interviews.
- Dependencies: T01. Parallel safety: Yes, with T03.
- Files/modules: `docs/pilot-interviews.md`, `docs/alternative-evaluation.md`.
- Inputs → outputs: Worker/supervisor process and C01–C04 → observed workflow and configure-versus-build recommendation.
- Acceptance: At least one relevant workflow walkthrough; distinguish observation from inference; retain unknown buyer and lab access.
- Verification: Review notes against competitor claims; user approves any architecture change.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T03 — Prove the native toolchain

- [!] T03 complete with evidence — BLOCKED: no physical phone; APK builds and runs on emulator only, offline ONNX tensor on a real phone never run.

- Requirements: REQ-028.
- Owner: B/native. Estimated effort: 1–2 h spike.
- Dependencies: None. Parallel safety: Yes, with T01/T02.
- Files/modules: `apps/mobile/package.json`, `apps/mobile/app.config.ts`, `lockfile`, `docs/toolchain-matrix.md`.
- Inputs → outputs: Actual phone/laptop inventory + D01/D03 → pinned development/release build with known ONNX tensor.
- Acceptance: APK installs on real phone; known tensor gives expected output offline; exact versions/device recorded.
- Verification: Build/install/run procedure and sanitized logs; failed compatibility stays blocked, not mocked.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T04 — Prove file-to-feature preprocessing

- [!] T04 complete with evidence — BLOCKED: no real camera file or physical ARM device; synthetic fixture, JS/Python/Kotlin(emulator) legs agree.

- Requirements: REQ-003.
- Owner: B/native. Estimated effort: 2 h spike.
- Dependencies: T01 T03. Parallel safety: No shared native files with T03.
- Files/modules: `modules/capture-native/index.ts`, `modules/capture-native/android/CaptureModule.kt`, `tests/capture-golden.json`, `docs/feature-schema.md`.
- Inputs → outputs: Authorized fixture image + protocol → oriented ROI and schema-v1 feature vector.
- Acceptance: EXIF rotations/perspective handled; JS/Python/native golden vectors agree; memory/time recorded.
- Verification: Known corner/color fixtures and one real camera file; no blanket calibration claim.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T05 — Freeze v1 contracts and test harness

- [x] T05 complete with evidence — 2026-09-24 @ d2d9207: 26 schema + 12 contract checks pass; openapi.json/client.ts regenerate byte-identical (Python-version dependency fixed).

- Requirements: REQ-023 REQ-027.
- Owner: C/contracts. Estimated effort: 1–2 h.
- Dependencies: T01. Parallel safety: Yes, with T03/T04.
- Files/modules: `services/api/app/schemas.py`, `contracts/openapi.json`, `contracts/client.ts`, `tests/contracts.test.ts`.
- Inputs → outputs: API/data specs → validated schema and generated client boundary.
- Acceptance: Sample/command discriminators reject invalid data; synthetic fixture round trip; exact future test commands documented.
- Verification: Schema unit tests and generated diff; protect shared file ownership.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T06 — Online membership authorization

- [!] T06 complete with evidence — BLOCKED: no OIDC provider chosen (human decision) and no real test accounts; verification logic built and tested, independent auth review outstanding.

- Requirements: REQ-017.
- Owner: C/security. Estimated effort: 2 h slice.
- Dependencies: T03 T05. Parallel safety: Yes, with T07 after contract freeze.
- Files/modules: `services/api/app/auth.py`, `apps/mobile/src/auth.ts`, `tests/auth_test.py`, `docs/auth-provider.md`.
- Inputs → outputs: Chosen OIDC provider and test accounts → scoped mobile session.
- Acceptance: Issuer/audience/expiry checks; tenant membership; no client/admin secret.
- Verification: Two-user/two-tenant negative API tests; web session integration follows T18.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T07 — Source selection and history slice

- [~] T07 complete with evidence — OUTSTANDING: screen recording and independent tenant-boundary review.

- Requirements: REQ-001.
- Owner: A/mobile. Estimated effort: 1–2 h.
- Dependencies: T03 T05. Parallel safety: Yes, with T06.
- Files/modules: `apps/mobile/src/sources.tsx`, `services/api/app/sources.py`, `services/api/migrations/source.py`, `tests/sources_test.py`.
- Inputs → outputs: Assigned synthetic catalog → cached list/QR/history screen.
- Acceptance: Unknown QR safe; tenant-scoped sources; stale/offline history labeled.
- Verification: Search/QR/offline tests and screen recording.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T08 — Kit protocol and read-window flow

- [!] T08 complete with evidence — BLOCKED on T01: no real kit read window; mechanism tested against declared/synthetic SYN-COLOR-001 timing only.

- Requirements: REQ-002.
- Owner: A/mobile. Estimated effort: 1–2 h.
- Dependencies: T01 T07. Parallel safety: Yes, with T10 after interfaces.
- Files/modules: `apps/mobile/src/protocol.tsx`, `apps/mobile/src/timer.ts`, `tests/protocol.test.ts`.
- Inputs → outputs: Selected approved protocol → instructions/lot/expiry/timer.
- Acceptance: Expired kit blocked; app background timing correct; clock/reboot ambiguity invalidates interpretation.
- Verification: Boundary-time and restart tests with declared fixture timing.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T09 — Guided camera and manual ROI

- [!] T09 complete with evidence — BLOCKED: cancel-during-capture and non-1 EXIF orientation need a physical phone.

- Requirements: REQ-003.
- Owner: A/mobile. Estimated effort: 1–2 h.
- Dependencies: T04 T08. Parallel safety: No shared capture edits with B.
- Files/modules: `apps/mobile/src/capture.tsx`, `apps/mobile/src/captureJob.ts`, `tests/capture-flow.test.ts`.
- Inputs → outputs: Native bridge → user-guided still capture and cancellable jobs.
- Acceptance: Permission error recovers; missing card prompts; old job cannot overwrite retake.
- Verification: Device capture/rotate/cancel tests.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T10 — Deterministic capture-quality rules

- [x] T10 complete with evidence — 2026-09-24: quality_fixtures_run 8/8, 0 mismatches; Kotlin QualityTest 4/4 (gradle :capture-native:testDebugUnitTest), 1 false reject recorded for T23; thresholds provisional.

- Requirements: REQ-004.
- Owner: B/vision. Estimated effort: 1–2 h.
- Dependencies: T04. Parallel safety: Yes, with T08.
- Files/modules: `modules/capture-native/android/Quality.kt`, `ml/quality_baseline.py`, `tests/quality-fixtures.json`.
- Inputs → outputs: Protocol/fixture set → versioned reason codes and review/retake result.
- Acceptance: Glare/blur/clipping/reference fixtures covered; thresholds labeled provisional; no fabricated class on rejection.
- Verification: Golden/negative fixtures; record false-reject examples for T23.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T11 — Indicative review and manual fallback

- [x] T11 complete with evidence — 2026-09-24: review.test.ts 12/12 (camera-denied, uncertain, human-disagreement).

- Requirements: REQ-006 REQ-009.
- Owner: A/mobile. Estimated effort: 1–2 h.
- Dependencies: T09 T10. Parallel safety: Yes, with T13 after sample schema freeze.
- Files/modules: `apps/mobile/src/review.tsx`, `apps/mobile/src/analysis/baseline.ts`, `tests/review.test.ts`.
- Inputs → outputs: Quality/features + kit bins → deterministic suggestion or manual interpretation.
- Acceptance: Manual reason/provenance preserved; no calibrated percentage; no potability wording.
- Verification: Camera-denied, uncertain and human-disagreement scenarios.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T12 — Crash-safe local save

- [~] T12 complete with evidence — OUTSTANDING: kill DURING a write on a device (only post-commit kill -9 done on emulator 2026-09-24; mid-write is fault-injected). Fixed: owner scoping, optional photo, single connection (handoff-T15.md).

- Requirements: REQ-007.
- Owner: A/storage. Estimated effort: 2 h slice.
- Dependencies: T11. Parallel safety: No shared storage edits.
- Files/modules: `apps/mobile/src/storage.ts`, `apps/mobile/src/outbox.ts`, `tests/local-save.test.ts`, `docs/local-recovery.md`.
- Inputs → outputs: Confirmed sample + local asset → durable sample/outbox/receipt.
- Acceptance: Force-kill recovery works; orphan cleanup safe; disk failure never reports success.
- Verification: Inject failures before/after file rename and DB commit; counts/hashes after restart.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T13 — Idempotent sample ingestion

- [~] T13 complete with evidence — OUTSTANDING: independent sync-ordering review. 10/10 incl. PostgreSQL 17.6 concurrent replay re-run 2026-09-24.

- Requirements: REQ-008.
- Owner: C/backend. Estimated effort: 1–2 h.
- Dependencies: T05 T06. Parallel safety: Yes, with T09–T12.
- Files/modules: `services/api/app/sync_push.py`, `services/api/app/samples.py`, `services/api/migrations/samples.py`, `tests/sync_push_test.py`.
- Inputs → outputs: Validated event batch → per-event receipts and immutable samples.
- Acceptance: Duplicate same hash returns same effect; mismatch rejected; partial batch outcome explicit.
- Verification: Replay/reorder/validation integration tests with PostgreSQL.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T14 — Commit-ordered pull and conflicts

- [~] T14 complete with evidence — OUTSTANDING: independent sync-ordering review. 12/12 incl. PostgreSQL late-commit test; global-sequence mutant caught (handoff-T14.md).

- Requirements: REQ-008.
- Owner: C/backend. Estimated effort: 2 h slice.
- Dependencies: T13. Parallel safety: No concurrent migration/schema edits.
- Files/modules: `services/api/app/sync_pull.py`, `services/api/app/changefeed.py`, `services/api/migrations/changefeed.py`, `tests/sync_order_test.py`.
- Inputs → outputs: Tenant mutations → stable paged feed/bootstrap snapshot.
- Acceptance: Late commits not skipped; cursor/filter bound; version conflict structured.
- Verification: Concurrent transaction test; partial-page rollback; reset-cursor recovery.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T15 — Foreground reconnect and queue UX

- [~] T15 complete with evidence — OUTSTANDING: physical-phone run and independent sync review. Emulator airplane/kill -9/reconnect run showed the same record accepted (server 1 row); 15/15 real-server tests (handoff-T15.md).

- Requirements: REQ-008.
- Owner: A/mobile. Estimated effort: 1–2 h.
- Dependencies: T12 T14. Parallel safety: Yes, with T17.
- Files/modules: `apps/mobile/src/sync.ts`, `apps/mobile/src/queue.tsx`, `tests/sync-client.test.ts`.
- Inputs → outputs: Outbox/receipts → Sync Now/reopen retry/status.
- Acceptance: Lost acknowledgment safe; auth failures pause; no closed-app immediacy claim.
- Verification: Airplane/reconnect/kill/retry real-device scenario; background optional.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T16 — Private evidence upload boundary

- [~] T16 complete with evidence — OUTSTANDING: independent security review; no malware scanner so lab PDFs stay quarantined. 19/19 incl. PostgreSQL; 15/15 mutants (handoff-T16.md).

- Requirements: REQ-018.
- Owner: C/security. Estimated effort: 2 h slice.
- Dependencies: T13. Parallel safety: Yes, with T17 only separate files.
- Files/modules: `services/api/app/evidence.py`, `services/api/app/upload_validation.py`, `services/api/migrations/evidence.py`, `tests/upload_test.py`.
- Inputs → outputs: Opt-in authorized asset metadata → private quarantine/upload/verification state.
- Acceptance: Wrong tenant denied; unsafe/oversize input rejected; metadata/image states independent.
- Verification: Upload allowlist/hash/expired URL/cancel tests; no real data until T32.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T17 — Case transition engine

- [~] T17 complete with evidence — OUTSTANDING: independent state-closure/concurrency review; T46 policy approval. 19/19 incl. exhaustive 6×10 table + PostgreSQL two-reviewer race ×5; 18/18 mutants (handoff-T17.md).

- Requirements: REQ-010.
- Owner: C/backend. Estimated effort: 1–2 h.
- Dependencies: T14. Parallel safety: Yes, with T15.
- Files/modules: `services/api/app/cases.py`, `services/api/app/case_policy.py`, `services/api/migrations/cases.py`, `tests/case_policy_test.py`.
- Inputs → outputs: Flagged sample/policy → unique review case with guarded commands.
- Acceptance: One case per trigger; owner/due enforced; stale-version rejection.
- Verification: Transition table tests including invalid/uncertain capture triage.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T18 — Supervisor queue and detail slice

- [~] T18 complete with evidence — API ONLY: the supervisor board is a separate app owned elsewhere (owner decision 2026-09-24). GET /v1/cases, /v1/cases/{id}, /v1/me + CORS allowlist; 11/11. OUTSTANDING: board-side E2E/keyboard/states (external), independent review (handoff-T18.md).

- Requirements: REQ-010 REQ-015.
- Owner: A/web. Estimated effort: 2 h slice.
- Dependencies: T06 T17. Parallel safety: Yes, with T19 under frozen contracts.
- Files/modules: `apps/web/app/cases/page.tsx`, `apps/web/app/cases/[id]/page.tsx`, `apps/web/lib/session.ts`, `tests/web-cases.spec.ts`.
- Inputs → outputs: Authenticated API → filters, timeline, assignment and evidence status.
- Acceptance: Secure web session; stale/empty/error/conflict states; filters match server.
- Verification: Browser E2E with two roles; keyboard pass for essential controls.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T19 — Lab entry and verification slice

- [~] T19 complete with evidence — OUTSTANDING: independent state-closure/concurrency review; UI lives in the separate web app per T18's owner decision; PostgreSQL race tests not re-run in this environment. 21/21 incl. exhaustive mismatch/role/supersession cases (handoff-T19.md).

- Requirements: REQ-011.
- Owner: C/backend. Estimated effort: 2 h slice.
- Dependencies: T16 T17. Parallel safety: Yes, with independent web work.
- Files/modules: `services/api/app/lab_reports.py`, `services/api/migrations/lab.py`, `apps/web/app/lab/page.tsx`, `tests/lab_test.py`.
- Inputs → outputs: Structured report + authorized reviewer → verified or rejected report.
- Acceptance: Parameter/unit/source mismatch visible; report upload not verification; correction supersedes.
- Verification: Negative report/role cases and UI verification path.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T20 — Corrective action slice

- [ ] T20 complete with evidence

- Requirements: REQ-012.
- Owner: A/product-engineer. Estimated effort: 1–2 h.
- Dependencies: T18. Parallel safety: Yes, with T19.
- Files/modules: `services/api/app/actions.py`, `apps/web/components/ActionForm.tsx`, `tests/action_test.py`.
- Inputs → outputs: Case and owner → action/due/completion evidence.
- Acceptance: Who/what/when retained; completion does not close; no autonomous treatment instructions.
- Verification: Action flow and incomplete closure rejection.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T21 — Retest and guarded closure

- [~] T21 complete with evidence — OUTSTANDING: independent concurrency/closure review; T20 (actions) still doesn't exist so close()'s action evidence needs an exemption reason. 7/7 (handoff-T21.md).

- Requirements: REQ-013.
- Owner: C/backend. Estimated effort: 2 h slice.
- Dependencies: T19 T20. Parallel safety: No shared case policy edits.
- Files/modules: `services/api/app/case_policy.py`, `apps/web/components/ClosureReview.tsx`, `tests/closure_test.py`.
- Inputs → outputs: Report/action/new sample → evidence checklist, closure/reopen.
- Acceptance: Reject missing proof; same-source later retest; concurrent commands safe; communication required per policy.
- Verification: State-machine negatives and two-reviewer race; final full journey after T22.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T22 — Resident communication record

- [~] T22 complete with evidence — OUTSTANDING: independent concurrency/closure review; resident-facing wording is T44's call. 10/10, incl. full real-evidence close path (handoff-T22.md).

- Requirements: REQ-014.
- Owner: A/product-engineer. Estimated effort: 1–2 h.
- Dependencies: T18. Parallel safety: Yes, with T21.
- Files/modules: `services/api/app/communications.py`, `apps/web/components/ResidentUpdate.tsx`, `tests/communication_test.py`.
- Inputs → outputs: Approved template + operator action → recorded communication and summary.
- Acceptance: No implied delivery; content/version/actor/time saved; closure policy consumes actual record.
- Verification: Synthetic resident summary comprehension and missing-update closure check.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T23 — Collect a protocol-grounded feasibility set

- [ ] T23 complete with evidence

- Requirements: REQ-019.
- Owner: B/domain. Estimated effort: 2 h sessions + acquisition waits.
- Dependencies: T01 T04 T10. Parallel safety: Yes, alongside M2; requires lab access.
- Files/modules: `ml/data/manifest.schema.json`, `docs/data-protocol.md`, `docs/data-permissions.md`.
- Inputs → outputs: Selected kit/reference method/permissions → versioned independent sample manifest.
- Acceptance: Each preparation has traceable labels/context; no generated ground truth; lawful reuse/consent captured.
- Verification: Domain reviewer audits random records and independent sample count.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T24 — Implement leakage-safe evaluation

- [ ] T24 complete with evidence

- Requirements: REQ-019 REQ-027.
- Owner: B/ML. Estimated effort: 1–2 h.
- Dependencies: T23. Parallel safety: Yes, with A/C tasks.
- Files/modules: `ml/splits.py`, `ml/evaluate.py`, `ml/tests/test_splits.py`, `ml/reports/baseline.md`.
- Inputs → outputs: Manifest → grouped frozen splits and metric report.
- Acceptance: No overlapping physical groups/derivatives; denominators and confidence intervals; baseline included.
- Verification: Disjointness test deliberately fails on duplicate group; report provenance.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T25 — Train and select small local model

- [ ] T25 complete with evidence

- Requirements: REQ-005 REQ-019.
- Owner: B/ML. Estimated effort: 2 h experiment sessions.
- Dependencies: T24. Parallel safety: Yes, with web/API work.
- Files/modules: `ml/train.py`, `ml/export.py`, `ml/model-card.md`, `ml/reports/comparison.md`.
- Inputs → outputs: Frozen development data → baseline/kNN/MLP comparison and candidate ONNX.
- Acceptance: Same splits; operator-compatible export; license and limitations documented.
- Verification: Reproducible seed/run config; CPU output parity on golden features.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T26 — Integrate bundled model offline

- [ ] T26 complete with evidence

- Requirements: REQ-005.
- Owner: B/mobile-ML. Estimated effort: 1–2 h.
- Dependencies: T03 T11 T25. Parallel safety: No shared analysis edits.
- Files/modules: `apps/mobile/src/analysis/model.ts`, `apps/mobile/assets/model-manifest.json`, `tests/model-parity.test.ts`.
- Inputs → outputs: Candidate ONNX + manifest → local AnalysisResult.
- Acceptance: Airplane mode runs; wrong SHA/schema fails; unavailable model shows honest fallback.
- Verification: Real-device parity, load failure and cancel/retake tests.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T27 — Calibrate and evaluate optimized variants

- [ ] T27 complete with evidence

- Requirements: REQ-005 REQ-019.
- Owner: B/ML. Estimated effort: 2 h experiment sessions.
- Dependencies: T26. Parallel safety: Yes, with T28.
- Files/modules: `ml/calibrate.py`, `ml/benchmark_variants.py`, `ml/reports/release-evaluation.md`, `apps/mobile/assets/model-manifest.json`.
- Inputs → outputs: Candidate + held-out data/device → approved or research-only model status.
- Acceptance: Abstention/coverage reported; quality gates; int8 adopted only paired benefit.
- Verification: Locked-test and leave-domain-out report; no tuning on test labels.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T28 — Language and accessible journey pass

- [ ] T28 complete with evidence

- Requirements: REQ-016.
- Owner: A/design-tester. Estimated effort: 2 h slices by screen.
- Dependencies: T15 T18 T22. Parallel safety: Yes, with T27.
- Files/modules: `apps/mobile/locales/`, `apps/web/locales/`, `docs/accessibility-checks.md`.
- Inputs → outputs: Implemented essential screens → reviewed English/Hindi and accessible flow.
- Acceptance: TalkBack/keyboard/200% text/reduced motion; visible errors; font license recorded.
- Verification: Manual real-device/web checklist plus automated contrast/a11y scan.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T29 — Device critical-path benchmark

- [ ] T29 complete with evidence

- Requirements: REQ-020.
- Owner: B/performance. Estimated effort: 1–2 h harness + repeated runs.
- Dependencies: T26 T15. Parallel safety: Yes, with T30.
- Files/modules: `tests/performance/device-runbook.md`, `ml/reports/device-performance.md`.
- Inputs → outputs: Release APK/data → cold/warm/memory/quality measurements.
- Acceptance: Whole path instrumented; thermal/network/phone recorded; honest tail sample sizes.
- Verification: Benchmark procedures from performance plan; raw samples retained.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T30 — Server and reconnect load benchmark

- [ ] T30 complete with evidence

- Requirements: REQ-020.
- Owner: C/performance. Estimated effort: 1–2 h harness + repeated runs.
- Dependencies: T14 T17 T16. Parallel safety: Yes, with T29.
- Files/modules: `tests/load/scenarios.js`, `docs/benchmarks/server.md`.
- Inputs → outputs: Representative synthetic data → load/lock/pool/backpressure evidence.
- Acceptance: 1/10/50req/s and hot tenant; accepted counts correct; no unbounded worker growth.
- Verification: Record errors and raw latency distributions; optimize only identified bottleneck.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T31 — Tenant and state security regression

- [ ] T31 complete with evidence

- Requirements: REQ-017 REQ-027.
- Owner: C + independent reviewer. Estimated effort: 2 h focused matrix.
- Dependencies: T19 T21 T22. Parallel safety: Yes, read-only review parallel.
- Files/modules: `tests/security/tenant_test.py`, `tests/security/state_test.py`, `docs/security-review.md`.
- Inputs → outputs: Full API → cross-tenant/role/replay/closure negative results.
- Acceptance: No high-severity bypass; RLS app role not owner; exports/assets included when available.
- Verification: Reviewer executes matrix independently and records defects.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T32 — Offline storage and privacy hardening

- [ ] T32 complete with evidence

- Requirements: REQ-018.
- Owner: C/native-security. Estimated effort: 2 h slices by boundary.
- Dependencies: T12 T16. Parallel safety: No simultaneous storage/native edits.
- Files/modules: `modules/secure-evidence/`, `apps/mobile/src/storage.ts`, `docs/privacy-checks.md`.
- Inputs → outputs: Persisted images/DB + policy → encrypted/locked/permission-aware storage.
- Acceptance: SQLCipher and images independently protected; temp cleanup and key loss safe; default no uploads.
- Verification: Filesystem inspection, key invalidation/restart, disabled-upload network check.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T33 — Operational signals and safe logging

- [ ] T33 complete with evidence

- Requirements: REQ-021.
- Owner: C/operations. Estimated effort: 1–2 h.
- Dependencies: T15 T17. Parallel safety: Yes, with independent ML work.
- Files/modules: `services/api/app/telemetry.py`, `apps/mobile/src/diagnostics.ts`, `docs/alert-runbook.md`.
- Inputs → outputs: Failure taxonomy → sanitized metrics/logs and ownership.
- Acceptance: Request IDs trace failures; no sensitive fields; queue/overdue/backup alerts actionable.
- Verification: Inject known failure and sensitive markers; inspect logs and alert route.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T34 — Full regression and truthful demo harness

- [ ] T34 complete with evidence

- Requirements: REQ-025 REQ-027.
- Owner: A/test + reviewer. Estimated effort: 2 h sessions.
- Dependencies: T15 T18 T19 T20 T21 T22. Parallel safety: Yes, read-only with compatible fixes.
- Files/modules: `tests/e2e/field-case.spec.ts`, `docs/demo-evidence.md`, `docs/release-test-matrix.md`.
- Inputs → outputs: Integrated synthetic scenario → repeatable complete loop and disclosures.
- Acceptance: Two cold real-device runs; invalid closure and offline recovery shown; mock/real boundaries visible.
- Verification: Record build/video/receipts; scientific and pilot gates remain separate.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T35 — Staging deployment pipeline

- [ ] T35 complete with evidence

- Requirements: REQ-022.
- Owner: C/release. Estimated effort: 2 h slice.
- Dependencies: T31 T32 T33. Parallel safety: No concurrent release config edits.
- Files/modules: `infra/compose.yaml`, `infra/deploy.md`, `.github/workflows/ci.yml`, `docs/staging-evidence.md`.
- Inputs → outputs: Budget/provider approval + built artifacts → isolated staging.
- Acceptance: Secrets external; TLS and health; CI tests and migration lock.
- Verification: Staging smoke with synthetic tenant; do not call production deployed.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T36 — Backup and restore rehearsal

- [ ] T36 complete with evidence

- Requirements: REQ-022.
- Owner: C/release. Estimated effort: 1–2 h + restore wait.
- Dependencies: T35. Parallel safety: No simultaneous DB migration.
- Files/modules: `infra/backup.md`, `docs/restore-evidence.md`.
- Inputs → outputs: Staging backup → isolated restored environment.
- Acceptance: Rows/assets/changefeed reconcile; deletion ledger reapplied; RPO/RTO measured.
- Verification: Timed restore and random checksums plus authorization smoke.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T37 — Rollback and old-client rehearsal

- [ ] T37 complete with evidence

- Requirements: REQ-022.
- Owner: C/release. Estimated effort: 1–2 h.
- Dependencies: T36. Parallel safety: No concurrent deploy.
- Files/modules: `infra/rollback.md`, `docs/compatibility-evidence.md`.
- Inputs → outputs: Previous app/API/schema + pending records → tested rollback path.
- Acceptance: No destructive auto-down migration; old outbox handled; unsafe model can be disabled.
- Verification: Rollback staging and replay queued event; record failure boundary.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T38 — Authorized shadow pilot and buyer learning

- [ ] T38 complete with evidence

- Requirements: REQ-026.
- Owner: A/domain lead. Estimated effort: 2 h analysis sessions + weeks of field time.
- Dependencies: T02 T27 T28 T34 T36 T37 T48. Parallel safety: Yes, with contained scale experiments.
- Files/modules: `docs/pilot-protocol.md`, `docs/pilot-results.md`, `docs/buyer-notes.md`.
- Inputs → outputs: Operator agreement + baseline → 50–100 workflow records and learning.
- Acceptance: Consent/policy approved; separate operational/scientific outcomes; no causal or revenue overclaim.
- Verification: Compare denominators/time-to-referral/completeness; report missing data and confounders.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T39 — Production release verification

- [ ] T39 complete with evidence

- Requirements: REQ-022.
- Owner: C/release + A approval. Estimated effort: 1–2 h + monitoring.
- Dependencies: T38 T43 T45 T47 T48. Parallel safety: No concurrent migrations.
- Files/modules: `docs/production-evidence.md`, `docs/agent-workflow/current-state.md`.
- Inputs → outputs: All G5 evidence and approval → live verified pilot release.
- Acceptance: Smoke/monitoring/owner/backups; exact deployed versions; unresolved high risks block.
- Verification: Live synthetic end-to-end smoke and monitoring check; no fabricated URL.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T40 — Second-kit configuration exercise

- [ ] T40 complete with evidence

- Requirements: REQ-024.
- Owner: B/domain + A. Estimated effort: 2 h config sessions + new data collection.
- Dependencies: T27 T38. Parallel safety: Yes, separate protocol/model version.
- Files/modules: `ml/protocols/second-kit.json`, `docs/second-kit-validation.md`.
- Inputs → outputs: Second manufacturer protocol/data → independently evaluated configuration.
- Acceptance: New bins/timing/language labels; no reuse of first-kit accuracy claim; rollback isolated.
- Verification: Repeat analytical/domain acceptance for new kit.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T41 — Expansion and capacity validation

- [ ] T41 complete with evidence

- Requirements: REQ-024.
- Owner: C/performance. Estimated effort: 1–2 h harness + runs.
- Dependencies: T30 T38. Parallel safety: Yes, isolated staging only.
- Files/modules: `tests/load/expansion.js`, `docs/scale-decision.md`.
- Inputs → outputs: 10x data/tenant skew → capacity limits and upgrade decision.
- Acceptance: No tenant leak; bounded device assignment; performance/backup limits measured.
- Verification: Scale benchmark + restore-size estimate; reprice only measured bottleneck.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T42 — Independent full-product handoff

- [ ] T42 complete with evidence

- Requirements: REQ-028.
- Owner: A/coordinator + fresh reviewer. Estimated effort: 1–2 h.
- Dependencies: T39 T40 T41. Parallel safety: Read-only independent review.
- Files/modules: `docs/agent-workflow/current-state.md`, `docs/release-evidence-index.md`, `to-do.md`.
- Inputs → outputs: All requirement evidence → resumable documented product state.
- Acceptance: Every REQ links to passing evidence; actual commands documented; fresh agent can claim next task.
- Verification: Fresh-context walkthrough and all-gate audit; unchecked failures remain open.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T43 — Metrics and safe export slice

- [~] T43 complete with evidence — OUTSTANDING: reports page lives in the separate web app (T18 decision); T31 recheck; independent review. 14/14, 2/2 mutants (handoff-T43.md).

- Requirements: REQ-015 REQ-023.
- Owner: C/reporting + A. Estimated effort: 2 h slice.
- Dependencies: T18 T22. Parallel safety: Yes, after contracts freeze.
- Files/modules: `services/api/app/reports.py`, `services/api/app/jobs.py`, `apps/web/app/reports/page.tsx`, `tests/reports_test.py`.
- Inputs → outputs: Case/sample records → denominator-defined metrics and cancelable export.
- Acceptance: Synthetic excluded; role/tenant scope; CSV neutralization and no partial file publication.
- Verification: Filter/count/CSV/job-cancel tests; include in T31 recheck.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T44 — Resident-template domain review

- [ ] T44 complete with evidence

- Requirements: REQ-014 REQ-016.
- Owner: A/domain. Estimated effort: 1–2 h.
- Dependencies: T22 T28. Parallel safety: Yes, no shared code required.
- Files/modules: `docs/resident-template-approval.md`.
- Inputs → outputs: Language templates → approved plain-language wording.
- Acceptance: No certification/unsafe advice; target users understand pending vs confirmed.
- Verification: Comprehension walkthrough with reviewer; update templates through A.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T45 — Offline grant and revocation handling

- [~] T45 complete with evidence — OUTSTANDING: independent auth review, physical phone, real IdP (T06). Emulator: grant → offline kill/relaunch → continue offline → 5 h clock rollback locked, 0 records lost → re-login synced; 4+10 tests, 10/10 mutants (handoff-T45.md).

- Requirements: REQ-017.
- Owner: C/security + A. Estimated effort: 2 h slice.
- Dependencies: T06 T12 T15. Parallel safety: No shared auth/storage edits.
- Files/modules: `services/api/app/offline_grants.py`, `apps/mobile/src/offlineAccess.ts`, `tests/offline-auth.test.ts`.
- Inputs → outputs: Membership/policy → bounded offline access and safe lock.
- Acceptance: First provisioning online; expired grant locks without losing queue; clock rollback handled.
- Verification: Revocation/reboot/time-shift/relogin tests with pending samples.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T46 — Closure-policy domain approval

- [!] T46 complete with evidence — BLOCKED on a human domain reviewer. Draft policy + E1–E3 enforcement + 7 regression tests exist; sign-off block empty (handoff-T46.md, docs/closure-policy-approval.md).

- Requirements: REQ-009 REQ-011 REQ-013.
- Owner: A/domain + C. Estimated effort: 1–2 h.
- Dependencies: T19 T21 T22. Parallel safety: Yes, read-only policy review.
- Files/modules: `docs/closure-policy-approval.md`, `services/api/app/case_policy.py`, `tests/closure_policy_test.py`.
- Inputs → outputs: Reviewer protocol → approved evidence prerequisites/exceptions.
- Acceptance: Exceptions explicit and authorized; no blanket safe label; dependent disputed report triggers review.
- Verification: Domain signoff and regression tests for approved exceptions.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T47 — Retention and deletion recovery

- [ ] T47 complete with evidence

- Requirements: REQ-018 REQ-022.
- Owner: C/privacy. Estimated effort: 1–2 h.
- Dependencies: T16 T32 T36. Parallel safety: No concurrent storage policy changes.
- Files/modules: `services/api/app/retention.py`, `tests/retention_test.py`, `docs/deletion-evidence.md`.
- Inputs → outputs: Approved retention policy → idempotent purge/hold/deletion ledger.
- Acceptance: Unsynced unresolved evidence not silently deleted; backup expiry documented; restore reapplies deletion.
- Verification: Fake-clock expiry, interrupted purge and restore tests.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## T48 — Final release security and accessibility review

- [ ] T48 complete with evidence

- Requirements: REQ-016 REQ-017 REQ-018 REQ-027.
- Owner: Independent reviewer/tester. Estimated effort: 1–2 h.
- Dependencies: T31 T32 T43 T44 T45 T46 T47. Parallel safety: Read-only review; fixes separately claimed.
- Files/modules: `docs/final-review.md`, `docs/release-test-matrix.md`.
- Inputs → outputs: Complete current release → final negative/a11y/dependency checks.
- Acceptance: New endpoints/retention/offline paths rechecked; no unreviewed high-risk changes; all blockers named.
- Verification: Repeat affected test matrix and manual access checks on exact release build.
- Completion evidence: handoff with changed files, exact command/procedure, result, build/commit and artifact location; update current-state and this checkbox only after review.

## Checkpoints

- [!] G0: T01–T04 feasibility reviewed; unsafe claims blocked. — BLOCKED: only met via the synthetic-only boundary (ADR-M1-001).
- [!] G1: T05–T15 and T45 applicable slice checks; restart/replay proof, not a UI-only demo. — NOT PASSED: M1 goal shown on an EMULATOR with synthetic data (offline save → kill -9 → reconnect → same record, 1 server row). Blocked by T01/T08 real kit, T03/T04/T09 physical phone, T06 IdP; independent reviews outstanding (current-state.md G1 review).
- [ ] G2: T16–T22, T43 and T46 workflow checks; evidence-complete closure.
- [ ] G3: T23–T28 and T44 scientific/accessibility checks.
- [ ] G4: T29–T34, T45, T47 and T48 hardening checks; overlaps completed before release.
- [ ] G5: T35–T39 deployed pilot evidence and approvals.
- [ ] G6: T40–T42 all requirements independently verified.
