/**
 * Single entry point for both JalSakshi surfaces.
 *
 * Staff sign in with credentials and land in the field-work app. Residents
 * reach the public water-quality portal without signing in at all, because
 * authorization-matrix.md states a resident is not a user and has no account.
 *
 * All routing decisions live in `session.ts`; this file is presentation.
 */

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radius, spacing, type } from './theme';
import {
  DEMO_ACCOUNTS,
  SIGN_IN_ERROR,
  continueAsPublic,
  isRealAuthentication,
  signIn,
  type AppSession,
} from './session';

export interface LoginScreenProps {
  onSession(session: AppSession): void;
}

export function LoginScreen({ onSession }: LoginScreenProps): React.JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    setBusy(true);
    const result = signIn(username, password);
    setBusy(false);
    if (!result.ok) {
      setError(SIGN_IN_ERROR[result.reason]);
      return;
    }
    setError(null);
    onSession(result.session);
  };

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.brandBlock}>
          <View style={s.drop}>
            <Text style={s.dropMark}>◆</Text>
          </View>
          <Text style={s.brand}>JalSakshi</Text>
          <Text style={s.tagline}>Clear water. Accountable tomorrow.</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Staff sign in</Text>
          <Text style={s.cardSub}>
            For trained field workers and supervisors.
          </Text>

          <Text style={s.label}>Username</Text>
          <TextInput
            style={s.input}
            value={username}
            onChangeText={(t) => {
              setUsername(t);
              setError(null);
            }}
            placeholder="worker"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            testID="login-username"
          />

          <Text style={s.label}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              setError(null);
            }}
            // NOT a row of dots: a dot placeholder is visually identical to
            // masked input, so an empty field looks filled. That cost a real
            // debugging cycle during on-device testing.
            placeholder="Enter your password"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            autoCapitalize="none"
            testID="login-password"
            onSubmitEditing={submit}
          />

          {error && (
            <Text style={s.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          <Pressable
            style={[s.btn, s.btnPrimary, busy && s.btnDisabled]}
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
            testID="login-submit"
          >
            <Text style={s.btnPrimaryText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
          </Pressable>

          {!isRealAuthentication && (
            <View style={s.demoNote}>
              <Text style={s.demoTitle}>Demo sign-in</Text>
              <Text style={s.demoText}>
                No identity provider is connected yet, so these credentials are
                checked on the device and verify nothing. Use{' '}
                {DEMO_ACCOUNTS.map((a) => a.username).join(' or ')} with the
                password “jalsakshi”.
              </Text>
            </View>
          )}
        </View>

        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>or</Text>
          <View style={s.dividerLine} />
        </View>

        {/* Residents have no account by design (authorization-matrix.md). */}
        <Pressable
          style={[s.btn, s.btnGhost]}
          onPress={() => onSession(continueAsPublic())}
          accessibilityRole="button"
          testID="login-public"
        >
          <Text style={s.btnGhostText}>View public water quality information</Text>
        </Pressable>
        <Text style={s.publicNote}>
          Open to everyone. No account needed.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl, gap: spacing.lg, justifyContent: 'center', flexGrow: 1 },
  brandBlock: { alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  drop: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropMark: { color: colors.onPrimary, fontSize: 24, fontWeight: '800' },
  brand: { fontSize: 28, fontWeight: '800', color: colors.primaryDark },
  tagline: { ...type.small },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { ...type.h2 },
  cardSub: { ...type.small, marginBottom: spacing.xs },
  label: { ...type.small, marginTop: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.cardAlt,
  },
  error: { color: colors.alert, fontSize: 13, fontWeight: '600', marginTop: spacing.xs },
  btn: { paddingVertical: 14, borderRadius: radius.md, alignItems: 'center' },
  btnPrimary: { backgroundColor: colors.primary, marginTop: spacing.sm },
  btnPrimaryText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
  btnGhost: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  btnGhostText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  demoNote: {
    backgroundColor: colors.watchSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: 3,
  },
  demoTitle: { fontSize: 12.5, fontWeight: '700', color: colors.watch },
  demoText: { fontSize: 12, color: colors.text, lineHeight: 17 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...type.small },
  publicNote: { ...type.tiny, textAlign: 'center' },
});
