/**
 * T15: saved-records queue. Shows how far each record got, and Sync now.
 *
 * Wording lives in sync.ts (QUEUE_TEXT etc.) so it is testable in Node.
 */

import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { FOREGROUND_NOTE, PHOTO_NOTE, QUEUE_TEXT, type QueueItem } from './sync';
import { colors, radius, spacing, type } from './theme';
import { Badge, Card } from './ui';

export interface QueueScreenProps {
  items: readonly QueueItem[];
  pending: number;
  status: string;
  busy: boolean;
  onSyncNow(): void;
  onBack(): void;
}

export function QueueScreen({ items, pending, status, busy, onSyncNow, onBack }: QueueScreenProps): React.JSX.Element {
  return (
    <View style={s.screen}>
      <View style={s.pad}>
        <Text style={s.title} testID="queue-pending">
          {pending === 0 ? 'Nothing waiting to send' : `${pending} saved record${pending === 1 ? '' : 's'} waiting to send`}
        </Text>
        {status ? <Text style={s.meta} testID="sync-status">{status}</Text> : null}
        <Text style={s.meta}>{FOREGROUND_NOTE} {PHOTO_NOTE}</Text>
        <Pressable
          style={[s.btn, busy && s.btnBusy]}
          disabled={busy}
          onPress={onSyncNow}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
          testID="sync-now"
        >
          <Text style={s.btnText}>{busy ? 'Sending…' : 'Sync now'}</Text>
        </Pressable>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.sampleId}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.meta}>No saved records on this phone for this account.</Text>}
        renderItem={({ item }) => {
          const text = QUEUE_TEXT[item.state];
          return (
            <Card>
              <View style={s.row}>
                <Badge label={text.label} tone={text.tone} />
                <Text style={s.meta}>Saved {new Date(item.savedAt).toLocaleString()}</Text>
              </View>
              <Text style={s.body} testID={`queue-${item.state}`}>
                {text.detail}
                {item.code ? ` (${item.code})` : ''}
              </Text>
              <Text style={s.id} selectable>Record {item.sampleId}</Text>
            </Card>
          );
        }}
      />
      <Pressable style={s.back} onPress={onBack} accessibilityRole="button" testID="queue-back">
        <Text style={s.backText}>Back to sources</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: spacing.lg, gap: spacing.sm },
  list: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.lg },
  title: { ...type.h3, color: colors.text },
  meta: { ...type.small },
  body: { ...type.body, color: colors.text, marginTop: spacing.xs },
  id: { ...type.tiny, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnBusy: { opacity: 0.6 },
  btnText: { ...type.body, color: '#fff', fontWeight: '700' },
  back: { padding: spacing.lg, alignItems: 'center' },
  backText: { ...type.body, color: colors.primary },
});
