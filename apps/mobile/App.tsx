import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native';

import { DemoWorkflowScreen } from './src/demo-workflow';
import { SourcesScreen } from './src/sources';
import type { CachedSource, HistoryRow } from './src/sourceCatalog';
import { ProtocolScreen } from './src/protocol';
import { CaptureScreen } from './src/capture';
import { runNativeGolden } from './src/nativeGolden';
import type { ClockReading, KitLot, Protocol } from './src/timer';

// ===========================================================================
// Integration shell (2026-09-22).
//
// This repository and the sibling `meow` repository implemented different
// slices of the same blueprint. This root hosts both:
//
//   * "Demo workflow" — meow's synthetic worker/supervisor/ONNX-probe flow,
//     which was that repo's root App.tsx. Real camera, real on-device model
//     execution, real offline/sync state transitions.
//   * "T07 Sources" / "T08 …" — this repo's source catalogue and kit
//     protocol / read-window screens.
//
// The T07/T08 tabs are still a DEMO HARNESS driven by fictional fixtures so
// the screens can be viewed; they are not wired to real navigation or real
// data. ALL fixture values below are fictional — no real kit, manufacturer,
// lot, expiry or read window has been selected (T01 remains a fictional
// template). Nothing here is domain-validated.
//
// Replace this shell once real provisioning (S01) and navigation exist.
// ===========================================================================

const DEMO_CACHE: CachedSource[] = [
  { id: 'src-a1', qrCode: 'JS-A-0001', label: 'Handpump 1', locality: 'Sundarpur', latitude: null, longitude: null },
  { id: 'src-a2', qrCode: 'JS-A-0002', label: 'Handpump 2', locality: 'Sundarpur', latitude: 25.1, longitude: 82.3 },
  { id: 'src-a3', qrCode: 'JS-A-0003', label: 'Well North', locality: 'Rampur', latitude: null, longitude: null },
];

const DEMO_HISTORY_ROWS: HistoryRow[] = [
  { sampleId: 'smp-1', receivedAtServer: '2026-09-15T10:00:00Z', indicativeFlag: 'review', method: 'assisted' },
  { sampleId: 'smp-2', receivedAtServer: '2026-08-01T10:00:00Z', indicativeFlag: 'no_flag', method: 'assisted' },
];

const DEMO_PROTOCOL: Protocol = {
  id: 'proto-fixture-0001',
  version: 1,
  manufacturer: 'FICTIONAL TEST MANUFACTURER',
  kit: 'FICTIONAL TEST KIT',
  parameter: 'fixture_parameter',
  read_window: { prepare_seconds: 10, read_at_seconds: 60, tolerance_seconds: 10, invalid_after_seconds: 180 },
  validity: { from: '2026-01-01T00:00:00Z', until: '2027-01-01T00:00:00Z' },
  approved_by: {
    actor: 'fixture-approver',
    role: 'domain_reviewer',
    at: '2026-01-01T00:00:00Z',
    source_document: 'FICTIONAL - no real manufacturer instruction sheet exists',
  },
};

const DEMO_LOT_VALID: KitLot = {
  id: 'lot-fixture-0001',
  protocol_id: DEMO_PROTOCOL.id,
  protocol_version: 1,
  lot: 'FIXTURE-LOT-A',
  expiry: '2026-12-31T00:00:00Z',
  verification_status: 'verified',
};

/** Expired + unverified lot — shows the blocked-but-manual-still-open state. */
const DEMO_LOT_EXPIRED: KitLot = {
  ...DEMO_LOT_VALID,
  id: 'lot-fixture-0002',
  lot: 'FIXTURE-LOT-EXPIRED',
  expiry: '2026-01-15T00:00:00Z',
  verification_status: 'unverified',
};

/** Short window so the timer states are observable in seconds, not minutes. */
const DEMO_PROTOCOL_FAST: Protocol = {
  ...DEMO_PROTOCOL,
  id: 'proto-fixture-fast',
  kit: 'FICTIONAL FAST-WINDOW FIXTURE',
  read_window: { prepare_seconds: 2, read_at_seconds: 6, tolerance_seconds: 2, invalid_after_seconds: 12 },
};

const DEMO_LOT_FAST: KitLot = {
  ...DEMO_LOT_VALID,
  id: 'lot-fixture-fast',
  protocol_id: DEMO_PROTOCOL_FAST.id,
  lot: 'FIXTURE-LOT-FAST',
};

