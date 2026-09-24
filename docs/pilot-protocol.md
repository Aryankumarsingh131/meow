# Shadow pilot protocol (T38), draft, BLOCKED

Status: **not started.** It cannot start until its prerequisites exist. This
is the plan a domain lead approves or changes; nothing here has been run.

## Prerequisites (all open)

| Needed | Why | Where tracked |
|---|---|---|
| An operator agreement with a named organisation | Consent and data ownership | T02 |
| A real kit, protocol and read window | Today everything is synthetic | T01 |
| Signed closure policy and resident wording | Cases must not close on unreviewed rules | T46, T44 |
| Production blockers cleared (RLS, phone encryption, secrets rotated) | Real personal data | docs/final-review.md |
| Local-language UI | Field workers | T28 |
| Physical-phone evidence | Emulator only so far | T29, T34 |

## Design

- **Shadow:** workers use their existing process as the record of decision.
  JalSakshi runs alongside it, and no action is taken on JalSakshi's output alone.
- 50–100 test records over the agreed weeks, at sources the operator already tests.
- Model suggestions stay "research": the worker's reading is what counts.
  The kill switch (infra/rollback.md) is ready to use from day one.

## Measures (operational, kept separate from scientific)

| Operational | Scientific (only with a reference method) |
|---|---|
| Denominator: sources due vs tested | Agreement of worker reading with lab result |
| Time from flag to lab referral | Model suggestion vs lab result, with abstentions counted |
| Record completeness (fields, photo, timing) | |
| Records needing correction or rejected on sync | |

Every table reports missing data and known confounders: season, worker
experience, kit lot, and whether the old process was followed in parallel.

## Not claimed

No causal effect ("JalSakshi reduced contamination"), no revenue or
willingness-to-pay figure, and no accuracy claim beyond the kit and lot tested.
Buyer conversations go in `docs/buyer-notes.md` as quotes and dates, not
projections.

## Outputs

`docs/pilot-results.md` and `docs/buyer-notes.md`. Neither exists yet; there
is nothing to put in them before a pilot.
