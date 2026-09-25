/**
 * Hosted staff app: Pluccy screening, the points card, and - supervisors only -
 * the resident complaint queue (link to an open report at its current version,
 * open a resident-origin report, or dismiss). Plus the resident portal link to
 * share. The server enforces every role and team rule; the tabs only hide what
 * a role cannot use.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Pluccy, ScreeningFlow } from './pluccy';
import type { StaffV2Session } from './session';
import { colors, radius, spacing, type } from './theme';
import { Badge, Card, CardTitle, Row } from './ui';
import {
  PORTAL_URL, problemText, reviewComplaint, staffComplaints, staffMe, staffReports,
  type Points, type Review, type StaffComplaint, type StaffReport,
} from './v2';

type Tab = 'screen' | 'points' | 'complaints';

export function StaffApp({ session, onAuthExpired }: { session: StaffV2Session; onAuthExpired(): void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('screen');
  const [points, setPoints] = useState<Points | null>(null);

  useEffect(() => {
    void staffMe(session.token).then((r) => {
      if (r.kind === 'ok') setPoints(r.value.points);
      else if (r.kind === 'auth_required') onAuthExpired();
    });
  }, [session.token, onAuthExpired]);

  const tabs: Array<[Tab, string]> = [['screen', 'Screen'], ['points', points ? `Points · ${points.points_balance}` : 'Points']];
  if (session.role === 'supervisor') tabs.push(['complaints', 'Complaints']);

  return (
    <View style={s.screen}>
      <View style={s.greeting}>
        <Image source={require('../assets/ui/pump.png')} style={s.pump} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={s.hello}>{session.role === 'supervisor' ? 'Supervisor workspace' : 'Field work'}</Text>
          <Text style={s.muted}>Every test counts. Pluccy will guide you.</Text>
        </View>
      </View>
      <View style={s.tabs}>
        {tabs.map(([key, label]) => (
          <Pressable key={key} style={[s.tab, tab === key && s.tabOn]} onPress={() => setTab(key)}
            accessibilityRole="tab" accessibilityState={{ selected: tab === key }} testID={`staff-tab-${key}`}>
            <Text style={[s.tabText, tab === key && s.tabTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {/* Screening keeps its state while another tab is open. */}
      <View style={[s.screen, tab !== 'screen' && s.hidden]}>
        <ScreeningFlow token={session.token} onAuthExpired={onAuthExpired} onPoints={setPoints} />
      </View>
      {tab === 'points' && <PointsCard points={points} />}
      {tab === 'complaints' && <ComplaintQueue token={session.token} onAuthExpired={onAuthExpired} />}
    </View>
  );
}

function PointsCard({ points }: { points: Points | null }): React.JSX.Element {
  if (!points) return <View style={s.pad}><Pluccy mood="think" say="Counting your points…" /></View>;
  const next = points.next_milestone;
  const progress = next ? Math.min(1, points.qualifying_screenings / next) : 1;
  const share = () => void Share.share({ message: `Report a water problem to JalSakshi: ${PORTAL_URL}` });
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Pluccy mood={points.streak_days > 0 ? 'cheer' : 'wave'}
        say={points.streak_days > 1 ? `${points.streak_days}-day streak! Keep it going.` : 'Every on-time screening counts.'} />
      <Card>
        <Text style={s.big}>{points.points_balance}</Text>
        <Text style={s.center}>points</Text>
        <Row label="On-time screenings" value={String(points.qualifying_screenings)} />
        <Row label="Streak" value={`🔥 ${points.streak_days} day${points.streak_days === 1 ? '' : 's'}`} />
        <Row label="Next milestone" value={next ? `${next} screenings` : 'All reached'} />
        <View style={s.bar}><View style={[s.barFill, { flex: progress }]} /><View style={{ flex: 1 - progress }} /></View>
      </Card>
      <Card>
        <CardTitle>How points work</CardTitle>
        <Text style={s.body}>{points.rule}</Text>
      </Card>
      <Pressable style={s.ghost} onPress={share} accessibilityRole="button" testID="share-portal">
        <Text style={s.ghostText}>Share the resident reporting link</Text>
      </Pressable>
    </ScrollView>
  );
}

