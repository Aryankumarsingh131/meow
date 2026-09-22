/**
 * T08 verification: boundary-time and restart tests with declared fixture
 * timing.
 *
 * ############################################################bin###########
 * # THE TIMING VALUES BELOW ARE DECLARED TEST FIXTURES.                    #
 * # They are NOT any real kit's read window. No real kit, manufacturer,    #
 * # lot or protocol has been selected - T01 is still a fictional template  #
 * # (docs/agent-workflow/current-state.md). protocol-schema.md line 50 is  #
 * # explicit that its own example values are "structural placeholders" and #
 * # that "60 is not any selected kit's read time".                         #
 * #                                                                        #
 * # These fixtures verify the MECHANISM (boundary arithmetic, clock        #
 * # integrity, restart semantics). They verify nothing about any physical  #
 * # kit, and passing them is not domain validation.                        #
 * ##########################################################################
 *
 * Run:  node tests/protocol.test.ts
 */

import assert from "node:assert/strict";

import {
  CLOCK_AGREEMENT_TOLERANCE_MS,
  assessAttempt,
  elapsedBetween,
  evaluateEligibility,
  evaluateTiming,
  restartAttempt,
  startAttempt,
  type ClockReading,
  type KitLot,
  type Protocol,
} from "../apps/mobile/src/timer.ts";

// --- declared fixtures -----------------------------------------------------

/** Fictional. prepare 10s, read at 60s ±10s, invalid after 180s. */
const FIXTURE_WINDOW = {
  prepare_seconds: 10,
  read_at_seconds: 60,
  tolerance_seconds: 10,
  invalid_after_seconds: 180,
};

const NOW = Date.parse("2026-09-22T12:00:00Z");
const PROTOCOL: Protocol = {
  id: "proto-fixture-0001",
  version: 1,
  manufacturer: "FICTIONAL TEST MANUFACTURER",
  kit: "FICTIONAL TEST KIT",
  parameter: "fixture_parameter",
  read_window: FIXTURE_WINDOW,
  validity: { from: "2026-01-01T00:00:00Z", until: "2027-01-01T00:00:00Z" },
  approved_by: {
    actor: "fixture-approver",
    role: "domain_reviewer",
    at: "2026-01-01T00:00:00Z",
    source_document: "FICTIONAL - no real manufacturer instruction sheet exists",
  },
};

const LOT: KitLot = {
  id: "lot-fixture-0001",
  protocol_id: PROTOCOL.id,
  protocol_version: 1,
  lot: "FIXTURE-LOT-A",
  expiry: "2026-12-31T00:00:00Z",
  verification_status: "verified",
};

const START: ClockReading = { wallMs: NOW, monotonicMs: 500_000, bootId: "boot-1" };

/** A clock reading `seconds` after START with both clocks advancing together. */
function after(seconds: number, overrides: Partial<ClockReading> = {}): ClockReading {
  return {
    wallMs: START.wallMs + seconds * 1000,
    monotonicMs: START.monotonicMs + seconds * 1000,
    bootId: "boot-1",
    ...overrides,
  };
}

function timingAt(seconds: number, overrides: Partial<ClockReading> = {}) {
  const attempt = startAttempt("attempt-1", PROTOCOL, LOT, START);
  return assessAttempt(attempt, PROTOCOL, LOT, after(seconds, overrides)).timing;
}

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// --- AC 2: boundary timing -------------------------------------------------

test("read-window boundaries are exact and inclusive", () => {
  // Window is 60 ± 10 => [50, 70] inclusive.
  assert.equal(timingAt(49.999).state, "waiting");
  assert.equal(timingAt(50).state, "in_window", "lower boundary must be inside");
  assert.equal(timingAt(60).state, "in_window");
  assert.equal(timingAt(70).state, "in_window", "upper boundary must be inside");
  assert.equal(timingAt(70.001).state, "late");
});

test("only in_window yields timingValid", () => {
  for (const seconds of [0, 5, 9.999, 49.999, 70.001, 100, 180, 180.001, 5000]) {
    assert.equal(timingAt(seconds).timingValid, false, `t=${seconds} claimed valid`);
  }
  for (const seconds of [50, 55, 60, 65, 70]) {
    assert.equal(timingAt(seconds).timingValid, true, `t=${seconds} not valid`);
  }
});

test("preparing / waiting / late / expired boundaries", () => {
  assert.equal(timingAt(0).state, "preparing");
  assert.equal(timingAt(9.999).state, "preparing");
  assert.equal(timingAt(10).state, "waiting", "prepare boundary");
  assert.equal(timingAt(180).state, "late", "invalid_after boundary is still late");
  assert.equal(timingAt(180.001).state, "expired");
});

