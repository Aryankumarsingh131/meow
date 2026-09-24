import { randomUUID } from 'expo-crypto';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  Alert, BackHandler, Image, Platform, Pressable, ScrollView, StatusBar as NativeStatusBar,
  StyleSheet, Text, TextInput, View,
} from 'react-native';

import { colors, radius, shadow, spacing } from './theme';
import { Badge, Card, type Tone } from './ui';
import {
  overallOf, PARAMETERS, statusOf, type CaseStatus, type ParameterKey, type Rating, type Reading,
  type TestRecord,
} from './v1Model';
import { listTests, saveTest } from './v1Store';

type Screen = 'welcome' | 'home' | 'new' | 'parameters' | 'assist' | 'summary' | 'tests' | 'detail' | 'followups' | 'case' | 'profile';
type Draft = { sourceId: string; sourceName: string; location: string; sourceType: string; date: string; testerName: string };
type Entry = { value: string; rating?: Rating };
type AssistState = 'ready' | 'good' | 'poor-light' | 'misaligned';

const SOURCE_TYPES = ['Tap', 'Hand Pump', 'Well', 'Tank', 'Other'];
const CASE_STATUSES: CaseStatus[] = ['Open', 'Sent for Lab Testing', 'Action Required', 'Retest Scheduled', 'Resolved'];
const RATING_LABEL: Record<Rating, string> = { safe: 'Safe', warning: 'Warning', unsafe: 'Unsafe' };
const RATING_TONE: Record<Rating, Tone> = { safe: 'unknown', warning: 'watch', unsafe: 'alert' };

