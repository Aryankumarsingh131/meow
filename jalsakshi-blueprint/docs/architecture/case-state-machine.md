# Case state machine — v1

Authoritative transition table for `cases`. Resolves the Phase 1 gap where states and commands were listed in separate documents with no legal mapping. Implemented by `services/api/app/case_policy.py` (T17/T21), attacked by T31, domain-approved by T46. Owner: C.

## States

| State | Meaning | Terminal |
|---|---|---|
| `review_needed` | A flagged, invalid or uncertain sample needs a human decision | no |
| `awaiting_lab` | Referred for laboratory confirmation; waiting on a report | no |
| `action_required` | Verified evidence indicates corrective work is needed | no |
| `retest_due` | Corrective action accepted; a linked retest of the same source is required | no |
| `closure_review` | All prerequisites claimed present; awaiting an authorized closure decision | no |
| `closed` | Evidence-complete decision recorded | reopenable |

`closed` is not terminal: a new flagged result on the same source reopens it, preserving the prior closure event.

## Transition table

Every row is a legal transition. Anything not listed is rejected with `CASE_TRANSITION_ILLEGAL` (409). All commands carry `command_id` and `expected_version`.

| # | From | Command | Role | To | Guards |
|---|---|---|---|---|---|
| 1 | *(system)* | — | — | `review_needed` | Created by accepted sample whose `indicative_flag` ∈ {review, uncertain, invalid}. Unique per `trigger_sample_id` |
| 2 | any open | `assign` | supervisor, admin | *(unchanged)* | Owner must be an active member. Sets `owner_id`, `due_at`. Does not change state |
| 3 | `review_needed` | `refer_to_lab` | supervisor, admin | `awaiting_lab` | Owner must be set first (G-OWNER) |
| 4 | `review_needed` | `record_action` | supervisor, admin | `action_required` | Direct-action path: protocol must permit skipping lab referral (G-POLICY) |
| 5 | `review_needed` | `dismiss` | supervisor, admin | `closed` | Requires `disposition` text ≥ 20 chars and `dismiss_reason` ∈ {invalid_capture, duplicate, not_a_water_source, resolved_before_referral}. Records a closure event with `evidence_exempt = true` |
| 6 | `awaiting_lab` | `record_action` | supervisor, admin | `action_required` | Requires a **verified** report (G-VERIFIED) whose result triggers the protocol's action rule |
| 7 | `awaiting_lab` | `link_retest` | supervisor, admin | `retest_due` | Reviewer requests follow-up without remediation. Requires verified report |
| 8 | `awaiting_lab` | `request_closure` | supervisor, admin | `closure_review` | Non-adverse verified report path. Requires signed `disposition` explaining why action and retest are not required (G-DISPOSITION) |
| 9 | `action_required` | `accept_action` | supervisor, admin | `retest_due` | ≥1 action with `completed_at` set and ≥1 evidence ID (G-ACTION) |
| 10 | `retest_due` | `link_retest` | supervisor, admin | `closure_review` | Linked sample must be a distinct, later, accepted sample of the **same source** under an appropriate protocol (G-RETEST) |
| 11 | `closure_review` | `close` | supervisor, admin | `closed` | Full prerequisite set recomputed server-side (G-CLOSE) |
| 12 | `closure_review` | `record_action` | supervisor, admin | `action_required` | Concerning retest or unresolved evidence sends the case back |
| 13 | any open | `record_communication` | supervisor, admin | *(unchanged)* | Appends a communication record. Never changes state |
| 14 | `closed` | `reopen` | supervisor, admin | `review_needed` | Triggered by a new flagged linked sample, or manually with `reopen_reason`. Prior closure event is preserved, never deleted |
| 15 | any | *(lab verify)* | lab_reviewer, admin | *(unchanged)* | See below — verification does not itself move the case |

## Verification does not move the case

`POST /v1/lab-reports/{id}/verify` is owned by the lab-reports module and **never mutates `cases.status`**. It writes a `lab_report.verified` case event and bumps `cases.version` so that concurrent case commands correctly conflict. A supervisor must then issue an explicit command (rows 6, 7 or 8).

This is deliberate: the Phase 1 review found case state being mutated from two endpoint families with no documented ownership. One writer for `cases.status` — the case command handler — is the invariant.

A **superseding** report (a correction) on a case already in `closure_review` or `closed` sets `requires_rereview = true` and emits an event. It does not silently reopen, because automatic state change on a third party's upload is exactly the kind of unreviewed transition ADR-003 forbids.

## Guards

| ID | Guard | Failure code |
|---|---|---|
| G-OWNER | `owner_id` and `due_at` are set | `CASE_OWNER_REQUIRED` |
| G-POLICY | `protocols.quality_policy.allow_direct_action` is true for this protocol version | `CASE_POLICY_FORBIDS` |
| G-VERIFIED | A `lab_reports` row for this case has `verification_state = verified`, is not superseded, and its `parameter`/`unit`/`sample_id` match the case's protocol | `LAB_REPORT_NOT_VERIFIED` |
| G-VERIFY-SEP | `lab_reports.verified_by != lab_reports.uploaded_by` | `VERIFICATION_SELF_REVIEW` |
| G-DISPOSITION | `disposition` present, ≥ 20 chars, actor recorded | `DISPOSITION_REQUIRED` |
| G-ACTION | ≥1 action row with `completed_at IS NOT NULL` and non-empty `evidence_ids` | `ACTION_EVIDENCE_MISSING` |
| G-RETEST | Retest sample: distinct ID, same `source_id`, `captured_at_device` later than trigger sample, status accepted | `RETEST_INVALID` |
| G-CLOSE | All of: verified report **or** authorized exemption; accepted action **or** exemption; linked retest **or** exemption; ≥1 communication record; `disposition`; `policy_version` | `CLOSURE_EVIDENCE_INCOMPLETE` with a per-item checklist in `field_errors` |

Every exemption is an explicit, logged, role-checked field — never a default. `G-CLOSE` returns the full checklist so S09 can render exactly what is missing, rather than a generic failure.

## Concurrency

1. Dedupe on `command_id` first — a replayed accepted command returns the prior receipt, not a conflict.
2. Then `expected_version` check — mismatch returns `CASE_VERSION_CONFLICT` (409) with `current_version` and a safe summary.
3. Then role check, then guards, then transition.
4. Authorization, version check, evidence validation, transition, audit row and changefeed insert all run in **one** transaction (data model invariant).

Command dedupe precedes the version check so that a lost-response retry of an already-applied command succeeds idempotently instead of confusing the user with a conflict for their own completed work.

## Closure policy is configurable, not hardcoded

Default demo policy requires verified report + accepted action + linked retest + communication. `protocols.quality_policy` carries the per-deployment prerequisite flags. T46 obtains domain approval for any deployment that relaxes them. A relaxed policy is recorded in `cases.policy_version` at closure time, so a case closed under a weaker policy stays auditable forever.
