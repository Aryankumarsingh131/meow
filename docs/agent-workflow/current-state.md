# Current state — meow1 (JalSakshi implementation, using jalsakshi-blueprint as reference)

Updated: 2026-09-22.

## What exists

`jalsakshi-blueprint/` — planning/reference package only, untouched, not edited by this task.

`docs/protocol-selection.md`, `docs/event-confirmation.md` — T01 deliverables.
Both are **fictional demo templates**, explicitly authorized by the user in
place of real kit/event data (real data was not available). No real kit,
lot, manufacturer, or event exists yet.

`docs/pilot-interviews.md`, `docs/alternative-evaluation.md` — T02 deliverables.
Both are **fictional demo templates**. The T02 dependency gate ("T01 reviewed,
not just checkbox-complete") was explicitly waived by the user for this pass;
T01 itself is still not really reviewed. No real worker/supervisor/buyer/lab
partner exists, and no real mWater/ODK sandbox trial has been performed.

`apps/mobile/` — real Expo/TypeScript scaffold (T03), not fictional. Real
`npm install`/`npx expo config` succeeded on this build host; real dependency
versions are resolved and recorded in `docs/toolchain-matrix.md`. `npx expo
run:android` was actually attempted and genuinely failed (no Android SDK, no
`adb`, no device) — that failure is recorded as-is, not mocked. APK
install/offline-tensor acceptance criteria remain unmet.

`modules/capture-native/` + `tests/capture-golden.json` + `docs/feature-schema.md`
(T04) — real JS (TypeScript, run directly via Node 24's type stripping) and
real Python implementations of the schema-v1 feature pipeline, actually run
against a real (synthetically-generated, not phone-captured) EXIF-tagged
JPEG fixture. Both legs agree exactly on EXIF orientation handling and ROI
geometry; median color values differ by a measured, root-caused ±1/channel
due to a real cross-decoder (jpeg-js vs Pillow/libjpeg) rounding difference,
recorded honestly rather than claimed as exact agreement. The Kotlin native
leg (`modules/capture-native/android/CaptureModule.kt`) is real source,
never compiled or executed — same missing-Android-toolchain blocker as T03.
**Note: T04 was still uncommitted when T05 began; both will reach `main` in
the same or consecutive commits.**

`services/api/app/schemas.py` + `contracts/openapi.json` + `contracts/client.ts`
+ `tests/contracts.test.ts` + `services/api/app/tests/test_schemas.py` (T05)
— real Pydantic v2 discriminated-union schemas (sample events on `kind`,
case commands on `type`), a real FastAPI-generated `openapi.json` (not
hand-typed), a real `openapi-typescript`-generated `client.ts` (never
hand-edited), and two real test suites: 15 Python `unittest` cases (incl.
the `close`-command report-or-exemption business rule, which is not
expressible in plain JSON Schema) and 8 Node/`ajv` runtime-validation cases
against the actual generated OpenAPI schemas, plus a clean `tsc --noEmit`
type-check of the fixtures against the generated client types. Regenerating
both `contracts/openapi.json` and `contracts/client.ts` from scratch
produced byte-identical output (verified by real `diff`, not assumed).

`services/api/app/auth.py` + `apps/mobile/src/auth.ts` + `tests/auth_test.py`
+ `tests/auth_client.test.ts` + `docs/auth-provider.md` +
`services/api/requirements.txt` (T06) — real OIDC access-token verification
(RS256 via JWKS, exact issuer, audience, expiry/nbf/iat with 60 s bounded
leeway), tenant resolved from the membership lookup and never from a token
claim or request field, and the role matrix from
`jalsakshi-blueprint/docs/architecture/authorization-matrix.md`. 44 Python
tests (incl. two-user/two-tenant negatives driven through a real ASGI app via
`TestClient`, asserting cross-tenant and nonexistent IDs return
byte-identical 404s) and 12 Node tests of the mobile PKCE public client using
real `node:crypto`. **The cryptography is real; the issuer is not** — tokens
are minted from locally generated RSA keypairs because no OIDC provider has
been chosen and no real test account exists. No end-to-end login against a
hosted IdP has ever been performed and none is claimed. Test quality was
checked by source-level mutation testing: 14 mutants, 11 caught individually,
and the 3 survivors are overlapping defences whose combined removal is caught.
Two real defects in `python-jose` 3.5.0 were found and worked around (it
ignores the JWS `kid` and walks the key set in order; an HS256 forgery is
accepted if an `oct` key sits first). No new dependency was installed.

`services/api/migrations/source.py` + `services/api/app/sources.py` +
`apps/mobile/src/sourceCatalog.ts` + `apps/mobile/src/sources.tsx` +
`tests/sources_test.py` + `tests/sources_client.test.ts` (T07) — real
`sources` DDL applied to a real SQLite database by the real migration
(per-tenant unique QR, bounded CHECKs, paired-coordinate constraint), a
tenant-scoped catalogue with escaped bounded search and keyset paging,
discriminated QR resolution, and source history carrying the **server** clock
so staleness is labelled against a trustworthy time. 43 Python tests and 22
Node tests. QR safety is real: 10 hostile payloads (`https:`, `javascript:`,
`file:`, `data:`, `intent:`, `content:`, protocol-relative, RTL-override, the
app's own scheme) are all rejected by allowlist, the malformed outcome carries
a reason code and never the payload, and there is no scan-to-navigate path at
all. Test quality was checked by source-level mutation testing: 21 mutants,
all caught — two initially survived and exposed that both bounded-length tests
asserted something true with or without the bound; both were rewritten so the
truncation is observable. **The S02 screen has never been rendered and no
screen recording exists** (no device, emulator or Android SDK — verified:
`adb` and `emulator` not found, `ANDROID_HOME`/`ANDROID_SDK_ROOT` unset).
**PostgreSQL has never been run against** — no server, no psycopg driver — and
`sources.py` uses qmark paramstyle, which psycopg does not accept, so it will
not run on PostgreSQL as written. No dependency was added and no lockfile was
touched.

## Active claims

- T01 (Protocol and event gate) — owner: agent (role A), acting on explicit
  user authorization to build a fictional/illustrative version since no real
  kit or event information was available. See [handoff-T01.md](handoff-T01.md).
- T02 (Validate the user job and alternatives) — owner: agent (role A), acting
  on explicit user authorization to waive the T01-reviewed dependency gate and
  build a fictional/illustrative version since no real interview subjects or
  competitor sandbox access were available. See [handoff-T02.md](handoff-T02.md).
- T03 (Prove the native toolchain) — owner: agent (role B), acting on explicit
  user authorization to scaffold real config/dependencies while leaving
  device-dependent acceptance criteria explicitly blocked (no Android SDK/
  adb/device in this environment). See [handoff-T03.md](handoff-T03.md).
- T04 (Prove file-to-feature preprocessing) — owner: agent (role B), acting
  on explicit user authorization to waive the T01+T03-reviewed dependency
  gate, use a synthetic (not real-camera) fixture, and stub the native leg
  since no Kotlin/Android toolchain is available. See [handoff-T04.md](handoff-T04.md).
- T05 (Freeze v1 contracts and test harness) — owner: agent (role C), acting
  on the same explicit precedent as T02-T04 to waive the T01-reviewed
  dependency gate. Fully real (no hardware blocker for this task). See
  [handoff-T05.md](handoff-T05.md).
- T06 (Online membership authorization) — owner: agent (role C). T05's gate is
  really satisfied; T03's is only partially (its device-dependent criteria are
  blocked, but T06 needs no device). Neither has had real human review — that
  gate remains unmet, stated rather than silently waived. **Requires
  independent auth review per AGENTS.md before it counts as done.** See
  [handoff-T06.md](handoff-T06.md).
- T07 (Source selection and history slice) — owner: agent (role A). Same gate
  position as T06: T05 really satisfied, T03 only partially (and its missing
  Android toolchain is exactly what blocks T07's required screen recording).
  Touches tenant authorization boundaries and shares T06's `Session` and its
  404-not-403 reasoning, so it **warrants the same independent review**. See
  [handoff-T07.md](handoff-T07.md).

## Open blockers

- Real kit/manufacturer/lot/read-window: not selected. `docs/protocol-selection.md`
  is a structural template only.
- Real event/organizer/pre-event rules: not confirmed. `docs/event-confirmation.md`
  is a structural template only; its mandated organizer cross-check verification
  has not been run and cannot be run against a fictional event.
- T01 has not received real human review despite gating T02's dependency; the
  gate was explicitly waived by the user rather than satisfied.
- No real worker/supervisor interview has been conducted; buyer and lab access
  remain genuinely unknown (not invented) per `docs/pilot-interviews.md`.
- No real mWater/ODK sandbox trial has been performed; the configure-versus-build
  question in `docs/alternative-evaluation.md` remains open, not answered.
- Any downstream task (T03/T08 for T01; T38 for T02; anything assuming a real
  reviewed protocol, confirmed event, real interview evidence, or a real
  platform decision) remains blocked on the above.
- **Undeclared shared-file overlap (found during T05's "protect shared file
  ownership" verification):** root-level `package.json`/`package-lock.json`
  and `tsconfig.json` are not named in any task's `to-do.md` file-scope list,
  but T04 (role B) created `package.json` and T05 (role C) just extended it
  (added `openapi-typescript`, `typescript`, `ajv`, `ajv-formats`,
  `@types/node`) and added `tsconfig.json`. No declared-scope collision was
  found (T01-T04's actual named files are untouched by T05), but this root
  config pair is now a de facto shared file across roles B and C with no
  single owner named. Future tasks editing it should coordinate first,
  per AGENTS.md's "one editor at a time" rule for shared config.
- **No OIDC provider chosen, no provider tenant, no real test accounts (T06).**
  `docs/auth-provider.md` recommends self-hosted Keycloak but that is a
  recommendation awaiting human sign-off, not a procurement. No fictional
  provider tenant, client ID or credential was invented. Verification logic is
  provider-agnostic, so the choice can be made later without a rewrite.
- **T06's mobile client is not wired into the app.** `expo-auth-session`,
  `expo-crypto`, `expo-web-browser` and `expo-secure-store` are not installed,
  and installing them edits `apps/mobile/package.json` and the mobile lockfile
  — both declared files of T03 (role B). Per AGENTS.md that interface change
  must be agreed with the owner first, so T06 did not make it. **Needs a
  role-B conversation.** Consequently token storage is also unimplemented;
  nothing should be persisted to disk until `expo-secure-store` exists.
  Hermes has no `crypto.subtle`, so S256 needs a native module regardless.
- **JWKS fetching/caching is unimplemented (T06).** `auth.py` does no network
  I/O by design, so a JWKS outage cannot become a silent auth bypass, but
  whoever wires the real provider must choose the failure mode explicitly.
- T06 has not had the independent auth review AGENTS.md requires, and its
  `to-do.md` checkbox is deliberately left unchecked.
- **T07's required screen recording was not produced.** No device, emulator or
  Android SDK exists here (verified, not assumed). The S02 screen has never
  been rendered; `apps/mobile/src/sources.tsx` is type-checked and
  source-scanned but never executed. No web render or mock-up was substituted
  — AGENTS.md is explicit that a fallback does not complete the original.
- **No PostgreSQL anywhere in this environment (T07).** No server and no
  psycopg driver, so the `sources` migration has only ever been applied to
  SQLite, and `services/api/app/sources.py` uses qmark (`?`) paramstyle, which
  psycopg does not accept. **That module will not run on PostgreSQL as
  written.** The fix is mechanical but was not written blind against a
  database nobody can execute.
- **T07's `source_history` depends on the `samples` table, which is T13's
  migration and does not exist.** The expected columns are documented in
  `sources.SAMPLES_COLUMNS_EXPECTED` and stood up as a test fixture — an
  interface expectation that **needs agreement with T13's owner**, not a
  schema T07 defines.
- **No HTTP route exists for `GET /v1/sources` or
  `/v1/sources/{id}/history`.** Registering them would edit T05's `main.py`
  and regenerate the frozen contracts, so T07 left both alone; the functions
  have therefore never been exercised over HTTP. `contracts/openapi.json` and
  `contracts/client.ts` remain byte-identical to T05's output.
- No QR scanner is wired in (`expo-camera` not installed — same role-B
  lockfile constraint as T06's auth dependencies).
- T07's catalogue is invented test data, not a real assigned one. No real
  tenant, village or source list exists; nothing in T07 is field-validated.
- T07 has not had independent review and its `to-do.md` checkbox is
  deliberately left unchecked.

## Next exact action

If/when real kit and event information becomes available, replace (not append
to) both T01 files with the real transcribed values and a cited source, then
re-run the manual organizer cross-check for real.

If/when a real worker/supervisor interview or a real mWater/ODK sandbox trial
becomes available, replace (not append to) the T02 files with real notes and
a real recommendation, and get explicit user approval before treating any
resulting configure-versus-build recommendation as an architecture change.

If/when a real Android phone plus Android SDK/adb becomes available (on this
or any machine), run `cd apps/mobile && npx expo run:android`, fix the Java
17 gap noted in `docs/toolchain-matrix.md` if it recurs, install the
resulting APK, and run a known ONNX tensor through the bundled
`onnxruntime-react-native` runtime to complete T03's real acceptance
criteria.

If/when a real Android/Kotlin toolchain becomes available, compile and run
`modules/capture-native/android/CaptureModule.kt` against
`tests/fixtures/capture-golden-source.jpg` with the same known corners, add
its result as a third `native_leg` entry in `tests/capture-golden.json`
(append, don't overwrite the JS/Python legs), and check it against the
measured ±1/channel JS/Python tolerance. If/when a real camera-captured
photo becomes available, add it as a second fixture rather than replacing
the synthetic one, since the synthetic fixture's exact known corners/colors
are what make the golden-vector comparison checkable at all.

For T06: a human must choose the OIDC provider and sign off on
`docs/auth-provider.md`, then create the realm, a **public** PKCE mobile
client with the `jalsakshi://auth` redirect, and at least two test users in
two tenants matching the fixture shape in `tests/auth_test.py`. Re-run the
suite against provider-issued tokens and confirm the claim shapes (notably
whether `aud` arrives as a string or an array). Only then may "login works" be
claimed. Separately, agree the mobile auth dependencies with T03's owner
(role B) before wiring `apps/mobile/src/auth.ts` into the app.

T06 added these commands: `python -m unittest tests.auth_test` and `node
tests/auth_client.test.ts`.

For T07: when a real Android device or emulator becomes available, render the
S02 screen and capture the required screen recording covering search, a
matching QR, an unknown QR, an unreadable QR, and cached history showing its
staleness label. When a PostgreSQL server and psycopg exist, convert
`services/api/app/sources.py` from qmark to pyformat placeholders, apply
`services/api/migrations/source.py` with `dialect="postgresql"`, and re-run
`tests/sources_test.py` against it. Agree `SAMPLES_COLUMNS_EXPECTED` with
T13's owner before T13 writes `services/api/migrations/samples.py`.

T07 added these commands: `python -m unittest tests.sources_test`, `node
tests/sources_client.test.ts`, and `cd apps/mobile && npx tsc --noEmit -p
tsconfig.json` (the first type-check of the mobile app's own sources).

T05 established the first real, recorded test commands for this repo (see
`docs/agent-workflow/handoff-T05.md` for the full list): `python -m
unittest services.api.app.tests.test_schemas -v`, `node
tests/contracts.test.ts`, `npx tsc --noEmit`, and the exact two-step
regeneration commands for `contracts/openapi.json` /`contracts/client.ts`.
Future tasks should extend these, not invent parallel ones.
