# Handoff — T08 Kit protocol and read-window flow

Owner: agent, role A (product/mobile). Requirement REQ-002, acceptance AC-002.
Date: 2026-09-22.

**Status: the timing/eligibility MECHANISM is implemented and tested against
declared fixtures. T08 is NOT domain-complete and must not be read as "the kit
protocol flow works".** No real kit exists to flow through it.

## Dependency gate — this one is genuinely unmet

The card gates T08 on **T01 T07**. T07 is complete (unreviewed). **T01 is
not.** `docs/agent-workflow/current-state.md` states in terms that
`docs/protocol-selection.md` is a *fictional demo template* and explicitly
lists **T08 as a downstream task that "remains blocked"** on it.

I did not treat that as satisfied, and I did not fabricate a kit to get past
it. What I did instead:

- Built the mechanism so that **every domain value is injected**, never
  embedded. There is no default read window, no fallback read window, and no
  hardcoded expiry, tolerance or threshold anywhere in `timer.ts`. A missing
  or malformed read window produces `indeterminate` — never an assumed one.
- Verified it with **declared fixture timing**, which is what the card's own
  verification line asks for, and labelled those fixtures as fictional in a
  banner at the top of the test file.

**What therefore remains unverified:** that the mechanism matches any real
kit's actual read window, preparation step, or expiry semantics. The fixture
(`prepare 10s, read at 60s ±10s, invalid after 180s`) is arbitrary structure,
matching protocol-schema.md's own warning that its example "60 is not any
selected kit's read time". Passing these tests is **not** domain validation.

## Changed files

| File | What |
|---|---|
| `apps/mobile/src/timer.ts` | **New.** Clock-integrity elapsed time, read-window verdict, kit eligibility, attempt lifecycle |
| `apps/mobile/src/protocol.tsx` | **New.** S03 screen (JSX/wiring only) |
| `tests/protocol.test.ts` | **New.** 39 tests |

**Exactly the card's three files. No scope additions, no new dependency, no
lockfile touched.** `timer.ts` being on the card is what let the testable
logic live in scope this time, unlike T07 where a split was needed.

## Exact commands and results

Build host: Windows 11, MINGW64_NT-10.0-26200. Node v24.19.0, Python 3.13.7.
Base commit `4d5b35019e5a...` (branch `main`, the T04–T07 commit).

```
node tests/protocol.test.ts                              -> 39/39 passed
npx tsc --noEmit                                         -> 0 errors
cd apps/mobile && npx tsc --noEmit -p tsconfig.json      -> 0 errors

# regressions, unchanged by T08
node tests/sources_client.test.ts                        -> 22/22 passed   (T07)
python -m unittest tests.sources_test                    -> Ran 43 ... OK  (T07)
node tests/auth_client.test.ts                           -> 12/12 passed   (T06)
python -m unittest tests.auth_test                       -> Ran 44 ... OK  (T06)
python -m unittest services.api.app.tests.test_schemas   -> Ran 15 ... OK  (T05)
node tests/contracts.test.ts                             -> ALL CHECKS PASSED (T05)
```

`tsc --listFiles` confirms both `apps/mobile/src/timer.ts` and
`tests/protocol.test.ts` are actually covered.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| **Expired kit blocked** | Lot expiry, lot verification status, lot↔protocol-version mismatch, protocol approval, and protocol validity window (both ends) each block independently. Boundary tested: the expiry **instant itself is still usable**, one millisecond past is not. An unparseable expiry is treated as **expired**, not as "no expiry". **Perfect timing does not rescue an expired kit** — a dedicated test asserts `timingValid: true` while `assistedPermitted: false`. All blocking reasons are reported together rather than one screen at a time |
| **App background timing correct** | Elapsed time is **computed from a clock reading, never accumulated from ticks** — a tick-accumulating implementation would report ~5 s across a 5s→65s suspension and wrongly say "keep waiting"; the test asserts 65 s and `in_window`. A long background past the window reports `expired`, not still-waiting. Monotonic (`elapsedRealtime`-style) is the measurement of record so device sleep is counted |
| **Clock/reboot ambiguity invalidates interpretation** | Four independent indeterminate reasons, each tested: `reboot` (boot id change), `clock_rollback` (wall moved backwards), `clock_disagreement` (wall vs monotonic diverge beyond tolerance), `monotonic_regression`. **A reboot is not rescued by a plausible wall clock** — even when the wall clock says exactly 60 s, a monotonic reset forces `indeterminate`, because the clock may have been adjusted while the device was off. Indeterminate never exposes a seconds figure. Missing `bootId` falls back to the conservative path |

## Verification from the card

`Boundary-time and restart tests with declared fixture timing.`

1. **Boundary-time — done.** The `[50, 70]` window is tested inclusive at both
   ends plus one step outside each (`49.999` → `waiting`, `70.001` → `late`);
   the prepare boundary at `10`; and the `invalid_after` boundary at `180`
   (still `late`) versus `180.001` (`expired`). `timingValid` is asserted
   `false` across nine out-of-window values and `true` across five in-window
   ones. Clock-skew tolerance is tested exactly at the limit and one
   millisecond past it.
