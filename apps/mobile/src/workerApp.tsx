/**
 * JalSakshi — WORKER app: the M1 field flow.
 *
 * Until M1 this file was a static mockup whose values (source "RS-1043",
 * "3 pending sync") were hardcoded. It is now built step by step from the
 * real task modules, and a step appears here only once it works:
 *
 *   1. Source      — T07: server catalogue, cached on the phone per account
 *   2. Protocol    — T08 (next)
 *   3. Capture     — T09
 *   4. Review      — T11
 *   5. Save + sync — T12, T15
 *
 * Wording rules (tests/status-label.test.ts): no potability claim, no
 * confidence percentage, no remediation instruction. All data is synthetic
 * (ADR-M1-001).
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DEV_API_BASE, fetchCatalogue } from './api';
import { deviceSql } from './deviceDb';
import type { Session } from './session';
import { freshnessLabel, freshnessOf, type CachedSource } from './sourceCatalog';
import { SourcesScreen } from './sources';
import { applyCatalogueFetch, loadCatalogue, type CatalogueView } from './storage';
import { colors, radius, spacing, type } from './theme';
import { Card, CardTitle, Row, StepRail } from './ui';

const STEPS = ['Source', 'Protocol', 'Capture', 'Review', 'Save'] as const;

const PROBLEM_TEXT: Record<NonNullable<CatalogueView['problem']>, string> = {
  offline: 'Offline — showing the copy saved on this phone.',
  auth_required: 'Your sign-in has expired. Sign in again to refresh.',
  server_error: 'The server could not send the source list — showing the saved copy.',
};

export interface WorkerAppProps {
  session: Session;
  /** Called when the server rejects the token; the host returns to sign-in. */
  onAuthExpired(): void;
  now?: () => number;
}

export function WorkerApp({ session, onAuthExpired, now = Date.now }: WorkerAppProps): React.JSX.Element {
  const owner = session.auth.subject;
  const [catalogue, setCatalogue] = useState<CatalogueView>(() => ({
    ...loadCatalogue(deviceSql(), owner), origin: 'cache', problem: null,
  }));
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<CachedSource | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    const outcome = await fetchCatalogue(DEV_API_BASE, session.auth.token);
    setCatalogue(applyCatalogueFetch(deviceSql(), owner, outcome));
    setRefreshing(false);
    if (outcome.kind === 'auth_required') onAuthExpired();
  };

  useEffect(() => {
    void refresh();
    // Once per signed-in account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const age = freshnessLabel(freshnessOf(catalogue.servedAt, now()));

  if (!source) {
    return (
      <View style={s.screen}>
        <View style={s.pad}>
          <StepRail steps={STEPS} current={0} />
          <Text style={s.meta} testID="catalogue-status">
            {refreshing ? 'Updating source list…' : catalogue.problem ? PROBLEM_TEXT[catalogue.problem] : 'Source list from server.'}
            {catalogue.servedAt ? ` ${age.replace('Last known record', 'Saved list')}.` : ''}
          </Text>
        </View>
        <SourcesScreen cache={catalogue.items} onSelectSource={setSource} now={now} />
      </View>
    );
  }

  return (
    <View style={[s.screen, s.pad]}>
      <StepRail steps={STEPS} current={1} />
      <Card>
        <CardTitle>Source selected</CardTitle>
        <Text style={s.label} testID="selected-source">{source.label}</Text>
        <Row label="Locality" value={source.locality} />
        <Row label="Code" value={source.qrCode} />
      </Card>
      <Text style={s.meta}>Next step: kit protocol and read window (T08).</Text>
      <Pressable style={s.btn} onPress={() => setSource(null)} accessibilityRole="button" testID="change-source">
        <Text style={s.btnText}>Choose a different source</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: spacing.lg, gap: spacing.md },
  meta: { ...type.small, color: colors.textMuted },
  label: { ...type.h3, color: colors.text },
  btn: {
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  btnText: { ...type.body, color: colors.text },
});
