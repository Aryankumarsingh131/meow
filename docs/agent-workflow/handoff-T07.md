# Handoff — T07 Source selection and history slice

Owner: agent, role A (product/mobile). Requirement REQ-001, acceptance AC-001.
Date: 2026-09-22.

**Status: three acceptance criteria met and tested; one required verification
step could not be run.** The card requires a **screen recording**, and there
is no device, emulator or Android SDK in this environment. That is recorded as
a blocker, not substituted with something weaker and called done.

## Dependency gate

Gate: "T03 T05 complete, reviewed, and reflected in current-state.md with real
evidence."

- **T05 — satisfied.** Real schemas, generated contracts, two passing suites,
  real recorded commands. T07 extends those commands.
- **T03 — partially satisfied, not treated as green.** Its scaffold and
  dependency resolution are real; its device-dependent criteria remain
  blocked. That same missing toolchain is what blocks T07's screen recording,
  so the gap is load-bearing here rather than incidental.
- **Neither has had real human review.** Unchanged since T02–T06, stated
  rather than silently waived.

## Changed files

| File | What |
|---|---|
| `services/api/migrations/source.py` | **New.** `sources` DDL, bounded CHECKs, per-tenant unique QR |
| `services/api/app/sources.py` | **New.** Tenant-scoped list/search/paging, QR resolution, history |
| `apps/mobile/src/sources.tsx` | **New.** S02 screen (JSX/wiring only) |
| `apps/mobile/src/sourceCatalog.ts` | **New, scope addition** — the testable logic |
| `tests/sources_test.py` | **New.** 43 tests against a real SQLite DB |
| `tests/sources_client.test.ts` | **New, scope addition.** 22 tests |
| `services/api/migrations/__init__.py` | **New**, empty package marker |

### Scope additions, flagged for approval