function localDate(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyDraft(): Draft {
  return { sourceId: '', sourceName: '', location: '', sourceType: 'Hand Pump', date: localDate(), testerName: '' };
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function toneFor(record: TestRecord): Tone {
  if (record.followUp?.status === 'Resolved') return 'unknown';
  return overallOf(record.readings) === 'unsafe' ? 'alert' : overallOf(record.readings) === 'warning' ? 'watch' : 'unknown';
}

export default function V1App(): React.JSX.Element {
  const [stack, setStack] = useState<Screen[]>(['welcome']);
  const screen = stack[stack.length - 1];
  const [records, setRecords] = useState<TestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [entries, setEntries] = useState<Partial<Record<ParameterKey, Entry>>>({});
  const [draftId, setDraftId] = useState(randomUUID);
  const [draftCreatedAt, setDraftCreatedAt] = useState(() => new Date().toISOString());
  const [assist, setAssist] = useState<AssistState>('ready');
  const [saved, setSaved] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    listTests().then(setRecords).catch((error) => setStorageError(String(error))).finally(() => setLoading(false));
  }, []);

  useEffect(() => { setSaved(false); }, [draft, entries]);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) { setStack((current) => current.slice(0, -1)); return true; }
      if (screen !== 'home' && screen !== 'welcome') { setStack(['home']); return true; }
      return false;
    });
    return () => listener.remove();
  }, [screen, stack.length]);

  const navigate = (next: Screen) => setStack((current) => [...current, next]);
  const tab = (next: Screen) => setStack([next]);
  const back = () => setStack((current) => current.length > 1 ? current.slice(0, -1) : ['home']);
  const selected = records.find((record) => record.id === selectedId);
  const readings: Reading[] = PARAMETERS.flatMap(({ key }) => {
    const entry = entries[key];
    return entry?.rating ? [{ key, value: entry.value?.trim() || 'Not entered', rating: entry.rating }] : [];
  });
  const draftRecord: TestRecord = {
    id: draftId, sourceId: draft.sourceId.trim(), sourceName: draft.sourceName.trim(),
    location: draft.location.trim(), sourceType: draft.sourceType, date: draft.date,
    testerName: draft.testerName.trim(), readings, createdAt: draftCreatedAt, demo: false,
  };

  function startTest() {
    setDraft(emptyDraft());
    setEntries({});
    setDraftId(randomUUID());
    setDraftCreatedAt(new Date().toISOString());
    setAssist('ready');
    setSaved(false);
    navigate('new');
  }

  async function persist(record: TestRecord): Promise<boolean> {
    try {
      await saveTest(record);
      setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setSaved(true);
      return true;
    } catch (error) {
      Alert.alert('Could not save', `The test was not saved on this phone. ${String(error)}`);
      return false;
    }
  }

  async function createFollowUp(record: TestRecord) {
    const unsafe = record.readings.filter((reading) => reading.rating === 'unsafe');
    if (!unsafe.length) return;
    const existingCase = record.followUp ?? records.find((item) => item.id === record.id)?.followUp;
    const updated: TestRecord = { ...record, followUp: existingCase ?? {
      id: `CASE-${randomUUID().slice(0, 8).toUpperCase()}`,
      parameter: unsafe[0].key, priority: unsafe.length > 1 ? 'High' : 'Medium',
      assignedPerson: record.testerName || 'Field team', dueDate: localDate(7), status: 'Open',
    } };
    if (await persist(updated)) { setSelectedId(updated.id); navigate('case'); }
  }

  async function changeCaseStatus(status: CaseStatus) {
    if (!selected?.followUp) return;
    const updated = { ...selected, followUp: { ...selected.followUp, status } };
    await persist(updated);
  }

  function continueSource() {
    if (!draft.sourceId.trim() || !draft.sourceName.trim() || !draft.location.trim() || !draft.testerName.trim()) {
      Alert.alert('Complete the source details', 'Source ID, name, location and tester name are required.');
      return;
    }
    if (!validDate(draft.date)) { Alert.alert('Check the date', 'Enter a real date as YYYY-MM-DD.'); return; }
    navigate('parameters');
  }

  const pending = records.filter((record) => !record.demo).length;
  const followUps = records.filter((record) => record.followUp);
  const openFollowUps = followUps.filter((record) => record.followUp?.status !== 'Resolved');
  const todayCount = records.filter((record) => record.date === localDate()).length;
  const rootTab = ['home', 'tests', 'followups', 'profile'].includes(screen);

  if (loading || storageError) {
    return <View style={s.center}><Text style={s.brand}>JalSakshi</Text><Text style={s.muted}>
      {storageError ? `Local storage unavailable: ${storageError}` : 'Opening your field notebook…'}
    </Text><StatusBar style="dark" /></View>;
  }

  if (screen === 'welcome') {
    return <View style={s.welcome}>
      <StatusBar style="dark" />
      <View style={s.welcomeOrb}><Image source={require('../assets/icon.png')} style={s.welcomeIcon} accessibilityLabel="JalSakshi icon" /></View>
      <Text style={s.welcomeEyebrow}>FIELD TESTING · VERSION 1</Text>
      <Text style={s.welcomeTitle}>JalSakshi</Text>
      <Text style={s.welcomeTagline}>Every Water Test Deserves a Follow-Up.</Text>
      <Text style={s.welcomeBody}>A simple field notebook for recording indicative tests and keeping follow-up visible.</Text>
      <View style={s.welcomeBottom}>
        <Action label="Get Started" onPress={() => tab('home')} />
        <Text style={s.disclaimer}>Prototype with example data. No result confirms water is safe to drink.</Text>
      </View>
    </View>;
  }

  return <View style={s.root}>
    <StatusBar style="dark" />
    <View style={s.topBar}>
      {!rootTab && <Pressable onPress={back} style={s.backButton} accessibilityRole="button" accessibilityLabel="Go back"><Text style={s.backText}>Back</Text></Pressable>}
      <View style={{ flex: 1 }}>
        <Text style={s.topEyebrow}>JALSAKSHI · OFFLINE DEMO</Text>
        <Text style={s.topTitle}>{({ home: 'Field dashboard', new: 'New water test', parameters: 'Test parameters', assist: 'AI assist preview', summary: 'Result summary', tests: 'Previous tests', detail: 'Test details', followups: 'Follow-up cases', case: 'Follow-up case', profile: 'Profile & sync' } as Record<string, string>)[screen]}</Text>
      </View>
    </View>

    <ScrollView key={screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {screen === 'home' && <>
        <View style={s.hero}>
          <Text style={s.heroEyebrow}>GOOD FIELD WORK STARTS HERE</Text>
          <Text style={s.heroTitle}>Keep every test connected to its next step.</Text>
          <Text style={s.heroBody}>Capture a result, save it on this phone, and track what needs follow-up.</Text>
          <Action label="New Water Test" onPress={startTest} light />
        </View>
        <View style={s.metricGrid}>
          <Metric label="Tests Today" value={todayCount} />
          <Metric label="Pending Sync" value={pending} />
          <Metric label="Follow-Up Required" value={openFollowUps.length} />
          <Metric label="Completed Tests" value={records.length} />
        </View>
        <Text style={s.sectionTitle}>Quick actions</Text>
        <Card><Action label="Previous Tests" onPress={() => tab('tests')} variant="quiet" /><Action label="Pending Follow-Ups" onPress={() => tab('followups')} variant="quiet" /><Action label="Sync Status" onPress={() => tab('profile')} variant="quiet" /></Card>
        {openFollowUps[0] && <>
          <Text style={s.sectionTitle}>Needs attention</Text>
          <TestCard record={openFollowUps[0]} onPress={() => { setSelectedId(openFollowUps[0].id); navigate('case'); }} />
        </>}
      </>}

      {screen === 'new' && <>
        <Step count={1} label="Source details" />
        <Text style={s.intro}>Record the source you tested. Location can be entered manually.</Text>
        <Card>
          <Field label="Water Source ID" value={draft.sourceId} onChangeText={(sourceId) => setDraft({ ...draft, sourceId })} placeholder="e.g. HP-104" />
          <Field label="Source Name" value={draft.sourceName} onChangeText={(sourceName) => setDraft({ ...draft, sourceName })} placeholder="e.g. School hand pump" />
          <Field label="Location / Village" value={draft.location} onChangeText={(location) => setDraft({ ...draft, location })} placeholder="e.g. Patel Nagar" />
          <Text style={s.fieldLabel}>Water Source Type</Text>
          <View style={s.chips}>{SOURCE_TYPES.map((sourceType) => <Choice key={sourceType} label={sourceType} selected={draft.sourceType === sourceType} onPress={() => setDraft({ ...draft, sourceType })} />)}</View>
          <Field label="Date (YYYY-MM-DD)" value={draft.date} onChangeText={(date) => setDraft({ ...draft, date })} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
          <Field label="Tester Name" value={draft.testerName} onChangeText={(testerName) => setDraft({ ...draft, testerName })} placeholder="Your name" />
        </Card>
        <Action label="Continue to Test" onPress={continueSource} />
      </>}

      {screen === 'parameters' && <>
        <Step count={2} label="Indicative readings" />
        <Text style={s.intro}>Enter a reading if available, then choose the demo label shown on your kit or worksheet. The app does not calculate a scientific threshold.</Text>
        {PARAMETERS.map((parameter) => <Card key={parameter.key}>
          <View style={s.between}><Text style={s.parameterTitle}>{parameter.label}</Text><Text style={s.muted}>{parameter.unit || 'pH scale'}</Text></View>
          <TextInput style={s.input} value={entries[parameter.key]?.value ?? ''} onChangeText={(value) => setEntries({ ...entries, [parameter.key]: { ...entries[parameter.key], value } })} placeholder="Enter reading (optional)" keyboardType="decimal-pad" accessibilityLabel={`${parameter.label} reading`} placeholderTextColor={colors.textMuted} />
          <View style={s.ratingRow}>{(['safe', 'warning', 'unsafe'] as Rating[]).map((rating) => <Choice key={rating} label={RATING_LABEL[rating]} selected={entries[parameter.key]?.rating === rating} onPress={() => setEntries({ ...entries, [parameter.key]: { value: entries[parameter.key]?.value ?? '', rating } })} tone={rating} />)}</View>
        </Card>)}
        <Action label="Continue to AI Assist" onPress={() => readings.length ? navigate('assist') : Alert.alert('Choose a result', 'Select a demo label for at least one parameter.')} />
      </>}

      {screen === 'assist' && <>
        <Step count={3} label="AI assist simulation" />
        <Card>
          <View style={s.between}><Text style={s.sectionTitle}>AI Assist / Indicative Result</Text><Badge label="SIMULATED" tone="watch" /></View>
          <Text style={s.intro}>This bundled sample card demonstrates the future photo flow. No image analysis or laboratory measurement is performed.</Text>
          <Image source={require('../assets/demo/syn-c.png')} style={s.sampleImage} resizeMode="contain" accessibilityLabel="Bundled synthetic color card" />
          <Action label="Run Sample Analysis" onPress={() => setAssist('good')} />
          <View style={s.ratingRow}><Choice label="Poor lighting" selected={assist === 'poor-light'} onPress={() => setAssist('poor-light')} /><Choice label="Misaligned" selected={assist === 'misaligned'} onPress={() => setAssist('misaligned')} /></View>
        </Card>
        {assist !== 'ready' && <Card>
          <Text style={s.parameterTitle}>{assist === 'good' ? 'Sample image accepted' : 'Retake photo'}</Text>
          <InfoRow label="Strip detected" value={assist === 'good' ? 'Yes (demo)' : 'Uncertain'} />
          <InfoRow label="Lighting" value={assist === 'poor-light' ? 'Poor lighting' : 'Acceptable (demo)'} />
          <InfoRow label="Position" value={assist === 'misaligned' ? 'Strip not aligned' : 'Acceptable (demo)'} />
          {assist === 'good' && <><InfoRow label="Demo confidence" value="91% simulated" /><InfoRow label="Suggested reading" value="Demo band C" /></>}
          {assist !== 'good' && <Text style={s.warningText}>Retake the photo or use the sample analysis above.</Text>}
        </Card>}
        <Text style={s.disclaimer}>Lab confirmation remains final for unsafe results. This preview does not determine water safety.</Text>
        <Action label="Continue to Results" onPress={() => navigate('summary')} disabled={assist !== 'good'} />
      </>}

      {screen === 'summary' && <>
        <Step count={4} label="Review and save" />
        <Card>
          <Text style={s.parameterTitle}>{draft.sourceName}</Text>
          <InfoRow label="Water source" value={`${draft.sourceId} · ${draft.sourceType}`} />
          <InfoRow label="Test date" value={draft.date} />
          <InfoRow label="Location" value={draft.location} />
          <InfoRow label="Tester" value={draft.testerName} />
        </Card>
        <ResultBlock record={draftRecord} />
        <Card><Text style={s.parameterTitle}>Parameter results</Text>{readings.map((reading) => <ReadingRow key={reading.key} reading={reading} />)}</Card>
        <Action label={saved ? 'Saved on this phone' : 'Save Test'} onPress={() => { void persist(draftRecord); }} disabled={saved} />
        {overallOf(readings) === 'unsafe' && <Action label={records.find((item) => item.id === draftId)?.followUp ? 'View Follow-Up' : 'Create Follow-Up'} onPress={() => { void createFollowUp(draftRecord); }} variant="quiet" />}
        <Action label="Return Home" onPress={() => saved ? tab('home') : Alert.alert('Leave without saving?', 'This test has not been saved.', [{ text: 'Stay', style: 'cancel' }, { text: 'Discard', onPress: () => tab('home') }])} variant="text" />
      </>}

      {screen === 'tests' && <>
        <Text style={s.intro}>Tests saved on this phone, including clearly labeled example records.</Text>
        {records.length ? records.map((record) => <TestCard key={record.id} record={record} onPress={() => { setSelectedId(record.id); navigate('detail'); }} />) : <Empty text="No tests yet. Start with a new water test." />}
        <Action label="New Water Test" onPress={startTest} />
      </>}

      {screen === 'detail' && selected && <>
        <Card><View style={s.between}><Text style={s.parameterTitle}>{selected.sourceName}</Text><Badge label={statusOf(selected)} tone={toneFor(selected)} /></View>
          <InfoRow label="Source ID" value={selected.sourceId} /><InfoRow label="Location" value={selected.location} />
          <InfoRow label="Type" value={selected.sourceType} /><InfoRow label="Date" value={selected.date} /><InfoRow label="Tester" value={selected.testerName} />
          {selected.demo && <Text style={s.disclaimer}>Example record · no real test was performed.</Text>}
        </Card>
        <ResultBlock record={selected} />
        <Card><Text style={s.parameterTitle}>Parameter results</Text>{selected.readings.map((reading) => <ReadingRow key={reading.key} reading={reading} />)}</Card>
        {selected.followUp ? <Action label="View Follow-Up Case" onPress={() => navigate('case')} /> : overallOf(selected.readings) === 'unsafe' ? <Action label="Create Follow-Up" onPress={() => { void createFollowUp(selected); }} /> : null}
      </>}

      {screen === 'followups' && <>
        <Text style={s.intro}>A concerning demo result stays visible until a person records its next step.</Text>
        {followUps.length ? followUps.map((record) => <TestCard key={record.id} record={record} onPress={() => { setSelectedId(record.id); navigate('case'); }} />) : <Empty text="No follow-up cases yet." />}
      </>}

      {screen === 'case' && selected?.followUp && <>
        <Card>
          <View style={s.between}><Text style={s.parameterTitle}>{selected.followUp.id}</Text><Badge label={selected.followUp.priority + ' priority'} tone="alert" /></View>
          <InfoRow label="Water Source" value={selected.sourceName} />
          <InfoRow label="Flagged Parameter" value={PARAMETERS.find((p) => p.key === selected.followUp?.parameter)?.label ?? selected.followUp.parameter} />
          <InfoRow label="Assigned Person" value={selected.followUp.assignedPerson} />
          <InfoRow label="Due Date" value={selected.followUp.dueDate} />
          <InfoRow label="Current Status" value={selected.followUp.status} />
          {selected.demo && <Text style={s.disclaimer}>Example case · no real referral or action was made.</Text>}
        </Card>
        <Text style={s.sectionTitle}>Update local status</Text>
        <Card>{CASE_STATUSES.map((status) => <Pressable key={status} style={[s.statusOption, selected.followUp?.status === status && s.statusOptionActive]} onPress={() => { void changeCaseStatus(status); }} accessibilityRole="button" accessibilityState={{ selected: selected.followUp?.status === status }}>
          <View style={[s.statusDot, selected.followUp?.status === status && s.statusDotActive]} /><Text style={s.statusOptionText}>{status}</Text>
        </Pressable>)}</Card>
        <Text style={s.disclaimer}>Status changes are stored only on this phone. “Resolved” here is a prototype demonstration, not verified case closure.</Text>
      </>}

      {screen === 'profile' && <>
        <Card><Text style={s.parameterTitle}>Field tester demo</Text><InfoRow label="Mode" value="Offline prototype" /><InfoRow label="Saved tests" value={String(records.length)} /><InfoRow label="Pending Sync" value={String(pending)} /></Card>
        <Card><Text style={s.parameterTitle}>Sync status</Text><Text style={s.intro}>New tests are saved on this phone. Version 1 does not upload records or require a server. Pending Sync counts local records awaiting a future integration.</Text><Badge label="LOCAL ONLY" tone="watch" /></Card>
        <Card><Text style={s.parameterTitle}>About this prototype</Text><Text style={s.intro}>Indicative labels and the AI preview are simulated. They are useful for testing the mobile workflow, not for making drinking-water decisions.</Text></Card>
      </>}
    </ScrollView>

    {rootTab && <View style={s.tabBar}>{([
      ['home', 'Home'], ['tests', 'Tests'], ['followups', 'Follow-Ups'], ['profile', 'Profile'],
    ] as [Screen, string][]).map(([target, label]) => <Pressable key={target} style={[s.tab, screen === target && s.tabActive]} onPress={() => tab(target)} accessibilityRole="tab" accessibilityState={{ selected: screen === target }}>
      <View style={[s.tabMarker, screen === target && s.tabMarkerActive]} /><Text style={[s.tabText, screen === target && s.tabTextActive]}>{label}</Text>
    </Pressable>)}</View>}
  </View>;
}

