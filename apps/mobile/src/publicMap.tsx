/**
 * The public map: every source as a dot coloured by its TYPE (hand pump, tap,
 * well...), on OpenStreetMap tiles, in a WebView running Leaflet. Tap a dot for
 * its name, status and area; tap a legend chip to hide or show a type.
 *
 * Locations are the server's public ones: fuzzed to about 500 m unless a lab
 * verified the source. Colours mean type only, never water quality; the
 * status is written in the popup in the server's own words.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { colors, radius, spacing, type } from './theme';
import { mapHtml, SOURCE_TYPE_COLORS, SOURCE_TYPE_LABELS } from './publicMapModel';
import type { MapSource } from './v2';

export { SOURCE_TYPE_COLORS, SOURCE_TYPE_LABELS };

export function PublicMap({ sources }: { sources: MapSource[] }): React.JSX.Element {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of sources) c[s.source_type] = (c[s.source_type] ?? 0) + 1;
    return c;
  }, [sources]);
  const shown = sources.filter((s) => !hidden.has(s.source_type));
  // Rebuild (and so reload) the map only when what it shows changes, not on every 30 s refresh.
  const shape = shown.map((x) => `${x.source_id}:${x.status}:${x.open_issues}:${x.latitude}:${x.longitude}`).join('|');
  const html = useMemo(() => mapHtml(shown), [shape]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={s.wrap}>
      <View style={s.map}>
        <WebView originWhitelist={['*']} source={{ html, baseUrl: 'https://jalsakshi.app/' }} javaScriptEnabled
          style={s.web} setSupportMultipleWindows={false} nestedScrollEnabled testID="public-map" />
      </View>
      <Text style={s.title}>Source types — tap to hide or show</Text>
      <View style={s.legend}>
        {Object.keys(SOURCE_TYPE_COLORS).filter((k) => counts[k]).map((k) => {
          const off = hidden.has(k);
          return (
            <Pressable key={k} style={[s.chip, off && s.chipOff]} accessibilityRole="switch" accessibilityState={{ checked: !off }}
              onPress={() => { const next = new Set(hidden); if (off) next.delete(k); else next.add(k); setHidden(next); }}>
              <View style={[s.dot, { backgroundColor: off ? colors.textFaint : SOURCE_TYPE_COLORS[k] }]} />
              <Text style={[s.chipText, off && s.chipTextOff]}>{SOURCE_TYPE_LABELS[k]} {counts[k]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.note}>
        Colours show the type of source only, not water quality. Pins are placed about 500 m from the real location unless a
        laboratory has verified the source.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: spacing.sm },
  map: { height: 420, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgDeep },
  web: { flex: 1, backgroundColor: 'transparent' },
  title: { ...type.small, fontWeight: '700', color: colors.text, marginTop: spacing.xs },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill,
          backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipOff: { backgroundColor: colors.bgDeep },
  dot: { width: 12, height: 12, borderRadius: 6 },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.text },
  chipTextOff: { color: colors.textFaint, textDecorationLine: 'line-through' },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
});
