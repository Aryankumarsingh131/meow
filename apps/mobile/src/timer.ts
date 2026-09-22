/**
 * T08: read-window timing integrity and kit eligibility.
 *
 * This module answers three questions and nothing else:
 *   1. May this kit/protocol be used for an ASSISTED interpretation at all?
 *   2. How much time has actually elapsed since the protocol's start event,
 *      and can that elapsed time be trusted?
 *   3. Given (2) and the protocol's read window, is the capture timing valid?
 *
 * It never produces a reading, a bin, a concentration or a verdict about the
 * water. Those are separate provenance fields owned elsewhere (AGENTS.md).
 *
 * ## No domain values live here
 *
 * Every threshold - prepare/read_at/tolerance/invalid_after, lot expiry,
 * protocol validity - is read from the protocol and lot objects passed in.
 * There is deliberately NO default read window and no fallback: a missing or
 * malformed read window yields `indeterminate`, never an assumed one.
 * jalsakshi-blueprint/docs/architecture/protocol-schema.md line 8: "No value
 * in this system is invented, rounded for convenience, or copied from a
 * different kit."
 *
 * ## Why two clocks
 *
 * A field phone gives us two unreliable clocks and no good one:
 *
 *   - Wall clock (`Date.now()`): survives reboot, but NTP, the user, or a
 *     timezone/DST correction can move it - forwards or backwards.
 *   - Monotonic clock (Android `SystemClock.elapsedRealtime()`): immune to
 *     clock changes and keeps counting while the device sleeps, but resets to
 *     zero on reboot and cannot be compared across boots.
 *
 * Neither alone is sufficient, so a reading carries both plus a boot
 * identifier. When they agree, elapsed time is `measured`. When they cannot
 * be reconciled - reboot, rollback, or drift beyond tolerance - the honest
 * answer is `indeterminate`, which forbids assisted interpretation and
 * leaves the manual path open (protocol-schema.md line 50).
 *
 * ## Elapsed time is computed, never accumulated
 *
 * `setInterval` ticks are throttled or suspended entirely when the app is
 * backgrounded, so a timer that accumulates ticks silently under-counts - the
 * exact bug that would let a worker read a strip late and be told they were
 * on time. Elapsed time here is always `now - start` from a clock reading.
 * The UI may tick for display; it must never tick for measurement.
 */

// --- protocol / lot inputs (shapes from protocol-schema.md, data-model.md) --

export interface ReadWindow {
  prepare_seconds: number;
  read_at_seconds: number;
  tolerance_seconds: number;
  invalid_after_seconds: number;
}

export interface Protocol {
  id: string;
  version: number;
  manufacturer: string;
  kit: string;
  parameter: string;
  read_window: ReadWindow;
  /** Protocol version approval window. `until: null` means open-ended. */
  validity: { from: string; until: string | null };
  /** Absent/null means this protocol version was never approved (T01). */
  approved_by: { actor: string; role: string; at: string; source_document: string } | null;
}

/** `kit_lots` row (data-model.md line 14). A lot is NOT model validation. */
export interface KitLot {
  id: string;
  protocol_id: string;
  protocol_version: number;
  lot: string;
  /** ISO-8601 date the physical kit lot expires. */
  expiry: string;
  verification_status: "verified" | "unverified" | "rejected";
}

// --- clock readings --------------------------------------------------------

/**
 * One observation of both clocks.
 *
 * `bootId` is an opaque identifier that changes when the device reboots. On
 * Android it is derived from boot time; when the platform cannot supply one
 * it must be `null`, which forces the more conservative offset-drift check
 * rather than silently assuming "same boot".
 */
export interface ClockReading {
  /** `Date.now()` - wall clock, milliseconds since epoch. */
  wallMs: number;
  /** Monotonic milliseconds since boot. Resets on reboot. */
  monotonicMs: number;
  bootId: string | null;
}

