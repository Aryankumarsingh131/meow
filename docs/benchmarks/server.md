# Server and reconnect load benchmark (T30)

Status: **partial.** Run on the local single-process SQLite stack. The
PostgreSQL run that matters for Render is still owed (see *Not done*).

## Setup (2026-09-25)

- API: `uvicorn services.api.app.main:app --workers 1`, development + synthetic,
  fresh SQLite file, on the same Windows laptop as the load generator.
- Load: `node tests/load/scenarios.js http://127.0.0.1:8010 60`. Open-loop
  arrival (requests keep coming whether or not earlier ones finished), one
  `POST /v1/sync/push` per request with one new sample; 5% re-send an earlier
  event and must come back `duplicate`.
- Steps: 60 s each at 1, 10 and 50 req/s against one tenant ("hot tenant"), then
  50 req/s split across two tenants.
- Raw samples: `docs/benchmarks/raw-server-*.tsv`; summary `server-summary.json`.

## Results (final run, after the fixes below)

| Step | Requests | Accepted | Replays → duplicate | Failures | p50 | p95 | p99 | max (ms) |
|---|---:|---:|---|---|---:|---:|---:|---:|
| 1 req/s, hot tenant | 60 | 58 | 2 / 2 | 0 | 41 | 53 | 88 | 88 |
| 10 req/s, hot tenant | 600 | 571 | 29 / 29 | 0 | 38 | 50 | 60 | 69 |
| 50 req/s, hot tenant | 3,000 | 2,665 | 133 / 149 | 201 × 503 | 2,509 | 7,823 | 9,042 | 10,803 |
| 50 req/s, two tenants | 3,000 | 2,721 | 145 / 148 | 134 × 503 | 170 | 5,755 | 6,425 | 6,717 |

- **Accepted counts are exact.** 6,015 rows, 6,015 distinct ids, 6,015
  accepted responses. Nothing lost, nothing duplicated, no row from a failed
  request. (Replays that met a 503 are not duplicates because they were never
  processed; the client retries them.)
- **No unbounded growth.** One process; memory 63 → 99 MB over the run.
- **10 req/s meets the budget** (warm metadata p50 150 ms / p95 400 ms).
  **50 req/s does not** on this stack: SQLite admits one writer at a time.

## Found and fixed

1. **Thread-affinity 500s (real bug).** FastAPI opened a request's SQLite
   connection on one threadpool thread and closed it on another. At 50 req/s
   this produced 4,732 errors (2,328 × 500 in the hot step). Fixed in
   `db.py` with `check_same_thread=False`, safe because each connection is used
   by one request, sequentially. PostgreSQL never had this check.
2. **Contention answered 500.** A lock wait is temporary, but the client
   treated it as a hard failure. The API now answers `503
   TEMPORARILY_UNAVAILABLE` (retryable) for SQLite locks and PostgreSQL
   statement/lock timeouts, deadlocks and serialization failures. Every write is
   idempotent, so retrying is safe. Tested in `tests/provider_test.py`.

## Not done

- **PostgreSQL.** Render uses Supabase Postgres; the 50 req/s limit above is a
  SQLite property. Running this against the staging database would add
  thousands of synthetic rows to the demo tenant, so it needs a disposable
  database (a Supabase branch) first.
- **Duration and volume.** The plan asks for 10-minute steady states and
  ≥ 10,000 requests per main condition; these steps were 60 s.
- **Reconnect burst of 30 clients, slow DB, exhausted pool:** not run.
- The load generator shared the laptop with the server; a separate client host
  would remove that interference.