function Action({ label, onPress, variant = 'primary', disabled = false, light = false }: { label: string; onPress: () => void; variant?: 'primary' | 'quiet' | 'text'; disabled?: boolean; light?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={({ pressed }) => [s.action, variant === 'quiet' && s.actionQuiet, variant === 'text' && s.actionTextOnly, light && s.actionLight, (pressed || disabled) && s.actionPressed]}>
    <Text style={[s.actionText, (variant !== 'primary' || light) && s.actionQuietText]}>{label}</Text>
  </Pressable>;
}

function Choice({ label, selected, onPress, tone }: { label: string; selected: boolean; onPress: () => void; tone?: Rating }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [s.choice, selected && s.choiceSelected, tone === 'unsafe' && selected && s.choiceAlert, pressed && s.actionPressed]}>
    <Text style={[s.choiceText, selected && s.choiceTextSelected, tone === 'unsafe' && selected && s.choiceAlertText]}>{label}</Text>
  </Pressable>;
}

function Field({ label, value, onChangeText, placeholder, keyboardType }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; keyboardType?: 'default' | 'numbers-and-punctuation' }) {
  return <View style={s.field}><Text style={s.fieldLabel}>{label}</Text><TextInput style={s.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textMuted} accessibilityLabel={label} keyboardType={keyboardType} /></View>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={s.metric}><Text style={s.metricValue}>{value}</Text><Text style={s.metricLabel}>{label}</Text></View>;
}

