# Backup and restore (T36)

Two layers. Neither is complete on its own; see "Gaps" at the end.

## 1. Logical backup (ours, tested)

`services/api/app/backup.py` copies every table the migrations create into
JSON lines, plus a `manifest.json` with each table's row count and checksum.
No `pg_dump` is needed. Reads the source in one read-only snapshot, so no row is
changed.

```sh
# Credentials come from the environment, never the command line history of a shared box.
set -a; . ./.env; set +a

# Backup (read-only on the source)
python -m services.api.app.backup dump "$JALSAKSHI_DATABASE_URL" backups/2026-09-25

# Restore into a FRESH, EMPTY database: a new Supabase project, a local
# Postgres (infra/compose.yaml), or a SQLite file for an offline check.
# It refuses a database that already has rows.
python -m services.api.app.backup restore backups/2026-09-25 postgresql://...new... \
    --evidence <restored evidence dir> --ledger <external deletions.jsonl>
#   -> checks every table's count and checksum against the manifest,
#      then re-applies the T47 deletion ledger.

# Re-check later, plus an authorization smoke through the real API routes
# (a restored member sees their tenant's sources; a stranger gets 403):
python -m services.api.app.backup verify backups/2026-09-25 postgresql://...new... --smoke
```

The order inside `restore` matters: checksums first, deletion ledger second.
Re-applying deletions changes `evidence_assets`, which is the point: evidence
deleted after the backup was taken must not come back.

Store the dump directory **outside** the database's provider (it contains
personal data once real data exists: encrypt it at rest and restrict access).

## 2. Supabase platform backups (theirs, not verified here)

Supabase takes its own backups depending on the plan (Dashboard, Database,
Backups). Whether this project's plan includes them, and their retention, was
**not verified** from here. Check before relying on them. Restoring a platform
backup replaces the whole project, so still run `verify --smoke` afterwards.

## Cut-over after a restore into a new database

1. Restore and verify as above.
2. On Render, set `JALSAKSHI_DATABASE_URL` to the new database; redeploy.
3. `python tests/e2e/staging_smoke.py` (T35), 7/7 expected.
4. Phones keep their outbox. Records they pushed after the backup was taken
   are pushed again: pushes are idempotent (event id), so replays are safe.
   A phone whose pull cursor is ahead of the restored changefeed gets
   `410 RESET_REQUIRED` and re-bootstraps (T14).

## Gaps (open)

- **Evidence photos are not backed up.** They live on the API container's
  disk (`.data/evidence`), which Render discards on every deploy and restart.
  Evidence upload is enabled only on the synthetic dev stack today, so nothing
  is lost yet; before it is enabled in a hosted environment it needs object
  storage (for example Supabase Storage) with its own backup.
- **The deletion ledger file** has the same problem: it must live outside the
  database and outside the container, or a restore cannot re-apply it.
- **No schedule.** Nothing runs the dump automatically. RPO is "since the last
  time someone ran it" until a scheduled job (for example a GitHub Actions cron with
  the database URL as a secret, writing to encrypted storage) exists.