test("secondsUntilWindow counts down and then stops", () => {
  assert.equal(timingAt(0).secondsUntilWindow, 50);
  assert.equal(timingAt(30).secondsUntilWindow, 20);
  assert.equal(timingAt(50).secondsUntilWindow, null, "no countdown once open");
  assert.equal(timingAt(100).secondsUntilWindow, null);
});

test("manual path stays open in every timing state", () => {
  for (const seconds of [0, 50, 100, 5000]) {
    assert.equal(timingAt(seconds).manualPermitted, true);
  }
  // Including when elapsed time is unknowable.
  assert.equal(timingAt(60, { bootId: "boot-2" }).manualPermitted, true);
});

// --- AC 2: backgrounding ---------------------------------------------------

test("backgrounding does not lose time: elapsed is computed, not accumulated", () => {
  // The app is suspended from t=5s to t=65s. No JS timer ticks fire in that
  // window. A tick-accumulating implementation would report ~5s and wrongly
  // say "keep waiting"; computing from the clock reports 65s.
  const verdict = timingAt(65);
  assert.equal(verdict.elapsed.kind, "measured");
  assert.equal(verdict.elapsed.kind === "measured" ? verdict.elapsed.seconds : -1, 65);
  assert.equal(verdict.state, "in_window");
});

test("long background past the window reports expired, not still-waiting", () => {
  const verdict = timingAt(600);
  assert.equal(verdict.state, "expired");
  assert.equal(verdict.timingValid, false);
  assert.equal(verdict.assistedPermitted, false);
});

test("elapsed is measured from the monotonic clock", () => {
  const verdict = timingAt(60);
  assert.equal(verdict.elapsed.kind === "measured" ? verdict.elapsed.source : null, "monotonic");
});

test("device sleep is counted: monotonic advances while wall does too", () => {
  // elapsedRealtime keeps counting during deep sleep, which is why it is the
  // measurement of record rather than uptimeMillis.
  const verdict = timingAt(60);
  assert.equal(verdict.elapsed.kind, "measured");
});

// --- AC 3: clock / reboot ambiguity ----------------------------------------

test("reboot mid-test invalidates timing", () => {
  const verdict = timingAt(60, { bootId: "boot-2", monotonicMs: 1000 });
  assert.equal(verdict.state, "indeterminate");
  assert.equal(verdict.timingValid, false);
  assert.equal(verdict.assistedPermitted, false);
  assert.equal(verdict.indeterminateReason, "reboot");
});

test("reboot is not rescued by a plausible wall clock", () => {
  // Wall clock says exactly 60s - right in the window. Monotonic reset proves
  // a reboot, so the wall clock cannot be trusted and must not be fallen back
  // to: it may have been adjusted while the device was off.
  const verdict = timingAt(60, { bootId: "boot-2", monotonicMs: 3000 });
  assert.equal(verdict.state, "indeterminate");
  assert.equal(verdict.timingValid, false);
});

test("wall clock rollback invalidates timing", () => {
  const reading = after(60, { wallMs: START.wallMs - 30_000 });
  const elapsed = elapsedBetween(START, reading);
  assert.equal(elapsed.kind, "indeterminate");
  assert.equal(elapsed.kind === "indeterminate" ? elapsed.reason : null, "clock_rollback");
});

test("clock disagreement beyond tolerance invalidates timing", () => {
  // Monotonic says 60s, wall says 3600s: someone changed the clock (or DST).
  const reading = after(60, { wallMs: START.wallMs + 3_600_000 });
  const elapsed = elapsedBetween(START, reading);
  assert.equal(elapsed.kind, "indeterminate");
  assert.equal(elapsed.kind === "indeterminate" ? elapsed.reason : null, "clock_disagreement");
});

test("small clock skew within tolerance is still measured", () => {
  const skew = CLOCK_AGREEMENT_TOLERANCE_MS - 1;
  const reading = after(60, { wallMs: START.wallMs + 60_000 + skew });
  const elapsed = elapsedBetween(START, reading);
  assert.equal(elapsed.kind, "measured", "ordinary NTP micro-adjustment must not invalidate");
});

test("skew exactly at tolerance is accepted, one past it is not", () => {
  const atLimit = after(60, { wallMs: START.wallMs + 60_000 + CLOCK_AGREEMENT_TOLERANCE_MS });
  assert.equal(elapsedBetween(START, atLimit).kind, "measured");
  const pastLimit = after(60, { wallMs: START.wallMs + 60_000 + CLOCK_AGREEMENT_TOLERANCE_MS + 1 });
  assert.equal(elapsedBetween(START, pastLimit).kind, "indeterminate");
});

