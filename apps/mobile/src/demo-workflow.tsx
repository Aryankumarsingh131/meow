/**
 * Synthetic demo workflow — integrated 2026-09-22 from the sibling `meow`
 * repository, where it was that repo's root `App.tsx`.
 *
 * Unchanged except for: the default export becoming a named
 * `DemoWorkflowScreen` (so this repo's root shell can host it alongside the
 * T07/T08 screens), and asset paths moving up one directory now that it lives
 * in `src/`.
 *
 * This is a SYNTHETIC workflow. It proves offline/sync state transitions and
 * that a bundled ONNX model actually executes on-device; it is not a
 * scientific pipeline and reads no real kit.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import { API_BASE } from './api';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { Paths } from 'expo-file-system';
import { StatusBar } from 'expo-status-bar';

import {
  initializeStore,
  listLocalRecords,
  listServerRecords,
  saveImage,
  submitDecision,
  syncPending,
  type FixtureId,
  type LocalRecord,
  type ServerRecord,
} from './demo-store';

const FIXTURES: FixtureId[] = ['SYN-A', 'SYN-B', 'SYN-C', 'SYN-D'];
const FIXTURE_ASSETS: Record<FixtureId, number> = {
  'SYN-A': require('../assets/demo/syn-a.png'),
  'SYN-B': require('../assets/demo/syn-b.png'),
  'SYN-C': require('../assets/demo/syn-c.png'),
  'SYN-D': require('../assets/demo/syn-d.png'),
};

type Screen = 'worker' | 'supervisor' | 'about';

export function DemoWorkflowScreen() {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [screen, setScreen] = useState<Screen>('worker');
  const [fixture, setFixture] = useState<FixtureId>('SYN-A');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Ready for a synthetic capture.');
  const [apiUrl, setApiUrl] = useState(API_BASE);
  const [localRecords, setLocalRecords] = useState<LocalRecord[]>([]);
  const [serverRecords, setServerRecords] = useState<ServerRecord[]>([]);

  async function refreshLocal() {
    setLocalRecords(await listLocalRecords());
  }

  useEffect(() => {
    initializeStore().then(refreshLocal).catch((error) => setNotice(`Storage error: ${String(error)}`));
  }, []);

  async function work(label: string, action: () => Promise<void>) {
    setBusy(true);
    setNotice(label);
    try {
      await action();
    } catch (error) {
      setNotice(`Could not complete: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveControlledImage() {
    await work('Saving controlled image durably…', async () => {
      const asset = await Asset.fromModule(FIXTURE_ASSETS[fixture]).downloadAsync();
      if (!asset.localUri) throw new Error('Bundled controlled image is unavailable');
      const id = await saveImage(asset.localUri, fixture, 'image/png');
      await refreshLocal();
      setNotice(`Saved offline • receipt ${id.slice(0, 8)}`);
    });
  }

  async function openCamera() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setNotice('Camera permission was not granted. Controlled images still work.');
        return;
      }
    }
    setCameraOpen(true);
  }

  async function capture() {
    await work('Capturing and saving durably…', async () => {
      const photo = await camera.current?.takePictureAsync({ quality: 0.82 });
      if (!photo?.uri) throw new Error('Camera did not return an image');
      const id = await saveImage(photo.uri, fixture, 'image/jpeg');
      setCameraOpen(false);
      await refreshLocal();
      setNotice(`Saved offline • receipt ${id.slice(0, 8)}`);
    });
  }

  async function sync() {
    await work('Syncing metadata and photos separately…', async () => {
      await syncPending(apiUrl);
      await refreshLocal();
      setNotice('Sync attempt finished. Check each state below.');
    });
  }

  async function refreshSupervisor() {
    await work('Refreshing synthetic supervisor queue…', async () => {
      setServerRecords(await listServerRecords(apiUrl));
      setNotice('Supervisor queue refreshed.');
    });
  }

  async function decide(record: ServerRecord, decision: 'ACCEPTED' | 'REFERRED') {
    await work(`Recording ${decision.toLowerCase()} demo decision…`, async () => {
      await submitDecision(apiUrl, record, decision);
      setServerRecords(await listServerRecords(apiUrl));
      setNotice(`${decision} means demo workflow only—not water safety.`);
    });
  }

  async function runNativeProbe() {
    await work('Running offline native bridge self-check…', async () => {
      if (Platform.OS === 'web') throw new Error('The native bridge self-check requires Android or iOS');
      const { InferenceSession, Tensor } = await import('onnxruntime-react-native');
      const asset = await Asset.fromModule(require('../assets/identity.onnx')).downloadAsync();
      if (!asset.localUri) throw new Error('Bundled self-check model is unavailable');
      const session = await InferenceSession.create(asset.localUri, { executionProviders: ['cpu'] });
      try {
        const output = await session.run({ input: new Tensor('float32', [1, 2], [1, 2]) });
        const values = Array.from(output.output.data as Float32Array);
        if (values.join(',') !== '1,2') throw new Error(`Unexpected output ${values.join(',')}`);
        setNotice('Native offline bridge passed • identity output 1,2 • no water meaning.');
      } finally {
        await session.release();
      }
    });
  }

  if (cameraOpen) {
    return (
      <View style={styles.cameraPage}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
        <SafeAreaView style={styles.cameraOverlay}>
          <View style={styles.cameraLabel}>
            <Text style={styles.cameraLabelText}>DEMO • Frame {fixture} inside the guide</Text>
          </View>
          <View style={styles.guide} />
          <View style={styles.cameraActions}>
            <Action label="Cancel" tone="quiet" onPress={() => setCameraOpen(false)} />
            <Action label={busy ? 'Saving…' : 'Capture'} onPress={capture} disabled={busy} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>JALSAKSHI • PRE-EVENT PROTOTYPE</Text>
            <Text style={styles.title}>Synthetic field notebook</Text>
          </View>
          <View style={styles.demoBadge}><Text style={styles.demoBadgeText}>DEMO ONLY</Text></View>
        </View>

        <View style={styles.warning}>
          <Text style={styles.warningTitle}>Not water analysis</Text>
          <Text style={styles.warningText}>No result here indicates concentration, quality, safety, or potability.</Text>
        </View>

        <View style={styles.tabs}>
          {(['worker', 'supervisor', 'about'] as Screen[]).map((item) => (
            <Pressable key={item} style={[styles.tab, screen === item && styles.tabActive]} onPress={() => setScreen(item)}>
              <Text style={[styles.tabText, screen === item && styles.tabTextActive]}>{item[0].toUpperCase() + item.slice(1)}</Text>
            </Pressable>
          ))}
        </View>

        {screen === 'worker' && (
          <>
            <Section title="1. Select controlled fixture" subtitle="Match the printed SYN-COLOR-001 card or use its bundled image.">
              <View style={styles.fixtureRow}>
                {FIXTURES.map((item) => (
                  <Pressable key={item} onPress={() => setFixture(item)} style={[styles.fixture, fixture === item && styles.fixtureActive]}>
                    <View style={[styles.swatch, { backgroundColor: fixtureColor(item) }]} />
                    <Text style={[styles.fixtureText, fixture === item && styles.fixtureTextActive]}>{item}</Text>
                  </Pressable>
                ))}
              </View>
              <Action label="Use bundled controlled image" onPress={saveControlledImage} disabled={busy} />
              <Action label="Photograph printed reference card" tone="quiet" onPress={openCamera} disabled={busy} />
            </Section>

            <Section title="2. Offline queue" subtitle="A saved receipt appears only after the file copy and SQLite commit finish.">
              {localRecords.length === 0 ? <Text style={styles.empty}>No locally saved demo records yet.</Text> : localRecords.map((record) => <LocalCard key={record.id} record={record} />)}
            </Section>

            <Section title="3. Development sync" subtitle="Emulator default shown. For a phone, enter this computer’s LAN address.">
              <TextInput value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} style={styles.input} accessibilityLabel="Demo API address" />
              <Action label="Sync queued records" onPress={sync} disabled={busy || localRecords.length === 0} />
            </Section>
          </>
        )}

        {screen === 'supervisor' && (
          <Section title="Synthetic supervisor" subtitle="A role label for local workflow testing; it is not authentication.">
            <TextInput value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} style={styles.input} accessibilityLabel="Demo API address" />
            <Action label="Refresh server queue" onPress={refreshSupervisor} disabled={busy} />
            {serverRecords.length === 0 ? <Text style={styles.empty}>No server records loaded.</Text> : serverRecords.map((record) => (
              <View key={record.id} style={styles.recordCard}>
                <View style={styles.recordTop}><Text style={styles.recordTitle}>{record.fixture_id}</Text><Text style={styles.receipt}>{record.id.slice(0, 8)}</Text></View>
                <Text style={styles.recordMeta}>Metadata {record.metadata_state} • Photo {record.photo_state}</Text>
                <Text style={styles.recordMeta}>Decision {record.decision ?? 'PENDING'} • v{record.version}</Text>
                {!record.decision && record.photo_state === 'AVAILABLE' && (
                  <View style={styles.decisionRow}>
                    <Action label="Accept demo" onPress={() => decide(record, 'ACCEPTED')} compact />
                    <Action label="Refer" tone="danger" onPress={() => decide(record, 'REFERRED')} compact />
                  </View>
                )}
              </View>
            ))}
          </Section>
        )}

        {screen === 'about' && <About onProbe={runNativeProbe} busy={busy} />}

        <View style={styles.notice}>
          {busy && <ActivityIndicator color="#0F6B67" />}
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LocalCard({ record }: { record: LocalRecord }) {
  return (
    <View style={styles.recordCard}>
      <View style={styles.recordTop}><Text style={styles.recordTitle}>{record.fixture_id}</Text><Text style={styles.receipt}>{record.id.slice(0, 8)}</Text></View>
      <Text style={styles.recordMeta}>Metadata {record.metadata_state} • Photo {record.photo_state}</Text>
      <Text style={styles.recordMeta}>{new Date(record.captured_at).toLocaleString()}</Text>
      {record.last_error && <Text style={styles.errorText}>{record.last_error}</Text>}
    </View>
  );
}

function About({ onProbe, busy }: { onProbe: () => void; busy: boolean }) {
  const gib = (value: number | null) => value == null ? 'Unavailable' : `${(value / 1024 ** 3).toFixed(1)} GiB`;
  return (
    <Section title="Test record" subtitle="Copy these exact values into the evidence log when testing begins.">
      <Fact label="Device model" value={Device.modelName ?? 'Unavailable'} />
      <Fact label="Android version" value={Device.osVersion ?? 'Unavailable'} />
      <Fact label="Total RAM" value={gib(Device.totalMemory)} />
      <Fact label="Available storage" value={gib(Paths.availableDiskSpace)} />
      <Action label="Run offline native bridge self-check" tone="quiet" onPress={onProbe} disabled={busy} />
      <View style={styles.rule} />
      <Text style={styles.body}>Use synthetic identities only. Real worker, supervisor, laboratory access, field kit selection, manufacturer timing, lot/expiry controls, and laboratory comparison are follow-up gates.</Text>
      <Text style={styles.body}>Event participation and pre-event-work rules remain unverified. This build is timestamped pre-event work and must be represented that way.</Text>
    </Section>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text>{children}</View>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;
}

function Action({ label, onPress, tone = 'primary', disabled = false, compact = false }: { label: string; onPress: () => void; tone?: 'primary' | 'quiet' | 'danger'; disabled?: boolean; compact?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, compact && styles.actionCompact, tone === 'quiet' && styles.actionQuiet, tone === 'danger' && styles.actionDanger, (pressed || disabled) && styles.actionMuted]}><Text style={[styles.actionText, tone === 'quiet' && styles.actionQuietText]}>{label}</Text></Pressable>;
}

function fixtureColor(value: FixtureId) {
  return { 'SYN-A': '#3B82F6', 'SYN-B': '#10B981', 'SYN-C': '#F59E0B', 'SYN-D': '#EF4444' }[value];
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F4EE' },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1 },
  eyebrow: { color: '#42606A', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  title: { color: '#0B2831', fontSize: 28, fontWeight: '800', marginTop: 4 },
  demoBadge: { backgroundColor: '#F3E5C8', borderColor: '#8A5300', borderWidth: 1, borderRadius: 5, paddingHorizontal: 8, paddingVertical: 6 },
  demoBadgeText: { color: '#713F00', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  warning: { backgroundColor: '#FFF4E6', borderLeftColor: '#A33825', borderLeftWidth: 4, padding: 14, borderRadius: 8 },
  warningTitle: { color: '#7D281B', fontSize: 17, fontWeight: '800' },
  warningText: { color: '#603B32', fontSize: 15, lineHeight: 21, marginTop: 3 },
  tabs: { flexDirection: 'row', backgroundColor: '#E6E8E3', borderRadius: 10, padding: 4 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  tabActive: { backgroundColor: '#FFFFFF' },
  tabText: { color: '#53666C', fontWeight: '700' },
  tabTextActive: { color: '#0F6B67' },
  section: { backgroundColor: '#FFFFFF', borderColor: '#D9DDD8', borderWidth: 1, borderRadius: 12, padding: 16, gap: 12 },
  sectionTitle: { color: '#0B2831', fontSize: 20, fontWeight: '800' },
  sectionSubtitle: { color: '#53666C', fontSize: 15, lineHeight: 21, marginTop: -6 },
  fixtureRow: { flexDirection: 'row', gap: 8 },
  fixture: { flex: 1, alignItems: 'center', gap: 5, borderColor: '#D5DBD8', borderWidth: 1, paddingVertical: 10, borderRadius: 8 },
  fixtureActive: { borderColor: '#0F6B67', backgroundColor: '#E7F3F1', borderWidth: 2 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  fixtureText: { color: '#53666C', fontSize: 12, fontWeight: '700' },
  fixtureTextActive: { color: '#0F6B67' },
  action: { minHeight: 50, flex: 1, backgroundColor: '#0F6B67', borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  actionCompact: { minHeight: 46 },
  actionQuiet: { backgroundColor: '#FFFFFF', borderColor: '#0F6B67', borderWidth: 1 },
  actionDanger: { backgroundColor: '#A33825' },
  actionMuted: { opacity: 0.55 },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  actionQuietText: { color: '#0F6B67' },
  input: { minHeight: 50, borderColor: '#AEBAB7', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, color: '#0B2831', fontSize: 16, backgroundColor: '#FAFAF7' },
  empty: { color: '#67777B', fontSize: 15, fontStyle: 'italic' },
  recordCard: { backgroundColor: '#F7F8F5', borderColor: '#D9DDD8', borderWidth: 1, borderRadius: 8, padding: 12, gap: 5 },
  recordTop: { flexDirection: 'row', justifyContent: 'space-between' },
  recordTitle: { color: '#0B2831', fontSize: 17, fontWeight: '800' },
  receipt: { color: '#42606A', fontFamily: 'monospace', fontSize: 13 },
  recordMeta: { color: '#53666C', fontSize: 14 },
  errorText: { color: '#A33825', fontSize: 13 },
  decisionRow: { flexDirection: 'row', gap: 8, marginTop: 5 },
  notice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12 },
  noticeText: { color: '#42606A', fontSize: 14, flexShrink: 1, textAlign: 'center' },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  factLabel: { color: '#53666C', fontSize: 15 },
  factValue: { color: '#0B2831', fontSize: 15, fontWeight: '700', textAlign: 'right' },
  rule: { height: 1, backgroundColor: '#D9DDD8' },
  body: { color: '#374F57', fontSize: 15, lineHeight: 22 },
  cameraPage: { flex: 1, backgroundColor: '#000000' },
  cameraOverlay: { flex: 1, justifyContent: 'space-between', padding: 20 },
  cameraLabel: { alignSelf: 'center', backgroundColor: 'rgba(11,40,49,0.9)', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6 },
  cameraLabelText: { color: '#FFFFFF', fontWeight: '800' },
  guide: { alignSelf: 'center', width: '86%', aspectRatio: 1.42, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 10 },
  cameraActions: { flexDirection: 'row', gap: 12 },
});
