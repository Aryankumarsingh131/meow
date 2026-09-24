/**
 * JalSakshi — WORKER app surface.
 *
 * Reproduces the supplied worker mockup: header with offline/sync state, a
 * 4-step rail (Scan Source, Capture Strip, Quality Check, Submit), the
 * identified-source card, capture panel, capture-quality panel, separated
 * field observations, location, previous tests, and the action row.
 *
 * ## Where this deliberately differs from the mockup
 *
 * The mockup showed an "AI Quality Check" card whose indicative result was
 * worded as a reassuring potability verdict, alongside a high confidence
 * percentage. Both are forbidden here:
 *
 * (The prohibited phrasings are deliberately not reproduced in this file.
 * tests/status-label.test.ts greps the source for them, and that check is kept
 * strict on purpose — there is no "it was only in a comment" exemption.)
 *
 *  - No model has been approved for any protocol (T23-T27 are unbuilt and
 *    `quality_policy.model.enabled` is false), so a confidence figure would be
 *    invented. The assisted panel says so instead.
 *  - "Safe / Acceptable" is a potability claim. Screening never makes one.
 *
 * The capture-quality card is real though: those checks are T10's deterministic
 * rules (blur/glare/clipping/reference card), which judge the PHOTOGRAPH and
 * make no claim about the water.
 *
 * ## Provenance stays split
 *
 * "Screening" (machine), "Field observations" (what the worker saw) and
 * "Laboratory" are three separate cards and three separate stored fields.
 * They are never combined into one "result", which is why the observations
 * card sits apart from the screening card rather than inside it.
 *
 * All values on this screen are DEMO FIXTURES. No real kit, lot or protocol
 * exists (T01 is still a fictional template).
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, type } from './theme';
import { Badge, Card, CardTitle, Divider, Row, StatusBlock, StepRail } from './ui';
import {
  assistedAvailability,
  qualityReasonText,
  recordAgeLabel,
  screeningPresentation,
  type IndicativeFlag,
} from './statusLabel';

const STEPS = ['Scan Source', 'Capture Strip', 'Quality Check', 'Submit'] as const;

export interface WorkerAppProps {
  now?: () => number;
}

export function WorkerApp({ now = Date.now }: WorkerAppProps): React.JSX.Element {
  const [step, setStep] = useState(2);
  const [odour, setOdour] = useState('No odour');
  const [turbidity, setTurbidity] = useState('Clear');
  const [remarks, setRemarks] = useState('');
  const [flag] = useState<IndicativeFlag>('no_flag');

  const screening = screeningPresentation(flag);
  // No approved model exists, so the assisted path is unavailable by
  // configuration, not by failure.
  const assisted = assistedAvailability(false);

  // T10 reason codes from the deterministic quality rules.
  const qualityReasons = ['THRESHOLD_UNSET'];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.brand}>JalSakshi</Text>
          <Text style={s.brandSub}>Field testing — worker</Text>
        </View>
        <View style={s.offline}>
          <Text style={s.offlineTitle}>Offline mode</Text>
          <Text style={s.offlineSub}>3 pending sync</Text>
        </View>
      </View>

      <StepRail steps={STEPS} current={step} />

      {/* 1. Source */}
      <Card>
        <View style={s.between}>
          <CardTitle>Source identified</CardTitle>
          <Badge label="Assigned" tone="ok" />
        </View>
        <Text style={s.sourceId}>RS-1043</Text>
        <Row label="Type" value="Hand pump" />
        <Row label="Locality" value="Kalyanpur village" />
        <Divider />
        {/* T07's rule: a cached record is labelled with its age, never shown
            as a current status. */}
        <Row label="Last recorded test" value={recordAgeLabel('2026-09-05T10:00:00Z', now())} />
        <Text style={s.note}>
          This is the last record on this phone. It may be out of date and is not the
          current condition of the source.
        </Text>
      </Card>

      {/* 2. Capture */}
      <Card>
        <View style={s.between}>
          <CardTitle>Capture test strip</CardTitle>
          <Badge label="Step 2" tone="unknown" />
        </View>
        <View style={s.viewfinder}>
          <View style={s.frame} />
          <Text style={s.viewfinderText}>
            Place the strip and the reference card inside the frame
          </Text>
        </View>
        <View style={s.btnRow}>
          <Pressable style={[s.btn, s.btnGhost]} onPress={() => setStep(1)}>
            <Text style={s.btnGhostText}>Retake photo</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnPrimary]} onPress={() => setStep(2)}>
            <Text style={s.btnPrimaryText}>Capture</Text>
          </Pressable>
        </View>
      </Card>

      {/* 3. Capture quality (T10) — about the PHOTO, not the water */}
      <Card>
        <View style={s.between}>
          <CardTitle>Capture quality</CardTitle>
          <Badge label="Provisional rules" tone="watch" />
        </View>
        <Text style={s.note}>
          These checks judge the photograph only. They say nothing about the water.
        </Text>
        <Row label="Strip alignment" value="Checked" tone="ok" />
        <Row label="Focus" value="Checked" tone="ok" />
        <Row label="Glare" value="Checked" tone="ok" />
        <Row label="Reference card" value="Detected" tone="ok" />
        {qualityReasons.map((code) => (
          <Text key={code} style={s.reason}>
            • {qualityReasonText(code)}
          </Text>
        ))}
        <Text style={s.note}>
          Quality thresholds are provisional and not yet approved against real
          data.
        </Text>
      </Card>

      {/* 4. Screening + assisted availability */}
      <Card>
        <CardTitle>Screening outcome (machine)</CardTitle>
        <StatusBlock title={screening.title} caveat={screening.detail} tone={screening.tone} />
        <Divider />
        <Text style={s.subhead}>{assisted.label}</Text>
        <Text style={s.note}>{assisted.detail}</Text>
      </Card>

      {/* 5. Field observations — a SEPARATE provenance channel */}
      <Card>
        <CardTitle>Field observations (what you saw)</CardTitle>
        <Text style={s.note}>
          Recorded separately from the machine screening. Your observation is never
          merged into the machine result.
        </Text>
        <Row label="Odour" value={odour} />
        <Row label="Turbidity" value={turbidity} />
        <Text style={s.inputLabel}>Remarks</Text>
        <TextInput
          style={s.input}
          value={remarks}
          onChangeText={setRemarks}
          placeholder="Anything you noticed at the source"
          placeholderTextColor={colors.textFaint}
          multiline
        />
      </Card>

      {/* 6. Actions */}
      <View style={s.actions}>
        <Pressable style={[s.btn, s.btnGhost]}>
          <Text style={s.btnGhostText}>Save offline</Text>
        </Pressable>
        <Pressable style={[s.btn, s.btnPrimary]} onPress={() => setStep(3)}>
          <Text style={s.btnPrimaryText}>Submit for review</Text>
        </Pressable>
      </View>
      <Pressable style={[s.btn, s.btnAlert]}>
        <Text style={s.btnAlertText}>Escalate to supervisor</Text>
      </Pressable>

      <Text style={s.footer}>
        Demo fixtures. No real kit, lot or protocol has been selected, so nothing
        here is domain-validated.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brand: { ...type.h1, color: colors.primaryDark },
  brandSub: { ...type.small },
  offline: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  offlineTitle: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  offlineSub: { fontSize: 10.5, color: colors.textMuted },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sourceId: { fontSize: 26, fontWeight: '800', color: colors.primaryDark, letterSpacing: 0.5 },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  subhead: { ...type.h3 },
  reason: { fontSize: 12.5, color: colors.watch },
  viewfinder: {
    height: 170,
    backgroundColor: '#0D1B26',
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  frame: {
    width: '62%',
    height: 92,
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: radius.sm,
  },
  viewfinderText: { color: '#E6F0F8', fontSize: 11.5, textAlign: 'center', paddingHorizontal: 20 },
  inputLabel: { ...type.small, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
    textAlignVertical: 'top',
    color: colors.text,
    backgroundColor: colors.cardAlt,
  },
  btnRow: { flexDirection: 'row', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, paddingVertical: 13, borderRadius: radius.md, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  btnGhostText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  btnAlert: { backgroundColor: colors.alertSoft, borderWidth: 1, borderColor: colors.alert },
  btnAlertText: { color: colors.alert, fontWeight: '700', fontSize: 15 },
  footer: { ...type.tiny, textAlign: 'center', marginTop: spacing.sm },
});