const DEMO_INSTRUCTIONS = [
  'Rinse the sample tube twice with the water you are testing, then discard.',
  'Fill the tube to the marked line and add one reagent tablet.',
  'Cap the tube and invert it slowly five times. Do not shake.',
  'Start the timer and place the tube upright out of direct sunlight.',
];

/** Real clock readings. `performance.now()` is monotonic — it does not jump
 *  when the wall clock changes, which is the property timer.ts relies on. */
function readClock(): ClockReading {
  return { wallMs: Date.now(), monotonicMs: Math.round(performance.now()), bootId: 'session-1' };
}

let attemptCounter = 0;
const newAttemptId = () => `attempt-${(attemptCounter += 1)}`;

type Tab = 'demo' | 'sources' | 'protocol' | 'protocol-blocked' | 'protocol-fast' | 'capture';

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['demo', 'Demo workflow'],
  ['sources', 'T07 Sources'],
  ['protocol', 'T08 Protocol'],
  ['protocol-blocked', 'T08 Expired'],
  ['protocol-fast', 'T08 Timer'],
  ['capture', 'T09 Capture'],
];

export default function App() {
  const [tab, setTab] = useState<Tab>('demo');

  // T04 acceptance: run the native golden vector once on mount and log it.
  // Temporary verification scaffolding.
  React.useEffect(() => {
    runNativeGolden()
      .then((r) => console.log('T04_NATIVE_GOLDEN ' + r))
      .catch((e) => console.log('T04_NATIVE_GOLDEN_ERROR ' + String(e && e.message ? e.message : e)));
  }, []);

  return (
    <View style={styles.root}>
      {tab !== 'demo' && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            DEMO HARNESS — fictional fixture data. Not domain-validated.
          </Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
        {TABS.map(([key, label]) => (
          <Pressable
            key={key}
            testID={`tab-${key}`}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
            accessibilityRole="button"
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.body}>
        {tab === 'demo' && <DemoWorkflowScreen />}

        {tab === 'capture' && (
          <CaptureScreen
            request={{
              sourceId: 'src-a1',
              protocolId: DEMO_PROTOCOL.id,
              protocolVersion: DEMO_PROTOCOL.version,
              attemptId: 'attempt-demo',
              requireReferenceCard: true,
            }}
            newJobId={newAttemptId}
            onManualEntry={(reason) => console.log('manual entry', reason)}
            onAnalysed={(_f, corners) => console.log('analysed', corners.length, 'corners')}
          />
        )}

        {tab === 'sources' && (
          <SourcesScreen
            cache={DEMO_CACHE}
            history={{
              sourceId: 'src-a1',
              rows: DEMO_HISTORY_ROWS,
              origin: 'cache',
              servedAt: '2026-09-10T10:00:00Z',
            }}
            onSelectSource={(source) => console.log('selected', source.id)}
          />
        )}

        {tab === 'protocol' && (
          <ProtocolScreen
            protocol={DEMO_PROTOCOL}
            lot={DEMO_LOT_VALID}
            instructions={DEMO_INSTRUCTIONS}
            readClock={readClock}
            newAttemptId={newAttemptId}
            onProceedToCapture={(attempt) => console.log('capture', attempt.attemptId)}
          />
        )}

        {tab === 'protocol-blocked' && (
          <ProtocolScreen
            protocol={DEMO_PROTOCOL}
            lot={DEMO_LOT_EXPIRED}
            instructions={DEMO_INSTRUCTIONS}
            readClock={readClock}
            newAttemptId={newAttemptId}
            onProceedToCapture={(attempt) => console.log('capture', attempt.attemptId)}
          />
        )}

        {tab === 'protocol-fast' && (
          <ProtocolScreen
            protocol={DEMO_PROTOCOL_FAST}
            lot={DEMO_LOT_FAST}
            instructions={DEMO_INSTRUCTIONS}
            readClock={readClock}
            newAttemptId={newAttemptId}
            onProceedToCapture={(attempt) => console.log('capture', attempt.attemptId)}
          />
        )}
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  // Keep content clear of the Android system status bar; without this the
  // tab row renders under the clock and is not tappable.
  root: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 24 : 0,
  },
  banner: { backgroundColor: '#8a5300', paddingVertical: 6, paddingHorizontal: 12 },
  bannerText: { color: '#fff', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  tabs: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: '#ddd' },
  tab: { paddingVertical: 10, paddingHorizontal: 12 },
  tabActive: { borderBottomWidth: 3, borderBottomColor: '#14507d' },
  tabText: { fontSize: 14, color: '#555' },
  tabTextActive: { color: '#14507d', fontWeight: '700' },
  body: { flex: 1 },
});
