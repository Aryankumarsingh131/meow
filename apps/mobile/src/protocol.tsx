/**
 * T08: S03 Kit protocol screen — manufacturer/lot/expiry, one instruction per
 * step, timer and read window.
 *
 * All decisions come from `./timer.ts`, which is tested by
 * tests/protocol.test.ts. This file is JSX and wiring only and has **never
 * been rendered** — no device or emulator exists in this environment (see
 * docs/agent-workflow/handoff-T08.md). Same constraint as T07's sources.tsx.
 *
 * Layout follows ui-ux-specification.md S03: "Manufacturer/lot/expiry; one
 * instruction per step; timer/read window", edge states "Unsupported/expired
 * kit; interrupted timer; invalid timing; no hidden auto-restart".
 *
 * ## Two rules this screen must not break
 *
 * 1. **No hidden auto-restart.** There is no effect, timeout or branch that
 *    calls `restartAttempt`. Restart is a button the worker presses, and the
 *    superseded attempt id is preserved. A timer that quietly restarted would
 *    tell a worker they were on time when they were not.
 * 2. **The ticking display is not the measurement.** The interval below only
 *    forces a re-render; every value shown is recomputed from a fresh clock
 *    reading via `assessAttempt`. Backgrounding suspends the interval, which
 *    is harmless — on resume the next reading reports true elapsed time.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  assessAttempt,
  evaluateEligibility,
  restartAttempt,
  startAttempt,
  type Attempt,
  type ClockReading,
  type KitLot,
  type Protocol,
  type TimingVerdict,
} from './timer';

export interface ProtocolScreenProps {
  protocol: Protocol;
  lot: KitLot;
  /** Ordered instruction steps, already localised. One is shown at a time. */
  instructions: readonly string[];
  /** Reads both clocks. Supplied by the host so this file stays testable. */
  readClock(): ClockReading;
  /** Generates a fresh attempt id (UUID). Never derived from the old one. */
  newAttemptId(): string;
  onProceedToCapture(attempt: Attempt, timing: TimingVerdict): void;
}

/** Wording for why a kit cannot be used for an assisted reading. */
const BLOCK_TEXT: Record<string, string> = {
  lot_expired: 'This kit lot is past its expiry date.',
  lot_rejected: 'This kit lot was rejected during verification.',
  lot_unverified: 'This kit lot has not been verified yet.',
  lot_protocol_mismatch: 'This lot belongs to a different protocol version.',
  protocol_unapproved: 'This protocol version has not been approved.',
  protocol_not_yet_valid: 'This protocol version is not valid yet.',
  protocol_validity_ended: 'This protocol version is no longer valid.',
  read_window_malformed: 'This protocol has no usable read window.',
};

/** Wording for why elapsed time could not be established. */
const INDETERMINATE_TEXT: Record<string, string> = {
  reboot: 'The phone restarted during the test, so the elapsed time is unknown.',
  clock_rollback: 'The phone clock moved backwards, so the elapsed time is unknown.',
  clock_disagreement: 'The phone clock changed during the test, so the elapsed time is unknown.',
  monotonic_regression: 'The phone timer became unreliable, so the elapsed time is unknown.',
};