/**
 * Engineering tolerance for reconciling the two clocks, in milliseconds.
 *
 * This is NOT a domain or kit value - it does not come from any manufacturer
 * and has nothing to do with a read window. It is the slack allowed between
 * the wall-clock delta and the monotonic delta before we declare them in
 * disagreement, covering ordinary NTP micro-adjustments and the fact that the
 * two clocks are not sampled in the same instruction.
 *
 * Deliberately tight: a genuine rollback attack or a DST jump is orders of
 * magnitude larger, and erring small only ever moves us toward
 * `indeterminate`, which is the safe direction.
 */
export const CLOCK_AGREEMENT_TOLERANCE_MS = 2000;

export type ElapsedIndeterminateReason =
  /** Monotonic clock reset: the device rebooted mid-test. */
  | "reboot"
  /** Wall clock moved backwards relative to the start reading. */
  | "clock_rollback"
  /** Wall and monotonic deltas disagree beyond tolerance. */
  | "clock_disagreement"
  /** Monotonic clock went backwards without a boot id change. */
  | "monotonic_regression";

/**
 * Elapsed time, discriminated. Never a bare number: a caller that receives a
 * number cannot tell a trustworthy 60 seconds from a guessed one, and that
 * distinction is the entire point of this module.
 */
export type Elapsed =
  | { kind: "measured"; seconds: number; source: "monotonic" }
  | { kind: "indeterminate"; reason: ElapsedIndeterminateReason };

/**
 * Reconcile two clock readings into an elapsed duration.
 *
 * Monotonic is the measurement of record when it is usable; the wall clock is
 * only ever a cross-check. We never fall back to wall-only timing after a
 * reboot: that is precisely the case where the wall clock may have been
 * adjusted while the device was off, and an unverifiable elapsed time must
 * not be dressed up as a measured one.
 */
export function elapsedBetween(
  start: ClockReading,
  now: ClockReading,
  toleranceMs: number = CLOCK_AGREEMENT_TOLERANCE_MS,
): Elapsed {
  // A boot id change is unambiguous: the monotonic clock restarted, so the
  // two monotonic values are not on the same timeline at all.
  if (start.bootId !== null && now.bootId !== null && start.bootId !== now.bootId) {
    return { kind: "indeterminate", reason: "reboot" };
  }

  const monotonicDelta = now.monotonicMs - start.monotonicMs;
  const wallDelta = now.wallMs - start.wallMs;

  // Monotonic went backwards. With matching boot ids this should be
  // impossible, so treat it as a reboot we failed to observe rather than
  // trusting either clock.
  if (monotonicDelta < 0) {
    return {
      kind: "indeterminate",
      reason: start.bootId === null ? "reboot" : "monotonic_regression",
    };
  }

  // Wall clock moved backwards: rollback, manual change, or NTP correction.
  if (wallDelta < 0) {
    return { kind: "indeterminate", reason: "clock_rollback" };
  }

  // Both advanced - do they agree? Disagreement means one of them was
  // adjusted during the test, and we cannot tell which.
  if (Math.abs(wallDelta - monotonicDelta) > toleranceMs) {
    return { kind: "indeterminate", reason: "clock_disagreement" };
  }

  return { kind: "measured", seconds: monotonicDelta / 1000, source: "monotonic" };
}

// --- kit / protocol eligibility -------------------------------------------

export type EligibilityBlockReason =
  | "lot_expired"
  | "lot_rejected"
  | "lot_unverified"
  | "lot_protocol_mismatch"
  | "protocol_unapproved"
  | "protocol_not_yet_valid"
  | "protocol_validity_ended"
  | "read_window_malformed";

/**
 * Whether an ASSISTED (automated) interpretation is permitted.
 *
 * `blocked` never means "stop working". AC-002 blocks *automated
 * interpretation*; protocol-schema.md line 50 is explicit that the manual
 * path stays open and is recorded as manual. So this type carries
 * `manualPermitted` alongside, rather than a single boolean that would
 * collapse "the machine may not judge this" into "the worker may not work".
 */
export type Eligibility =
  | { state: "eligible" }
  | { state: "blocked"; reasons: EligibilityBlockReason[]; manualPermitted: true };

