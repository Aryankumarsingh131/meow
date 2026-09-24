# Handoff — T19 lab entry and verification slice

- Task: T19 / REQ-011. Role C (backend), carried by the agent under the M2 option-A authorisation (synthetic only).
- Status: **`[~]` API built and verified.** Outstanding: independent state-closure/concurrency review (shares T17's guard machinery), PostgreSQL race re-run in an environment with `TEST_DATABASE_URL` configured, and a UI. Per the T18 project-owner decision, the supervisor/lab web app is a **separate app at its own address**, not part of this repository — `apps/web/app/lab/page.tsx` is therefore explicitly out of scope here, not a missed file.

## What was built

| File | Purpose |
|---|---|
| `services/api/migrations/lab.py` | `lab_reports` table: append-only apart from one `unverified -> verified/rejected` decision; `verified_by <> uploaded_by` enforced by a DB `CHECK`, not just app code; `supersedes_id` unique per tenant so a correction chain never forks |
| `services/api/app/lab_reports.py` | `record_report` (mismatch computation, idempotent on `report_id`, correction/supersession, re-review flag on a closed/closure_review case) and `decide_report` (role/self-review guard, mismatch blocks `verify`, optimistic-concurrency race against a racing case command) |
| `services/api/app/case_policy.py` | `g_verified`/`g_lab_adverse`/`g_lab_within_limit` now read real `lab_reports` evidence instead of `not_yet_available` stubs (rows 6–8 of the case transition table); `protocol_policy` split so `_mismatches` can read the full protocol doc, not just its `quality_policy` |
| `services/api/app/evidence.py` | `IntentRequest.context` extended to `lab_report`; a lab-report file attaches to a **case** (not a sample), and only `supervisor`/`lab_reviewer`/`admin` may attach one; PDFs are now allowed for this context (T16's PDF quarantine path still applies) |
| `services/api/app/errors.py` | Five new problem codes: `LAB_RESULT_NOT_ADVERSE`, `LAB_RESULT_NOT_WITHIN_LIMIT`, `LAB_REPORT_MISMATCH`, `LAB_REPORT_DECIDED`, `LAB_REPORT_SUPERSEDED` |
| `services/api/app/routes_v1.py` | `POST /v1/lab-reports`, `POST /v1/lab-reports/{id}/verify` |
| `services/api/app/dev_issuer.py` | Synthetic `lab-reviewer` demo user/membership, distinct from the report-recording `supervisor`, so self-review tests exercise a real second identity |
| `services/api/app/db.py` | `lab` migration wired into both SQLite and PostgreSQL `migrate()` |
| `tests/lab_test.py` | 21 tests (mismatch detection, recording-is-not-verifying, role separation incl. a DB-level self-verification check, correction/supersession, interpretation guards, HTTP, PostgreSQL race) |

## Acceptance mapping

- **Report upload is not verification.** Recording a report always leaves it `unverified`; nothing before an explicit `verify`/`reject` call changes `verification_state`, and recording never moves the case's `status` (only its `version`, so a racing case command must reload).
- **Mismatch visible and blocking.** Source, sample (must belong to the case's source), parameter, unit, unknown-protocol, and collection-time-vs-screening-window mismatches are computed at recording time and returned on the report; `verify` is refused (`LAB_REPORT_MISMATCH`) while any mismatch is present. `reject` and a corrected report remain the two ways forward.
- **Verification separated from recording.** The recorder cannot decide their own report (`VERIFICATION_SELF_REVIEW`), enforced twice: in `decide_report` and by the table's `CHECK (verified_by IS NULL OR verified_by <> uploaded_by)`, so even a code defect can't self-approve a report at the database layer.
- **Correction supersedes, never edits.** A new report with `supersedes_id` appends; the old row is untouched. Superseding a report already decided on a `closure_review`/`closed` case sets `requires_rereview` without moving the case, so a stale verdict can't silently stand or silently reopen the case.
- **Guards read real evidence.** `g_verified` (row 6/7/8), `g_lab_adverse` (row 6, `record_action`) and `g_lab_within_limit` (row 8, `request_closure`) now consult `current_verified_reports` — verified, not-superseded, zero-mismatch reports only — instead of always refusing.

## Verification actually run (2026-09-24)

- `python -m unittest tests.lab_test -v`: **21/21** (2 skipped: `TEST_DATABASE_URL not configured` in this environment — the two PostgreSQL race tests are written and will run wherever the Supabase credential is present, per T16/T17's own PostgreSQL-race pattern).
- `python -m unittest tests.upload_test -v`: **19/19** (1 skipped for the same reason) — confirms the `lab_report` evidence-context change didn't regress T16's sample-photo path.
- `python -m unittest discover -s tests -p "*_test.py"`: **241 passed** (11 skipped, all `TEST_DATABASE_URL`-gated), full repo suite green after this change.
- No contract regeneration needed: `contracts/openapi.json`/`client.ts` are frozen to two synthetic demo paths only (`contracts_app.py`); `/v1/lab-reports*` was never in scope for them, matching T16/T18/T45's own routes.

## Not done / limits

- **No UI.** Per the T18 project-owner decision the lab/supervisor screens live in a separate web app; this repo provides only the API.
- **PostgreSQL race tests not run in this environment** (no `TEST_DATABASE_URL`/Supabase credential configured here). They exist and should be re-run wherever T16/T17/T18's PostgreSQL suite is re-run.
- **No mutation-testing pass recorded for this change** (unlike T16/T17/T18's stated mutant counts) — worth running before this is ticked complete.
- **`lab_interpretation` is the lab's own transcribed statement**, not a computed threshold comparison; T46 is the domain sign-off on using it as the closure-policy trigger.
- **Needs independent review:** state-closure/concurrency (AGENTS.md), same requirement as T17 since the new guards sit in the same transition table.

## Independent post-pull check (from meow/main)

- Task: T19 / REQ-011 / AC-011. Verification owner: this agent, 2026-09-24; independent reviewer still needed.
- Status: `[~]`. API implementation arrived on `main` in `30634ce`; this handoff records a post-pull check, not authorship of that implementation.
- Files checked: `services/api/app/lab_reports.py`, `tests/lab_test.py`; task status recorded in `to-do.md` and `current-state.md`.
- Actual check: `py -3.11 -m unittest tests.lab_test -v` from repository root on Windows, Python 3.11: 19 passed, 2 skipped (`TEST_DATABASE_URL` not configured). HTTP test covers record, upload quarantine, role rejection, verification and visible source mismatch. Other local tests cover supersession, self-review and closure guards.
- Not verified: PostgreSQL reviewer/command races, external board lab entry and reviewer flow, independent security/state review. The board is a separate app by the T18 owner decision. Synthetic reports do not establish real laboratory validity.
- Next: run the PostgreSQL race checks against a configured test database; verify the separate board with two roles; obtain independent review before ticking T19 complete.
