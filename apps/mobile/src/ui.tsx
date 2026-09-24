/**
 * Small shared presentation primitives for the two app surfaces.
 *
 * Deliberately plain: `View`/`Text` compositions with the shared tokens, no
 * component library and no new dependency. Enough to reproduce the mockup's
 * card language (white cards, soft borders, pill badges, step rail) without
 * inventing a design system.
 */

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, radius, shadow, spacing, type } from './theme';

export type Tone = 'ok' | 'watch' | 'alert' | 'unknown';

const TONE_FG: Record<Tone, string> = {
  ok: colors.ok,
  watch: colors.watch,
  alert: colors.alert,
  unknown: colors.unknown,
};
const TONE_BG: Record<Tone, string> = {
  ok: colors.okSoft,
  watch: colors.watchSoft,
  alert: colors.alertSoft,
  unknown: colors.unknownSoft,
};

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}): React.JSX.Element {
  return <View style={[s.card, style]}>{children}</View>;
}

export function CardTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text style={s.cardTitle}>{children}</Text>;
}

export function Badge({
  label,
  tone = 'unknown',
}: {
  label: string;
  tone?: Tone;
}): React.JSX.Element {
  return (
    <View style={[s.badge, { backgroundColor: TONE_BG[tone] }]}>
      <Text style={[s.badgeText, { color: TONE_FG[tone] }]}>{label}</Text>
    </View>
  );
}

/** Key/value row used throughout both surfaces. */
export function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: Tone;
}): React.JSX.Element {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, tone ? { color: TONE_FG[tone] } : null]}>{value}</Text>
    </View>
  );
}

/**
 * A status block with a coloured left rule.
 *
 * `caveat` is not optional by accident — every status shown to a worker or a
 * resident carries the sentence that keeps it honest, so a caller cannot
 * render a bare verdict.
 */
export function StatusBlock({
  title,
  caveat,
  tone,
}: {
  title: string;
  caveat: string;
  tone: Tone;
}): React.JSX.Element {
  return (
    <View style={[s.status, { backgroundColor: TONE_BG[tone], borderLeftColor: TONE_FG[tone] }]}>
      <Text style={[s.statusTitle, { color: TONE_FG[tone] }]}>{title}</Text>
      <Text style={s.statusCaveat}>{caveat}</Text>
    </View>
  );
}

/** The numbered progress rail from the worker mockup. */
export function StepRail({
  steps,
  current,
}: {
  steps: readonly string[];
  current: number;
}): React.JSX.Element {
  return (
    <View style={s.rail}>
      {steps.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <View key={label} style={s.railItem}>
            <View
              style={[
                s.railDot,
                (active || done) && { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Text style={[s.railDotText, (active || done) && { color: colors.onPrimary }]}>
                {i + 1}
              </Text>
            </View>
            <Text style={[s.railLabel, active && s.railLabelActive]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function Divider(): React.JSX.Element {
  return <View style={s.divider} />;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  cardTitle: { ...type.h3, marginBottom: 2 },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    gap: spacing.md,
  },
  rowLabel: { ...type.small, flexShrink: 1 },
  rowValue: { ...type.body, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  status: {
    borderLeftWidth: 4,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  statusTitle: { fontSize: 15.5, fontWeight: '700' },
  statusCaveat: { fontSize: 12.5, color: colors.text, lineHeight: 18 },
  rail: { flexDirection: 'row', gap: spacing.xs },
  railItem: { flex: 1, alignItems: 'center', gap: 5 },
  railDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railDotText: { fontSize: 12, fontWeight: '700', color: colors.textFaint },
  railLabel: { fontSize: 10.5, color: colors.textFaint, textAlign: 'center' },
  railLabelActive: { color: colors.primary, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 2 },
});
