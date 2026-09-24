# Release test matrix

Run every row on the exact commit being released. Last full run: 2026-09-25,
commit after `e58ee7b`: **all green** (numbers below). Rows marked *device* or
*external* are not automated and are listed with their current state.

## Automated

| Suite | Command | What it proves | Last result |
|---|---|---|---|
| Python API + security | `python -m unittest discover -s tests -p "*_test.py"` | Auth, tenant isolation (all 22 `/v1` routes), case engine and state invariants, lab, closure, reports, uploads, telemetry, provider | 318 passed, 11 skipped (PostgreSQL-only) |
| ML pipeline | `python -m unittest discover -s ml/tests` | Leakage-safe splits, locked test, ONNX parity | 19 passed |
| Node (app logic, contracts) | `for f in tests/*.test.ts; do node $f; done` | Review, model parity, sync, offline access, storage, sign-in, diagnostics, wording rules, contracts | 18 of 18 suites pass |
| Type checks | `npx tsc --noEmit` (root) and `cd apps/mobile && npx tsc --noEmit -p tsconfig.json` | App and tests compile | clean |
| End-to-end journey | start the dev API, then `node tests/e2e/field-case.spec.ts <base>` | Flag → case → assign/refer → lab verify (separate reviewer) → **invalid closure refused** → retest → communication → closed; offline re-push is a duplicate | 8 of 8 steps |
| Load | `node tests/load/scenarios.js <base> 60` | 1/10/50 req/s, hot and two-tenant; accepted rows reconcile | see docs/benchmarks/server.md |
| PostgreSQL suites | set `TEST_DATABASE_URL`, rerun the Python row | Races and dialect paths on real Postgres | **not run in this environment** |

## Device and external (not automated)

| Check | State |
|---|---|
| Release APK signs in against Render, loads sources | Done on the emulator (v2.2, `docs/evidence/screenshots/v22-render-signed-in.png`) |
| On-device model parity | Done on the emulator, 29/29 (T26) |
| Two cold **real-device** runs of the field journey | **Not done: no physical phone** |
| Offline recovery on a device (airplane mode, kill, reconnect) | Done on the emulator in M1 (T15/T45); not on a phone |
| Cold start and memory | Emulator only (T29); over budget there, needs a phone |
| Independent security/state review | **Owed** (T31) |

## Mock / real boundaries (say these out loud in any demo)

| Real | Synthetic or simulated |
|---|---|
| Sign-in (Supabase Auth), tokens verified against published keys | All water data: SYN-COLOR-001 is a printed colour card, not a kit |
| Database (Supabase Postgres), tenant isolation, case rules | The ML model is trained on rendered images, research-only |
| Offline save, sync, idempotency | Demo users and tenant |
| The server on Render | The "lab" in every lab report |
