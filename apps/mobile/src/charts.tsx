/**
 * Small charts drawn with plain Views (no chart library): vertical bars
 * (stacked or side by side), horizontal bars and a proportional split bar.
 * Every chart carries its numbers as text too, for screen readers.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from './theme';

export interface Series {
  name: string;
  color: string;
  values: number[];
}

const Legend = ({ items }: { items: Array<{ name: string; color: string }> }) => (
  <View style={s.legend}>
    {items.map((i) => (
      <View key={i.name} style={s.legendItem}>
        <View style={[s.swatch, { backgroundColor: i.color }]} />
        <Text style={s.legendText}>{i.name}</Text>
      </View>
    ))}
  </View>
);

/** Vertical bars per label; `stacked` piles the series, otherwise they stand side by side. */
export function Bars({ labels, series, stacked = false, height = 140 }: {
  labels: string[];
  series: Series[];
  stacked?: boolean;
  height?: number;
}): React.JSX.Element {
  const totals = labels.map((_, i) => series.reduce((n, x) => n + x.values[i], 0));
  const max = Math.max(1, ...(stacked ? totals : series.flatMap((x) => x.values)));
  const summary = labels.map((l, i) => `${l}: ${series.map((x) => `${x.values[i]} ${x.name}`).join(', ')}`).join('; ');
  return (
    <View accessible accessibilityLabel={summary}>
      <View style={[s.plot, { height }]}>
        <Text style={s.axisMax}>{max}</Text>
        {labels.map((label, i) => (
          <View key={label} style={s.col}>
            {stacked ? (
              <View style={s.stack}>
                {series.map((x) => (
                  <View key={x.name} style={{ height: (x.values[i] / max) * (height - 18), backgroundColor: x.color }} />
                )).reverse()}
              </View>
            ) : (
              <View style={s.group}>
                {series.map((x) => (
                  <View key={x.name} style={[s.bar, { height: Math.max(1, (x.values[i] / max) * (height - 18)), backgroundColor: x.color }]} />
                ))}
              </View>
            )}
          </View>
        ))}
      </View>
      <View style={s.labels}>
        {labels.map((l, i) => <Text key={l} style={s.xLabel} numberOfLines={1}>{i % 2 === (labels.length - 1) % 2 ? l : ''}</Text>)}
      </View>
      <Legend items={series} />
    </View>
  );
}

/** One horizontal bar per item, longest first. */
export function HBars({ items }: { items: Array<{ label: string; value: number; color: string }> }): React.JSX.Element {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <View style={s.hWrap}>
      {items.map((i) => (
        <View key={i.label} style={s.hRow} accessible accessibilityLabel={`${i.label}: ${i.value}`}>
          <Text style={s.hLabel} numberOfLines={1}>{i.label}</Text>
          <View style={s.hTrack}>
            <View style={[s.hBar, { width: `${(i.value / max) * 100}%`, backgroundColor: i.color }]} />
          </View>
          <Text style={s.hValue}>{i.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** One bar split in proportion, with a legend showing counts and percentages. */
export function SplitBar({ parts }: { parts: Array<{ name: string; value: number; color: string }> }): React.JSX.Element {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return (
    <View accessible accessibilityLabel={parts.map((p) => `${p.name}: ${p.value}`).join(', ')}>
      <View style={s.split}>
        {parts.filter((p) => p.value > 0).map((p) => <View key={p.name} style={{ flex: p.value, backgroundColor: p.color }} />)}
      </View>
      <Legend items={parts.map((p) => ({ name: `${p.name} ${p.value} (${Math.round((p.value / total) * 100)}%)`, color: p.color }))} />
    </View>
  );
}

const s = StyleSheet.create({
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, borderBottomWidth: 1, borderBottomColor: colors.borderStrong,
          paddingTop: 16 },
  axisMax: { position: 'absolute', top: 0, left: 0, ...type.tiny },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  stack: { width: '80%', justifyContent: 'flex-end', borderTopLeftRadius: 3, borderTopRightRadius: 3, overflow: 'hidden' },
  group: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, width: '90%', justifyContent: 'center' },
  bar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  labels: { flexDirection: 'row', gap: 3, marginTop: 3 },
  xLabel: { flex: 1, fontSize: 9, color: colors.textMuted, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11, color: colors.textMuted },
  hWrap: { gap: 7 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hLabel: { width: 96, fontSize: 12, color: colors.text },
  hTrack: { flex: 1, height: 14, backgroundColor: colors.bgDeep, borderRadius: radius.sm, overflow: 'hidden' },
  hBar: { height: '100%', borderRadius: radius.sm },
  hValue: { width: 30, textAlign: 'right', fontSize: 12, fontWeight: '700', color: colors.text },
  split: { flexDirection: 'row', height: 18, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.bgDeep },
});
