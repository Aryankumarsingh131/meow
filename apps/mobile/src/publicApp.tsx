/**
 * JalSakshi — PUBLIC / COMMUNITY app surface.
 *
 * Reproduces the supplied three-panel community mockup: Source Overview,
 * Details & History, and Community & Actions, as three tabs.
 *
 * ## Where this deliberately differs from the mockup
 *
 * The mockup's overview panel led with a large green potability verdict and a
 * matching pill, and its actions panel gave water-treatment advice. Those are
 * the highest-risk strings in the whole product: a resident who reads a
 * drinking-water assurance will act on it. AGENTS.md forbids both a potability
 * claim and a remediation instruction, so the summary states what a laboratory
 * actually measured, against which standard, on which date, and stops there.
 *
 * (The prohibited phrasings are deliberately not reproduced in this file;
 * tests/status-label.test.ts greps the source for them.)
 *
 * ## What IS kept from the mockup, and why it is legitimate
 *
 * The precise numbers (pH 7.2, 1.8 NTU, 0.4 mg/L, E. coli not detected) are
 * kept, because they come from a **verified laboratory report** — a distinct
 * provenance channel from screening. A laboratory measured them and a
 * `lab_reviewer` verified the report, so reporting them as "as tested on
 * <date> by <lab>" is a fact rather than a fabrication. The same numbers
 * coming from a phone photo would NOT be legitimate, and screening results
 * are not shown on this surface at all.
 *
 * Every value here is a DEMO FIXTURE.
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from './theme';
import { Badge, Card, CardTitle, Divider, Row, StatusBlock } from './ui';
import { labParameterTone, labSummary, recordAgeLabel, type LabParameter } from './statusLabel';

type Panel = 'overview' | 'details' | 'community';

const LAB = 'Riverside District Water Lab';
const TESTED_ON_ISO = '2026-09-18T00:00:00Z';
const TESTED_ON = '18 Sep 2026';

/** Verified laboratory report fixture. Numbers are legitimate ONLY because
 *  they carry this provenance; see the module docstring. */
const PARAMETERS: LabParameter[] = [
  { name: 'pH', value: '7.2', unit: null, limitText: '6.5 – 8.5', withinLimit: true },
  { name: 'Turbidity', value: '1.8', unit: 'NTU', limitText: '≤ 5', withinLimit: true },
  { name: 'Nitrate', value: '8', unit: 'mg/L', limitText: '≤ 45', withinLimit: true },
  { name: 'Residual chlorine', value: '0.4', unit: 'mg/L', limitText: '0.2 – 1.0', withinLimit: true },
  { name: 'E. coli', value: 'Not detected', unit: null, limitText: '0 per 100 mL', withinLimit: true },
];

const HISTORY = [
  { date: '18 Sep 2026', note: 'All tested parameters within limits', tone: 'ok' as const },
  { date: '10 Aug 2026', note: 'All tested parameters within limits', tone: 'ok' as const },
  { date: '05 Jul 2026', note: 'Turbidity above limit (6.1 NTU)', tone: 'watch' as const },
];

export interface PublicAppProps {
  now?: () => number;
}

