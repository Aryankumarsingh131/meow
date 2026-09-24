# Handoff — T14 commit-ordered pull and conflicts

- Task: T14 / REQ-008 / AC-008 ("pull misses no committed changes")
- Owner: agent acting as role C (project-owner authorised all M1 roles). Branch `merge-into-meow`, base `8a2c3ef`.
- Status: **`[~]` built and verified; independent sync-ordering review outstanding** (AGENTS.md mandates it for sync ordering — not self-certifiable).
- Data: synthetic fixtures only. PostgreSQL runs used isolated throwaway schemas (`jalsakshi_test_t13`, `jalsakshi_test_t14`) on the project's Supabase PostgreSQL 17.6, created and dropped by the tests.

## What was built

| File | Purpose |
|---|---|
| `services/api/migrations/changefeed.py` | `sync_heads(tenant_id, next_seq, floor_seq)`, `changefeed(tenant_id, seq, entity_type, entity_id, operation, version, committed_at)`, PK `(tenant_id, seq)` |
| `services/api/app/changefeed.py` | `record_change` allocates under the tenant row lock (`UPDATE … RETURNING`) inside the mutation transaction; `head`; `compact` raises the floor |
| `services/api/app/sync_pull.py` | `pull` (ordered, bounded, deterministic) and `bootstrap` (source pages under one snapshot seq) |
| `services/api/app/routes_v1.py` | `GET /v1/sync/pull`, `GET /v1/bootstrap` through T06 `authenticate()` |
| `services/api/app/errors.py` | `RESET_REQUIRED` → 410 (additive; `ProblemDetail.code` is a free string, frozen contract byte-identical) |
| `services/api/app/sync_push.py` | T13 push now takes the tenant lock first and records one `sample/upsert` per accepted event |
| `tests/sync_order_test.py` | 12 tests: SQLite (6), PostgreSQL (3), HTTP (2 + problem-body checks) |

## Acceptance mapping

- **Late commits not skipped.** Sequence allocation holds the tenant's `sync_heads` row lock until commit, so sequence order equals commit order within a tenant. PostgreSQL test: writer 1 allocates seq 1 and holds it uncommitted. Writer 2 is shown to **block** for 1.5 s, a concurrent reader sees **nothing**, and after writer 1 commits the pull returns `[(1, slow), (2, fast)]`. **Mutant:** replacing the lock with a bare global `nextval()` makes this test fail, because writer 2 no longer waits.
- **Cursor/filter bound.** The cursor is opaque and versioned `{v, k, t, s}`, bound to the tenant and to its kind. Another tenant's cursor, non-base64 input, a list, a boolean/negative/string seq, a wrong version or a bootstrap cursor used for pull all return 422 (`InvalidCursor`). Limit is clamped to 1–100.
- **Reset.** A cursor below the compaction floor, or ahead of the committed head (a server restored from an older backup), returns **410 `RESET_REQUIRED`** as `application/problem+json`. A cursor exactly at the floor is still served. `compact` beyond the head is refused and deletes nothing.
- **Reset-cursor recovery.** bootstrap → `snapshot_cursor` → pull delivers the change committed after the reset.
- **Partial-page rollback.** A reference device apply (page + cursor in one SQLite transaction) fails mid-page, leaving 0 rows and an unmoved cursor. Re-pulling the same cursor returns an **identical** page, which then applies fully. The production client apply is T15's.
- **Bootstrap snapshot.** The head is captured before page 1. A sample committed between pages arrives via pull from `snapshot_cursor`. A bootstrap cursor from another tenant returns 422.
- **Only effects enter the feed.** Duplicate, conflict, rejected and retryable-rejected events roll back their allocation. Concurrent duplicate replay on PostgreSQL produces exactly one feed row.
- **"Same accepted record".** Each change carries the server's `payload_hash` (= `canonical_event_hash`), so a device can prove the accepted record is the one it saved.
- **Version conflict structured.** Changes carry `version`, and push conflicts remain T13's typed `conflict` receipts (`IDEMPOTENCY_MISMATCH`, `SAMPLE_ID_CONFLICT`). **Not applicable in M1:** the contract's `409 + current_version` belongs to versioned mutable commands (case commands T17, admin source PATCH). M1 has no such mutation because samples are append-only, so nothing here claims it.

## Found and fixed along the way

- **T07 defect (real):** `/v1/sources` cursors escaped non-ASCII as `\uXXXX`. A legal 120-character Devanagari label produced a 1,340-character cursor, past the route's 512 cap, so every page after it was unreachable. Fixed by encoding the cursor as UTF-8 (worst case 700 characters, including 4-byte characters) and raising the caps to `MAX_CURSOR_LENGTH = 1024` (bootstrap 2048). Old cursors still decode. HTTP regression test with a worst-case mixed Devanagari + 4-byte label.
- **My own `compact` draft** deleted rows up to the argument even when the floor move was refused, which would have created a silent hole. Fixed to delete up to the stored floor before any test ran; a mutant confirms the test catches the original version.

## Verification actually run (2026-09-24)

- `TEST_DATABASE_URL=<.env JALSAKSHI_DATABASE_URL> python -m unittest tests.sync_order_test -v` — 12/12 OK.
- `python -m unittest tests.sync_push_test` (T13, now with the lock) — 10/10 OK, including the PostgreSQL race.
- Mutation run: 11/11 source mutants caught against a passing baseline, plus the global-sequence mutant caught. The first mutation run was **discarded as invalid**: a docstring escape made the module unimportable, so every mutant "failed" for the wrong reason.
- `python -m pytest -q` (repo root, PostgreSQL enabled) — 204 passed, 0 skipped, 66 subtests.
- All 11 Node suites pass. `contracts/openapi.json` regenerates byte-identical.

## Limits and next

- Bootstrap covers **sources only**. Protocol/model are files, not DB rows, in M1. Historic samples are served by `/sources/{id}/history`, not by bootstrap.
- `entity_type` is limited to `'sample'` by CHECK. Widen it with a migration when sources/cases start emitting changes (admin PATCH, T17).
- Pull and push response shapes are **not** in the frozen `contracts/openapi.json` (T05 froze only request shapes). T15 consumes them. Adding response models to the contract is a recorded follow-up, not done silently.
- Scope changes and revocation in the feed are T45.
- **Needs independent review:** sync ordering (AGENTS.md).