function ComplaintQueue({ token, onAuthExpired }: { token: string; onAuthExpired(): void }): React.JSX.Element {
  const [complaints, setComplaints] = useState<StaffComplaint[] | null>(null);
  const [reports, setReports] = useState<StaffReport[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [c, r] = await Promise.all([staffComplaints(token), staffReports(token)]);
    if (c.kind === 'auth_required' || r.kind === 'auth_required') return onAuthExpired();
    if (c.kind !== 'ok') return setMessage(problemText(c));
    setComplaints(c.value.items);
    if (r.kind === 'ok') setReports(r.value.items.filter((x) => x.status !== 'closed'));
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (c: StaffComplaint, review: Review, done: string) => {
    setBusy(true);
    const r = await reviewComplaint(token, c.complaint_id, review);
    setBusy(false);
    if (r.kind === 'auth_required') return onAuthExpired();
    setMessage(r.kind === 'ok' ? `${c.reference_number}: ${done}` : problemText(r));
    setOpen(null);
    void load();   // a version conflict needs the fresh versions too
  };

  if (!complaints) return <View style={s.pad}><Pluccy mood="think" say={message ?? 'Loading complaints…'} /></View>;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      {message && <Text style={s.notice} accessibilityLiveRegion="polite">{message}</Text>}
      {complaints.length === 0 && <Pluccy mood="wave" say="No new resident complaints. Nice!" />}
      {complaints.map((c) => {
        const candidates = reports.filter((r) => !c.source_id || r.source_id === c.source_id);
        return (
          <Card key={c.complaint_id}>
            <View style={s.between}>
              <CardTitle>{c.reference_number}</CardTitle>
              <Badge label={c.complaint_type} tone={c.complaint_type === 'illness' ? 'alert' : 'watch'} />
            </View>
            <Row label="Source" value={c.source_name ?? 'Not given'} />
            <Row label="Received" value={new Date(c.submitted_at).toLocaleString()} />
            {c.description && <Text style={s.body}>{c.description}</Text>}
            {c.photo && <Text style={s.muted}>Photo attached (view it on the supervisor board).</Text>}
            {open === c.complaint_id ? (
              <View style={s.actions}>
                <Text style={s.muted}>Link to an open report{c.source_id ? ' on this source' : ''}:</Text>
                {candidates.length === 0 && <Text style={s.muted}>No open report{c.source_id ? ' on this source' : ''}.</Text>}
                {candidates.map((r) => (
                  <Pressable key={r.report_id} style={s.choice} disabled={busy} accessibilityRole="button"
                    onPress={() => void act(c, { action: 'link', report_id: r.report_id, version: r.version }, 'linked')}>
                    <Text style={s.body}>{r.source_name} · {r.status.replace('_', ' ')} · {r.risk_level}</Text>
                    <Text style={s.muted}>Opened {new Date(r.created_at).toLocaleDateString()} · version {r.version}</Text>
                  </Pressable>
                ))}
                {c.source_id && (
                  <View style={s.rowWrap}>
                    <Text style={s.muted}>Or open a new report:</Text>
                    {(['low', 'medium', 'high'] as const).map((risk) => (
                      <Pressable key={risk} style={s.chip} disabled={busy} accessibilityRole="button"
                        onPress={() => void act(c, { action: 'open_report', risk_level: risk }, `new ${risk}-risk report opened`)}>
                        <Text style={s.chipText}>{risk}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <Pressable style={s.ghost} disabled={busy} accessibilityRole="button" onPress={() =>
                  Alert.alert('Dismiss complaint?', 'The resident will see it as reviewed with no investigation opened.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Dismiss', style: 'destructive', onPress: () => void act(c, { action: 'dismiss' }, 'dismissed') },
                  ])}>
                  <Text style={s.ghostText}>Dismiss</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={s.btn} onPress={() => setOpen(c.complaint_id)} accessibilityRole="button">
                <Text style={s.btnText}>Review</Text>
              </Pressable>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  greeting: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  pump: { width: 64, height: 64 },
  hello: { fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  hidden: { display: 'none' },
  pad: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center', backgroundColor: colors.card,
         borderWidth: 1, borderColor: colors.border },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  tabTextOn: { color: colors.onPrimary },
  big: { fontSize: 48, fontWeight: '800', color: colors.primaryDark, textAlign: 'center' },
  center: { ...type.small, textAlign: 'center', marginTop: -6 },
  bar: { flexDirection: 'row', height: 10, borderRadius: radius.pill, backgroundColor: colors.primarySoft, overflow: 'hidden', marginTop: spacing.sm },
  barFill: { backgroundColor: colors.ok },
  body: { ...type.body },
  muted: { ...type.small },
  notice: { ...type.body, backgroundColor: colors.primarySoft, padding: spacing.md, borderRadius: radius.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  choice: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, backgroundColor: colors.cardAlt },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.primary },
  chipText: { color: colors.primary, fontWeight: '700' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { ...type.body, color: colors.textMuted },
});
