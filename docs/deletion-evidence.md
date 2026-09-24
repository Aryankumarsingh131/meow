# Retention and deletion recovery (T47)

Status: **built and tested; policy is provisional.** The 30-day photo period
is assumption A10, awaiting an operator/privacy reviewer's approval.

## Policy implemented

| Data | Period | Implemented |
|---|---|---|
| Evidence photos and report files (server) | 30 days after upload | **Yes**, `services/api/app/retention.py` |
| Sample and case metadata | 12 months | **No.** Redaction must keep "minimal authorized audit facts" (data-model.md); which facts is an operator decision |
| Backups | 30 days | Provider-side (see below) |
| Photos on the phone | Kept until the sample is synced; never auto-deleted | Phones never upload photos (no-upload default), so the phone copy is the only copy |

## Guarantees and their tests (`tests/retention_test.py`)

| Acceptance line | How it is met | Test |
|---|---|---|
| Unsynced/unresolved evidence is not silently deleted | Evidence whose case is not closed is never purged, and is listed as **held** in the purge report | `test_old_evidence_of_a_closed_case_is_purged_but_an_open_case_holds_it` |
| Truthful status | The row stays with `state = deleted` and the reason; access answers "not available", never a broken link | same test |
| Interrupted purge | Two-phase: ledger intent committed first, then bytes removed, then completion. The next run finishes unfinished entries | `test_a_purge_interrupted_after_its_intent_is_finished_by_the_next_run` |
| Restore reapplies deletion | Each completed deletion is appended to a ledger file **outside** the database. After restoring an older backup, `reapply_deletions` deletes those assets again (idempotent) | `test_restoring_an_older_backup_reapplies_the_deletion` |
| Fake clock | Day 29 purges nothing; day 31 purges | `test_nothing_is_purged_inside_the_retention_period` |

## Backup expiry

Deleted evidence can live on inside a backup until that backup expires. On
Supabase, database backups are managed by the plan (daily backups with a plan-
defined retention; point-in-time recovery is a paid add-on). Two rules follow:

1. After **any** restore, run `reapply_deletions` with the external ledger
   before the API serves traffic, or deleted evidence comes back.
2. Keep the ledger file where a database restore cannot roll it back (separate
   storage, itself backed up for at least as long as the longest backup).

Evidence files are not in the database at all: today they live in the API's
local evidence folder, and hosted deployments have uploads switched off, so
there is currently nothing to purge on Render. The procedure applies as soon
as uploads are enabled with object storage.

## Not done

- Metadata redaction after 12 months (needs the operator's audit-fact list).
- A scheduled job. Retention runs by calling `retention.purge(...)`; wiring it
  to a nightly Render cron job belongs with T35/T36.
