/**
 * JalSakshi — PUBLIC / COMMUNITY app surface ("View public data", no account).
 *
 * Live data from GET /v1/public/map and /v1/public/leaderboard, the same
 * records the supervisor dashboard and field workers change:
 *
 *   Sources      every public source, searchable, filterable by status and area;
 *                tap one for its details
 *   Map          every source on a map, coloured by type (publicMap.tsx)
 *   Trends       graphs from /v1/public/stats, and per-area summaries
 *   Leaders      field workers by on-time screening points, and areas
 *
 * Wording rules (AGENTS.md): status words come from the server's constrained
 * vocabulary; no drinking-water assurance and no water-treatment advice. The
 * leaderboard rewards timely screening work and says nothing about water.
 * When the server cannot be reached, the offline demo data is shown and
 * labelled as such.
 */

import React, { useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { demo } from './demoBackend';
import { colors, radius, spacing, type } from './theme';
import { Bars, HBars, SplitBar } from './charts';
import { PublicMap, SOURCE_TYPE_COLORS, SOURCE_TYPE_LABELS } from './publicMap';
import { RefreshBar, useAutoRefresh } from './refresh';
import { Badge, Card, CardTitle, Divider, Row, type Tone } from './ui';
import { recordAgeLabel } from './statusLabel';
import { problemText, publicLeaderboard, publicMap, publicStats, type Leaderboard, type MapSource, type PublicStats } from './v2';

type Panel = 'sources' | 'map' | 'trends' | 'leaderboard' | 'about';

/** Green only for a verified lab report (theme.ts); the rest describe the record. */
const STATUS_TONE: Record<string, Tone> = {
  lab_verified_safe: 'ok', under_review: 'watch', action_pending: 'alert', no_open_issues: 'unknown', not_tested: 'unknown',
};
const FILTERS = [['all', 'All'], ['action_pending', 'Action pending'], ['under_review', 'Under review'],
  ['lab_verified_safe', 'Lab-verified'], ['no_open_issues', 'No open issues'], ['not_tested', 'Not tested']] as const;

interface Data { sources: MapSource[]; disclaimer: string; board: Leaderboard; stats: PublicStats; offline: boolean }

export interface PublicAppProps {
  now?: () => number;
}

export function PublicApp({ now = Date.now }: PublicAppProps): React.JSX.Element {
  const [panel, setPanel] = useState<Panel>('sources');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [area, setArea] = useState<string | null>(null);
  const [open, setOpen] = useState<MapSource | null>(null);

  // Every 30 s and on the refresh button. A failed background refresh keeps the
  // last live data on screen; only a first load falls back to the offline demo.
  const load = async (background: boolean): Promise<boolean> => {
    const [map, board, stats] = await Promise.all([publicMap(), publicLeaderboard(), publicStats()]);
    if (map.kind === 'ok' && board.kind === 'ok' && stats.kind === 'ok') {
      setError(null);
      setData({ sources: map.value.items, disclaimer: map.value.disclaimer, board: board.value, stats: stats.value, offline: false });
      return true;
    }
    if (background && data && !data.offline) return false;
    const failed = map.kind !== 'ok' ? map : board.kind !== 'ok' ? board : stats.kind !== 'ok' ? stats : null;
    if (failed && failed.kind === 'offline') {
      const m = demo.publicMap();
      const b = demo.leaderboard();
      const st = demo.stats();
      if (m.kind === 'ok' && b.kind === 'ok' && st.kind === 'ok') {
        setData({ sources: m.value.items, disclaimer: m.value.disclaimer, board: b.value, stats: st.value, offline: true });
        return false;
      }
    }
    if (failed) setError(problemText(failed));
    return false;
  };
  const refresh = useAutoRefresh(load);

  const areaOf = (src: MapSource) => src.village ?? 'Unnamed area';
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.sources ?? []).filter((src) => (status === 'all' || src.status === status) && (!area || areaOf(src) === area)
      && (!q || `${src.name} ${src.village ?? ''} ${src.ward ?? ''} ${src.source_type}`.toLowerCase().includes(q)));
  }, [data, query, status, area]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.sources.length ?? 0 };
    for (const src of data?.sources ?? []) c[src.status] = (c[src.status] ?? 0) + 1;
    return c;
  }, [data]);

  const TABS = [['sources', 'Sources'], ['map', 'Map'], ['trends', 'Trends'], ['leaderboard', 'Leaders'], ['about', 'About']] as const;

  return (
    <View style={s.screen}>
      <View style={s.tabs}>
        {TABS.map(([key, label]) => (
          <Pressable key={key} testID={`public-tab-${key}`} style={[s.tab, panel === key && s.tabActive]}
            onPress={() => { setPanel(key); setOpen(null); }} accessibilityRole="tab" accessibilityState={{ selected: panel === key }}>
            <Text style={[s.tabText, panel === key && s.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <RefreshBar state={refresh} />

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refresh.refreshing} onRefresh={refresh.refresh} />}>
        {data?.offline && <Text style={s.offline}>Offline demo data — the server cannot be reached. Pull down to retry.</Text>}
        {error && (
          <Card>
            <Text style={s.error}>{error}</Text>
            <Pressable style={s.btn} onPress={refresh.refresh} accessibilityRole="button"><Text style={s.btnText}>Try again</Text></Pressable>
          </Card>
        )}
        {!data && !error && <Text style={s.note}>Loading public water data…</Text>}

        {data && panel === 'sources' && !open && (
          <>
            <View style={s.stats}>
              <Stat label="Sources" value={data.sources.length} />
              <Stat label="Screened (30 days)" value={data.sources.reduce((n, x) => n + x.screenings_30d, 0)} />
              <Stat label="Open issues" value={data.sources.reduce((n, x) => n + x.open_issues, 0)} tone={colors.alert} />
            </View>
            <TextInput style={s.search} value={query} onChangeText={setQuery} placeholder="Search by name, village or type"
              placeholderTextColor={colors.textFaint} accessibilityLabel="Search sources" testID="public-search" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {FILTERS.map(([key, label]) => (
                <Pressable key={key} style={[s.chip, status === key && s.chipOn]} onPress={() => setStatus(key)} accessibilityRole="radio"
                  accessibilityState={{ selected: status === key }}>
                  <Text style={[s.chipText, status === key && s.chipTextOn]}>{label} {counts[key] ?? 0}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {area && (
              <Pressable style={s.areaTag} onPress={() => setArea(null)} accessibilityRole="button">
                <Text style={s.areaTagText}>Area: {area}  ✕</Text>
              </Pressable>
            )}
            <Text style={s.note}>{shown.length} of {data.sources.length} sources</Text>
            {shown.map((src) => (
              <Pressable key={src.source_id} style={s.item} onPress={() => setOpen(src)} accessibilityRole="button"
                testID={`public-source-${src.source_id}`}>
                <View style={s.between}>
                  <Text style={s.itemTitle} numberOfLines={1}>{src.name}</Text>
                  <Badge label={src.status_label} tone={STATUS_TONE[src.status] ?? 'unknown'} />
                </View>
                <Text style={s.note}>
                  {src.source_type.replace('_', ' ')} · {areaOf(src)}{src.ward ? `, ${src.ward}` : ''}
                </Text>
                <Text style={s.note}>
                  {src.last_screened_at ? `Last screening: ${recordAgeLabel(src.last_screened_at, now()).toLowerCase()}` : 'Not screened yet'}
                  {' · '}{src.screenings_30d} in 30 days{src.open_issues ? ` · ${src.open_issues} open issue${src.open_issues === 1 ? '' : 's'}` : ''}
                </Text>
              </Pressable>
            ))}
            <Text style={s.footer}>{data.disclaimer}</Text>
          </>
        )}

        {data && panel === 'sources' && open && (
          <>
            <Card>
              <View style={s.between}>
                <CardTitle>{open.name}</CardTitle>
                <Badge label={open.status_label} tone={STATUS_TONE[open.status] ?? 'unknown'} />
              </View>
              <Row label="Type" value={open.source_type.replace('_', ' ')} />
              <Row label="Area" value={`${areaOf(open)}${open.ward ? `, ${open.ward}` : ''}`} />
              <Row label="Last field screening" value={open.last_screened_at ? recordAgeLabel(open.last_screened_at, now()) : 'None yet'} />
              <Row label="Screenings in 30 days" value={String(open.screenings_30d)} />
              <Row label="Open issues" value={String(open.open_issues)} tone={open.open_issues ? 'alert' : undefined} />
              <Row label="Lab-verified" value={open.lab_verified_at ? recordAgeLabel(open.lab_verified_at, now()) : 'Not yet'} />
              <Row label="Record updated" value={recordAgeLabel(open.last_updated, now())} />
              <Divider />
              <Row label="Location" value={open.location_precision} />
              {open.latitude !== null && open.longitude !== null && (
                <Pressable style={s.ghost} accessibilityRole="link"
                  onPress={() => void Linking.openURL(`https://www.openstreetmap.org/?mlat=${open.latitude}&mlon=${open.longitude}#map=16/${open.latitude}/${open.longitude}`)}>
                  <Text style={s.ghostText}>Open on the map</Text>
                </Pressable>
              )}
            </Card>
            <Card>
              <CardTitle>What this page does not tell you</CardTitle>
              <Text style={s.note}>
                • A field screening is not a laboratory test.{'\n'}
                • It does not describe the water today, only what was last recorded.{'\n'}
                • It is not advice about whether to drink. Contact the water authority (see About).
              </Text>
            </Card>
            <Pressable style={s.ghost} onPress={() => setOpen(null)} accessibilityRole="button" testID="public-back">
              <Text style={s.ghostText}>Back to all sources</Text>
            </Pressable>
          </>
        )}

        {data && panel === 'map' && <PublicMap sources={data.sources} />}

        {data && panel === 'trends' && <Trends stats={data.stats} />}

        {data && panel === 'trends' && (
          <>
            <Text style={s.section}>Areas</Text>
            {data.board.areas.map((a) => (
              <Pressable key={a.area} style={s.item} onPress={() => { setArea(a.area); setStatus('all'); setPanel('sources'); }}
                accessibilityRole="button">
                <View style={s.between}>
                  <Text style={s.itemTitle}>{a.area}</Text>
                  <Text style={s.note}>View sources ›</Text>
                </View>
                <View style={s.stats}>
                  <Stat label="Sources" value={a.sources} />
                  <Stat label="Screened (30 days)" value={a.screenings_30d} />
                  <Stat label="Open issues" value={a.open_issues} tone={colors.alert} />
                </View>
              </Pressable>
            ))}
            {data.board.areas.length === 0 && <Text style={s.note}>No areas yet.</Text>}
          </>
        )}

        {data && panel === 'leaderboard' && (
          <>
            <Card>
              <CardTitle>Field worker leaderboard</CardTitle>
              <Text style={s.note}>Points for complete, on-time screenings with a photo.</Text>
              {data.board.field_workers.map((w) => (
                <View key={`${w.rank}-${w.display_name}`} style={s.rankRow}>
                  <Text style={[s.rank, w.rank <= 3 && s.rankTop]}>{w.rank <= 3 ? ['🥇', '🥈', '🥉'][w.rank - 1] : `#${w.rank}`}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.itemTitle}>{w.display_name}</Text>
                    <Text style={s.note}>{w.area ?? '—'} · {w.on_time_screenings} on time of {w.screenings}</Text>
                  </View>
                  <Text style={s.points}>{w.points}</Text>
                </View>
              ))}
              {data.board.field_workers.length === 0 && <Text style={s.note}>No field workers yet.</Text>}
            </Card>
            <Card>
              <CardTitle>Most active areas (30 days)</CardTitle>
              {data.board.areas.map((a) => (
                <Row key={a.area} label={`#${a.rank} ${a.area}`} value={`${a.screenings_30d} screenings`} />
              ))}
            </Card>
            <Text style={s.footer}>{data.board.disclaimer}</Text>
          </>
        )}

        {panel === 'about' && (
          <>
            <Card>
              <CardTitle>What the statuses mean</CardTitle>
              {FILTERS.slice(1).map(([key, label]) => (
                <View key={key} style={s.between}>
                  <Badge label={label} tone={STATUS_TONE[key]} />
                </View>
              ))}
              <Text style={s.note}>
                Statuses describe the monitoring record, not the water. "Lab-verified" means a laboratory report for the last
                sample was verified; it does not cover parameters that were not tested or the water today.
              </Text>
            </Card>
            <Card>
              <CardTitle>Contact</CardTitle>
              <Row label="Reporting helpline" value="1800 123 5678" />
              <Row label="Availability" value="24×7, toll free" />
              <Divider />
              <Text style={s.note}>
                For any question about whether this water is suitable for a particular use, contact the water authority on
                the number above. This app does not give guidance on treating water. Residents can sign in to report a problem.
              </Text>
            </Card>
            <Card>
              <CardTitle>How sources are monitored</CardTitle>
              <Text style={s.note}>
                Trained field workers record screenings with test kits, including a look at the surroundings of each source.
                Supervisors review the results and a laboratory verifies selected samples.
              </Text>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const RISK_COLORS = { low: colors.ok, medium: colors.watch, high: colors.alert, unknown: colors.unknown };
const STATUS_WORDS: Record<string, string> = {
  not_tested: 'Not yet tested', under_review: 'Under review', action_pending: 'Action pending', no_open_issues: 'No open issues',
  lab_verified_safe: 'Lab-verified',
};
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The graphs: weekly activity, the report pipeline, the 30-day risk mix, sources by type and status, complaints. */
function Trends({ stats }: { stats: PublicStats }): React.JSX.Element {
  const labels = stats.weeks.map((w) => shortDate(w.week_start));
  const t = stats.totals;
  return (
    <>
      <View style={s.stats}>
        <Stat label="Screenings (12 wk)" value={stats.weeks.reduce((n, w) => n + w.screenings, 0)} />
        <Stat label="Open reports" value={t.open_reports} tone={colors.alert} />
        <Stat label="Escalated to authority" value={t.escalated_to_authority} tone={colors.watch} />
      </View>
      <Card>
        <CardTitle>Field screenings per week</CardTitle>
        <Bars labels={labels} stacked series={[
          { name: 'Within band', color: colors.primary, values: stats.weeks.map((w) => w.screenings - w.flagged) },
          { name: 'Flagged for review', color: colors.watch, values: stats.weeks.map((w) => w.flagged) },
        ]} />
      </Card>
      <Card>
        <CardTitle>Reports opened and closed per week</CardTitle>
        <Bars labels={labels} series={[
          { name: 'Opened', color: colors.alert, values: stats.weeks.map((w) => w.reports_opened) },
          { name: 'Closed', color: colors.ok, values: stats.weeks.map((w) => w.reports_closed) },
        ]} />
      </Card>
      <Card>
        <CardTitle>Screening results, last 30 days</CardTitle>
        <SplitBar parts={[
          { name: 'Within band', value: stats.risk_30d.low, color: RISK_COLORS.low },
          { name: 'Watch', value: stats.risk_30d.medium, color: RISK_COLORS.medium },
          { name: 'Outside band', value: stats.risk_30d.high, color: RISK_COLORS.high },
        ]} />
      </Card>
      <Card>
        <CardTitle>Sources by type</CardTitle>
        <HBars items={Object.entries(stats.sources_by_type).map(([k, v]) => ({
          label: SOURCE_TYPE_LABELS[k] ?? k, value: v, color: SOURCE_TYPE_COLORS[k] ?? SOURCE_TYPE_COLORS.other }))} />
      </Card>
      <Card>
        <CardTitle>Sources by record status</CardTitle>
        <HBars items={Object.entries(stats.sources_by_status).map(([k, v]) => ({
          label: STATUS_WORDS[k] ?? k, value: v, color: k === 'action_pending' ? colors.alert : k === 'under_review' ? colors.watch
            : k === 'lab_verified_safe' ? colors.ok : colors.unknown }))} />
      </Card>
      <Card>
        <CardTitle>Resident complaints per week</CardTitle>
        <Bars labels={labels} height={100} series={[{ name: 'Complaints', color: '#7C3AED', values: stats.weeks.map((w) => w.complaints) }]} />
        <HBars items={Object.entries(stats.complaints_by_type).map(([k, v]) => ({ label: k.replace('_', ' '), value: v, color: '#A78BFA' }))} />
      </Card>
      <Text style={s.footer}>{stats.disclaimer}</Text>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }): React.JSX.Element {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, tone && value ? { color: tone } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  tabs: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xs },
  tab: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center', backgroundColor: colors.card, borderWidth: 1,
         borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.onPrimary },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  offline: { backgroundColor: colors.watchSoft, color: colors.watch, fontWeight: '600', fontSize: 12, padding: spacing.sm, borderRadius: radius.sm },
  error: { color: colors.alert, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
  statLabel: { ...type.tiny, textAlign: 'center' },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
            fontSize: 15, color: colors.text, backgroundColor: colors.card },
  chips: { gap: spacing.sm },
  chip: { paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  chipTextOn: { color: colors.onPrimary },
  areaTag: { alignSelf: 'flex-start', backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: spacing.md },
  areaTagText: { color: colors.primaryDark, fontWeight: '700', fontSize: 12 },
  item: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  itemTitle: { ...type.body, fontWeight: '700', flexShrink: 1 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  rank: { width: 36, fontSize: 15, fontWeight: '800', color: colors.textMuted, textAlign: 'center' },
  rankTop: { fontSize: 22 },
  points: { fontSize: 20, fontWeight: '800', color: colors.primary },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xs },
  ghostText: { ...type.body, color: colors.textMuted },
  footer: { ...type.tiny, textAlign: 'center', marginTop: spacing.sm },
  section: { ...type.body, fontWeight: '800', color: colors.primaryDark, marginTop: spacing.sm },
});
