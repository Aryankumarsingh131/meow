/**
 * The resident entrance: sign in, or create an account in the app
 * (POST /v1/public/accounts signs the new resident in straight away).
 * Staff accounts are sent back to the staff sign-in.
 *
 * DEMO: "Use the demo resident" fills 3@demo.org / 1234 (007).
 */

import React, { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { SIGN_IN_ERROR, checkSignInInput, hostedSession, signInFailureFor, type AppSession } from './session';
import { colors, radius, spacing, type } from './theme';
import { canonicalPhone, registrationProblem } from './residentForm';
import { login, problemText, registerResident } from './v2';

const NAVY = '#0B2545';
const GREEN = '#0F766E';

export function ResidentLogin({ initialMode = 'signin', onSession, onBack }: {
  initialMode?: 'signin' | 'register';
  onSession(session: AppSession): void;
  onBack(): void;
}): React.JSX.Element {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (mail: string, role: string, token: string) => {
    if (role !== 'resident') return setError('This is a staff account. Go back and use the staff sign-in.');
    const next = hostedSession(mail, 'resident', token);
    if (!next) return setError(SIGN_IN_ERROR.unknown_account);
    onSession(next);
  };

  const signIn = async () => {
    const invalid = checkSignInInput(email, password);
    if (invalid) return setError(invalid === 'empty_username' ? 'Enter your email.' : SIGN_IN_ERROR[invalid]);
    setBusy(true);
    const r = await login(email, password);
    setBusy(false);
    if (r.kind !== 'ok') return setError(SIGN_IN_ERROR[signInFailureFor(r.kind)]);
    finish(email, r.value.role, r.value.token);
  };

  const register = async () => {
    const problem = registrationProblem({ name, email, phone, password, confirm });
    if (problem) return setError(problem);
    setBusy(true);
    const r = await registerResident({ email: email.trim(), password, full_name: name.trim(), phone: canonicalPhone(phone) });
    setBusy(false);
    if (r.kind !== 'ok') return setError(problemText(r));
    finish(email.trim(), r.value.role ?? 'resident', r.value.token);
  };

  const field = (label: string, value: string, set: (v: string) => void, extra: object = {}) => (
    <>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={(t) => { set(t); setError(null); }} placeholderTextColor={colors.textFaint}
        autoCorrect={false} accessibilityLabel={label} {...extra} />
    </>
  );

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.hero}>
          <Image source={require('../assets/ui/family.jpg')} style={s.heroImage} resizeMode="cover" accessibilityIgnoresInvertColors />
          <View style={s.heroShade} />
          <Pressable style={s.back} onPress={onBack} accessibilityRole="button" testID="resident-back">
            <Text style={s.backText}>‹ Staff sign-in</Text>
          </Pressable>
          <View style={s.heroText}>
            <Text style={s.kicker}>JALSAKSHI FOR RESIDENTS</Text>
            <Text style={s.headline}>Your water,{'\n'}your voice.</Text>
          </View>
        </View>

        <View style={s.body}>
          <Text style={s.lede}>Report a problem with a water source near you, and follow every step until it is resolved.</Text>
          <View style={s.perks}>
            {[['📣', 'Report in a minute'], ['🔔', 'Track each complaint'], ['🗺️', 'See sources near you']].map(([icon, text]) => (
              <View key={text} style={s.perk}><Text style={s.perkIcon}>{icon}</Text><Text style={s.perkText}>{text}</Text></View>
            ))}
          </View>

          <View style={s.card}>
            <View style={s.switch}>
              {(['signin', 'register'] as const).map((m) => (
                <Pressable key={m} style={[s.switchBtn, mode === m && s.switchOn]} onPress={() => { setMode(m); setError(null); }}
                  accessibilityRole="tab" accessibilityState={{ selected: mode === m }} testID={`resident-mode-${m}`}>
                  <Text style={[s.switchText, mode === m && s.switchTextOn]}>{m === 'signin' ? 'Sign in' : 'Create account'}</Text>
                </Pressable>
              ))}
            </View>

            {mode === 'register' && field('Your name', name, setName, { placeholder: 'e.g. Sunita Patil', autoCapitalize: 'words', testID: 'resident-name' })}
            {field('Email address', email, setEmail, { placeholder: 'you@example.com', keyboardType: 'email-address', autoCapitalize: 'none',
              testID: 'resident-email' })}
            {mode === 'register' && field('Phone (optional, for SMS updates)', phone, setPhone, { placeholder: '+91 98765 43210',
              keyboardType: 'phone-pad', testID: 'resident-phone' })}
            {field('Password', password, setPassword, { placeholder: mode === 'register' ? 'At least 8 characters' : 'Your password',
              secureTextEntry: !show, autoCapitalize: 'none', testID: 'resident-password',
              onSubmitEditing: mode === 'signin' ? () => void signIn() : undefined })}
            {mode === 'register' && field('Confirm password', confirm, setConfirm, { secureTextEntry: !show, autoCapitalize: 'none',
              testID: 'resident-confirm' })}
            <Pressable onPress={() => setShow(!show)} accessibilityRole="button"><Text style={s.link}>{show ? 'Hide password' : 'Show password'}</Text></Pressable>

            {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}

            <Pressable style={[s.primary, busy && s.dim]} disabled={busy} accessibilityRole="button" testID="resident-submit"
              onPress={() => void (mode === 'signin' ? signIn() : register())}>
              <Text style={s.primaryText}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create my account'}</Text>
            </Pressable>
            {mode === 'signin' && (
              <Pressable style={s.demo} accessibilityRole="button" testID="resident-demo"
                onPress={() => { setEmail('3@demo.org'); setPassword('1234'); setError(null); }}>
                <Text style={s.demoText}>Use the demo resident (3@demo.org · 1234)</Text>
              </Pressable>
            )}
            <Text style={s.tiny}>
              {mode === 'register'
                ? 'Your email and phone are used only to send you updates about your complaints. They are never shown publicly.'
                : 'Forgot your password? Ask your ward office to reset it.'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const serif = Platform.select({ android: 'serif', ios: 'Georgia', default: undefined });

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3FAF8' },
  content: { flexGrow: 1, paddingBottom: spacing.xl * 2 },
  hero: { height: 270, overflow: 'hidden', justifyContent: 'flex-end' },
  heroImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(11,37,69,0.35)' },
  back: { position: 'absolute', top: spacing.lg, left: spacing.lg, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.pill,
          paddingVertical: 6, paddingHorizontal: spacing.md },
  backText: { color: NAVY, fontWeight: '700' },
  heroText: { padding: spacing.xl },
  kicker: { color: '#D1FAE5', fontWeight: '800', letterSpacing: 1.5, fontSize: 12 },
  headline: { fontFamily: serif, color: '#fff', fontSize: 34, lineHeight: 38, fontWeight: '700', marginTop: 4 },
  body: { padding: spacing.xl, gap: spacing.md },
  lede: { ...type.body, color: colors.textMuted, lineHeight: 21 },
  perks: { flexDirection: 'row', gap: spacing.sm },
  perk: { flex: 1, backgroundColor: '#fff', borderRadius: radius.md, padding: spacing.sm, alignItems: 'center', gap: 4,
          borderWidth: 1, borderColor: '#CCEDE6' },
  perkIcon: { fontSize: 20 },
  perkText: { fontSize: 11.5, textAlign: 'center', color: NAVY, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, borderWidth: 1, borderColor: '#CCEDE6' },
  switch: { flexDirection: 'row', backgroundColor: '#E6F4F1', borderRadius: radius.pill, padding: 4, marginBottom: spacing.sm },
  switchBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center' },
  switchOn: { backgroundColor: GREEN },
  switchText: { fontWeight: '700', color: GREEN },
  switchTextOn: { color: '#fff' },
  label: { fontSize: 13.5, fontWeight: '700', color: NAVY, marginTop: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11,
           fontSize: 15, color: colors.text, backgroundColor: '#FBFEFD' },
  link: { color: GREEN, fontWeight: '700', fontSize: 13, paddingVertical: spacing.xs },
  error: { color: colors.alert, fontSize: 13, fontWeight: '600' },
  primary: { backgroundColor: GREEN, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: spacing.sm },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  demo: { borderWidth: 1, borderStyle: 'dashed', borderColor: GREEN, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center',
          marginTop: spacing.xs },
  demoText: { color: GREEN, fontWeight: '700' },
  tiny: { ...type.tiny, marginTop: spacing.sm },
  dim: { opacity: 0.6 },
});
