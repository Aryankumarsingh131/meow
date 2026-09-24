# Expansion and capacity (T41), partial

Date 2026-09-25. Everything below was measured locally on synthetic data.
Nothing was run against the hosted staging service or Supabase.

## Measured

| What | Result | Source |
|---|---|---|
| Push throughput, local SQLite stack | 10 req/s: p95 50 ms, 0 failures. 50 req/s: saturates (one writer), up to 201 retryable 503s, no lost or doubled record | docs/benchmarks/server.md (T30) |
| Tenant skew (hot tenant vs two tenants at 50 req/s) | Two tenants: p50 170 ms vs 2,509 ms hot; the per-tenant change lock is the bottleneck under skew | T30 |
| Tenant isolation | All 22 `/v1` routes: cross-tenant ids indistinguishable from missing ones | tests/security/tenant_test.py (T31) |
| Backup size and time vs data | 1,000 samples: 6,003 rows, 2.6 MB, dump 0.19 s, restore+verify 0.77 s. 10,000 samples: 60,003 rows, 26.3 MB, dump 1.85 s, restore+verify 3.67 s. Linear | services/api/app/backup.py (T36), SQLite |

**Restore-size estimate:** about 2.6 KB and 6 rows per sample, excluding photos.
10× the pilot's upper bound (1,000 records) is about 2.6 MB. That is trivial;
the first real limit is the backup tool holding a table in memory, around a
million samples (marked in the code).

## Decision

- **Buy nothing yet.** No measured bottleneck applies to the hosted
  stack: T30's limit is SQLite's single writer, and hosted runs PostgreSQL.
- **The Render free plan's sleep (cold start of about a minute) is the only
  limit a pilot would notice.** Move to an always-on plan before a pilot
  (docs/final-review.md, blocker 10). That is the one cost justified by a
  measurement.
- Re-measure on PostgreSQL before any scale beyond a pilot: rerun
  `tests/load/scenarios.js` against an isolated Postgres (infra/compose.yaml,
  or the CI service), never against staging.

## Open

- PostgreSQL throughput and per-tenant lock contention: not measured (no
  isolated Postgres on the build machine; Docker is unavailable).
- "Bounded device assignment": no per-worker device limit exists; any device
  a member signs in on is accepted. Needs a product decision on the bound.
- `tests/load/expansion.js` (10× data with tenant skew) was not written. T30's
  hot-tenant step already covers skew at the request level; data volume is
  covered by the backup measurement above.
- T38's pilot data (the real workload shape) does not exist yet.