1. `apps/mobile/src/sourceCatalog.ts` — `sources.tsx` **cannot be executed
   here**: Node has no JSX transform in strip-only mode, and no React test
   renderer is installed (installing one edits `apps/mobile/package.json` and
   the mobile lockfile — T03's declared files, role B). Putting the decision
   logic in a `.ts` module is what makes the acceptance criteria testable at
   all. `sources.tsx` keeps only JSX and wiring.
2. `tests/sources_client.test.ts` — the card names no check for the mobile
   file.

**No dependency was added and no lockfile was touched.**

### Files deliberately NOT touched

- `apps/mobile/package.json`, the mobile lockfile, `apps/mobile/tsconfig.json`
  — role B / T03. When `sources.tsx` hit a `.ts`-extension import error I
  fixed my own import rather than edit the mobile tsconfig.
- `services/api/migrations/samples.py` — **T13's** migration. `source_history`
  reads `samples`, but T07 does not define it; the expected columns are
  documented in `sources.SAMPLES_COLUMNS_EXPECTED` and stood up as a test
  fixture. **This is an interface expectation to agree with T13's owner.**
- `services/api/app/main.py`, `schemas.py` — T05's files. No route was
  registered and no contract was regenerated, so `contracts/openapi.json`
  and `client.ts` are untouched and still byte-identical to T05's output.

## Exact commands and results

Build host: Windows 11, MINGW64_NT-10.0-26200. Python 3.13.7, Node v24.19.0,
SQLite 3.50.4. Base commit `1c371043629f061c945cf4a38af68c84af8e6bff`
(branch `main`). All commands run from the repository root except where noted.

```
python -m unittest tests.sources_test                    -> Ran 43 tests ... OK
node tests/sources_client.test.ts                        -> 22/22 passed
npx tsc --noEmit                                         -> 0 errors
cd apps/mobile && npx tsc --noEmit -p tsconfig.json      -> 0 errors

# regressions, unchanged by T07
python -m unittest tests.auth_test                       -> Ran 44 tests ... OK   (T06)
node tests/auth_client.test.ts                           -> 12/12 passed          (T06)
python -m unittest services.api.app.tests.test_schemas   -> Ran 15 tests ... OK   (T05)
node tests/contracts.test.ts                             -> ALL CHECKS PASSED     (T05)
```

`tsc` coverage of both new TypeScript files was confirmed with `--listFiles`
and a deliberately injected type error, observed to fail and then reverted.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| **Unknown QR safe** | `TestUnknownQrIsSafe` (8) + mobile QR tests. 10 hostile payloads (`https:`, `javascript:`, `file:`, `data:`, `intent:`, `content:`, protocol-relative, RTL-override, the app's own `jalsakshi://` scheme) are all `unreadable`. `isNavigableScan` returns `false` for **every** outcome including a valid match — there is no scan→navigate path at all. The malformed outcome carries a **reason code only, never the payload**, asserted by serialising it and checking the payload is absent. A source-level scan asserts `sources.tsx` contains no `Linking.`/`openURL`/`WebView`/`eval`/`dangerouslySetInnerHTML` |
| **Tenant-scoped sources** | `TestTenantScoping` (9). Every query filters `session.tenant_id` (T06's `Session`); no parameter can name a tenant. Identical labels in two tenants do not bleed; another tenant's QR resolves `QrUnknown` carrying only the caller's own input; cross-tenant history is `NOT_FOUND` (404, not 403) and byte-identical to a nonexistent source. Two tenants sharing a source-id string stay separated |
| **Stale/offline history labeled** | `TestHistory` (7) + mobile freshness tests. Server returns `served_at` so the client labels against the **server** clock. Every label is qualified ("Last known record…"), and a test asserts no label contains *safe / clean / potable / pass / current*. Cached data is warned **even when fresh**; `origin` and `freshness` are separate fields, not one boolean |

## Verification from the card

`Search/QR/offline tests and screen recording.`

1. **Search tests — done.** `TestSearch` (7) + mobile search tests: label and
   locality matching, LIKE-wildcard escaping (`%` and `_` search for literal
   characters instead of matching the whole catalogue), SQL-injection payloads
   inert, bounded term length, blank search.
2. **QR tests — done.** See the acceptance table above.
3. **Offline tests — done.** Missing/unparseable server time is `unknown`,
   never assumed fresh. A **future** timestamp reports `clock_unreliable`
   rather than rendering "just now" — a rolled-back field phone must not
   produce fabricated freshness. Empty history is an empty labelled slice, not
   an error.
4. **Screen recording — NOT DONE. Blocked.** Verified in this environment:
   `adb` not found, `emulator` not found, `ANDROID_HOME` and
   `ANDROID_SDK_ROOT` unset, no Android SDK directory. No device is attached.
   This is T03's standing blocker. I did not substitute a web render or a
   static mock-up and call it a recording — AGENTS.md is explicit that a
   fallback does not complete the original requirement.

## Mutation testing

Both legs were re-run against deliberately broken copies (source-level edits,
reverted afterwards).

**Server, 11 mutants, all CAUGHT:** drop the tenant filter from list; QR lookup
ignores tenant; remove LIKE escaping; unbounded limit; unbounded search term;
QR regex accepts anything; inactive source matches; history skips the parent
check; history ignores tenant; history shows all statuses; inactive sources
listed.

**Mobile, 10 mutants, all CAUGHT:** QR regex accepts anything; scans become
navigable; no payload length bound; future clock treated as fresh; cache not
warned; staleness warning never shown; unreadable echoes the payload; stale
threshold widened to 10 years; unbounded search; missing server time treated
as fresh (this last one is caught by `tsc`, not the runtime suite — removing
the guard is a type error, and at runtime `Date.parse(null)` is `NaN` so the
NaN branch already covers it; genuine redundancy, verified rather than
assumed).

Two mutants initially **survived** and exposed real defects *in the tests*:
both bounded-length tests asserted "returns nothing", which is true whether or
not the bound exists. Both were rewritten so the truncation is observable (a
60-character label matched by a 70-character query, which only succeeds if the
term was actually cut), and both mutants are now caught.

## Blockers — none hidden

1. **Screen recording impossible** — no device, emulator or Android SDK
   (verified, not assumed). The S02 screen has **never been rendered**.
   `sources.tsx` is type-checked and source-scanned but not executed.
2. **PostgreSQL never run against.** No server and no psycopg driver exist.
   Tests run on SQLite via the real migration. Two consequences:
   - The DDL dialect difference is isolated to `_TYPES` and a test asserts
     both dialects declare the same columns — but that is not the same as
     applying the migration to PostgreSQL, which has not happened.
   - `sources.py` uses **qmark (`?`) paramstyle**, which SQLite accepts and
     psycopg does not (it uses `%s`). This module as written will not run on
     PostgreSQL. The change is mechanical, but writing an untested
     translation against a database nobody can execute would be inventing a
     result. Recorded in the module docstring too.
3. **`samples` table is T13's, and does not exist.** `source_history` depends
   on it; the test fixture is a stand-in, not a schema claim. **Needs
   agreement with T13's owner** on `SAMPLES_COLUMNS_EXPECTED`.
4. **No HTTP route is registered.** T07 delivers the data layer and screen
   logic; wiring `GET /v1/sources` and `/v1/sources/{id}/history` into the app
   would edit T05's `main.py` and regenerate the frozen contracts. Out of
   scope, and it means these functions have not been exercised over HTTP.
5. **No scanner is wired in.** `expo-camera` is not installed (same role-B
   lockfile constraint). The screen takes a scanned string through a callback;
   the safety logic does not depend on which scanner supplies it.
6. **The synthetic catalogue is invented test data**, not an assigned real
   one. The card's input is "assigned synthetic catalog"; no real tenant,
   village, or source list exists. Nothing here is field-validated.

## Independent review

T07 touches **tenant authorization boundaries** (every query is tenant-scoped,
and cross-tenant reads must be indistinguishable from missing ones). Per
AGENTS.md that warrants independent review alongside T06's auth review, since
the two share `Session` and the same 404-not-403 reasoning.

## Proposed status update (for the reviewer, not applied)

I have **not** checked the T07 box in `to-do.md`; the card reserves it for
after review, and `jalsakshi-blueprint/` is a reference package this repo does
not edit. Proposed wording once a reviewer signs off:

> T07 — catalogue, QR safety and history staleness implemented and tested;
> screen recording still outstanding (no device/SDK); PostgreSQL and HTTP
> wiring not exercised; `samples` interface pending agreement with T13.

## Artifact locations

- Code: `services/api/app/sources.py`, `services/api/migrations/source.py`,
  `apps/mobile/src/sourceCatalog.ts`, `apps/mobile/src/sources.tsx`
- Tests: `tests/sources_test.py` (43), `tests/sources_client.test.ts` (22)
- Evidence: the command block above, reproducible from commit
  `1c371043629f061c945cf4a38af68c84af8e6bff` plus these seven files.
