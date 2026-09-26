/**
 * Field-worker app: Pluccy screening and the points card, plus the resident
 * portal link to share. Supervisors work in the supervisor dashboard
 * (apps/supervisor); both read and write the same data through the API.
 */

import React, { useState } from 'react';
import { Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Pluccy, ScreeningFlow } from './pluccy';
import { RefreshBar, useAutoRefresh } from './refresh';
import type { StaffV2Session } from './session';
import { colors, radius, spacing, type } from './theme';
import { Card, CardTitle, Row } from './ui';
import { PORTAL_URL, staffMe, type Points } from './v2';

type Tab = 'screen' | 'points';

export function StaffApp({ session, onAuthExpired }: { session: StaffV2Session; onAuthExpired(): void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('screen');
  const [points, setPoints] = useState<Points | null>(null);

  // Points refresh every 30 s (and on the button), so a supervisor's changes show up.
  const pointsRefresh = useAutoRefresh(async () => {
    const r = await staffMe(session.token);
    if (r.kind === 'auth_required') { onAuthExpired(); return false; }
    if (r.kind !== 'ok') return false;
    setPoints(r.value.points);
  }, session.token);

  const tabs: Array<[Tab, string]> = [['screen', 'Screen'], ['points', points ? `Points · ${points.points_balance}` : 'Points']];

  return (
    <View style={s.screen}>
      <View style={s.greeting}>
        <Image source={require('../assets/ui/pump.png')} style={s.pump} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={s.hello}>Field work</Text>
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
      {tab === 'points' && <><RefreshBar state={pointsRefresh} /><PointsCard points={points} /></>}
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
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { ...type.body, color: colors.textMuted },
});
