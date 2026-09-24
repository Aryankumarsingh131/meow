# Handoff: T29–T37, T47, T48, T38–T42 (2026-09-25)

One combined handoff for this batch. Each task's evidence document holds the
detail; this file records what changed, how it was verified and what is still open.
Self-reviewed only: AGENTS.md's independent review is owed for every item.

| Task | Mark | Changed / evidence | Verified by | Outstanding |
|---|---|---|---|---|
| T29 | `[!]` | tests/performance/device-runbook.md, ml/reports/device-performance.md | Emulator, n=20: cold start p50 3.3 s (over budget), PSS 86.9 MB, model 0.6 ms | physical phone |
| T30 | `[~]` | tests/load/scenarios.js, docs/benchmarks/server.md; fixed SQLite thread 500s and lock 500s (now retryable 503) | 6,015 rows reconciled exactly | Postgres load |
| T31 | `[!]` | tests/security/tenant_test.py (22 routes), state_test.py, docs/security-review.md | tests pass | **F1 high: RLS off, API is table owner; needs owner approval** |
| T32 | `[!]` | storage.ts: camera originals discarded and swept; docs/privacy-checks.md | tests/local-save.test.ts | encryption decision |
| T33 | `[~]` | telemetry.py (request ids, one log line, no secrets), diagnostics.ts, docs/alert-runbook.md | telemetry_test.py, diagnostics.test.ts | alerts not wired to paging |
| T34 | `[~]` | tests/e2e/field-case.spec.ts (8 steps), docs/release-test-matrix.md, docs/demo-evidence.md | journey passes on local dev API | physical-phone journeys |
| T35 | `[~]` | ci.yml (3 jobs, green), migration advisory lock, infra/compose.yaml, tests/e2e/staging_smoke.py | CI green at 23a81ae; smoke 7/7 on Render | compose not run (no Docker) |
| T36 | `[~]` | services/api/app/backup.py, tests/backup_test.py, infra/backup.md, docs/restore-evidence.md | staging to isolated DB: 15/15 tables reconcile, authorization smoke passes | photo store backup, schedule, timed cut-over |
| T37 | `[~]` | tests/e2e/rollback_rehearsal.py, `/models/disabled` + modelSwitch.ts, infra/rollback.md, docs/compatibility-evidence.md | 8/8 to 67dbf71; 7/8 to pre-T14 sets the rollback floor | Render rollback not performed; switch needs next APK |
| T47 | `[~]` | retention.py, deletion_ledger migration, docs/deletion-evidence.md | retention_test.py 4/4; also inside backup_test.py | policy A10 provisional |
| T48 | `[!]` | docs/final-review.md; a11y fixes in login.tsx, publicApp.tsx | static scan | not cleared: 10 blockers |
| T38 | `[!]` | docs/pilot-protocol.md (draft) | none possible | operator, kit, sign-offs |
| T39 | `[!]` | docs/production-evidence.md (not released) | none | T38 + T48 blockers |
| T40 | `[!]` | docs/second-kit-validation.md | none | second kit |
| T41 | `[~]` | docs/scale-decision.md; backup scale measured (10k samples: 26 MB, 5.5 s round trip) | local measurement | Postgres load; device bound |
| T42 | `[!]` | docs/release-evidence-index.md | none | fresh reviewer |

## Commands

```sh
python -m unittest discover -s tests -p "*_test.py"      # 330 tests, 12 skipped locally
for f in tests/*.test.ts; do node "$f"; done              # 19 suites
npx tsc --noEmit && (cd apps/mobile && npx tsc --noEmit)
python tests/e2e/rollback_rehearsal.py                     # 8/8
python -m services.api.app.backup dump|restore|verify ...  # infra/backup.md
JALSAKSHI_SMOKE_EMAIL=... JALSAKSHI_SMOKE_PASSWORD=... python tests/e2e/staging_smoke.py
```

## Found along the way

- Staging holds one sample with no changefeed entry, probably from a pre-T14
  deploy; phones never receive it (docs/restore-evidence.md).
- Evidence photos live on the container disk, which Render wipes on each deploy (infra/backup.md).
- `CREATE TABLE IF NOT EXISTS` never adds columns to an existing table; future
  schema changes need explicit additive `ALTER` statements (infra/rollback.md).