function isMalformedWindow(w: ReadWindow | null | undefined): boolean {
  if (!w) return true;
  const values = [w.prepare_seconds, w.read_at_seconds, w.tolerance_seconds, w.invalid_after_seconds];
  if (values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) return true;
  // A read window whose invalid_after precedes the end of its own tolerance
  // band is self-contradictory; refusing it is safer than picking a winner.
  if (w.invalid_after_seconds < w.read_at_seconds + w.tolerance_seconds) return true;
  return false;
}

/**
 * Evaluate kit lot + protocol against a wall-clock instant.
 *
 * Uses the wall clock deliberately: expiry and validity are calendar facts,
 * not durations, and there is no monotonic equivalent of "3 March 2027".
 * A wrong device clock can therefore misjudge expiry - which is why the
 * server re-checks on ingestion and why this is not the only gate.
 *
 * All reasons are collected rather than short-circuiting: a worker holding an
 * expired lot of an unapproved protocol should be told both things at once,
 * not led through them one screen at a time.
 */
export function evaluateEligibility(
  protocol: Protocol,
  lot: KitLot,
  nowWallMs: number,
): Eligibility {
  const reasons: EligibilityBlockReason[] = [];

  if (lot.protocol_id !== protocol.id || lot.protocol_version !== protocol.version) {
    // The lot was manufactured against a different protocol version. Its
    // chart and read window may differ; they are not interchangeable.
    reasons.push("lot_protocol_mismatch");
  }

  const lotExpiry = Date.parse(lot.expiry);
  if (Number.isNaN(lotExpiry) || nowWallMs > lotExpiry) {
    // An unparseable expiry is treated as expired, not as "no expiry".
    reasons.push("lot_expired");
  }

  if (lot.verification_status === "rejected") reasons.push("lot_rejected");
  if (lot.verification_status === "unverified") reasons.push("lot_unverified");

  if (!protocol.approved_by) reasons.push("protocol_unapproved");

  const validFrom = Date.parse(protocol.validity.from);
  if (Number.isNaN(validFrom) || nowWallMs < validFrom) reasons.push("protocol_not_yet_valid");

  if (protocol.validity.until !== null) {
    const validUntil = Date.parse(protocol.validity.until);
    if (Number.isNaN(validUntil) || nowWallMs > validUntil) reasons.push("protocol_validity_ended");
  }

  if (isMalformedWindow(protocol.read_window)) reasons.push("read_window_malformed");

  if (reasons.length > 0) return { state: "blocked", reasons, manualPermitted: true };
  return { state: "eligible" };
}

// --- read-window verdict ---------------------------------------------------

export type TimingState =
  /** Before the protocol's preparation step has completed. */
  | "preparing"
  /** Preparation done, too early to read. */
  | "waiting"
  /** Inside read_at ± tolerance. The only state where timing is valid. */
  | "in_window"
  /** Past the tolerance band but before invalid_after. */
  | "late"
  /** Past invalid_after_seconds. */
  | "expired"
  /** Elapsed time could not be established. */
  | "indeterminate";

export interface TimingVerdict {
  state: TimingState;
  /**
   * `true` ONLY inside read_at ± tolerance with measured elapsed time.
   * protocol-schema.md line 50 states the true case explicitly and the
   * false cases explicitly; everything else defaults to false, because
   * inventing validity is the one error this module must never make.
   */
  timingValid: boolean;
  /** Assisted interpretation permitted. Requires valid timing AND eligibility. */
  assistedPermitted: boolean;
  /** Manual reading is permitted in every state, recorded as manual. */
  manualPermitted: true;
  elapsed: Elapsed;
  /** Seconds until the read window opens; null when unknowable or passed. */
  secondsUntilWindow: number | null;
  /** Present only when state is `indeterminate`. */
  indeterminateReason?: ElapsedIndeterminateReason;
}

/**
 * Classify elapsed time against a protocol's read window.
 *
 * SPEC AMBIGUITY, resolved conservatively and flagged for domain review:
 * protocol-schema.md states that inside `read_at ± tolerance` is
 * `timing_valid = true`, and that after `invalid_after_seconds` is
 * `timing_valid = false`. It does not say what the band between
 * `read_at + tolerance` and `invalid_after` means. This implementation
 * treats it as `late` with `timingValid = false` - i.e. only the explicitly
 * stated true case is true. That cannot produce a false "valid", but the
 * distinction between `late` and `expired` is a real domain question (does a
 * late strip get re-read or discarded?) and needs T01 sign-off.
 * See docs/agent-workflow/handoff-T08.md.
 */