function Step({ count, label }: { count: number; label: string }) {
  return <View style={s.step}><Text style={s.stepCount}>{String(count).padStart(2, '0')} / 04</Text><Text style={s.stepLabel}>{label}</Text></View>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <View style={s.infoRow}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue}>{value}</Text></View>;
}

function ReadingRow({ reading }: { reading: Reading }) {
  const parameter = PARAMETERS.find((item) => item.key === reading.key)!;
  return <View style={s.readingRow}><View style={{ flex: 1 }}><Text style={s.readingName}>{parameter.label}</Text><Text style={s.muted}>{reading.value}{parameter.unit && reading.value !== 'Not entered' ? ` ${parameter.unit}` : ''}</Text></View><Badge label={`${RATING_LABEL[reading.rating]} · demo`} tone={RATING_TONE[reading.rating]} /></View>;
}

function ResultBlock({ record }: { record: TestRecord }) {
  const overall = overallOf(record.readings);
  const tone: Tone = overall === 'unsafe' ? 'alert' : overall === 'warning' ? 'watch' : 'unknown';
  return <View style={[s.resultBlock, tone === 'alert' ? s.resultAlert : tone === 'watch' ? s.resultWatch : s.resultOk]}>
    <Text style={s.resultEyebrow}>OVERALL DEMO STATUS</Text>
    <Text style={s.resultTitle}>{overall === 'unsafe' ? 'Follow-Up Required' : overall === 'warning' ? 'Review Suggested' : 'Safe (demo)'}</Text>
    <Text style={s.resultNote}>Indicative labels were entered manually. This is not laboratory confirmation or a potability result.</Text>
  </View>;
}

