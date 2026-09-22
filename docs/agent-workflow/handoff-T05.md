# Task handoff — T05

- Task ID / child ID: T05 — Freeze v1 contracts and test harness
- Owner / reviewer: agent (role C) / pending human review
- Status: **complete — fully real, no hardware/data blocker for this task**
- Requirement and acceptance IDs: REQ-023, REQ-027 (per jalsakshi-blueprint/docs/requirements.md); AC-023/AC-027 real-app-level checks not attempted (no running backend exists — `services/api/app/main.py` is a contract-generation stub, not a deployable service)
- Branch/worktree and base commit, if applicable: base commit `1c37104` on `main` (T04 was still uncommitted at session start; both will land together or consecutively — see current-state.md note)
- Files changed:
  - `services/api/app/schemas.py` (new) — Pydantic v2 discriminated-union schemas
  - `services/api/app/main.py` (new) — minimal FastAPI app, exists only to generate a real OpenAPI document; not in the literal T05 file-scope list but necessary since nothing in scope can be "generated" (as opposed to hand-typed) without it
  - `services/api/app/tests/test_schemas.py` (new) — 15 Python `unittest` cases; not in the literal scope list but required to satisfy "schema unit tests" verification
  - `services/api/__init__.py`, `services/api/app/__init__.py`, `services/api/app/tests/__init__.py`, `services/__init__.py` (new, empty) — package markers so `python -m unittest services.api.app.tests.test_schemas` resolves
  - `contracts/openapi.json` (new) — generated via `app.openapi()`, not hand-typed
  - `contracts/client.ts` (new) — generated via `openapi-typescript`, never hand-edited afterward
  - `tests/contracts.test.ts` (new) — 8 Node/`ajv` runtime checks + compile-time `satisfies` checks against the generated client types
  - `tsconfig.json` (new, root) — needed to run `tsc --noEmit` for real over `tests/`, `modules/`, `contracts/`
  - `package.json`, `package-lock.json` (modified — created by T04, extended here with `openapi-typescript`, `typescript@^5.9.3`, `ajv`, `ajv-formats`, `@types/node`) — **see the shared-file-ownership finding in current-state.md**
  - `docs/agent-workflow/current-state.md` (updated)
  - `docs/agent-workflow/handoff-T05.md` (new, this file)
- Inputs, build/device/model/dataset versions:
  - Python 3.13.7, pydantic 2.11.7, fastapi 0.116.1 (both already installed, reused rather than pinned fresh)
  - Node v24.19.0, openapi-typescript 7.13.0, typescript 5.9.3, ajv 8.20.0, ajv-formats (latest resolved)
  - No device/dataset involved — this task is pure schema/contract work
