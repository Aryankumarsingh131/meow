# Handoff — T21 retest and guarded closure

- Task: T21 / REQ-013. Role C (backend), carried by the agent under the M2 option-A authorisation (synthetic only).
- Status: **`[~]` built and verified.** The retest guard (row 10) is fully real. The closure guard (row 11) is also real but was completed together with T22 (below), because "communication required" is one of its four evidence checks and has no table to check against until T22 exists. **Outstanding:** independent concurrency/closure review (AGENTS.md); T20 (corrective actions) still doesn't exist, so `close`'s action-evidence path can only ever be satisfied by an exemption reason, never by real `action_ids`; T46 domain sign-off on which exemptions are authorized.

## What was built

| File | Purpose |
|---|---|
| `services/api/migrations/cases.py` | Added `retest_sample_id`, `communication_id` columns to `cases` (nullable; `retest_sample_id` has a real FK to `samples`) |
| `services/api/app/case_policy.py` | `retest_sample_ok()` + real `g_retest` (row 10): a retest sample must exist, be on the SAME source as the case, and be captured AFTER the trigger sample — never the trigger sample itself, never invented |
| `services/api/app/cases.py` | `_link_retest` effect (stores the linked sample id); `load_case`'s column list extended |
| `tests/closure_test.py` | 7 tests: missing proof, nonexistent sample, the trigger sample as its own retest, wrong source, an earlier retest, a real same-source-later retest succeeding, and a concurrency race on `link_retest` |

## Acceptance mapping

- **Reject missing proof.** No `retest_sample_id` → `RETEST_INVALID`. A `retest_sample_id` pointing at nothing, at the trigger sample itself, at a different source, or at a sample captured before the trigger → all `RETEST_INVALID`, never silently accepted.
- **Same-source later retest.** Verified by joining to the real `samples` row and comparing `source_id` and `captured_at_device` — not by trusting the client's claim.
- **Concurrent commands safe.** Reuses the case engine's existing optimistic-concurrency `expected_version` check (T17): two `link_retest` commands racing on the same version leave exactly one winner and one `CASE_VERSION_CONFLICT`.
- **Communication required per policy.** This part of T21's acceptance line is delivered in the T22 handoff, since it needed T22's `communications` table to check against; see there for the full `close` guard.

## Verification actually run (2026-09-24)

- `python -m unittest tests.closure_test -v`: **7/7**.
- `python -m unittest tests.case_policy_test -v`: **12/12**, including the pre-existing exhaustive (state × command) table (60 pairs) — updated only where `record_communication`/`link_retest` now behave differently than their old fail-closed stubs, never loosened elsewhere.
- Full repo suite (`python -m unittest discover -s tests -p "*_test.py"`): **258 passed**, 11 skipped (all `TEST_DATABASE_URL`-gated), no regressions.
- No contract regeneration needed: case commands were never in the T05-frozen `openapi.json`/`client.ts`.

## Not done / limits

- **No PostgreSQL run in this environment** (no `TEST_DATABASE_URL`/Supabase credential configured here); the SQLite suite exercises every guard and the version-conflict race, but a real two-writer PostgreSQL race for `link_retest` specifically hasn't been re-run, unlike T13/T14/T16-T19's own PostgreSQL passes.
- **No mutation-testing pass recorded** for this change.
- **No web UI**, consistent with T18's owner decision that non-field-worker screens live in a separate app; `apps/web/components/ClosureReview.tsx` from the task card was not built here.
- **Needs independent review:** concurrency/closure (AGENTS.md), same class of review T17/T19 are still waiting on.