function TestCard({ record, onPress }: { record: TestRecord; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${record.sourceName} test`} style={({ pressed }) => [s.testCard, pressed && s.actionPressed]}>
    <View style={s.between}><Text style={s.testName}>{record.sourceName}</Text><Badge label={statusOf(record)} tone={toneFor(record)} /></View>
    <Text style={s.testMeta}>{record.sourceId} · {record.location}</Text>
    <Text style={s.testMeta}>{record.date}{record.demo ? ' · Example record' : ' · Saved locally'}</Text>
  </Pressable>;
}

function Empty({ text }: { text: string }) { return <Card><Text style={s.intro}>{text}</Text></Card>; }

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 24 : 0 },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  brand: { color: colors.primaryDark, fontSize: 30, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 14 },
  welcome: { flex: 1, backgroundColor: colors.bg, paddingTop: (NativeStatusBar.currentHeight ?? 24) + 42, paddingHorizontal: 28 },
  welcomeOrb: { width: 116, height: 116, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.82)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, ...shadow.card },
  welcomeIcon: { width: 82, height: 82, borderRadius: 24 },
  welcomeEyebrow: { marginTop: 44, color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.7 },
  welcomeTitle: { marginTop: 10, color: colors.text, fontSize: 44, fontWeight: '800', letterSpacing: -1.5 },
  welcomeTagline: { marginTop: 14, color: colors.primaryDark, fontSize: 25, lineHeight: 32, fontWeight: '700' },
  welcomeBody: { marginTop: 18, color: colors.textMuted, fontSize: 17, lineHeight: 25 },
  welcomeBottom: { marginTop: 'auto', paddingBottom: 36, gap: 16 },
  disclaimer: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16, backgroundColor: 'rgba(255,255,255,0.9)', borderBottomWidth: 1, borderBottomColor: colors.border },
  backButton: { minWidth: 48, minHeight: 48, justifyContent: 'center' },
  backText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  topEyebrow: { color: colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  topTitle: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 3 },
  content: { padding: 20, paddingBottom: 40, gap: 16 },
  hero: { backgroundColor: colors.primaryDark, borderRadius: 24, padding: 24, gap: 12 },
  heroEyebrow: { color: '#B9D9F4', fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },
  heroTitle: { color: '#FFFFFF', fontSize: 27, lineHeight: 34, fontWeight: '800' },
  heroBody: { color: '#E2F0FA', fontSize: 15, lineHeight: 22 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  metric: { width: '48%', minHeight: 108, backgroundColor: colors.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.border, justifyContent: 'space-between', ...shadow.card },
  metricValue: { color: colors.primaryDark, fontSize: 27, fontWeight: '800' },
  metricLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  intro: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  action: { minHeight: 52, backgroundColor: colors.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  actionQuiet: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  actionTextOnly: { backgroundColor: 'transparent' },
  actionLight: { backgroundColor: '#FFFFFF' },
  actionPressed: { opacity: 0.65 },
  actionText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  actionQuietText: { color: colors.primaryDark },
  tabBar: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 8, paddingBottom: Platform.OS === 'android' ? 28 : 8, paddingTop: 5 },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12 },
  tabActive: { backgroundColor: colors.primarySoft },
  tabMarker: { width: 18, height: 3, borderRadius: 3, backgroundColor: 'transparent' },
  tabMarkerActive: { backgroundColor: colors.primary },
  tabText: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: colors.primaryDark },
  step: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepCount: { color: colors.primary, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  stepLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  field: { gap: 6 },
  fieldLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12, backgroundColor: colors.cardAlt, paddingHorizontal: 14, color: colors.text, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 48, minWidth: 80, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.borderStrong },
  choiceSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  choiceAlert: { backgroundColor: colors.alertSoft, borderColor: colors.alert },
  choiceText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  choiceTextSelected: { color: colors.primaryDark },
  choiceAlertText: { color: colors.alert },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  parameterTitle: { color: colors.text, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  ratingRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sampleImage: { width: '100%', height: 210, borderRadius: 14, backgroundColor: colors.cardAlt },
  warningText: { color: colors.alert, fontSize: 14, fontWeight: '700' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { color: colors.textMuted, fontSize: 14, flex: 1 },
  infoValue: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right', flex: 1 },
  resultBlock: { borderRadius: 18, padding: 20, gap: 8, borderLeftWidth: 5 },
  resultAlert: { backgroundColor: colors.alertSoft, borderLeftColor: colors.alert },
  resultWatch: { backgroundColor: colors.watchSoft, borderLeftColor: colors.watch },
  resultOk: { backgroundColor: colors.primarySoft, borderLeftColor: colors.primary },
  resultEyebrow: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  resultTitle: { color: colors.text, fontSize: 23, fontWeight: '800' },
  resultNote: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  readingName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  testCard: { minHeight: 116, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 7, ...shadow.card },
  testName: { color: colors.text, fontSize: 17, fontWeight: '800', flex: 1 },
  testMeta: { color: colors.textMuted, fontSize: 13 },
  statusOption: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  statusOptionActive: { backgroundColor: colors.primarySoft, borderRadius: 10, paddingHorizontal: 8 },
  statusDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.borderStrong },
  statusDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  statusOptionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