export function PublicApp({ now = Date.now }: PublicAppProps): React.JSX.Element {
  const [panel, setPanel] = useState<Panel>('overview');
  const allWithin = PARAMETERS.every((p) => p.withinLimit === true);
  const summary = labSummary(allWithin, TESTED_ON, LAB);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>JalSakshi</Text>
          <Text style={s.brandSub}>Water quality information for residents</Text>
        </View>
      </View>

      <View style={s.tabs}>
        {(
          [
            ['overview', 'Overview'],
            ['details', 'Details'],
            ['community', 'Community'],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            testID={`public-tab-${key}`}
            style={[s.tab, panel === key && s.tabActive]}
            onPress={() => setPanel(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: panel === key }}
          >
            <Text style={[s.tabText, panel === key && s.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {panel === 'overview' && (
          <>
            <Card>
              <View style={s.between}>
                <CardTitle>Patel Nagar hand pump</CardTitle>
                <Badge label="Public source" tone="unknown" />
              </View>
              <Text style={s.sourceId}>RS-1043</Text>
              <Row label="Locality" value="Patel Nagar, Riverside District" />
            </Card>

            <Card>
              {/* The mockup's big green "Safe" block. Reworded to state the
                  measurement, not a drinking-water guarantee. */}
              <StatusBlock title={summary.title} caveat={summary.detail} tone={summary.tone} />
              <Divider />
              <Row label="Tested by" value={LAB} />
              <Row label="Tested on" value={TESTED_ON} />
              <Row label="Record age" value={recordAgeLabel(TESTED_ON_ISO, now())} />
              <Text style={s.note}>
                This describes one laboratory test of one sample taken on that date.
                Water quality can change between tests.
              </Text>
            </Card>

            <Card>
              <CardTitle>What this page does not tell you</CardTitle>
              <Text style={s.note}>
                • It does not cover parameters that were not tested.{'\n'}
                • It does not describe the water today, only the sample tested.{'\n'}
                • It is not advice about whether to drink. For that, contact the
                water authority using the details under Community.
              </Text>
            </Card>
          </>
        )}

        {panel === 'details' && (
          <>
            <Card>
              <View style={s.between}>
                <CardTitle>Laboratory results</CardTitle>
                <Badge label="Verified report" tone="ok" />
              </View>
              <Text style={s.note}>
                Measured by {LAB} on {TESTED_ON}. Compared against the published BIS
                10500 limits.
              </Text>
              <Divider />
              {PARAMETERS.map((p) => (
                <View key={p.name} style={s.param}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.paramName}>{p.name}</Text>
                    <Text style={s.paramLimit}>Limit {p.limitText}</Text>
                  </View>
                  <Text style={s.paramValue}>
                    {p.value}
                    {p.unit ? ` ${p.unit}` : ''}
                  </Text>
                  <Badge
                    label={p.withinLimit === null ? 'Not tested' : p.withinLimit ? 'Within limit' : 'Above limit'}
                    tone={labParameterTone(p)}
                  />
                </View>
              ))}
            </Card>

            <Card>
              <CardTitle>Previous laboratory tests</CardTitle>
              {HISTORY.map((h) => (
                <View key={h.date} style={s.histRow}>
                  <Text style={s.histDate}>{h.date}</Text>
                  <Text style={s.histNote}>{h.note}</Text>
                  <Badge label={h.tone === 'ok' ? 'Within limits' : 'Outside limits'} tone={h.tone} />
                </View>
              ))}
              <Text style={s.note}>
                Only laboratory-verified reports appear here. Field screening results
                are not shown, because a screening is not a laboratory test.
              </Text>
            </Card>
          </>
        )}

        {panel === 'community' && (
          <>
            <Card>
              <CardTitle>Report a problem</CardTitle>
              <Text style={s.note}>
                Tell the water authority if something has changed at this source — a
                break, a leak, or a change you have noticed.
              </Text>
              {/* T48: these did nothing when tapped. Until in-app reporting
                  exists they are visibly and programmatically disabled, and the
                  helpline below is named as the way to do it. */}
              <Pressable style={[s.btn, s.btnPrimary, s.btnDisabled]} disabled accessibilityRole="button"
                accessibilityState={{ disabled: true }} accessibilityHint="Not available in the app yet. Call the helpline below.">
                <Text style={s.btnPrimaryText}>Report an issue</Text>
              </Pressable>
              <Pressable style={[s.btn, s.btnGhost, s.btnDisabled]} disabled accessibilityRole="button"
                accessibilityState={{ disabled: true }} accessibilityHint="Not available in the app yet. Call the helpline below.">
                <Text style={s.btnGhostText}>Request a retest</Text>
              </Pressable>
              <Text style={s.note}>Not available in the app yet: call the reporting helpline below.</Text>
            </Card>

            <Card>
              <CardTitle>Contact</CardTitle>
              <Row label="Reporting helpline" value="1800 123 5678" />
              <Row label="Availability" value="24×7, toll free" />
              <Divider />
              <Text style={s.note}>
                {/* The mockup's water-treatment tip was a remediation
                    instruction and is deliberately not reproduced. Residents
                    are directed to the water authority instead. */}
                For any question about whether this water is suitable for a
                particular use, contact the water authority on the number above.
                This app does not give guidance on treating water.
              </Text>
            </Card>

            <Card>
              <CardTitle>How this source is monitored</CardTitle>
              <Text style={s.note}>
                Trained community workers record field screenings, and a laboratory
                verifies selected samples. Only verified laboratory reports are
                published on this page.
              </Text>
            </Card>
          </>
        )}

        <Text style={s.footer}>
          Demo fixtures. Not a real monitoring record for any real source.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, paddingBottom: spacing.sm },
  brand: { ...type.h1, color: colors.primaryDark },
  brandSub: { ...type.small },
  tabs: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  tabTextActive: { color: colors.onPrimary },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sourceId: { fontSize: 24, fontWeight: '800', color: colors.primaryDark, letterSpacing: 0.5 },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  param: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  paramName: { ...type.body, fontWeight: '600' },
  paramLimit: { ...type.tiny },
  paramValue: { ...type.body, fontWeight: '700', color: colors.primaryDark },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 7 },
  histDate: { ...type.small, width: 86 },
  histNote: { ...type.small, flex: 1 },
  btn: { paddingVertical: 12, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.xs },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  btnGhostText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.5 },
  footer: { ...type.tiny, textAlign: 'center', marginTop: spacing.sm },
});