test("monotonic regression without a boot change is caught", () => {
  const reading = after(60, { monotonicMs: START.monotonicMs - 1000 });
  const elapsed = elapsedBetween(START, reading);
  assert.equal(elapsed.kind, "indeterminate");
  assert.equal(elapsed.kind === "indeterminate" ? elapsed.reason : null, "monotonic_regression");
});

test("missing bootId falls back to the conservative check", () => {
  // Platform could not supply a boot id. A monotonic reset must still be
  // caught rather than assumed to be the same boot.
  const start: ClockReading = { ...START, bootId: null };
  const reading: ClockReading = { wallMs: START.wallMs + 60_000, monotonicMs: 100, bootId: null };
  const elapsed = elapsedBetween(start, reading);
  assert.equal(elapsed.kind, "indeterminate");
  assert.equal(elapsed.kind === "indeterminate" ? elapsed.reason : null, "reboot");
});

test("indeterminate timing never carries a seconds figure", () => {
  const verdict = timingAt(60, { bootId: "boot-2" });
  assert.equal(verdict.elapsed.kind, "indeterminate");
  assert.ok(!("seconds" in verdict.elapsed), "a guessed elapsed time must not be exposed");
  assert.equal(verdict.secondsUntilWindow, null);
});

// --- AC 1: expired / unsupported kit --------------------------------------

test("expired lot blocks assisted interpretation but not manual", () => {
  const expired: KitLot = { ...LOT, expiry: "2026-01-01T00:00:00Z" };
  const eligibility = evaluateEligibility(PROTOCOL, expired, NOW);
  assert.equal(eligibility.state, "blocked");
  assert.ok(eligibility.state === "blocked" && eligibility.reasons.includes("lot_expired"));
  assert.equal(eligibility.state === "blocked" ? eligibility.manualPermitted : null, true);
});

test("expiry boundary: the expiry instant itself is still usable", () => {
  const atExpiry: KitLot = { ...LOT, expiry: new Date(NOW).toISOString() };
  assert.equal(evaluateEligibility(PROTOCOL, atExpiry, NOW).state, "eligible");
  const justPast: KitLot = { ...LOT, expiry: new Date(NOW - 1).toISOString() };
  assert.equal(evaluateEligibility(PROTOCOL, justPast, NOW).state, "blocked");
});

test("perfect timing does not rescue an expired kit", () => {
  const expired: KitLot = { ...LOT, expiry: "2026-01-01T00:00:00Z" };
  const attempt = startAttempt("attempt-1", PROTOCOL, expired, START);
  const { eligibility, timing } = assessAttempt(attempt, PROTOCOL, expired, after(60));
  assert.equal(timing.state, "in_window");
  assert.equal(timing.timingValid, true, "the timing itself really was valid");
  // ...but the kit was not eligible, so no assisted interpretation.
  assert.equal(eligibility.state, "blocked");
  assert.equal(timing.assistedPermitted, false);
  assert.equal(timing.manualPermitted, true);
});

test("unparseable expiry is treated as expired, not as no-expiry", () => {
  const bad: KitLot = { ...LOT, expiry: "not-a-date" };
  const eligibility = evaluateEligibility(PROTOCOL, bad, NOW);
  assert.ok(eligibility.state === "blocked" && eligibility.reasons.includes("lot_expired"));
});

test("unapproved protocol blocks assisted interpretation", () => {
  const unapproved: Protocol = { ...PROTOCOL, approved_by: null };
  const eligibility = evaluateEligibility(unapproved, LOT, NOW);
  assert.ok(eligibility.state === "blocked" && eligibility.reasons.includes("protocol_unapproved"));
});

test("protocol validity window is enforced at both ends", () => {
  const notYet: Protocol = { ...PROTOCOL, validity: { from: "2027-01-01T00:00:00Z", until: null } };
  const notYetResult = evaluateEligibility(notYet, LOT, NOW);
  assert.equal(notYetResult.state, "blocked");
  assert.ok(
    notYetResult.state === "blocked" && notYetResult.reasons.includes("protocol_not_yet_valid"),
  );

  const ended: Protocol = {
    ...PROTOCOL,
    validity: { from: "2026-01-01T00:00:00Z", until: "2026-02-01T00:00:00Z" },
  };
  const endedResult = evaluateEligibility(ended, LOT, NOW);
  assert.equal(endedResult.state, "blocked");
  assert.ok(
    endedResult.state === "blocked" && endedResult.reasons.includes("protocol_validity_ended"),
  );
});

