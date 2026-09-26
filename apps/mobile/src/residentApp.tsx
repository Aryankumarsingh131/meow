/**
 * Resident app: report a water problem (one or more problems, an area and
 * source picked from dropdowns, up to 4 photos), follow your own complaints,
 * and see the public source list. Lists refresh every 30 s and on the refresh
 * button; a half-filled report is never cleared by a refresh. The server
 * returns only this resident's complaints - row-level security in the
 * database, not this screen, decides that (006). No wording here says any
 * water is fit to drink.
 */

import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Dropdown } from './dropdown';
import { PhotoSet, photoFields } from './photoSet';
import { RefreshBar, useAutoRefresh } from './refresh';
import type { ResidentSession } from './session';
import { colors, radius, spacing, type } from './theme';
import { Badge, Card, CardTitle, Row } from './ui';
import {
  COMPLAINT_TYPES, fileComplaint, myComplaints, problemText, publicMap,
  type ComplaintType, type MapSource, type MyComplaint, type Photo,
} from './v2';

type Tab = 'report' | 'mine' | 'sources';

const TYPE_LABEL = Object.fromEntries(COMPLAINT_TYPES) as Record<ComplaintType, string>;
const areaOf = (s: MapSource) => s.village ?? 'Other areas';

export function ResidentApp({ session, onAuthExpired }: { session: ResidentSession; onAuthExpired(): void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('report');
  const [sources, setSources] = useState<MapSource[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  const [complaints, setComplaints] = useState<MyComplaint[] | null>(null);
  const [complaintError, setComplaintError] = useState<string | null>(null);

  const sourcesRefresh = useAutoRefresh(async () => {
    const r = await publicMap(session.token);
    if (r.kind !== 'ok') return false;
    setSources(r.value.items);
    setDisclaimer(r.value.disclaimer);
  }, session.token);
  const complaintsRefresh = useAutoRefresh(async (background) => {
    const r = await myComplaints(session.token);
    if (r.kind === 'auth_required') { onAuthExpired(); return false; }
    if (r.kind !== 'ok') {
      if (!background) setComplaintError(problemText(r));
      return false;
    }
    setComplaints(r.value.items);
    setComplaintError(null);
  }, session.token, tab === 'mine');

  return (
    <View style={s.screen}>
      <View style={s.banner}>
        <Image source={require('../assets/ui/family.jpg')} style={s.bannerImage} resizeMode="cover" />
        <Text style={s.bannerText}>Your water, your voice.</Text>
      </View>
      <View style={s.tabs}>
        {([['report', 'Report'], ['mine', 'My complaints'], ['sources', 'Sources']] as const).map(([key, label]) => (
          <Pressable key={key} style={[s.tab, tab === key && s.tabOn]} onPress={() => setTab(key)}
            accessibilityRole="tab" accessibilityState={{ selected: tab === key }} testID={`resident-tab-${key}`}>
            <Text style={[s.tabText, tab === key && s.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <RefreshBar state={tab === 'mine' ? complaintsRefresh : sourcesRefresh} />
      {tab === 'report' && (
        <ReportForm token={session.token} sources={sources} onAuthExpired={onAuthExpired} onSent={complaintsRefresh.refresh} />
      )}
      {tab === 'mine' && <MyComplaints items={complaints} message={complaintError} />}
      {tab === 'sources' && <SourceList sources={sources} disclaimer={disclaimer} />}
    </View>
  );
}

function SourceList({ sources, disclaimer }: { sources: MapSource[]; disclaimer: string }): React.JSX.Element {
  const [area, setArea] = useState<string | null>(null);
  const areas = useMemo(() => areaOptions(sources), [sources]);
  const shown = area ? sources.filter((src) => areaOf(src) === area) : sources;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Dropdown label="Area" placeholder="All areas" clearLabel="All areas" options={areas} value={area} onChange={setArea}
        testID="sources-area" />
      <Text style={s.muted}>{shown.length} of {sources.length} sources</Text>
      {shown.map((src) => (
        <Card key={src.source_id}>
          <View style={s.between}><CardTitle>{src.name}</CardTitle><Badge label={src.status_label} /></View>
          <Text style={s.muted}>{src.source_type.replace('_', ' ')} · {areaOf(src)}{src.ward ? `, ${src.ward}` : ''} · location {src.location_precision}</Text>
        </Card>
      ))}
      <Text style={s.muted}>{disclaimer}</Text>
    </ScrollView>
  );
}

function areaOptions(sources: MapSource[]) {
  const counts = new Map<string, number>();
  for (const src of sources) counts.set(areaOf(src), (counts.get(areaOf(src)) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b))
    .map(([a, n]) => ({ value: a, label: a, detail: `${n} source${n === 1 ? '' : 's'}` }));
}

function ReportForm({ token, sources, onAuthExpired, onSent }: {
  token: string; sources: MapSource[]; onAuthExpired(): void; onSent(): void;
}): React.JSX.Element {
  const [kinds, setKinds] = useState<ComplaintType[]>([]);
  const [area, setArea] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const areas = useMemo(() => areaOptions(sources), [sources]);
  const sourceOptions = useMemo(() => sources.filter((src) => !area || areaOf(src) === area)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((src) => ({ value: src.source_id, label: src.name,
                     detail: `${src.source_type.replace('_', ' ')} · ${areaOf(src)}${src.ward ? `, ${src.ward}` : ''}` })), [sources, area]);

  const toggle = (k: ComplaintType) => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);
  const pickSource = (id: string | null) => {
    setSource(id);
    const src = sources.find((x) => x.source_id === id);
    if (src) setArea(areaOf(src));
  };

  const send = async () => {
    if (!kinds.length || busy) return;
    setBusy(true);
    setMessage(null);
    const r = await fileComplaint(token, {
      complaint_type: kinds[0], ...(kinds.length > 1 ? { also: kinds.slice(1) } : {}), ...(source ? { source_id: source } : {}),
      ...(description.trim() ? { description: description.trim() } : {}), ...photoFields(photos),
    });
    setBusy(false);
    if (r.kind === 'auth_required') return onAuthExpired();
    if (r.kind !== 'ok') return setMessage(problemText(r));
    setKinds([]);
    setArea(null);
    setSource(null);
    setDescription('');
    setPhotos([]);
    setMessage(`Sent. Reference ${r.value.reference_number}. ${r.value.notice}`);
    onSent();
  };

  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {message && <Text style={s.notice} accessibilityLiveRegion="polite">{message}</Text>}
      <Card>
        <CardTitle>What is wrong?</CardTitle>
        <Text style={s.muted}>Choose all that apply.</Text>
        <View style={s.wrap}>
          {COMPLAINT_TYPES.map(([key, label]) => {
            const on = kinds.includes(key);
            return (
              <Pressable key={key} style={[s.chip, on && s.chipOn]} onPress={() => toggle(key)}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }} testID={`complaint-type-${key}`}>
                <Text style={[s.chipText, on && s.chipTextOn]}>{on ? '✓ ' : ''}{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {kinds.length > 1 && <Text style={s.muted}>{kinds.length} problems selected.</Text>}
        {kinds.includes('illness') && <Text style={s.warn}>If anyone is unwell, also contact a health worker now.</Text>}
      </Card>
      <Card>
        <CardTitle>Where? (optional)</CardTitle>
        <Dropdown label="Area" placeholder="Choose your area" clearLabel="Any area" options={areas} value={area}
          onChange={(a) => { setArea(a); if (a && source && areaOf(sources.find((x) => x.source_id === source)!) !== a) setSource(null); }}
          testID="complaint-area" />
        <Dropdown label="Water source" placeholder={sourceOptions.length ? 'Choose the water source' : 'Loading sources…'}
          clearLabel="I don't know / not listed" options={sourceOptions} value={source} onChange={pickSource} testID="complaint-source" />
      </Card>
      <Card>
        <CardTitle>Details (optional)</CardTitle>
        <TextInput style={s.input} multiline maxLength={1000} value={description} onChangeText={setDescription}
          placeholder="When did it start? Who is affected?" placeholderTextColor={colors.textFaint} testID="complaint-description" />
      </Card>
      <Card>
        <CardTitle>Photos (optional)</CardTitle>
        <PhotoSet photos={photos} onChange={setPhotos} prompt="Photograph what you noticed: the water, the tap or the container" />
      </Card>
      <Pressable style={[s.btn, (!kinds.length || busy) && s.btnMuted]} disabled={!kinds.length || busy} onPress={() => void send()}
        accessibilityRole="button" testID="complaint-send">
        <Text style={s.btnText}>{busy ? 'Sending…' : kinds.length ? 'Send report' : 'Choose what is wrong first'}</Text>
      </Pressable>
      <Text style={s.muted}>A report is not a test result. If people are unwell, also contact a health worker.</Text>
    </ScrollView>
  );
}

function MyComplaints({ items, message }: { items: MyComplaint[] | null; message: string | null }): React.JSX.Element {
  if (!items) return <View style={s.pad}><Text style={s.muted}>{message ?? 'Loading…'}</Text></View>;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      {items.length === 0 && <Text style={s.muted}>You have not sent any reports yet.</Text>}
      {items.map((c) => (
        <Card key={c.reference_number}>
          <View style={s.between}>
            <CardTitle>{c.reference_number}</CardTitle>
            <Badge label={c.status_label} tone={c.status === 'new' ? 'watch' : c.status === 'linked' ? 'unknown' : 'ok'} />
          </View>
          <Row label="Problem" value={[c.complaint_type, ...(c.also ?? [])].map((k) => TYPE_LABEL[k] ?? k).join(', ')} />
          <Row label="Source" value={c.source_name ?? 'Not given'} />
          <Row label="Sent" value={new Date(c.submitted_at).toLocaleString()} />
          {c.resolution_label && <Text style={s.body}>{c.resolution_label}</Text>}
          {c.description && <Text style={s.muted}>{c.description}</Text>}
        </Card>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  banner: { height: 110, overflow: 'hidden' },
  bannerImage: { width: '100%', height: '100%' },
  bannerText: { position: 'absolute', left: spacing.lg, top: spacing.md, fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  pad: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center', backgroundColor: colors.card,
         borderWidth: 1, borderColor: colors.border },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  tabTextOn: { color: colors.onPrimary },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...type.body, color: colors.text },
  chipTextOn: { color: colors.onPrimary, fontWeight: '700' },
  input: { minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
           color: colors.text, backgroundColor: colors.cardAlt, textAlignVertical: 'top' },
  body: { ...type.body },
  muted: { ...type.small },
  warn: { ...type.small, color: colors.alert, fontWeight: '700' },
  notice: { ...type.body, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: radius.md },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnMuted: { backgroundColor: colors.textFaint },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
});
