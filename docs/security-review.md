# Security review — tenant and state regression (T31)

Status: **agent-run; the independent reviewer's pass is still owed** (the task
card requires a reviewer to execute the matrix and record defects themselves).
Date 2026-09-25, commit after `26f9cae`.

## What was checked

| Area | How | Result |
|---|---|---|
| Tenant isolation, every `/v1` route | `tests/security/tenant_test.py`: tenant A creates a sample, case, lab report, evidence photo and export job; tenant B attacks each with a user of the same role. The test also fails if a `/v1` route is added without a matrix row | **Pass**, all 22 routes |
| Existence oracle | Cross-tenant ids return the same status and body as random ids | **Pass** |
| Signed evidence URLs | Forged upload/read tokens refused | **Pass** |
| Role separation | Workers get 403 on the board, lab reports, metrics and export | **Pass** |
| Case state machine | `tests/security/state_test.py`: 40 random walks mixing real evidence and junk commands; after every step: a refusal changes nothing, status follows the transition table, version +1 on success, closure only with a recorded communication | **Pass** |
| Exports and assets included | Both covered by the matrix above | **Pass** |
| Database role and RLS (live Supabase, read-only queries) | `current_user`, table owners, `relrowsecurity`, Data API grants | **FAIL** (below) |

## Findings

### F1 — HIGH for release: the API runs as the table owner, and RLS is off

The API connects as `postgres`, which owns all 14 `jalsakshi` tables and has
`BYPASSRLS`. Row-level security is disabled on every table. The card's
acceptance line "RLS app role not owner" is **not met**.

- **Today's exposure:** limited. The Supabase Data API roles (`anon`,
  `authenticated`) have no `USAGE` on the `jalsakshi` schema, so only the API
  can reach the tables, and the API's own tenant checks pass the full matrix.
- **What is missing:** defence in depth. One tenant-filter bug in a future
  query would expose another tenant's rows, and the database would not stop it.

**Remediation (not applied: it changes live database roles, needs owner approval):**

1. Create a login role `jalsakshi_app` without `BYPASSRLS`, not the owner;
   grant it `USAGE` on the schema and only the table privileges the API uses.
2. Enable RLS on every tenant table with a policy
   `tenant_id = current_setting('app.tenant_id')::uuid`.
3. In the API, run `SET LOCAL app.tenant_id = <session tenant>` at the start of
   every request transaction (`db` dependency).
4. Point `JALSAKSHI_DATABASE_URL` at `jalsakshi_app`; keep `postgres` for
   migrations only.
5. Re-run this matrix plus a test that a query *without* the tenant filter
   still returns only the session tenant's rows.

### F2 — MEDIUM, accepted by design: signed evidence read URLs are bearer links

A read URL from `GET /v1/evidence/{id}/access` works for anyone who holds it
until it expires (5 minutes). This is the standard signed-URL model and is
bounded by the short expiry, but a URL pasted into a chat works for its
lifetime. Keep the TTL short; never log these URLs.

### F3 — LOW: the demo passwords are in a chat transcript

The two demo accounts were shared in chat on request. Acceptable for synthetic
demo data only; rotate before any real data is stored (docs/deploy-render.md).

## Not covered here

- PostgreSQL-specific behaviour of the matrix (it runs on SQLite; the queries
  are dialect-neutral and the T13–T19 PostgreSQL suites cover the SQL paths).
- Rate limiting and brute force on Supabase sign-in (Supabase's own limits
  apply; not tested).
- Independent reviewer execution.