test("open-ended validity (until: null) does not expire", () => {
  const openEnded: Protocol = { ...PROTOCOL, validity: { from: "2026-01-01T00:00:00Z", until: null } };
  assert.equal(evaluateEligibility(openEnded, LOT, NOW).state, "eligible");
});

test("lot from a different protocol version is refused", () => {
  const mismatched: KitLot = { ...LOT, protocol_version: 2 };
  const eligibility = evaluateEligibility(PROTOCOL, mismatched, NOW);
  assert.ok(eligibility.state === "blocked" && eligibility.reasons.includes("lot_protocol_mismatch"));
});

test("unverified and rejected lots are distinguished, not merged", () => {
  const unverified = evaluateEligibility(PROTOCOL, { ...LOT, verification_status: "unverified" }, NOW);
  const rejected = evaluateEligibility(PROTOCOL, { ...LOT, verification_status: "rejected" }, NOW);
  assert.ok(unverified.state === "blocked" && unverified.reasons.includes("lot_unverified"));
  assert.ok(rejected.state === "blocked" && rejected.reasons.includes("lot_rejected"));
});

test("all blocking reasons are reported together, not one at a time", () => {
  const bad: KitLot = { ...LOT, expiry: "2026-01-01T00:00:00Z", verification_status: "unverified" };
  const badProtocol: Protocol = { ...PROTOCOL, approved_by: null };
  const eligibility = evaluateEligibility(badProtocol, bad, NOW);
  assert.ok(eligibility.state === "blocked");
  const reasons = eligibility.state === "blocked" ? eligibility.reasons : [];
  for (const expected of ["lot_expired", "lot_unverified", "protocol_unapproved"]) {
    assert.ok(reasons.includes(expected as never), `missing ${expected}`);
  }
});

// --- malformed read windows: no invented defaults --------------------------

test("a malformed read window yields indeterminate, never an assumed window", () => {
  const windows = [
    { ...FIXTURE_WINDOW, read_at_seconds: -1 },
    { ...FIXTURE_WINDOW, invalid_after_seconds: 5 }, // before its own tolerance band
    { ...FIXTURE_WINDOW, tolerance_seconds: Number.NaN },
    { ...FIXTURE_WINDOW, read_at_seconds: Number.POSITIVE_INFINITY },
  ];
  for (const read_window of windows) {
    const protocol: Protocol = { ...PROTOCOL, read_window };
    const eligibility = evaluateEligibility(protocol, LOT, NOW);
    assert.ok(
      eligibility.state === "blocked" && eligibility.reasons.includes("read_window_malformed"),
      `accepted malformed window ${JSON.stringify(read_window)}`,
    );
    const verdict = evaluateTiming(protocol, eligibility, { kind: "measured", seconds: 60, source: "monotonic" });
    assert.equal(verdict.state, "indeterminate");
    assert.equal(verdict.timingValid, false);
  }
});

test("a missing read window is refused, not defaulted", () => {
  // A protocol that arrived without a read window at all - truncated sync,
  // bad migration, hand-edited cache. There is no such thing as a default
  // read window, so this must block rather than assume one.
  for (const missing of [null, undefined]) {
    const protocol = { ...PROTOCOL, read_window: missing } as unknown as Protocol;
    const eligibility = evaluateEligibility(protocol, LOT, NOW);
    assert.ok(
      eligibility.state === "blocked" && eligibility.reasons.includes("read_window_malformed"),
      `read_window=${missing} was accepted`,
    );
    const verdict = evaluateTiming(protocol, eligibility, {
      kind: "measured",
      seconds: 60,
      source: "monotonic",
    });
    assert.equal(verdict.state, "indeterminate");
    assert.equal(verdict.timingValid, false);
    assert.equal(verdict.assistedPermitted, false);
  }
});

// --- restart semantics (no hidden auto-restart) ----------------------------

test("restart produces a new attempt id and records what it superseded", () => {
  const first = startAttempt("attempt-1", PROTOCOL, LOT, START);
  const second = restartAttempt(first, "attempt-2", after(200));
  assert.equal(second.attemptId, "attempt-2");
  assert.equal(second.supersedesAttemptId, "attempt-1");
  // The abandoned attempt is untouched - it is evidence, not litter.
  assert.equal(first.attemptId, "attempt-1");
  assert.equal(first.supersedesAttemptId, null);
});

test("restarting with the same id is refused", () => {
  const first = startAttempt("attempt-1", PROTOCOL, LOT, START);
  assert.throws(() => restartAttempt(first, "attempt-1", after(200)));
});

