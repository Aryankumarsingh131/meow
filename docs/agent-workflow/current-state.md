# Current state — meow1 (JalSakshi implementation, using jalsakshi-blueprint as reference)

Updated: 2026-09-24.

**This is the authoritative state record** (project-owner decision,
2026-09-24, `docs/decisions/ADR-M1-001-synthetic-protocol-boundary.md`). The
copy at `jalsakshi-blueprint/docs/agent-workflow/current-state.md` is the
sibling `meow` repository's historical record and carries a banner saying so.
`jalsakshi-blueprint/AGENTS.md` now links here.

## Milestone M1 — crash-safe offline vertical slice (ALL TASKS BUILT; G1 NOT PASSED — see G1 review)

### Entry check (2026-09-24, run before any M1 task work)

M1 entry = "native/protocol feasibility and frozen v1 schema". Checked
against evidence, not against checkboxes:

| Condition | Verdict | Evidence |
|---|---|---|
| Frozen v1 schema | **Met** | `openapi.json` + `client.ts` regenerated from source: byte-identical. Schema suite (15) and contract suite (8) pass. |
| Native feasibility | **Largely met** | Native build succeeds; Kotlin feature leg == Python leg exactly on Android 15 emulator. **Open:** G0 "APK offline tensor" never run; no physical device. |
| Protocol feasibility | **Met only via the synthetic-boundary clause** | G0 requires a signed protocol decision + domain review of timing/units — **neither exists**. G0 explicitly accepts "an explicit synthetic-only boundary" instead; the project owner adopted SYN-COLOR-001 as that boundary (ADR-M1-001). |

**Therefore M1 is a "clearly synthetic" slice.** M1's own goal permits this
("a real *or clearly synthetic* test"). Every M1 output is labelled synthetic
and none is presented as validated real-world evidence.

**G0 items that remain OPEN and are never claimed as met:** domain review of
timing/units; APK offline tensor; any real signed kit protocol; independent
human review of T01–T04; a physical device.

### G1 gate review (2026-09-24, after T05–T15 + T45 passes) — **NOT PASSED**

The M1 goal was demonstrated **on an emulator with synthetic data**. A test
was recorded in airplane mode, the app was `kill -9`'d and relaunched offline,
then reconnected, and the queue showed the same record accepted, with exactly
one server row (handoff-T15.md). T45 repeated the flow under an offline lease,
including a 5 h clock rollback that locked access with no record lost
(handoff-T45.md). That is real evidence, but it does not pass G1, because:

- **External blockers (`[!]`):** T01/T08 have no real kit or read window. T03/T04/T09 have no physical phone. T06 has no identity provider chosen by a human.
- **Independent review still owed** (AGENTS.md: auth, sync ordering, state): T06, T07, T13, T14, T15, T45 and the Render release change. Every one of these was self-reviewed by the agent that built it.
- **Not exercised on any device:** a process kill *during* a write (fault-injected only); lost-ack replay on the device itself (tested against the real server in Node, not on the phone); membership revocation on the device (no HTTP revoke exists in M1).

Cross-cutting checks:

| Check | Evidence | Verdict |
|---|---|---|
| Kill during a write → record whole or absent | T12 fault injection at rename/commit boundaries; T15 crash between receipt and outbox delete on real SQLite; emulator `kill -9` after commit keeps the record | Met in tests; **mid-write kill on a device not done** |
| Lost response → no duplicate | T15 real-server test: server commits, response dropped, replay = `duplicate`, 1 server row; T13/T14 PostgreSQL concurrent replay → 1 row, 1 feed entry | Met (integration); not on a device |
| Airplane-mode operation and reconciliation | Emulator: `airplane_mode_on=1`, no default network, API unreachable; save, restart, reconnect, accepted | **Met on emulator** |
| Offline access rules enforced offline | Emulator: lease-gated offline entry; 5 h rollback → locked, grant deleted, 0 records lost | **Met on emulator** |
| Duplicate / out-of-order ingestion | T13: same hash → duplicate, changed payload → conflict, reordered duplicates → 1 sample, correction before original → retryable; T15: retryable stays queued | Met |

### Protocol under test

