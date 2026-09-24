import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native';

import { LoginScreen } from './src/login';
import { PublicApp } from './src/publicApp';
import { WorkerApp } from './src/workerApp';
import { surfaceFor, type AppSession } from './src/session';
import { colors, spacing, type } from './src/theme';

/**
 * JalSakshi root.
 *
 * One entry point:  Login  ->  field-work app (staff)  or  public portal.
 *
 * ## What happened to the development tabs
 *
 * This root previously showed a tab strip of task harnesses (T07 sources, T08
 * protocol/timer, T09 capture, the synthetic demo workflow). Those are gone
 * from the UI, as asked. The code behind them is NOT deleted and still runs
 * where it belongs:
 *
 *   - `sourceCatalog.ts` (T07)  - QR safety + staleness labelling
 *   - `timer.ts`         (T08)  - read-window timing and kit eligibility
 *   - `captureJob.ts`    (T09)  - capture job lifecycle, retake supersession
 *   - `statusLabel.ts`   (T10)  - the constrained status vocabulary
 *   - `quality_baseline` (T10)  - deterministic capture-quality rules
 *   - `capture-native`   (T04)  - the compiled native feature bridge
 *
 * Each remains covered by its own test suite, and the two product surfaces
 * consume them. Removing a harness tab removed a demo affordance, not a
 * capability. `demo-workflow.tsx` (from the meow integration), `sources.tsx`,
 * `protocol.tsx` and `capture.tsx` are likewise retained in the tree and
 * simply not routed to from here.
 */

export default function App(): React.JSX.Element {
  const [session, setSession] = useState<AppSession>(null);
  const surface = surfaceFor(session);

  if (!session || !surface) {
    return (
      <View style={styles.root}>
        <LoginScreen onSession={setSession} />
        <StatusBar style="auto" />
      </View>
    );
  }

  const isStaff = session.kind === 'staff';

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.barTitle}>
            {isStaff ? 'Field work' : 'Public water quality'}
          </Text>
          <Text style={styles.barSub}>
            {isStaff
              ? `${session.displayName} · ${session.tenantName}`
              : 'Open information — no account'}
          </Text>
        </View>
        <Pressable
          style={styles.signOut}
          onPress={() => setSession(null)}
          accessibilityRole="button"
          testID="sign-out"
        >
          <Text style={styles.signOutText}>{isStaff ? 'Sign out' : 'Back'}</Text>
        </Pressable>
      </View>

      {/* An unverified session must say so. It is a demo sign-in until an
          identity provider is connected (T06). */}
      {isStaff && !session.verified && (
        <Text style={styles.unverified}>
          Demo session — not verified by an identity provider.
        </Text>
      )}

      <View style={styles.body}>
        {surface === 'field' ? <WorkerApp /> : <PublicApp />}
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 24 : 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  barTitle: { ...type.h3, color: colors.primaryDark },
  barSub: { ...type.tiny },
  signOut: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  signOutText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  unverified: {
    backgroundColor: colors.watchSoft,
    color: colors.watch,
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 5,
  },
  body: { flex: 1 },
});