test("a restarted attempt re-times from its own start, not the original", () => {
  const first = startAttempt("attempt-1", PROTOCOL, LOT, START);
  const restartClock = after(300);
  const second = restartAttempt(first, "attempt-2", restartClock);
  // 60s after the RESTART is in-window, even though 360s have passed since
  // the original start.
  const now: ClockReading = {
    wallMs: restartClock.wallMs + 60_000,
    monotonicMs: restartClock.monotonicMs + 60_000,
    bootId: "boot-1",
  };
  const { timing } = assessAttempt(second, PROTOCOL, LOT, now);
  assert.equal(timing.state, "in_window");
  assert.equal(timing.timingValid, true);
});

test("nothing in this module restarts an attempt implicitly", () => {
  // Assess an expired attempt many times; it must stay expired and keep its
  // id. An implementation that auto-restarted would silently re-open the
  // window and tell the worker they are on time.
  const attempt = startAttempt("attempt-1", PROTOCOL, LOT, START);
  for (const seconds of [200, 400, 800]) {
    const { timing } = assessAttempt(attempt, PROTOCOL, LOT, after(seconds));
    assert.equal(timing.state, "expired");
    assert.equal(timing.timingValid, false);
  }
  assert.equal(attempt.attemptId, "attempt-1");
  assert.deepEqual(attempt.start, START);
});

// --- provenance ------------------------------------------------------------

test("the verdict carries no reading, bin or water judgement", () => {
  const verdict = timingAt(60);
  for (const forbidden of ["bin", "result", "value", "concentration", "safe", "potable", "reading"]) {
    assert.ok(!(forbidden in verdict), `timing verdict leaked a ${forbidden} field`);
  }
});

test("assisted and manual permissions are separate fields", () => {
  const verdict = timingAt(600);
  assert.equal(verdict.assistedPermitted, false);
  assert.equal(verdict.manualPermitted, true);
  // One boolean could not express "the machine may not judge this, but the
  // worker may still record what they saw".
  assert.notEqual(verdict.assistedPermitted, verdict.manualPermitted);
});

test("eligible kit read in window is the only assisted-permitted combination", () => {
  assert.equal(timingAt(60).assistedPermitted, true);
  assert.equal(timingAt(100).assistedPermitted, false);
  const expiredLot: KitLot = { ...LOT, expiry: "2026-01-01T00:00:00Z" };
  const attempt = startAttempt("a", PROTOCOL, expiredLot, START);
  assert.equal(assessAttempt(attempt, PROTOCOL, expiredLot, after(60)).timing.assistedPermitted, false);
});

// --- source-level guard on the screen (cannot be rendered here) -----------

test("protocol.tsx restarts only from an explicit press, never automatically", async () => {
  // protocol.tsx cannot be executed here (no JSX transform under Node, no
  // React test renderer installed - that would edit T03's lockfile), so this
  // guards the S03 rule "no hidden auto-restart" at source level. tsc
  // type-checks the file separately via apps/mobile/tsconfig.json.
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../apps/mobile/src/protocol.tsx", import.meta.url),
    "utf8",
  );

  const restartCalls = [...source.matchAll(/restartAttempt\s*\(/g)];
  assert.equal(restartCalls.length, 1, "expected exactly one restartAttempt call site");

  // The single call site must sit inside an onPress handler.
  const callIndex = restartCalls[0].index ?? 0;
  const preceding = source.slice(Math.max(0, callIndex - 200), callIndex);
  assert.ok(/onPress=\{/.test(preceding), "restartAttempt is not inside an onPress handler");

  // And must not be reachable from a timer or lifecycle effect.
  for (const [construct, pattern] of [
    ["setTimeout", /setTimeout\s*\([^)]*restartAttempt/],
    ["setInterval", /setInterval\s*\([^)]*restartAttempt/],
    ["useEffect", /useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*restartAttempt/],
  ] as const) {
    assert.ok(!pattern.test(source), `restartAttempt is reachable from ${construct}`);
  }

  // startAttempt likewise must not fire from an effect.
  assert.ok(
    !/useEffect\s*\(\s*\(\)\s*=>\s*\{[^}]*startAttempt/.test(source),
    "startAttempt is reachable from useEffect",
  );
});

test("protocol.tsx computes elapsed time from a clock, not from the tick counter", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../apps/mobile/src/protocol.tsx", import.meta.url),
    "utf8",
  );
  // The render tick must never be fed into the timing calculation.
  assert.ok(/readClock\(\)/.test(source), "screen never takes a clock reading");
  assert.ok(
    !/assessAttempt\([^)]*tick/.test(source),
    "the render tick is being passed into the timing calculation",
  );
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
