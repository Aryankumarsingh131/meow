/**
 * Sign-in: one email + password form against the API behind ngrok. The
 * server's role picks the staff app or the resident app (session.ts).
 *
 * DEMO: a dropdown fills in one of the demo accounts (1/2/3@demo.org,
 * password 1234) so a tester never types credentials. Remove it with the
 * accounts (007) before any real use.
 */

import React, { useState } from 'react';
import {
  Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { colors, radius, spacing, type } from './theme';
import {
  DEMO_LOGINS, SIGN_IN_ERROR, checkSignInInput, continueAsPublic, hostedSession, signInFailureFor, type AppSession,
} from './session';
import { PORTAL_URL, login } from './v2';

const NAVY = '#0B2545';

export interface LoginScreenProps {
  onSession(session: AppSession): void;
}

export function LoginScreen({ onSession }: LoginScreenProps): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const invalid = checkSignInInput(email, password);
    if (invalid) return setError(invalid === 'empty_username' ? 'Enter your email.' : SIGN_IN_ERROR[invalid]);
    setBusy(true);
    const r = await login(email, password);
    setBusy(false);
    if (r.kind !== 'ok') return setError(SIGN_IN_ERROR[signInFailureFor(r.kind)]);
    const next = hostedSession(email, r.value.role, r.value.token);
    if (!next) return setError(SIGN_IN_ERROR.unknown_account);
    setError(null);
    onSession(next);
  };

  const pick = (d: (typeof DEMO_LOGINS)[number]) => {
    setEmail(d.email);
    setPassword(d.password);
    setPicked(`${d.label} · ${d.email}`);
    setMenuOpen(false);
    setError(null);
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <Image source={require('../assets/ui/hero.jpg')} style={s.heroImage} resizeMode="cover" accessibilityIgnoresInvertColors />
          <View style={s.brand}>
            <Image source={require('../assets/ui/logo.png')} style={s.logo} resizeMode="contain" />
            <View>
              <Text style={s.brandName}>JalSakshi</Text>
              <Text style={s.brandSub}>Water quality workspace</Text>
            </View>
          </View>
        </View>

        <View style={s.body}>
          <Image source={require('../assets/ui/shape-blue.png')} style={s.shapeBlue} resizeMode="contain" />
          <Text style={s.headline}>Every source.{'\n'}Every signal.</Text>
          <Text style={[s.headline, s.headlineBlue]}>In focus.</Text>
          <Text style={s.lede}>Turn field evidence into clear, accountable action for the communities you serve.</Text>

          <View style={s.card}>
            <Text style={s.welcome}>Welcome back.</Text>
            <Text style={s.small}>Sign in to your JalSakshi workspace.</Text>

            <Text style={s.label}>Demo account</Text>
            <Pressable style={s.select} onPress={() => setMenuOpen(!menuOpen)} accessibilityRole="button"
              accessibilityState={{ expanded: menuOpen }} testID="login-demo-picker">
              <Text style={[s.selectText, !picked && s.placeholder]}>{picked ?? 'Choose a demo account'}</Text>
              <Text style={s.chevron}>{menuOpen ? '▲' : '▼'}</Text>
            </Pressable>
            {menuOpen && (
              <View style={s.menu}>
                {DEMO_LOGINS.map((d) => (
                  <Pressable key={d.email} style={s.option} onPress={() => pick(d)} accessibilityRole="button"
                    testID={`login-demo-${d.email}`}>
                    <Text style={s.optionTitle}>{d.label}</Text>
                    <Text style={s.small}>{d.email} · password {d.password}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <Text style={s.label}>Email address</Text>
            <View style={s.field}>
              <Text style={s.fieldIcon}>✉</Text>
              <TextInput style={s.input} value={email} onChangeText={(t) => { setEmail(t); setError(null); }}
                placeholder="you@district.gov.in" placeholderTextColor={colors.textFaint} keyboardType="email-address"
                autoCapitalize="none" autoCorrect={false} testID="login-username" accessibilityLabel="Email address" />
            </View>

            <Text style={s.label}>Password</Text>
            <View style={s.field}>
              <Text style={s.fieldIcon}>🔒</Text>
              <TextInput style={s.input} value={password} onChangeText={(t) => { setPassword(t); setError(null); }}
                placeholder="Enter your password" placeholderTextColor={colors.textFaint} secureTextEntry={!showPassword}
                autoCapitalize="none" testID="login-password" accessibilityLabel="Password" onSubmitEditing={submit} />
              <Pressable onPress={() => setShowPassword(!showPassword)} accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} hitSlop={10}>
                <Text style={s.eye}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>

            {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}

            <Pressable style={[s.signIn, busy && s.dim]} onPress={submit} disabled={busy} accessibilityRole="button" testID="login-submit">
              <Text style={s.signInText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
              <Text style={s.signInText}>→</Text>
            </Pressable>
            <Text style={s.tiny}>Use your assigned district account. Contact your administrator if you need access.</Text>
          </View>

          <Pressable onPress={() => void Linking.openURL(PORTAL_URL)} accessibilityRole="link" testID="login-register">
            <Text style={s.link}>New resident? Create an account →</Text>
          </Pressable>
          <Pressable onPress={() => onSession(continueAsPublic())} accessibilityRole="button" testID="login-public">
            <Text style={s.link}>View public water quality information →</Text>
          </Pressable>
          <Image source={require('../assets/ui/shape-red.png')} style={s.shapeRed} resizeMode="contain" />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const serif = Platform.select({ android: 'serif', ios: 'Georgia', default: undefined });

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FBF8F1' },
  content: { flexGrow: 1, paddingBottom: spacing.xl },
  hero: { height: 250, overflow: 'hidden' },
  heroImage: { width: '100%', height: 340, position: 'absolute', top: -40 },
  brand: { position: 'absolute', top: spacing.lg, left: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
           backgroundColor: 'rgba(251,248,241,0.92)', paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  logo: { width: 34, height: 34 },
  brandName: { fontSize: 20, fontWeight: '800', color: NAVY },
  brandSub: { fontSize: 11, color: colors.textMuted },
  body: { padding: spacing.xl, gap: spacing.md, overflow: 'hidden' },
  shapeBlue: { position: 'absolute', right: -90, top: -40, width: 200, height: 200, opacity: 0.9 },
  shapeRed: { width: 170, height: 170, alignSelf: 'flex-end', marginRight: -60, marginBottom: -70, opacity: 0.9 },
  headline: { fontFamily: serif, fontSize: 34, lineHeight: 38, fontWeight: '700', color: NAVY },
  headlineBlue: { color: colors.primary, marginTop: -spacing.md },
  lede: { ...type.body, color: colors.textMuted, lineHeight: 20 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
          gap: spacing.sm, marginTop: spacing.sm },
  welcome: { fontFamily: serif, fontSize: 26, fontWeight: '700', color: NAVY },
  small: { ...type.small },
  tiny: { ...type.tiny, marginTop: spacing.xs },
  label: { fontSize: 13.5, fontWeight: '700', color: NAVY, marginTop: spacing.sm },
  select: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md,
            paddingHorizontal: spacing.md, paddingVertical: 13, backgroundColor: colors.primarySoft },
  selectText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
  placeholder: { color: colors.textMuted, fontWeight: '400' },
  chevron: { color: colors.primary, fontSize: 12 },
  menu: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.card, overflow: 'hidden' },
  option: { paddingHorizontal: spacing.md, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  optionTitle: { ...type.body, fontWeight: '700' },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong,
           borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.card },
  fieldIcon: { fontSize: 15, color: colors.textMuted },
  input: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  eye: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  error: { color: colors.alert, fontSize: 13, fontWeight: '600' },
  signIn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: NAVY,
            borderRadius: radius.md, paddingVertical: 15, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  signInText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  dim: { opacity: 0.6 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 14, paddingVertical: spacing.xs },
});
