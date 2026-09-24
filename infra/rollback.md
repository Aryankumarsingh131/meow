# Rollback (T37)

## Rules

1. **Migrations only add.** Every statement is `CREATE ... IF NOT EXISTS`;
   there are no down-migrations and nothing drops or rewrites data. A rollback
   therefore changes code only; the database stays as the newer release left
   it. Keep it that way: a change to an existing table must be an additive
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` with a default, never a rename,
   drop or new `NOT NULL` column without a default. (Note: `CREATE TABLE IF NOT
   EXISTS` never alters a table that already exists, so a column added only
   inside the `CREATE` is silently missing on existing databases.)
2. **Rollback floor: `1052e76` (T14).** Releases older than that write samples
   without a changefeed entry; phones then never receive those samples
   (rehearsed: docs/compatibility-evidence.md). Never roll back below a release
   that introduced something newer writes depend on; record each new floor here.
3. **Phones need no action.** Pushes are idempotent by event id, so a phone
   replays its outbox against whichever release is live; duplicates are
   answered `duplicate`, never stored twice.

## Procedure (Render)

1. Render dashboard, jalsakshi-api, Events/Deploys: pick the last good deploy,
   **Rollback**. Check it is not below the floor above.
2. `python tests/e2e/staging_smoke.py` (T35), 7/7 expected.
3. Look at the error-rate alert (docs/alert-runbook.md) for 15 minutes.
4. Fix forward on `main`; the next deploy supersedes the rollback.

## Switching off an unsafe on-device model (no app release needed)

1. Take the model file's SHA-256 from `apps/mobile/assets/model-manifest.json`.
2. On Render, set `JALSAKSHI_DISABLED_MODELS=<sha256>[,<sha256>...]`; save
   (Render redeploys).
3. Check: `curl https://jalsakshi-api.onrender.com/models/disabled`.
4. Each phone applies it on its next online source-list refresh and keeps it
   while offline; the review screen then shows "switched off" and the worker
   reads the chart by eye. Removing the hash re-enables the model the same way.

Limit: app builds from before this switch (v2.2 and older) do not check it.
In those, the model only ever *suggests* a bin and the worker confirms it;
replacing the APK is the only way to remove the model from them.
