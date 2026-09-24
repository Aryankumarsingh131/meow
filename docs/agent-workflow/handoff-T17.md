# Handoff — T17 case transition engine

- Task: T17 / REQ-010 / AC-010 (engine part). Role C, carried by the agent under M2 option A (synthetic only).
- Status: **`[~]` built and verified.** Outstanding: independent review of **state closure and reviewer concurrency** (AGENTS.md), and **domain approval of the closure policy** (T46). The demo policy is `POLICY_VERSION = 1` and is **not approved**.

## What was built

| File | Purpose |
|---|---|
| `services/api/migrations/cases.py` | `cases`, unique per `(tenant, trigger_sample_id)`, with owner, due date, version, policy version, `requires_rereview` and disposition; `case_events`, append-only with a unique `(tenant, command_id)`, stored receipt and from/to version. Indexes per data-model.md |
| `services/api/app/case_policy.py` | The transition table as data (rows 2–14); guards G-OWNER, G-POLICY (reads the real protocol JSON, fails closed if the protocol is unknown), the dismiss rules and G-DISPOSITION. G-VERIFIED, G-ACTION, G-RETEST and G-CLOSE **fail closed** until T19–T21 |
| `services/api/app/cases.py` | Row 1 case creation, run *inside the push transaction*. The single writer of `cases.status`, in the order dedupe → version → role → legal → guards → effect, in one transaction. Commands whose records belong to T20/T21/T22 are refused, not half-applied |
| `services/api/app/sync_push.py` | Calls `open_case_for_sample` in the same transaction as the sample |
| `services/api/app/routes_v1.py` | `POST /v1/cases/{id}/commands`; `assign` checks active membership in the tenant through the auth lookup |
| `services/api/app/errors.py` | Guard codes from case-state-machine.md |
| `services/api/app/schemas.py`, `contracts/*` | Three contract changes (below); regenerated deterministically |
| `tests/case_policy_test.py` | 19 tests, including exhaustive 6×10 table and PostgreSQL races |

## Contract changes (recorded here and to be read with handoff-T05)

The frozen v1 contract contradicted the authoritative case-state-machine.md. Resolved additively, since v1 allows additive optional fields:

1. `AssignPayload.due_at`: optional, new. G-OWNER needs owner **and** due date.
2. `DismissPayload.dismiss_reason` (enum) and `disposition`: optional, new; the engine enforces both.
3. `LinkRetestPayload.retest_sample_id`: required → **optional**. Row 7 *requests* a retest (no sample exists yet); row 10 links one. Old clients stay valid. **Flagged for T46 domain review.**

`openapi.json` `f48b5f3c…`, `client.ts` `833841cb…`. Both regenerate byte-identically.

## Acceptance mapping

- **One case per trigger.** `review`/`uncertain`/`invalid` each open exactly one case; `no_flag` opens none; a replay opens nothing. A correction (or a correction of a correction) marks the *existing* case `requires_rereview` and bumps its version, whatever the new flag. A flagged correction of an unflagged sample opens its own case. Sample and case **commit together**: a failed case insert rolls the sample back.
- **Owner/due enforced.** Referral needs both; `assign` needs an active member of *this* tenant (unknown and other-tenant users refused).
- **Stale version rejected.** `CASE_VERSION_CONFLICT` with `current_version` and `current_status`; a refused command changes nothing (asserted for every refused pair in the exhaustive table).
- **Reviewer race (AC-013).** On real PostgreSQL 17.6, two connections decide on the same version at once, repeated 5 times: exactly one wins and one conflicts every time, and the version advances by exactly 1. A refer-vs-dismiss race leaves one coherent state. The same command racing itself applies once, and both callers get the same receipt.
- **Invalid/uncertain capture triage.** Such samples open review cases, which can be dismissed with `invalid_capture` and a ≥20-character disposition, recorded as a closure with the policy version.
- **Dedupe precedes version.** A lost-response replay returns the original receipt even after the case moved on. The same command ID with a different body (or a different case) is `IDEMPOTENCY_MISMATCH`.

## Verification actually run (2026-09-24)

- `TEST_DATABASE_URL=<.env> python -m unittest tests.case_policy_test -v`: **19/19** (schema `jalsakshi_test_t17`, created and dropped).
- Mutation: **18/18** caught against a passing baseline. The critical one: removing `AND version = ?` from the `UPDATE` (last write wins) is caught by the PostgreSQL race test. One survivor on the first pass: the direct-action guard was masked by the not-yet-registered T20 effect returning the same code. I added a guard-level test against the real protocol file and a patched permissive policy, and that mutant is now caught.
- `python -m pytest -q`: 246 passed. All Node suites pass; root `tsc` is clean. The T13/T14/T16 test fixtures gained the `cases` tables, because the schema grew.

## Deviations and limits

- **No changefeed entry for case changes.** The changefeed `entity_type` CHECK allows only `sample`, and field devices don't consume cases in M2 (case decisions are online). data-model.md asks for one; this is a recorded deviation, and widening it needs a migration.
- **No separate `audit_events` table.** `case_events` is the case audit trail. A general audit log is T33.
- **Rows 6–12 fail closed** until T19–T22 supply lab reports, actions, retests and communications.
- **A worker from another tenant gets 404 (not 403).** The case lookup precedes the role check, so no case's existence leaks.
- **Needs independent review:** state closure and concurrency (AGENTS.md). **Needs domain approval:** closure policy (T46).
