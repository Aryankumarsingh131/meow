# Handoff — T13 idempotent sample ingestion

- Task: T13 / REQ-008 / AC-008
- Branch: `feature/t13-idempotent-ingestion`
- Status: complete engineering slice, reviewed 24 September 2026 IST
- Inputs/outputs: validated `PushRequest` events → per-event accepted, duplicate, rejected or conflict receipts

## Evidence

- Each event commits independently; a rejected event does not roll back accepted siblings.
- `(tenant_id,event_id)` is the atomic idempotency key. Exact canonical-payload replay returns the prior effect; changed payload returns `IDEMPOTENCY_MISMATCH` without overwrite.
- Concurrent PostgreSQL replay produced exactly one sample/observation/receipt and outcomes `accepted` + `duplicate`.
- Samples are append-only. `sample.correct` inserts a new row with `supersedes_id`; an out-of-order correction is retryable and is not prematurely claimed.
- Tenant and role come only from the authenticated `Session`; cross-tenant source lookup is indistinguishable from missing.
- Server policy overwrites client `data_mode`. Machine/manual/selected bins and the bounded manual `override_reason` remain separate.
- The real authenticated `/v1/sync/push` route, startup migration and source-history route share the same schema.

## Verification

- SQLite + PostgreSQL 17 Alpine: `python -m unittest tests.sync_push_test -v` — 10/10 passed, including two-connection race.
- Authenticated HTTP/source integration: 15/15 passed.
- Contract suite: 12/12 passed; generated OpenAPI/client refreshed from `schemas.py`; root TypeScript clean.
- Combined post-pull regression before T13: 168 Python passed, 14 skipped, 50 subtests; 166 Node checks; root/mobile TypeScript clean.
- PostgreSQL driver: official Psycopg 3.3.6 binary pin, compatible with Python 3.11 and PostgreSQL 17.

Limits: the isolated PostgreSQL container uses no real tenant data. Receipt retention/compaction and ordered pull are T14; queue draining is T15. The checked-in blueprint checkbox remains untouched because that directory is reference material.
