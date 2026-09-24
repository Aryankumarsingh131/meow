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
# NOTE (2026-09-22, meow integration): the contract-generation app moved from
# services/api/app/main.py to services/api/app/contracts_app.py. main.py is now
# the real service (health, config validation, synthetic demo router), and
# generating from it would add /health/* and /demo/v1/* to this FROZEN
# document. Regeneration was re-run after the rename and verified
# byte-identical, so the T05 freeze is intact.
python -c "from services.api.app.contracts_app import app; import json; json.dump(app.openapi(), open('contracts/openapi.json','w'), indent=2); open('contracts/openapi.json','a').write('\n')"

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

---

## M1 Definition-of-Done review — 2026-09-24 (CONTRACT CHANGE)

Re-reviewed as part of milestone M1. The three acceptance criteria still hold,
and the generated diff was re-verified. **But the review found a genuine defect
in the frozen contract, and the contract was changed.**

### The defect

The frozen v1 `Timing` was `{elapsed_ms: int >= 0, valid: bool}`. Demonstrated
against the live model before any change:

- A rebooted test (T08: elapsed time **indeterminate**) could not be recorded
  honestly. Omitting `elapsed_ms`, sending `None`, and sending `-1` were all
  **rejected**; the only accepted form was to invent a number
  (`elapsed_ms=0`). That is fabricated precision, forbidden by AGENTS.md, and
  exactly what T08's discriminated `Elapsed` type was built to prevent.
- `valid: bool` made **late**, **expired** and **indeterminate** produce
  byte-identical payloads — AGENTS.md's "generic boolean that collapses
  provenance".

T05 was frozen before T08 existed, so the wire never learned about
indeterminate timing.

### Why it was changed now

T12 (local save) and T13 (ingestion) had not been built, and **no mobile code
imported the generated client** (verified by grep). There were zero consumers,
making this the cheapest moment the change would ever have. Left alone, both
T12 and T13 would have been forced to write `elapsed_ms=0` for every rebooted
test, silently.

### The change

`Timing` is now a discriminated union on `state`, mirroring T08:

- `TimingMeasured` — `state` in `preparing | waiting | in_window | late |
  expired`, plus `elapsed_ms >= 0` and `valid`. A `model_validator` enforces
  `valid == (state == "in_window")`, so a client cannot claim an expired
  capture is valid.
- `TimingIndeterminate` — `state: "indeterminate"`, a typed `reason`
  (`reboot | clock_rollback | clock_disagreement | monotonic_regression |
  read_window_malformed`), `valid: Literal[False]`, and **no `elapsed_ms`**.
  `extra="forbid"`, because pydantic otherwise *silently drops* unknown fields
  and a smuggled guess would vanish rather than be refused.

Found while writing the tests: the first draft asserted that a smuggled
`elapsed_ms` was "rejected", but pydantic ignores extra fields by default, so
it was silently dropped and the assertion passed for the wrong reason. Fixed by
making the model strict and asserting a real `ValidationError`.

The ajv fixture now references the real synthetic protocol
(`SYN-COLOR-001`, `f96bdca3-5020-5313-b65a-072967c46292`) instead of a
placeholder id.

### Evidence (commit follows this entry)

```
python -m unittest services.api.app.tests.test_schemas   -> Ran 26 tests OK   (was 15; +11 timing)
node tests/contracts.test.ts                             -> ALL CHECKS PASSED (12; was 8; +4 timing)
npx tsc --noEmit                                         -> 0 errors (fixture `satisfies` the regenerated client)
```

Re-freeze, regenerated twice and diffed — **deterministic**:

```
sha256 3ac6b2b87979dc1ea6ceed7756d19e5eb44c6f5a5db98dcf7443c74f7d8c9c2c  contracts/openapi.json
sha256 c92c158aed59253adbba098ec55c8125e9850c6d4edc87c52450f0cb14a57760  contracts/client.ts
```

Mutation testing of the new validators — **7/7 caught**: valid/state check
removed; `late` counted as valid; `extra="forbid"` removed; indeterminate
allowed `valid=true`; negative `elapsed_ms` allowed; unknown reason accepted;
a reason dropped from the enum. The harness asserts each mutation actually
applied, and it caught one that did not (a literal `\n` in a shell argument),
reporting it as "did not apply" rather than a false "survived".

### Known limit

`valid == (state == "in_window")` is a cross-field rule that JSON Schema cannot
express. The **server** (pydantic) enforces it; ajv/generated clients do not.
Documented in `tests/contracts.test.ts`. Same situation as the existing
close-command rule.

### Obligation handed to T12

T12 will be the **first** code to produce this wire shape from T08's
`TimingVerdict`. It must import the generated `contracts/client.ts` types so
`tsc` enforces the contract, rather than hand-building the object.

### Status

T05's acceptance criteria are met with evidence. **Not ticked** — T05 is a
contract freeze and this review *changed* the contract, so it wants
independent review of the new `Timing` shape before sign-off.

## Contract change 2026-09-24 (T17, additive)

The frozen command payloads contradicted `case-state-machine.md`. Resolved
additively (v1 permits additive optional fields); details in handoff-T17.md:
`AssignPayload.due_at` (new, optional), `DismissPayload.dismiss_reason` +
`disposition` (new, optional), `LinkRetestPayload.retest_sample_id`
(required -> optional; flagged for T46). Regenerated deterministically:
openapi.json `f48b5f3c…`, client.ts `833841cb…`; 26 schema + 12 contract checks pass.
