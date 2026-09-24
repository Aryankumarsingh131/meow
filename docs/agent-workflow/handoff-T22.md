# Handoff — T22 resident communication record

- Task: T22 / REQ-014. Carried by the agent under the M2 option-A authorisation (synthetic only).
- Status: **`[~]` built and verified.** Together with T21, this also completes the real `g_close` guard (row 11), which was left fail-closed by T17/T19/T21 pending this table. **Outstanding:** independent concurrency/closure review; the wording *content* residents actually see is T44's domain review, not this task's; no dedicated web form (per the T18 owner decision, non-field-worker UI lives in a separate app).

## What was built

| File | Purpose |
|---|---|
| `services/api/migrations/communications.py` | New `communications` table: append-only, `channel` + `template_version` + `audience_description` + `actor_id` + `occurred_at`. No "delivered" field exists anywhere — recording is never a delivery claim |
| `services/api/app/cases.py` | `_record_communication` effect (row 13, any open state, never moves status); the row's `id` is the client's own `command_id`, so the same value can be handed straight back as `close`'s `communication_id` with no extra round trip |
| `services/api/app/case_policy.py` | Real `g_close` (row 11): checks all four `close` evidence fields at once and reports every failing one in `field_errors`, not just the first — `verified_report_id` (must be a current verified, non-superseded, zero-mismatch report per T19), `retest_sample_id` (must be the exact sample linked via T21, not just any valid-looking one), `action_ids` (always refused — T20 doesn't exist, so nothing exists to check them against; only an exemption reason can satisfy this today), `communication_id` (must be a real row recorded on this case), plus `policy_version` matching `POLICY_VERSION` |
| `services/api/app/cases.py` | `_request_closure` and `_close` effects (rows 8 and 11 had real guards since T17/T19 but no effect — commands were refused at the last step with `CASE_POLICY_FORBIDS`; this was a **found-and-fixed gap**, not new scope) |
| `tests/communication_test.py` | 10 tests: recording never moves the case, idempotent on `command_id`, role check, a communication recorded on the wrong case is rejected, and a full real-evidence path (refer → verified report → row 7 retest request → row 10 real retest link → recorded communication → `close` succeeds), plus one negative test per evidence field |

## Acceptance mapping

- **No implied delivery.** The schema has no delivered/sent/read field; `channel` + `template_version` + `audience_description` is what the operator states they did, nothing more.
- **Content/version/actor/time saved.** `channel`, `template_version`, `audience_description`, `actor_id` (from the session, never client-supplied), `occurred_at` (server clock) are all stored; append-only, no update path.
- **Closure policy consumes the actual record.** `g_close` looks the id up in `communications` scoped to `(tenant_id, id, case_id)` — a real row on this case, not a client-typed UUID that happens to look right.

## Found and fixed

`request_closure` (row 8) and `close` (row 11) had real guards since T17 (`g_verified`, `g_lab_within_limit`) and T19, but neither had an entry in `cases.py`'s `EFFECTS` dict, so a command that passed every guard still failed at the last step with `CASE_POLICY_FORBIDS ... not available yet in this build`. Both effects are added here.

## Verification actually run (2026-09-24)

- `python -m unittest tests.communication_test -v`: **10/10**.
- `python -m unittest tests.closure_test tests.case_policy_test tests.case_reads_test tests.lab_test -v`: **59/59** (5 skipped, `TEST_DATABASE_URL`-gated), confirming T21/T19/T18/T17 are undisturbed.
- Full repo suite: **258 passed**, 11 skipped, no regressions.

## Not done / limits

- **`action_ids` can never be real evidence until T20 exists.** `close` accepts either `action_ids` (currently always refused — nothing to verify them against) or `action_exemption_reason`; today only the exemption path can succeed. This is a genuine, temporary gap, not a design choice, and should be revisited the moment T20 lands.
- **DEMO policy v1, not domain-approved.** Every exemption path is explicit and recorded, never silent, but which exemptions should be *authorized* is T46's call, not made here.
- **No PostgreSQL run in this environment** (no `TEST_DATABASE_URL` configured here).
- **No mutation-testing pass recorded.**
- **Needs independent review:** concurrency/closure (AGENTS.md).
