import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from 'react-native';

import { deviceSql } from './src/deviceDb';
import { LoginScreen } from './src/login';
import { OFFLINE_LIMIT_NOTE, revokeOfflineAccess } from './src/offlineAccess';
import { pendingCount } from './src/sync';
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

  // Sign-out ends this account's offline access on this phone (T45). It never
  // deletes saved records; with unsent records it warns first.
  const signOut = () => {
    if (session.kind !== 'staff') return setSession(null);
    const finish = () => {
      revokeOfflineAccess(deviceSql(), session.auth.subject);
      setSession(null);
    };
    const pending = pendingCount(deviceSql(), session.auth.subject);
    if (pending === 0) return finish();
    Alert.alert(
      'Records not sent yet',
      `${pending} saved record${pending === 1 ? '' : 's'} stay on this phone and will be sent after you sign in again. Offline access ends when you sign out.`,
      [{ text: 'Stay signed in', style: 'cancel' }, { text: 'Sign out', onPress: finish }],
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.barTitle}>
            {isStaff ? 'Field work' : 'Public water quality'}
          </Text>
          <Text style={styles.barSub}>
            {isStaff
              ? `Signed in as ${session.username}`
              : 'Open information — no account'}
          </Text>
        </View>
        <Pressable
          style={styles.signOut}
          onPress={signOut}
          accessibilityRole="button"
          testID="sign-out"
        >
          <Text style={styles.signOutText}>{isStaff ? 'Sign out' : 'Back'}</Text>
        </Pressable>
      </View>

      {/* The issuer is synthetic (ADR-M1-002) and the screen must say so. */}
      {isStaff && session.issuer === 'synthetic_dev_issuer' && (
        <Text style={styles.unverified}>
          Synthetic session — issued by the test issuer, not a real identity provider.
        </Text>
      )}

      {isStaff && session.offlineUntilMs !== null && (
        <Text style={styles.unverified} testID="offline-banner">
          Working offline until {new Date(session.offlineUntilMs).toLocaleString()}. Nothing is sent until you sign in. {OFFLINE_LIMIT_NOTE}
        </Text>
      )}

      <View style={styles.body}>
        {surface === 'field' && isStaff ? <WorkerApp session={session} onAuthExpired={() => setSession(null)} /> : <PublicApp />}
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
