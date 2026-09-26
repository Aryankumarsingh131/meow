/**
 * useAutoRefresh: load now, then every 30 s while the app is open and in the
 * foreground (refreshModel.ts), plus a RefreshBar with a manual button and the
 * time of the last successful update.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { AUTO_REFRESH_MS, Refresher } from './refreshModel';
import { colors, radius, spacing } from './theme';

export interface RefreshState {
  refreshing: boolean;
  updatedAt: number | null;
  failed: boolean;
  refresh(): void;
}

/** `load(background)` returns false when it could not load; it is called again on a key change. */
export function useAutoRefresh(load: (background: boolean) => Promise<boolean | void>, key: unknown = null,
                               enabled = true): RefreshState {
  const [state, setState] = useState({ refreshing: false, updatedAt: null as number | null, failed: false });
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresher = useRef<Refresher | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const r = new Refresher({ load: (bg) => loadRef.current(bg), isForeground: () => AppState.currentState === 'active',
                              onState: setState }, AUTO_REFRESH_MS);
    refresher.current = r;
    r.start();
    return () => { r.stop(); refresher.current = null; };
  }, [key, enabled]);
  return { ...state, refresh: () => void refresher.current?.refresh() };
}

export function RefreshBar({ state }: { state: RefreshState }): React.JSX.Element {
  const when = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  return (
    <View style={s.bar}>
      <Text style={[s.text, state.failed && s.warn]} numberOfLines={1}>
        {state.refreshing ? 'Refreshing…' : state.failed ? `Could not refresh${when ? ` · showing ${when}` : ''}`
          : when ? `Updated ${when} · auto every 30 s` : 'Loading…'}
      </Text>
      <Pressable style={[s.btn, state.refreshing && s.dim]} onPress={state.refresh} disabled={state.refreshing}
        accessibilityRole="button" accessibilityLabel="Refresh now" testID="refresh-button" hitSlop={8}>
        <Text style={s.btnText}>↻ Refresh</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: 6 },
  text: { flex: 1, fontSize: 12, color: colors.textMuted },
  warn: { color: colors.watch, fontWeight: '600' },
  btn: { borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: spacing.md,
         backgroundColor: colors.card },
  btnText: { color: colors.primary, fontWeight: '700', fontSize: 12.5 },
  dim: { opacity: 0.5 },
});
