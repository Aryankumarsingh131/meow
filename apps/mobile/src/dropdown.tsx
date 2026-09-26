/**
 * A dropdown: a field showing the choice; tapping it opens a searchable list
 * in a modal. `null` is "none chosen" (shown with the placeholder).
 */

import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radius, spacing, type } from './theme';

export interface Option {
  value: string;
  label: string;
  detail?: string;
}

export function Dropdown({ label, placeholder, options, value, onChange, testID, clearLabel }: {
  label: string;
  placeholder: string;
  options: Option[];
  value: string | null;
  onChange(value: string | null): void;
  testID?: string;
  /** When set, the list offers this as a way back to "none chosen". */
  clearLabel?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const chosen = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const pick = (v: string | null) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <View style={s.wrap}>
      <Text style={s.label}>{label}</Text>
      <Pressable style={s.field} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${chosen?.label ?? placeholder}`}
        testID={testID}>
        <View style={{ flex: 1 }}>
          <Text style={[s.value, !chosen && s.placeholder]} numberOfLines={1}>{chosen?.label ?? placeholder}</Text>
          {chosen?.detail ? <Text style={s.detail} numberOfLines={1}>{chosen.detail}</Text> : null}
        </View>
        <Text style={s.chevron}>▼</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <Text style={s.sheetTitle}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" hitSlop={10}><Text style={s.close}>Close</Text></Pressable>
            </View>
            <TextInput style={s.search} value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.textFaint}
              autoCorrect={false} accessibilityLabel={`Search ${label}`} />
            <FlatList data={shown} keyExtractor={(o) => o.value} keyboardShouldPersistTaps="handled"
              ListHeaderComponent={clearLabel ? (
                <Pressable style={s.option} onPress={() => pick(null)} accessibilityRole="button">
                  <Text style={[s.optionText, s.placeholder]}>{clearLabel}</Text>
                </Pressable>
              ) : null}
              ListEmptyComponent={<Text style={s.empty}>Nothing matches “{query}”.</Text>}
              renderItem={({ item }) => (
                <Pressable style={[s.option, item.value === value && s.optionOn]} onPress={() => pick(item.value)} accessibilityRole="button"
                  accessibilityState={{ selected: item.value === value }}>
                  <Text style={[s.optionText, item.value === value && s.optionTextOn]}>{item.label}</Text>
                  {item.detail ? <Text style={s.detail}>{item.detail}</Text> : null}
                </Pressable>
              )} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 4 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong,
           borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, backgroundColor: colors.cardAlt },
  value: { ...type.body, fontWeight: '600' },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  detail: { fontSize: 12, color: colors.textMuted },
  chevron: { color: colors.primary, fontSize: 12 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,41,66,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%', backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
           padding: spacing.lg, gap: spacing.sm },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.primaryDark },
  close: { color: colors.primary, fontWeight: '700' },
  search: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 9,
            color: colors.text, backgroundColor: colors.cardAlt },
  option: { paddingVertical: 12, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionOn: { backgroundColor: colors.primarySoft },
  optionText: { ...type.body },
  optionTextOn: { fontWeight: '800', color: colors.primaryDark },
  empty: { ...type.small, padding: spacing.md, textAlign: 'center' },
});