2. **Restart — done.** A restart yields a **new attempt id**, records
   `supersedesAttemptId`, and leaves the abandoned attempt untouched (it is
   evidence, not litter). Reusing an id throws. A restarted attempt re-times
   from **its own** start. A dedicated test assesses an expired attempt three
   times and asserts it stays expired with an unchanged id — an
   auto-restarting implementation would silently re-open the window.

## Mutation testing

`timer.ts` was re-run against 16 deliberately broken copies (source edits,
reverted). **All 16 CAUGHT:** reboot check removed; rollback check removed;
clock-disagreement ignored; monotonic-regression ignored; window off-by-one at
each end; `late` counted as valid; eligibility ignored in `assistedPermitted`;
lot expiry unchecked; unapproved protocol allowed; validity end ignored;
lot/protocol mismatch allowed; malformed window accepted; all `timingValid`
forced true; `assistedPermitted` forced true on indeterminate; wall-clock
fallback after reboot.

Two mutants initially survived; **both were my errors, not clean results**:

- One mutation used a multi-line `sed` that silently **never applied** — the
  "SURVIVED" was meaningless. Re-run with a valid single-line mutation: caught.
- The other was a **real test gap**: no test passed a `null`/`undefined`
  `read_window`, so removing that guard went unnoticed. Test added; caught.

The `protocol.tsx` source guard was likewise verified by injecting a hidden
`restartAttempt` into the render interval — the guard failed as intended, then
the file was restored.

## Spec ambiguity, resolved conservatively — needs T01/domain sign-off

`protocol-schema.md` line 50 states that inside `read_at ± tolerance` is
`timing_valid = true`, and that after `invalid_after_seconds` is
`timing_valid = false`. **It does not say what the band between
`read_at + tolerance` and `invalid_after` means** — yet the schema clearly
intends the two to differ, or `invalid_after` would be redundant.

I resolved this as `late` with `timingValid = false`: only the explicitly
stated true case is true. That **cannot produce a false "valid"**, which is
the one error this module must never make. But whether a late strip should be
re-read, discarded, or recorded manually with a caveat is a real domain
question I am not in a position to answer. **Flagged for T01 sign-off.**

## Blockers — none hidden

1. **T01 is fictional; T08 cannot be domain-complete.** No real kit,
   manufacturer, lot, expiry or read window exists. The fixture timings are
   declared test values and are labelled as such in the test file banner.
2. **The S03 screen has never been rendered.** No device, emulator or Android
   SDK (verified in T07: `adb`/`emulator` absent, `ANDROID_HOME` unset).
   `protocol.tsx` is type-checked and source-guarded but never executed.
3. **The real monotonic clock is not wired.** `ClockReading` is supplied by
   the host. On Android the monotonic source must be
   `SystemClock.elapsedRealtime()` (counts during deep sleep) and **not**
   `uptimeMillis()` (does not) — using the wrong one would under-count a test
   left running while the phone slept. That binding needs a native module and
   is **role B's boundary**, plus `expo-keep-awake`/background considerations
   not yet in any lockfile. **Not implemented; needs agreement with role B.**
4. **`CLOCK_AGREEMENT_TOLERANCE_MS = 2000` is an engineering constant I
   chose**, not a domain value — it is the slack between the two clocks before
   declaring disagreement. It is named, documented and configurable per call.
   Erring small only moves toward `indeterminate` (the safe direction), but it
   has not been validated against real device clock behaviour.
5. **Not wired to any screen or navigation.** `protocol.tsx` is not reachable
   from `App.tsx`; nothing routes into it. No persistence: an attempt lives in
   component state only, so a process kill loses it. Durable attempt storage
   is T12's (`storage.ts`/`outbox.ts`) boundary, not T08's.
6. **No server-side enforcement.** These are client-side gates. A wrong device
   clock can misjudge calendar expiry, so the server must re-check on
   ingestion — that is T13's boundary and does not exist yet.

## Independent review

AGENTS.md requires independent review for **state closure**. T08 decides
whether an automated interpretation may occur and whether a timing record is
valid/invalid — it gates provenance and produces the `invalid` timing state
that AC-002 turns into "requests a new test". **Flagged for independent
review**, together with the spec ambiguity above.

## Proposed status update (for the reviewer, not applied)

I have **not** checked the T08 box in `to-do.md`; the card reserves it for
after review, and `jalsakshi-blueprint/` is a reference package this repo does
not edit. Proposed wording:

> T08 — read-window timing and kit-eligibility mechanism implemented and
> tested against declared fixtures; **domain-blocked on T01** (no real kit,
> lot or read window); screen never rendered; monotonic clock source not yet
> bound (role B); late-vs-expired band awaiting domain sign-off.

## Artifact locations

- Code: `apps/mobile/src/timer.ts`, `apps/mobile/src/protocol.tsx`
- Tests: `tests/protocol.test.ts` (39)
- Evidence: the command block above, reproducible from commit `4d5b350` plus
  these three files.