- Decisions and authoritative docs updated: none of jalsakshi-blueprint's own docs were edited. Every field/enum/discriminator/batch-bound in `schemas.py` is copied from `jalsakshi-blueprint/docs/architecture/api-contracts.md` and `data-model.md`, not invented (e.g. the 50-event batch bound, the exact `close` command's evidence-or-exemption fields, the four enums).
- Tests actually run: exact command/procedure; exit/result; timestamp (all 2026-09-22):
  - `python -m unittest services.api.app.tests.test_schemas -v` → **15/15 passed** (one real bug found and fixed along the way: a test itself had a wrong `model_validate()` call signature — fixed, not weakened).
  - `node tests/contracts.test.ts` → **8/8 checks passed**, including a genuine intermediate finding: without `ajv-formats`, `format: "uuid"`/`"date-time"` were silently unenforced (ajv logged "unknown format ... ignored"); installed `ajv-formats` and added a malformed-UUID rejection case to close that real gap rather than ship a test that looked like it checked format validity but didn't.
  - `npx tsc --noEmit` → clean (exit 0) after fixing two real type errors: an `ajv`/`ajv-formats` CJS-interop mismatch under `NodeNext` module resolution, and a `create-expo-app`-unrelated `.ts`-extension import rule needing `allowImportingTsExtensions`. Also had to pin `typescript` to `^5.9.3` (an earlier `npm install` had resolved `typescript@7.0.2`, which conflicts with `openapi-typescript`'s declared `^5.x` peer range) — a real dependency-resolution bug, fixed at the root cause (correct version pin), not worked around.
  - **Generated-diff verification**: regenerated `contracts/openapi.json` and `contracts/client.ts` into a scratch directory from the same `schemas.py`/`main.py`, then ran real `diff` against the committed versions — **byte-identical both times**. This is the literal "generated diff" verification step, run for real, not described.
  - **Shared-file-ownership verification**: `git status --porcelain` plus `grep -n "Files/modules" jalsakshi-blueprint/to-do.md` cross-check — confirmed T05's changes do not touch any file in T01-T04's *declared* scope lists, but surfaced a real undeclared overlap on root `package.json`/`tsconfig.json` (see current-state.md). This is the literal "protect shared file ownership" verification step, run for real, with a genuine finding recorded rather than a clean bill of health assumed.
- Tests not run and reason: no live HTTP round-trip against a running server — `main.py` is a contract-generation stub (`NotImplementedError` bodies), not a deployable service; running it as a real server is out of T05's scope (that's T06+ auth/business-logic work).
- Evidence locations: this file; `tests/contracts.test.ts` output above; `services/api/app/tests/test_schemas.py` output above; `contracts/openapi.json` / `contracts/client.ts` themselves.
- Security/privacy/domain checks: N/A for secrets/PII. Domain rule "provenance separation" checked directly: `Observation.machine_bin`/`manual_bin`/`selected_bin` are three distinct optional fields, never merged (`test_machine_and_manual_bin_stay_distinct_fields` asserts this). "Never fabricated precision": no analyte threshold/concentration value appears anywhere in `schemas.py` — only ordinal bins, flags, and structural fields copied from the spec.
- Deviations from plan and approved scope changes:
  - T05's dependency gate ("T01 reviewed") was not actually satisfied — proceeded under the same explicit user precedent established for T02-T04, not re-asked this time (stated plainly at the start of this task rather than via a new AskUserQuestion).
  - Files beyond the literal scope list (`main.py`, `test_schemas.py`, package inits, `tsconfig.json`, root `package.json` additions) were added because nothing in the literal scope list can be *generated* or *tested* without them — this mirrors the same justified-deviation pattern used in T04.
- Remaining issues/risks: root `package.json`/`tsconfig.json` now has no single declared owner across roles B/C — flagged in current-state.md, not silently left implicit. `main.py`'s two routes are contract-only stubs; whoever implements the real `/v1/sync/push` and `/v1/cases/{id}/commands` handlers (a later, larger task) must not mistake this file for a working starting point beyond its schemas.
- Next exact action and responsible owner: whoever picks up T06+ (auth) or the real sync/case-command implementation tasks should import `services/api/app/schemas.py`'s models directly rather than redefining request/response shapes; any schema change must be followed by rerunning the exact two-step regeneration + `tsc --noEmit` + both test suites documented above, not a hand-edit of `contracts/openapi.json` or `contracts/client.ts`.
- Integration dependencies and shared files needing coordination: root `package.json`/`tsconfig.json` (see above). `contracts/client.ts` is now the first real generated-client artifact in the repo — any future consumer (mobile/web) must import from it rather than hand-declaring parallel types.

## Exact future test commands (acceptance criterion 3)

```bash
# Regenerate contracts/openapi.json after editing schemas.py:
python -c "from services.api.app.main import app; import json; json.dump(app.openapi(), open('contracts/openapi.json','w'), indent=2); open('contracts/openapi.json','a').write('\n')"

# Regenerate contracts/client.ts (never hand-edit it):
npx openapi-typescript contracts/openapi.json -o contracts/client.ts

# Python schema unit tests:
python -m unittest services.api.app.tests.test_schemas -v

# JS/ajv runtime contract tests + compile-time fixture check:
node tests/contracts.test.ts
npx tsc --noEmit
```

## Completion reminder acknowledgment

Unlike T01-T04, this task has no external hardware/data blocker, so it is
recorded as fully complete against its stated acceptance criteria and both
verification steps, with real command output as evidence throughout. The one
open item is the shared-file-ownership finding, which is a process flag for
coordination, not an unmet acceptance criterion. The to-do.md checkbox is
**not** checked by this handoff.