`protocols/SYN-COLOR-001.v1.json` — canonical, conforms to `protocol-schema.md`
(`node tests/protocol-fixture.test.ts`, 17/17). Its **read window is
SYNTHETIC** (prepare 10 s, read 30 s ± 15 s, invalid after 120 s), chosen by
the agent to exercise T08's timer states; a printed colour card has no
reaction, so these values mean nothing about any kit. Its quality thresholds
are T10's fitted **provisional** values. `model.enabled = false`.

### Task claims and status

Status symbols match `to-do.md`'s legend: `[x]` done, `[~]` built but a named DoD item outstanding, `[!]` blocked/errored, `[ ]` not started.

Owner is recorded by blueprint ROLE. The project owner authorised this agent
to carry every M1 task, so work outside role A is named per task rather than
done silently. A box is ticked in `to-do.md` only after real DoD evidence.

| Task | Role | Depends on | Status | Evidence / blocker |
|---|---|---|---|---|
| T05 | C | T01 | `[x]` **2026-09-24 (d2d9207): regeneration made Python-version independent** (3.13 renamed the 422 phrase, breaking byte-identity) — re-verified byte-identical. Earlier: **reviewed 2026-09-24 — CONTRACT CHANGED.** Frozen `Timing` could not carry indeterminate timing without inventing `elapsed_ms=0`, and `valid: bool` collapsed late/expired/indeterminate. Now discriminated on `state`; re-frozen deterministically (openapi.json `3ac6b2b8…`, client.ts `c92c158a…`). 26 schema + 12 contract checks; 7/7 mutants caught. Ticked 2026-09-24 after a second agent re-verified the shape and regeneration; contracts are not on AGENTS.md's mandatory-independent-review list, but a human look at `Timing` is still welcome. | handoff-T05.md |
| T06 | C | T03 T05 | `[!]` **blocked on a human OIDC-provider choice.** **reviewed 2026-09-24 — acceptance met; M1 input added.** Verification code unchanged. Gap found: nothing could mint a token it accepts and nothing in the API called it. Added a synthetic dev issuer (ADR-M1-002): real RS256/JWKS, `.invalid` issuer, mounted only in development+synthetic; 26 tests prove its tokens pass T06's real `authenticate()`; 6/6 mutants caught. Still open: real provider, JWKS fetching, dead mobile `refreshToken` (→ T15/T45), independent auth review. **Not ticked.** | handoff-T06.md, ADR-M1-002 |
| T07 | A | T03 T05 | `[~]` built; HTTP routes live (c68ef38). **Outstanding:** screen recording, independent tenant review. | handoff-T07.md |
| T08 | A | T01 T07 | `[!]` mechanism built; **blocked on T01** for any real read window. | handoff-T08.md |
| T09 | A | T04 T08 | `[!]` built; cancel + non-1 EXIF **need a physical phone**. | handoff-T09.md |
| T10 | B | T04 | `[x]` complete 2026-09-23; Re-run 2026-09-24: Python fixtures 8/8, 0 mismatches; Kotlin `QualityTest` 4/4. | handoff-T10.md |
| T11 | A | T09 T10 | `[x]` complete 2026-09-24; `node tests/review.test.ts` 12/12 re-run. | handoff-T11.md |
| T12 | A | T11 | `[~]` 7/7 fault-injection; post-commit `kill -9` on emulator keeps the record (T15 run). T15 fixed: owner scoping, optional photo, one DB connection. **Outstanding:** kill *during* a write on a device. | handoff-T12.md, handoff-T15.md |
| T13 | C | T05 T06 | `[~]` built; 10/10 re-run 2026-09-24 incl. PostgreSQL 17.6 two-connection replay race. **Outstanding:** independent sync-ordering review (AGENTS.md). | handoff-T13.md |
| T14 | C | T13 | `[~]` built 2026-09-24: tenant-locked changefeed, `/v1/sync/pull`, `/v1/bootstrap`, 410 reset; 12/12 incl. PostgreSQL late-commit; 11/11 + global-sequence mutants caught. Fixed a T07 cursor-length defect. **Outstanding:** independent sync-ordering review. | handoff-T14.md |
| T15 | A | T12 T14 | `[~]` built 2026-09-24: sync engine + queue + full worker flow. Emulator: offline save → kill -9 → offline relaunch → reconnect → same record accepted (server 1 row). 15/15 real-server tests; 13/14 mutants (survivor equivalent). **Outstanding:** physical phone, independent review. | handoff-T15.md |
| T45 | C+A | T06 T12 T15 | `[~]` built 2026-09-24: server 72 h lease (A08, provisional), device lock on expiry/rollback, revocation drops lease and keeps records. Emulator: offline continue + 5 h rollback lock + re-login sync. 4+10 tests; 10/10 mutants. **Outstanding:** auth review, phone, real IdP. | handoff-T45.md |