export function ProtocolScreen({
  protocol,
  lot,
  instructions,
  readClock,
  newAttemptId,
  onProceedToCapture,
}: ProtocolScreenProps): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  // Bumped by the interval purely to force a re-render. This counter is NOT
  // a time source — it only decides *when* to recompute, never *what* the
  // elapsed time is. That still comes from a fresh clock reading below.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!attempt) return;
    const handle = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(handle);
  }, [attempt]);

  // Recomputed from a fresh clock reading — never from an accumulated
  // counter. `tick` is in the dependency list so this re-runs each second.
  const { eligibility, timing } = useMemo(() => {
    const now = readClock();
    if (!attempt) {
      return {
        eligibility: evaluateEligibility(protocol, lot, now.wallMs),
        timing: null as TimingVerdict | null,
      };
    }
    return assessAttempt(attempt, protocol, lot, now);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is the
    // intentional re-render trigger; it is not read inside the callback.
  }, [attempt, protocol, lot, readClock, tick]);

  const blocked = eligibility.state === 'blocked';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Manufacturer / lot / expiry — required by S03. */}
      <View style={styles.header}>
        <Text style={styles.kit}>
          {protocol.manufacturer} · {protocol.kit}
        </Text>
        <Text style={styles.meta}>Parameter: {protocol.parameter}</Text>
        <Text style={styles.meta}>
          Lot {lot.lot} · expires {formatDate(lot.expiry)}
        </Text>
        <Text style={styles.meta}>
          Protocol version {protocol.version} ({lot.verification_status})
        </Text>
      </View>

      {blocked && (
        <View style={styles.blockBox} accessibilityLiveRegion="polite">
          <Text style={styles.blockTitle}>Automatic reading is not available</Text>
          {eligibility.reasons.map((reason) => (
            <Text key={reason} style={styles.blockReason}>
              • {BLOCK_TEXT[reason] ?? reason}
            </Text>
          ))}
          {/* Blocked never means the worker is stuck: the manual path stays
              open and is recorded as manual. protocol-schema.md line 50. */}
          <Text style={styles.blockFooter}>
            You can still record a manual reading. It will be saved as a manual
            reading, not an automatic one.
          </Text>
        </View>
      )}

      {/* One instruction per step, with an explicit back action. */}
      <View style={styles.stepBox}>
        <Text style={styles.stepCount}>
          Step {Math.min(step + 1, instructions.length)} of {instructions.length}
        </Text>
        <Text style={styles.stepText}>{instructions[step] ?? ''}</Text>
        <View style={styles.stepNav}>
          <Pressable
            style={[styles.button, step === 0 && styles.buttonDisabled]}
            disabled={step === 0}
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Back</Text>
          </Pressable>
          <Pressable
            style={[styles.button, step >= instructions.length - 1 && styles.buttonDisabled]}
            disabled={step >= instructions.length - 1}
            onPress={() => setStep((s) => Math.min(instructions.length - 1, s + 1))}
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Next</Text>
          </Pressable>
        </View>
      </View>

      {/* Timer / read window. */}
      {!attempt ? (
        <Pressable
          style={styles.primary}
          accessibilityRole="button"
          onPress={() => setAttempt(startAttempt(newAttemptId(), protocol, lot, readClock()))}
        >
          <Text style={styles.primaryText}>Start read-window timer</Text>
        </Pressable>
      ) : (
        <View style={styles.timerBox}>
          <Text style={styles.timerState}>{describeTiming(timing)}</Text>

          {timing?.state === 'indeterminate' && (
            <Text style={styles.invalid} accessibilityLiveRegion="polite">
              {INDETERMINATE_TEXT[timing.indeterminateReason ?? ''] ??
                'The elapsed time could not be established.'}{' '}
              This test cannot be read automatically. Start a new test.
            </Text>
          )}

          {timing?.state === 'expired' && (
            <Text style={styles.invalid} accessibilityLiveRegion="polite">
              The read window has passed. This test cannot be read
              automatically. Start a new test.
            </Text>
          )}

          {/* Explicit restart only — never automatic. The previous attempt id
              is retained by restartAttempt so the abandoned run stays visible. */}
          <Pressable
            style={styles.secondary}
            accessibilityRole="button"
            onPress={() => setAttempt(restartAttempt(attempt, newAttemptId(), readClock()))}
          >
            <Text style={styles.secondaryText}>Start a new test</Text>
          </Pressable>

          <Pressable
            style={styles.primary}
            accessibilityRole="button"
            onPress={() => timing && onProceedToCapture(attempt, timing)}
          >
            <Text style={styles.primaryText}>
              {timing?.assistedPermitted ? 'Capture now' : 'Record a manual reading'}
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

function describeTiming(timing: TimingVerdict | null): string {
  if (!timing) return '';
  switch (timing.state) {
    case 'preparing':
      return 'Preparing — follow the steps above.';
    case 'waiting':
      return timing.secondsUntilWindow !== null
        ? `Wait ${Math.ceil(timing.secondsUntilWindow)}s before reading.`
        : 'Waiting.';
    case 'in_window':
      return 'Read now — you are inside the read window.';
    case 'late':
      return 'Past the read window. Automatic reading is not available.';
    case 'expired':
      return 'Too late to read this test.';
    case 'indeterminate':
      return 'Elapsed time unknown.';
  }
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  // An unparseable expiry is shown as unknown rather than as a blank or a
  // fabricated date; timer.ts separately treats it as expired.
  return Number.isNaN(parsed) ? 'unknown' : new Date(parsed).toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  header: { gap: 2 },
  kit: { fontSize: 18, fontWeight: '700' },
  meta: { fontSize: 13, color: '#444' },
  blockBox: { backgroundColor: '#fff4e5', borderRadius: 8, padding: 12, gap: 4 },
  blockTitle: { fontSize: 15, fontWeight: '700', color: '#8a5300' },
  blockReason: { fontSize: 13, color: '#8a5300' },
  blockFooter: { fontSize: 13, color: '#333', marginTop: 6 },
  stepBox: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, gap: 8 },
  stepCount: { fontSize: 12, color: '#666' },
  stepText: { fontSize: 16 },
  stepNav: { flexDirection: 'row', gap: 12 },
  button: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#eee' },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 14 },
  timerBox: { gap: 10 },
  timerState: { fontSize: 16, fontWeight: '600' },
  invalid: { fontSize: 14, color: '#8a1c1c' },
  primary: { backgroundColor: '#14507d', padding: 14, borderRadius: 8, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { borderWidth: 1, borderColor: '#14507d', padding: 12, borderRadius: 8, alignItems: 'center' },
  secondaryText: { color: '#14507d', fontSize: 15 },
});
