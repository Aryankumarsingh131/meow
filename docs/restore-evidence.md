# Restore rehearsal evidence (T36)

Date 2026-09-25, UTC. Procedure: infra/backup.md.

## Rehearsal 1: staging (Supabase) to an isolated database

Source: the staging database behind https://jalsakshi-api.onrender.com
(synthetic data). Target: a new, empty SQLite file on the build machine,
fully isolated from staging. The dump is read-only; staging was not changed.

| Step | Result | Time |
|---|---|---|
| `dump` from Supabase (one read-only snapshot) | 13 rows, 15 tables, 29 KB | 8.50 s (incl. TLS connect) |
| `restore` into the empty target | All 15 tables match the manifest (row counts and checksums) | 0.44 s |
| Deletion ledger re-applied | 0 assets (staging has no evidence and no deletions yet) | n/a |
| `verify --smoke` | Tables reconcile; a restored member signs in and sees their tenant's 4 active sources; a user with no membership gets 403 | 1.35 s |

Rows per table: sources 8, memberships 2, samples 1, observations 1,
idempotency_receipts 1, all others 0.

**RTO (measured part):** backup plus restore plus verification took about 10 s at this
size. Pointing Render at a new database and redeploying adds a few minutes
(not timed here). **RPO:** no scheduled backup exists, so the RPO is the time
since the last manual dump (infra/backup.md, Gaps).

## Rehearsal 2: automated (every CI run)

`tests/backup_test.py`:

| Test | Checks |
|---|---|
| a restored copy reconciles row for row | dump, restore, checksums, authorization smoke |
| a restore refuses a database that already has data | no accidental overwrite |
| a changed row is caught | tampering with one case is detected in exactly that table |
| evidence deleted after the backup stays deleted after the restore | T47 ledger re-applied: the purged photo is deleted again (row and file); the held photo is untouched |
| PostgreSQL round trip (CI only, throwaway database) | SQLite to PostgreSQL restore, then a second dump out of PostgreSQL matches the first in every table's count and checksum, and the smoke passes |

## Observations

- **Staging has one sample with no changefeed entry** (and `sync_heads` is
  empty). The only insert path today (`sync_push`) writes the changefeed
  first, so this row was probably written by an earlier deploy. Pull clients
  will never receive it. It was left as is (synthetic data); worth deleting
  or re-pushing before the next demo. Not a restore defect: the restore
  reproduced it faithfully.
- The acceptance item "assets reconcile" is **not met**: there is no
  backed-up asset store (infra/backup.md, Gaps). It stays open until
  evidence moves to object storage.

## Verdict

Database restore rehearsed and verified, on staging and in CI. **T36 stays
partial** until: evidence object storage plus its backup, a scheduled dump,
and a timed full cut-over (restore into a new Supabase project and redeploy).