### Milestone M2 — evidence-to-action loop (IN PROGRESS, option A: synthetic only; G2 expected `[!]` — needs domain closure-policy sign-off and independent reviews)

Entry check 2026-09-24: immutable ingestion met in code (T13/T14 unreviewed), command contracts met (T05), membership contract NOT met (T06 `[!]`). Project owner chose to proceed synthetic-only.

| Task | Role | Depends on | Status | Evidence / blocker |
|---|---|---|---|---|
| T16 | C | T13 | `[~]` built 2026-09-24: private evidence boundary; 19/19 incl. PostgreSQL; 15/15 mutants. **Outstanding:** security review; malware scanner (PDFs quarantined). | handoff-T16.md |
| T17 | C | T14 | `[~]` built 2026-09-24: transition table, one case per trigger (same transaction as the sample), dedupe→version→role→guards; later-task guards fail closed. 19/19 incl. PostgreSQL race ×5; 18/18 mutants. 3 additive contract changes. **Outstanding:** concurrency/closure review; T46. | handoff-T17.md |
| T21 | C | T19 T20 | `[~]` built 2026-09-24: real `g_retest` (row 10) — a retest sample must be real, same-source, later than the trigger, never invented. 7/7. **Outstanding:** concurrency/closure review; T20. | handoff-T21.md |
| T22 | C | T18 | `[~]` built 2026-09-24: `communications` table (row 13, never a delivery claim); real `g_close` (row 11), checking all four evidence fields at once (`verified_report_id`, `retest_sample_id`, `action_ids`, `communication_id`) plus `policy_version`; found and fixed a gap where `request_closure`/`close` had real guards since T17/T19 but no effect. 10/10. **Outstanding:** concurrency/closure review; T46. | handoff-T22.md |
| T43 | C | T18 T22 | `[~]` built 2026-09-24: tenant/role-scoped metrics + CSV export, synthetic excluded, formula-injection neutralized, cancelable job never publishes a partial file. 14/14; 2/2 mutants. **Outstanding:** in-memory single-process job store; web page external; T31 recheck; review. | handoff-T43.md |
| T46 | A+C | T19 T21 T22 | `[!]` **blocked on a human domain reviewer.** Draft `docs/closure-policy-approval.md` (PENDING, empty sign-off), E1 substantive-exemption rule enforced, E2/E3 pinned; 7/7. | handoff-T46.md |
| T23 | B | T01 T04 T10 | `[!]` synthetic stand-in only (640 captures, real feature pipeline); real kit/lab/audit absent. | handoff-T23.md |
| T24 | B | T23 | `[~]` preparation-level frozen splits, locked test, CIs; 15/15. | handoff-T24.md |
| T25 | B | T24 | `[~]` MLP 3-8-4 → ONNX (896 B), CPU parity; not worse than baseline. | handoff-T25.md |
| T26 | B | T03 T11 T25 | `[~]` on-device model, SHA/schema checks, manual fallback; **emulator 29/29 match, 1.7 ms**; live flow gated by missing card locator (owner decision). | handoff-T26.md |
| T27 | B | T26 | `[~]` calibrated + range guard; locked test 160/160 but only 32 preparations; int8 rejected; **status research**. | handoff-T27.md |
| T18 | A/C | T06 T17 | `[~]` **API only** — supervisor board is a separate app at another address (owner decision). Board endpoints + CORS allowlist (`JALSAKSHI_CORS_ALLOWED_ORIGINS`), bearer only; 11/11. **Outstanding:** board-side verification (external), review. | handoff-T18.md |
| T19 | C | T16 T17 | `[~]` built 2026-09-24: lab report recording (mismatch detection, idempotent, correction/supersession) and verification (role-separated, self-review blocked at the DB layer too); `g_verified`/`g_lab_adverse`/`g_lab_within_limit` case-policy guards now read real evidence. 21/21. **Outstanding:** concurrency/closure review (shares T17's guards); PostgreSQL race tests not re-run here (no `TEST_DATABASE_URL`); UI is out of scope per T18's separate-app decision; T46. | handoff-T19.md |
| T20 | A/C | T18 | `[~]` claimed 2026-09-24 by this agent for API/actions, migration, contracts and tests. Action record and operator-note acceptance built; 7/7 focused tests, full Python suite 275 passed, 11 skipped. **Outstanding:** separate board UI, PostgreSQL race, independent review. | handoff-T20.md |

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
recorded honestly rather than claimed as exact agreement.
**Superseded 2026-09-22: the Kotlin native leg is now COMPILED, LINKED AND
RUN on a device.** It was previously real-but-never-compiled source.
Diagnosis of why `computeFeaturesNative` always rejected: **it was not a build
failure.** `CaptureModule` was a plain Kotlin class with no Expo `Module`, no
`ModuleDefinition` and no JS-callable surface, and the module had no
`package.json`, `expo-module.config.json` or `android/build.gradle` — so it sat
in **no build graph at all**, while the JS side was a hardcoded
`Promise.reject` whose "no Android SDK" message had gone stale. Fixed by
adding the build target, writing the missing binding
(`CaptureNativeModule.kt`), and pointing Expo autolinking at the repo-root
`modules/` directory. Compiling it for the first time exposed two latent
defects in the never-compiled source: a public function exposing a
`private-in-class` return type, and a `minSdk` floor conflicting with the app.
**Result: native median_r/g/b = 120/40/201, an EXACT match with the Python
leg** (Android 15 / API 35 emulator, x86_64). That also root-causes T04's
original ±1/channel JS gap as a **jpeg-js decoder artifact** — Android
`BitmapFactory` and Pillow are both libjpeg-based and agree to the bit, while
only the pure-JS decoder differs. Median 23 ms/call; process memory recorded
in `tests/capture-golden.json` `native_leg`. **Still outstanding for T04:**
the card's "one real camera file" (the fixture is synthetic), EXIF
orientations other than 6 on the native leg, and a physical ARM device.
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
truncation is observable. **Superseded 2026-09-22:** at the time T07 was
written there was no device, emulator or Android SDK, so the S02 screen had
never been rendered. An emulator now exists and the screen has been rendered
and screenshotted on it (`docs/evidence/`); **a screen recording is still not
produced**, and stills on an emulator are not a substitute for it.
**PostgreSQL has never been run against** — no server, no psycopg driver — and
`sources.py` uses qmark paramstyle, which psycopg does not accept, so it will
not run on PostgreSQL as written. No dependency was added and no lockfile was
touched.

`apps/mobile/src/timer.ts` + `apps/mobile/src/protocol.tsx` +
`tests/protocol.test.ts` (T08) — read-window timing integrity and kit
eligibility. Elapsed time is reconciled from **two** clocks (monotonic as the
measurement of record, wall clock as cross-check) and yields a discriminated
`measured | indeterminate`, where reboot, wall-clock rollback, monotonic
regression, or divergence beyond tolerance all force `indeterminate` — which
blocks assisted interpretation while leaving the manual path open, per
protocol-schema.md line 50. Elapsed time is **computed from a clock reading,
never accumulated from ticks**, so backgrounding cannot silently under-count.
Kit eligibility checks lot expiry, verification status, lot↔protocol-version
match, protocol approval and validity window, reporting all failures at once.
39 Node tests. Test quality checked by source-level mutation testing: 16
mutants, all caught — two initially survived, one because a multi-line `sed`
never applied (a meaningless result, re-run properly) and one because of a
**real gap** (no test passed a `null` read window; test added).
**Every domain value is injected — there is no default or fallback read
window anywhere**, and a missing/malformed one yields `indeterminate` rather
than an assumed window. **T08 is NOT domain-complete: T01 is still fictional,
so no real kit, manufacturer, lot, expiry or read window exists.** The fixture
timings in the tests are declared test values, labelled as such, and passing
them is not domain validation. **Superseded 2026-09-22:** the S03 screen has
now been rendered on the Android emulator and its full timer lifecycle
(waiting → in-window → expired) captured from a single live run against the
short-window fixture — see `docs/evidence/`. The domain blocker is unchanged:
rendering correctly with fictional fixtures says nothing about any real kit.

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
- T08 (Kit protocol and read-window flow) — owner: agent (role A). **Its T01
  dependency gate is genuinely unmet, not waived:** this document already
  listed T08 as "blocked" on T01, and that is still true. The mechanism was
  built data-driven so no kit value is embedded, and verified against declared
  fixtures per the card's own verification line, but nothing about a real kit
  is validated. Gates whether an automated interpretation may occur and
  produces the `invalid` timing state, so it **requires independent review**
  per AGENTS.md's state-closure rule. See [handoff-T08.md](handoff-T08.md).

- T10 (Deterministic capture-quality rules) — owner/reviewer: Codex (role B),
  completed 23 September 2026 IST on `feature/t10-quality-native`. The Python
  fixture runner and compiled Kotlin mirror agree on decisions/reason codes;
  thresholds remain explicitly provisional. See [handoff-T10.md](handoff-T10.md).
- T11 (Indicative review and manual fallback) — owner/reviewer: Codex (role A),
  completed 24 September 2026 IST on `feature/t11-review`. The deterministic
  baseline, accessible review screen and camera-denied/uncertain/human-
  disagreement paths are tested and rendered. Only an explicitly supplied,
  valid versioned profile may produce a suggestion; the repository still has
  no real approved kit profile. See [handoff-T11.md](handoff-T11.md).
- T12 (Crash-safe local save) — owner/reviewer: Codex (role A/storage),
  completed 24 September 2026 IST on `feature/t12-local-save`. The asset is
  hashed before rename, sample/asset/outbox rows commit atomically, and no
  receipt is returned before commit. Fault injection covers both sides of
  rename and commit; startup recovery removes only owned unreferenced files,
  preserves unknown/referenced files and reports missing referenced assets.
  Expo exposes no public filesystem `fsync`, encryption remains T32, and no
  physical-device process kill has been claimed. See
  [handoff-T12.md](handoff-T12.md).

**Android toolchain and visual evidence (2026-09-22, explicitly authorized by
the user).** JDK 17, the Android SDK (platform 35, build-tools 35.0.0,
platform-tools, emulator), an `android-35 google_apis x86_64` system image and
an AVD (`jalsakshi_pixel`) were installed, and **the real native Android build
now succeeds and runs on the emulator** (`BUILD SUCCESSFUL`, APK installed,
`org.jalsakshi.mobile/.MainActivity` resumed). This **closes T03's long-standing
"no Android SDK/device" blocker** for emulator purposes and the "Java 17 gap"
in `docs/toolchain-matrix.md`. Screenshots of the T07 and T08 screens running
on the emulator, plus an Expo-web set driven by Playwright through
system-installed Edge, are in `docs/evidence/` with a full reproduction
procedure. Playwright is a **root** devDependency so the mobile lockfile (T03,
role B) stays untouched; no browser binary was downloaded.

**Sibling repository `meow` integrated (2026-09-22, branch `integrate-meow`,
user-requested).** `meow` and this repo are **siblings, not a fork** — no
common git ancestor — and implemented different slices of the same blueprint,
so they are complementary. Taken from `meow`: the API service skeleton
(`config.py`, `errors.py`, real `main.py`), the synthetic demo workflow
(`demo.py`, `demo-store.ts`, `sync-state.ts`, ONNX probe model, controlled
fixtures), `metro.config.js`, packaging, 12 API tests, and two reference docs.
**Its `patch-onnxruntime.mjs` resolves the onnxruntime/Gradle-9 blocker this
repo had recorded as open** — it is version-guarded, preserves real semantics,
refuses unrecognised source, and runs as `postinstall` so it survives
`npm install`. Its dependency set also supplies **`expo-crypto` (T06 PKCE) and
`expo-camera` (T07 QR)**, both previously recorded as blocked on a role-B
lockfile change; T06/T07 are **not yet rewired** onto them.
**T05's frozen `contracts/openapi.json` was protected:** this repo's
contract-generation stub moved to `services/api/app/contracts_app.py` so that
`main.py` could become the real service without silently adding `/health/*`
and `/demo/v1/*` to the frozen document; regeneration was re-run and verified
byte-identical. The merged app builds and runs on the emulator with both
halves reachable. 183 tests from this repo plus 13 from `meow` all pass.
Full detail: [handoff-integration-meow.md](handoff-integration-meow.md).

`apps/mobile/src/captureJob.ts` + `apps/mobile/src/capture.tsx` +
`tests/capture-flow.test.ts` (T09) — guided capture and manual ROI. The job
reducer enforces J02's rule that a retake supersedes an in-flight capture and
that cancelled/late output **cannot** overwrite it: a stale settle returns a
typed `discarded_superseded`/`discarded_cancelled` disposition and leaves
state byte-identical. At most one job is active by construction, so there is
no queue to bound. Failure reasons are typed and each carries a prompt that
names an action; `permission_denied` is recoverable and manual entry stays
open in every state. Manual ROI corners are validated (refused, never
clamped) and mapped into the upright frame — verified against T04's **real**
`correctOrientation` for all 8 EXIF orientations, pixel by pixel. 31 tests;
13 source-level mutants all caught (one initially survived on a **real gap**:
nothing tested cancelling a wrong job id, so a stale cancel could have killed
the active retake). **Permission recovery and missing-card→manual-ROI were
exercised on the Android emulator with permission genuinely revoked via adb**
— screenshots in `docs/evidence/`. **Cancel was NOT verified on device** (the
capture settles faster than two adb taps); it is unit-tested only. No real
assisted reading was possible at that point because the native module had not
yet been compiled and no reference-card locator existed. The native feature
bridge and T10 rules now compile; the capture screen still does not locate the
card or consume T10 outcomes.

`modules/capture-native/android/src/main/java/org/jalsakshi/capture/Quality.kt`,
`ml/quality_baseline.py`, `ml/quality_fixtures_run.py` and
`tests/quality-fixtures.json` (T10) — deterministic blur, clipping, glare, ROI
and reference-card rules now exist in Python and compiled Kotlin. Eight
synthetic fixtures cover accept/review/retake, absent/partial/unreadable cards,
unset thresholds and all named quality reasons. Four native unit tests pass.
A deliberately sharp but low-texture card is recorded as a false reject for
T23, proving the provisional Laplacian rule measures texture rather than focus.
No rule returns a class, bin, concentration or water judgement. Thresholds are
synthetic and provisional until T23/T27; this is not real-kit validation.

**Supabase connected (2026-09-22, user-supplied credentials, explicitly
authorised).** **PostgreSQL 17.6.** The project reference is deliberately not
recorded here — this repository is public, and naming the project identifies
it without adding anything a contributor needs; it lives in the gitignored
`.env`. Config is
read from a **gitignored `.env`** via `config.py`'s `JALSAKSHI_` env prefix;
`.env.example` is the committed template and contains placeholders only. No
credential is in any tracked file — verified against the staged diff before
pushing. Two corrections were needed to the supplied connection details: the
string was missing the `:` between username and password, and the direct host
`db.<ref>.supabase.co` **does not resolve** (Supabase direct connection is
IPv6-only), so the working route is the **pooler**
`aws-0-ap-northeast-1.pooler.supabase.com:5432` with username
`postgres.<project-ref>`.

**Security actions outstanding:** the database password was pasted into a chat
transcript and **must be rotated** — it is compromised regardless of what the
repo does. **Data residency:** the project is in **Tokyo (ap-northeast-1)**,
not India; `security-and-privacy.md` treats residency as material for this
programme, so the region likely needs revisiting (a region change means a new
Supabase project). Everything stored so far is **synthetic fixture data** —
`.env` sets `environment=development` and `tenant_data_mode=synthetic`, and
`config.py` refuses to start production unless the mode is `operational`.
This work touches migrations and security, so it **requires independent
review** per AGENTS.md.

**Render deploy fixed (2026-09-24, ef5de2d).** The `meow` Dockerfile ran
`app.main` from `/app`, making `app` the top-level package, so `..migrations`
imports crash-looped every worker. It now installs the source at
`/app/services/api` and runs `services.api.app.main:app`. Verified by
reproducing the container layout locally (no Docker on this host): two uvicorn
workers start, `/health/live` 200. **Not verified on Render itself** (not
pushed at time of writing). Production still needs `DATABASE_URL`,
`OIDC_ISSUER` and `OIDC_AUDIENCE` set or `config.py` refuses to start, and
every `/v1/*` route answers 503 there until a real IdP is wired (T06 blocker).
Release config change: **requires independent review** per AGENTS.md.

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
  For M1 only, `services/api/app/dev_issuer.py` (ADR-M1-002) issues synthetic
  tokens in development+synthetic; it is **not** a provider decision.
- **T06's mobile client is still not wired into the app** — but the
  dependency half of this blocker is **partly resolved** (2026-09-22, `meow`
  integration): `expo-crypto` is now installed, which is what PKCE S256 needs
  since Hermes has no `crypto.subtle`. Still absent: `expo-auth-session`,
  `expo-web-browser`, `expo-secure-store`. The T06 module has **not** been
  rewired onto `expo-crypto` yet — that is follow-up work. Consequently token
  storage is also unimplemented;
  nothing should be persisted to disk until `expo-secure-store` exists.
  Hermes has no `crypto.subtle`, so S256 needs a native module regardless.
- **JWKS fetching/caching is unimplemented (T06).** `auth.py` does no network
  I/O by design, so a JWKS outage cannot become a silent auth bypass, but
  whoever wires the real provider must choose the failure mode explicitly.
- T06 has not had the independent auth review AGENTS.md requires, and its
  `to-do.md` checkbox is deliberately left unchecked.
- **T07/T08 screen recordings still outstanding, though the screens now render.**
  As of 2026-09-22 an emulator exists and both screens have been rendered and
  screenshotted on it (`docs/evidence/`). What is captured is **stills, not a
  recording**, and an emulator is **not a device** — no real camera, no real
  sensors, x86_64 rather than ARM. The original verification line asks for a
  screen recording; that is not yet produced, and emulator stills are not
  silently substituted for it.
- ~~`onnxruntime-react-native@1.24.3` breaks the Android build on Gradle 9.~~
  **RESOLVED 2026-09-22 by the `meow` integration.**
  `apps/mobile/scripts/patch-onnxruntime.mjs` runs as `postinstall`, so the
  fix now survives `npm install` and the Android build **is** reproducible
  from a clean checkout. The patch is version-guarded to 1.24.3 and refuses to
  apply to unrecognised source. Remove it once onnxruntime ships its own
  Gradle 9 fix (a `ponytail:` marker in the script says so).
- The demo harness in `apps/mobile/App.tsx` is **temporary scaffolding**, not
  the app's real root component. It wires T07/T08 screens to fictional
  fixtures purely so they can be viewed, and must be reverted before real
  provisioning (S01) and navigation are built.
- ~~No PostgreSQL anywhere in this environment (T07).~~ **RESOLVED
  2026-09-22.** The user supplied a Supabase project and authorised connecting
  it. `psycopg` installed; the `sources` migration now runs on **real
  PostgreSQL 17.6**, and `tests/sources_postgres_test.py` (12 tests) passes
  against it. The qmark/pyformat gap is fixed by `_adapt` in `sources.py`,
  verified on both backends rather than written blind.
  **Three divergences SQLite structurally could not catch, found immediately:**
  (1) the schema's `uuid` columns **reject** T07's friendly fixture ids like
  `src-a1` — SQLite maps `uuid`→`text` and accepts anything, so the SQLite
  suite passes with data the real schema refuses; (2) psycopg returns
  `uuid.UUID` objects where SQLite returns `str`, so `Source.id` was not
  actually a `str` on PostgreSQL despite the dataclass declaring it —
  `_row_to_source` now coerces; (3) PostgreSQL aborts the whole transaction on
  any error, which SQLite does not, so the test harness needed rollbacks
  between cases.
  **Still open from this:** `tests/sources_test.py` (SQLite) continues to use
  non-UUID ids, so the two suites disagree about what a valid id is. That
  should be reconciled — the schema is authoritative per data-model.md.
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
- No QR scanner is wired in. **`expo-camera` is now installed** (2026-09-22,
  `meow` integration), so the dependency blocker is gone, but T07's
  `resolveScan` has not been connected to a live camera feed yet.
- T07's catalogue is invented test data, not a real assigned one. No real
  tenant, village or source list exists; nothing in T07 is field-validated.
- T07 has not had independent review and its `to-do.md` checkbox is
  deliberately left unchecked.
- **T09's cancel path was never verified on a device.** The capture settles
  faster than two sequential `adb` taps, so the Cancel button was gone before
  the tap landed. Covered by three unit tests only. Needs a human tapping
  Cancel during a slow capture, or an instrumented test harness.
- **T09 could not exercise a non-1 EXIF orientation on device** — the emulator
  camera always reports orientation 1. Photo-rotation normalisation is
  verified against T04's real transform in unit tests, not on hardware. The
  device "rotate" check only proved the app survives a rotation config change
  with state intact, because `app.config.ts` sets `orientation: "portrait"`
  and the app is deliberately portrait-locked.
- **No geometric reference-card locator exists.** T10 now classifies supplied
  reference-patch colours and produces glare/blur/clipping reason codes, but
  the native bridge still takes ROI corners as input and does not find the card
  in a photograph. T09's manual ROI remains the interim path, not a substitute.
- **Metro could not resolve `modules/` from `apps/mobile` until T09 fixed it.**
  Metro sandboxes to its project root, so the app's import of the native
  bridge failed at runtime even though Node and `tsc` resolved it (which is
  why tests and type-checks did not catch it). Fixed via `watchFolders` in
  `apps/mobile/metro.config.js` — a file no task card claims.
- `MIN_ROI_AREA_PX = 16` in `captureJob.ts` is an engineering floor chosen by
  the agent, not a domain threshold. Real quality thresholds
  (`min_roi_pixels`, blur, glare) belong to the protocol's `quality_policy`
  and T10 fitted only provisional synthetic values. T23/T27 must replace or
  approve them using real captures.
- T09's ROI editor is tap-to-move rather than drag, and capture state is not
  persisted (durable drafts are T12). T09 has not had independent review and
  its `to-do.md` checkbox is deliberately left unchecked.
- **T08 is domain-blocked on T01 and cannot be completed until a real kit
  protocol exists.** No real kit, manufacturer, lot, expiry or read window has
  been selected. The mechanism is real and tested; the domain is not. Passing
  `tests/protocol.test.ts` is explicitly **not** evidence that any physical
  kit's read window is honoured.
- **Spec ambiguity in `protocol-schema.md` (found by T08, unresolved):** the
  document defines `timing_valid = true` inside `read_at ± tolerance` and
  `false` after `invalid_after_seconds`, but says nothing about the band
  between them — though the schema plainly intends them to differ or
  `invalid_after` would be redundant. T08 resolves it conservatively as
  `late` with `timingValid = false` (only the explicitly-stated true case is
  true, so no false "valid" is possible), but whether a late strip is re-read,
  discarded, or recorded manually **needs T01/domain sign-off**.
- **T08's monotonic clock source is not bound to the platform.** The Android
  source must be `SystemClock.elapsedRealtime()` (counts during deep sleep),
  **not** `uptimeMillis()`; using the wrong one would under-count a test left
  running while the phone slept. Binding it needs a native module — **role B's
  boundary — and needs agreement before wiring.**
- `CLOCK_AGREEMENT_TOLERANCE_MS = 2000` in `timer.ts` is an engineering
  constant chosen by the agent, not a domain value, and has not been validated
  against real device clock behaviour. Erring small only moves toward
  `indeterminate`, which is the safe direction.
- T08's S03 screen is not reachable from `App.tsx` and an attempt lives in
  component state only, so a process kill loses it. Durable attempt storage is
  T12's boundary. Server-side re-checking of expiry/timing on ingestion is
  T13's boundary and does not exist.
- T08 has not had independent review and its `to-do.md` checkbox is
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

For T08: when T01 supplies a **real** transcribed protocol, replace the
fixture in `tests/protocol.test.ts` with the real read window and re-run —
`timer.ts` needs no change, because no kit value is embedded in it. Get domain
sign-off on the late-vs-expired band before then. Separately, agree the
monotonic clock binding with role B (`SystemClock.elapsedRealtime()`, not
`uptimeMillis()`).

For T09: tap Cancel during an in-flight capture on a real device (or wire an
instrumented test) to close the one device check that was not exercised, and
capture a photo with a non-1 EXIF orientation on real hardware to confirm the
ROI mapping end to end. Both are blocked on a physical phone, not on code.

T09 added this command: `node tests/capture-flow.test.ts`.

T08 added this command: `node tests/protocol.test.ts`.

T07 added these commands: `python -m unittest tests.sources_test`, `node
tests/sources_client.test.ts`, and `cd apps/mobile && npx tsc --noEmit -p
tsconfig.json` (the first type-check of the mobile app's own sources).

T05 established the first real, recorded test commands for this repo (see
`docs/agent-workflow/handoff-T05.md` for the full list): `python -m
unittest services.api.app.tests.test_schemas -v`, `node
tests/contracts.test.ts`, `npx tsc --noEmit`, and the exact two-step
regeneration commands for `contracts/openapi.json` /`contracts/client.ts`.
Future tasks should extend these, not invent parallel ones.