export function evaluateTiming(
  protocol: Protocol,
  eligibility: Eligibility,
  elapsed: Elapsed,
): TimingVerdict {
  const base = { manualPermitted: true as const, elapsed };

  if (elapsed.kind === "indeterminate") {
    return {
      ...base,
      state: "indeterminate",
      timingValid: false,
      assistedPermitted: false,
      secondsUntilWindow: null,
      indeterminateReason: elapsed.reason,
    };
  }

  if (isMalformedWindow(protocol.read_window)) {
    // No usable window means no way to judge timing. Not "valid by default".
    return {
      ...base,
      state: "indeterminate",
      timingValid: false,
      assistedPermitted: false,
      secondsUntilWindow: null,
    };
  }

  const w = protocol.read_window;
  const seconds = elapsed.seconds;
  const windowOpens = w.read_at_seconds - w.tolerance_seconds;
  const windowCloses = w.read_at_seconds + w.tolerance_seconds;

  let state: TimingState;
  if (seconds < w.prepare_seconds) state = "preparing";
  else if (seconds < windowOpens) state = "waiting";
  else if (seconds <= windowCloses) state = "in_window";
  else if (seconds <= w.invalid_after_seconds) state = "late";
  else state = "expired";

  const timingValid = state === "in_window";
  return {
    ...base,
    state,
    timingValid,
    // Both gates must pass. An eligible kit read at the wrong time and a
    // perfectly-timed read of an expired kit are both refused.
    assistedPermitted: timingValid && eligibility.state === "eligible",
    secondsUntilWindow: seconds < windowOpens ? windowOpens - seconds : null,
  };
}

// --- attempt lifecycle -----------------------------------------------------

/**
 * One timed attempt. Immutable: restarting produces a NEW attempt with a new
 * id rather than mutating this one.
 *
 * ui-ux-specification.md S03 requires "no hidden auto-restart". Nothing in
 * this module restarts a timer; `restartAttempt` exists so that a restart is
 * always an explicit, attributable act by the worker, and the superseded
 * attempt id is retained so an abandoned attempt is visible rather than
 * erased.
 */
export interface Attempt {
  attemptId: string;
  protocolId: string;
  protocolVersion: number;
  lotId: string;
  start: ClockReading;
  /** Set when this attempt replaced an earlier one. */
  supersedesAttemptId: string | null;
}

export function startAttempt(
  attemptId: string,
  protocol: Protocol,
  lot: KitLot,
  start: ClockReading,
): Attempt {
  return {
    attemptId,
    protocolId: protocol.id,
    protocolVersion: protocol.version,
    lotId: lot.id,
    start,
    supersedesAttemptId: null,
  };
}

/** Explicit restart. Never called automatically by this module. */
export function restartAttempt(previous: Attempt, attemptId: string, start: ClockReading): Attempt {
  if (attemptId === previous.attemptId) {
    // Reusing the id would make the abandoned run indistinguishable from the
    // new one in the record.
    throw new Error("A restarted attempt must have a new attemptId.");
  }
  return { ...previous, attemptId, start, supersedesAttemptId: previous.attemptId };
}

/**
 * The whole picture for the S03 screen: eligibility + timing in one call.
 */
export function assessAttempt(
  attempt: Attempt,
  protocol: Protocol,
  lot: KitLot,
  now: ClockReading,
  toleranceMs: number = CLOCK_AGREEMENT_TOLERANCE_MS,
): { eligibility: Eligibility; timing: TimingVerdict } {
  const eligibility = evaluateEligibility(protocol, lot, now.wallMs);
  const elapsed = elapsedBetween(attempt.start, now, toleranceMs);
  const timing = evaluateTiming(protocol, eligibility, elapsed);
  return { eligibility, timing };
}
