# Closure policy — approval record (T46)

Status: **PENDING DOMAIN SIGN-OFF — NOT APPROVED.**

This is a **draft** written by the implementing agent. The code enforces what
this draft says (`services/api/app/case_policy.py`, `POLICY_VERSION = 1`), and
`tests/closure_policy_test.py` pins that behaviour down. Nobody with domain
authority has reviewed it. Until the sign-off block at the bottom is completed
by a named reviewer, every case closed under this policy was closed under an
**unapproved demo policy**, and every closure event records `policy_version: 1`
so it can be found and re-reviewed later.

All data in this system is synthetic (ADR-M1-001). Nothing here has been
applied to a real water source.

## What `close` requires (case-state-machine.md row 11)

A case in `closure_review` closes only when **every** item below is satisfied.
The server checks all of them together and returns every failing item at once
in `field_errors`, so the operator sees the whole checklist rather than one
item at a time.

| # | Evidence | Satisfied by real evidence | Or by an exemption |
|---|---|---|---|
| 1 | Laboratory result | `verified_report_id`: a report on this case that is `verified`, not superseded by a correction, and has no mismatch (T19) | `verified_report_exemption_reason` |
| 2 | Retest | `retest_sample_id`: exactly the sample linked through `retest_due → link_retest`, which was itself checked to be a real sample on the same source captured after the trigger (T21) | `retest_exemption_reason` |
| 3 | Corrective action | `action_ids` — **cannot currently be satisfied**: corrective actions (T20) do not exist, so there is nothing to check an id against. Any `action_ids` value is refused | `action_exemption_reason` |
| 4 | Resident communication | `communication_id`: a communication actually recorded on this case (T22). **No exemption exists** | — |
| 5 | Policy | `policy_version` equals the version in force (`1`) | — |

## Draft rules

**E1 — Exemptions must be explicit.** An exemption reason must be at least 20
characters of non-whitespace text (the same floor as a disposition). `"x"`,
`"n/a"` or spaces are refused. The accepted reason is stored permanently on
the closure event.

**E2 — No blanket safe label.** Closing a case records a disposition and a
policy version. It never records a safety or potability verdict for the
source, and the `cases` table has no column that could hold one. A closed case
means "this case's workflow is finished", not "this water is safe".

**E3 — A disputed report triggers review.** If a lab report on a case is
corrected (a superseding report is recorded) after the case reached
`closure_review` or `closed`, the case is flagged `requires_rereview`. It is
neither silently left as it was nor silently reopened. A superseded report no
longer counts as evidence for item 1.

## Questions the reviewer must answer before this can be approved

1. **Who may use each exemption?** Today any `supervisor` or `admin` may. Should
   a lab-result exemption (item 1) require `admin`, or a second person?
2. **Is a lab-result exemption ever acceptable?** Closing with no verified lab
   result at all may need to be forbidden outright rather than exempted.
3. **Is "retest not required" a legitimate outcome** when the verified lab
   result is `within_limit`, or must every closure have a retest?
4. **Item 3 after T20 lands.** When corrective actions exist, should an action
   exemption still be allowed when the lab result was `exceeds_limit`?
5. **Communication content.** Item 4 checks that a communication was recorded,
   not what it said. The wording is T44's review; should closure also require
   that the template version used was an approved one?
6. **Re-review handling.** E3 flags the case. Who clears the flag, and must the
   case be reopened, or may it be re-closed against the corrected report?

## Sign-off

| Field | Value |
|---|---|
| Reviewer name | _(blank — not reviewed)_ |
| Role / authority | _(blank)_ |
| Date | _(blank)_ |
| Decision | _(blank — approve / approve with changes / reject)_ |
| Changes required | _(blank)_ |

When this is signed, update `POLICY_VERSION` if any rule changes, update this
file's Status line, and update `tests/closure_policy_test.py`'s
`PolicyIsDraftTests` in the same change (that test fails on purpose if the
Status line stops saying PENDING without the test being updated).
