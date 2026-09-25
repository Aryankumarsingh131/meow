/**
 * Resident app: report a water problem (optional photo), follow your own
 * complaints, and see the public source list. The server returns only this
 * resident's complaints - row-level security in the database, not this
 * screen, decides that (006). No wording here says any water is fit to drink.
 */

import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PhotoCapture } from './photoCapture';
import type { ResidentSession } from './session';
import { colors, radius, spacing, type } from './theme';
import { Badge, Card, CardTitle, Row } from './ui';
import {
  COMPLAINT_TYPES, fileComplaint, myComplaints, problemText, publicMap,
  type ComplaintType, type MapSource, type MyComplaint, type Photo,
} from './v2';

type Tab = 'report' | 'mine' | 'sources';

export function ResidentApp({ session, onAuthExpired }: { session: ResidentSession; onAuthExpired(): void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('report');
  const [sources, setSources] = useState<MapSource[]>([]);
  const [disclaimer, setDisclaimer] = useState('');
  useEffect(() => {
    void publicMap(session.token).then((r) => {
      if (r.kind === 'ok') {
        setSources(r.value.items);
        setDisclaimer(r.value.disclaimer);
      }
    });
  }, [session.token]);

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
      {tab === 'report' && <ReportForm token={session.token} sources={sources} onAuthExpired={onAuthExpired} />}
      {tab === 'mine' && <MyComplaints token={session.token} onAuthExpired={onAuthExpired} />}
      {tab === 'sources' && (
        <ScrollView contentContainerStyle={s.pad}>
          {sources.map((src) => (
            <Card key={src.source_id}>
              <View style={s.between}><CardTitle>{src.name}</CardTitle><Badge label={src.status_label} /></View>
              <Text style={s.muted}>{src.source_type.replace('_', ' ')} · location {src.location_precision}</Text>
            </Card>
          ))}
          <Text style={s.muted}>{disclaimer}</Text>
        </ScrollView>
      )}
    </View>
  );
}

function ReportForm({ token, sources, onAuthExpired }: {
  token: string; sources: MapSource[]; onAuthExpired(): void;
}): React.JSX.Element {
  const [kind, setKind] = useState<ComplaintType | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async () => {
    if (!kind || busy) return;
    setBusy(true);
    setMessage(null);
    const r = await fileComplaint(token, {
      complaint_type: kind, ...(source ? { source_id: source } : {}),
      ...(description.trim() ? { description: description.trim() } : {}), ...(photo ? { photo } : {}),
    });
    setBusy(false);
    if (r.kind === 'auth_required') return onAuthExpired();
    if (r.kind !== 'ok') return setMessage(problemText(r));
    setKind(null);
    setSource(null);
    setDescription('');
    setPhoto(null);
    setMessage(`Sent. Reference ${r.value.reference_number}. ${r.value.notice}`);
  };

  if (camera) {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <PhotoCapture prompt="Photograph what you noticed (the water, the tap or the container)."
          onPhoto={(p) => { setPhoto(p); setCamera(false); }} onSkip={() => setCamera(false)} skipLabel="Cancel" />
      </ScrollView>
    );
  }
  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {message && <Text style={s.notice} accessibilityLiveRegion="polite">{message}</Text>}
      <Card>
        <CardTitle>What is wrong?</CardTitle>
        <View style={s.wrap}>
          {COMPLAINT_TYPES.map(([key, label]) => (
            <Pressable key={key} style={[s.chip, kind === key && s.chipOn]} onPress={() => setKind(key)}
              accessibilityRole="button" accessibilityState={{ selected: kind === key }} testID={`complaint-type-${key}`}>
              <Text style={[s.chipText, kind === key && s.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card>
        <CardTitle>Which water source? (optional)</CardTitle>
        <View style={s.wrap}>
          {sources.map((src) => (
            <Pressable key={src.source_id} style={[s.chip, source === src.source_id && s.chipOn]}
              onPress={() => setSource(source === src.source_id ? null : src.source_id)} accessibilityRole="button"
              accessibilityState={{ selected: source === src.source_id }}>
              <Text style={[s.chipText, source === src.source_id && s.chipTextOn]}>{src.name}</Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <Card>
        <CardTitle>Details (optional)</CardTitle>
        <TextInput style={s.input} multiline maxLength={1000} value={description} onChangeText={setDescription}
          placeholder="When did it start? Who is affected?" placeholderTextColor={colors.textFaint} testID="complaint-description" />
        <Pressable style={s.ghost} onPress={() => setCamera(true)} accessibilityRole="button">
          <Text style={s.ghostText}>{photo ? 'Photo added — retake' : 'Add a photo (optional)'}</Text>
        </Pressable>
      </Card>
      <Pressable style={[s.btn, (!kind || busy) && s.btnMuted]} disabled={!kind || busy} onPress={() => void send()}
        accessibilityRole="button" testID="complaint-send">
        <Text style={s.btnText}>{busy ? 'Sending…' : 'Send report'}</Text>
      </Pressable>
      <Text style={s.muted}>A report is not a test result. If people are unwell, also contact a health worker.</Text>
    </ScrollView>
  );
}

function MyComplaints({ token, onAuthExpired }: { token: string; onAuthExpired(): void }): React.JSX.Element {
  const [items, setItems] = useState<MyComplaint[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void myComplaints(token).then((r) => {
      if (r.kind === 'ok') setItems(r.value.items);
      else if (r.kind === 'auth_required') onAuthExpired();
      else setMessage(problemText(r));
    });
  }, [token, onAuthExpired]);

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
          <Row label="Problem" value={COMPLAINT_TYPES.find(([k]) => k === c.complaint_type)?.[1] ?? c.complaint_type} />
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
  notice: { ...type.body, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: radius.md },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnMuted: { backgroundColor: colors.textFaint },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  ghostText: { ...type.body, color: colors.textMuted },
});
