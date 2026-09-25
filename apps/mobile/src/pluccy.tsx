/**
 * Pluccy - the field guidance mascot - and the guided screening it runs:
 *
 *   source -> kit -> dip -> wait (dance + countdown, length from the kit
 *   config) -> pull out -> one reading per kit parameter, with a tip each ->
 *   photo proof -> submit -> result (+ points, milestone celebration).
 *
 * Everything the flow asks for comes from GET /v1/staff/kits; nothing about a
 * kit is hardcoded here. The server re-checks the readings, assesses risk with
 * the same bands and decides points (006); this screen only guides.
 *
 * ponytail: the dip time lives in memory, so closing the app mid-wait loses
 * the screening. Persist it (deviceDb) before long-incubation kits such as
 * the 24 h coliform vial are used in the field.
 */

import { randomUUID } from 'expo-crypto';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';

import { PhotoCapture } from './photoCapture';
import {
  BAND_TEXT, bandFor, formatCountdown, milestoneReached, parseReading, readPhase, type Band, type Kit,
} from './pluccyModel';
import { colors, radius, spacing, type } from './theme';
import { Badge, Card, CardTitle, Row, type Tone } from './ui';
import {
  fetchKits, problemText, staffSources, submitScreening, type Photo, type Points, type ScreeningResult, type StaffSource,
} from './v2';

// --- the mascot ----------------------------------------------------------------

export type Mood = 'wave' | 'dance' | 'alert' | 'cheer' | 'think';

/** A water droplet with a face. Animated with the built-in Animated API only. */
export function Pluccy({ mood, say, size = 88 }: { mood: Mood; say?: string; size?: number }): React.JSX.Element {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    t.setValue(0);
    const speed = { wave: 900, dance: 420, alert: 180, cheer: 300, think: 1400 }[mood];
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: speed, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: speed, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [mood, t]);

  const tilt = { wave: 8, dance: 16, alert: 4, cheer: 10, think: 3 }[mood];
  const hop = { wave: 2, dance: 10, alert: 6, cheer: 16, think: 1 }[mood];
  const transform = [
    { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -hop] }) },
    { rotate: t.interpolate({ inputRange: [0, 1], outputRange: [`-${tilt}deg`, `${tilt}deg`] }) },
    { scale: mood === 'cheer' ? t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) : 1 },
  ];
  const eye = size * 0.13;
  return (
    <View style={s.mascotRow} accessibilityLabel={say ? `Pluccy says: ${say}` : 'Pluccy'}>
      <Animated.View style={{ width: size, height: size, transform }}>
        {/* Body: a square with one sharp corner, turned 45 degrees = a droplet. */}
        <View style={[s.drop, { width: size * 0.78, height: size * 0.78, borderRadius: size * 0.39, left: size * 0.11, top: size * 0.16 }]} />
        <View style={[s.face, { top: size * 0.42, width: size }]}>
          <View style={s.eyes}>
            {[0, 1].map((i) => (
              <View key={i} style={{ width: eye, height: mood === 'think' ? eye * 0.4 : eye, borderRadius: eye, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: eye * 0.5, height: eye * 0.5, borderRadius: eye, backgroundColor: colors.text }} />
              </View>
            ))}
          </View>
          <View style={mood === 'alert'
            ? { width: size * 0.14, height: size * 0.14, borderRadius: size, backgroundColor: colors.text, marginTop: 4 }
            : { width: size * 0.3, height: size * 0.15, borderBottomLeftRadius: size, borderBottomRightRadius: size, backgroundColor: colors.text, marginTop: 4 }} />
        </View>
        {mood === 'cheer' && <Text style={[s.sparkle, { left: 0 }]}>✦</Text>}
        {mood === 'cheer' && <Text style={[s.sparkle, { right: 0 }]}>✦</Text>}
        {mood === 'alert' && <Text style={s.bang}>!</Text>}
      </Animated.View>
      {say ? <View style={s.bubble}><Text style={s.bubbleText}>{say}</Text></View> : null}
    </View>
  );
}

// --- the guided screening ----------------------------------------------------------

type Stage =
  | { s: 'source' }
  | { s: 'kit'; source: StaffSource }
  | { s: 'dip'; source: StaffSource; kit: Kit }
  | { s: 'wait'; source: StaffSource; kit: Kit; dipMs: number }
  | { s: 'readings'; source: StaffSource; kit: Kit; dipMs: number; readMs: number }
  | { s: 'photo'; source: StaffSource; kit: Kit; dipMs: number; readMs: number; readings: Record<string, number> }
  | { s: 'review'; source: StaffSource; kit: Kit; dipMs: number; readMs: number; readings: Record<string, number>;
      photo: Photo | null; localId: string; error: string | null; sending: boolean }
  | { s: 'done'; result: ScreeningResult; milestone: number | null };

const TONE: Record<Band, Tone> = { low: 'ok', medium: 'watch', high: 'alert' };
const RESULT_TEXT: Record<string, string> = {
  low: 'All readings are within the screening bands.',
  medium: 'A reading is in the watch band. Your supervisor can see it.',
  high: 'A reading is outside the screening band. A report is open for your supervisor.',
  unknown: 'No readings to assess.',
};

export function ScreeningFlow({ token, onAuthExpired, onPoints }: {
  token: string;
  onAuthExpired(): void;
  onPoints(points: Points): void;
}): React.JSX.Element {
  const [stage, setStage] = useState<Stage>({ s: 'source' });
  const [sources, setSources] = useState<StaffSource[] | null>(null);
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [raw, setRaw] = useState<Record<string, string>>({});
  const buzzed = useRef(false);

  const load = async () => {
    setLoadError(null);
    const [src, kit] = await Promise.all([staffSources(token), fetchKits(token)]);
    for (const r of [src, kit]) {
      if (r.kind === 'auth_required') return onAuthExpired();
      if (r.kind !== 'ok') return setLoadError(problemText(r));
    }
    if (src.kind === 'ok') setSources(src.value.items);
    if (kit.kind === 'ok') setKits(kit.value.items);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // One clock for the wait stage; buzz once when the read window opens.
  useEffect(() => {
    if (stage.s !== 'wait') return;
    buzzed.current = false;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [stage.s]);
  const phase = stage.s === 'wait' ? readPhase(stage.dipMs, now, stage.kit) : null;
  useEffect(() => {
    if (phase?.phase === 'read_now' && !buzzed.current) {
      buzzed.current = true;
      Vibration.vibrate(500);
    }
  }, [phase?.phase]);

  const restart = () => { setRaw({}); setStage({ s: 'source' }); };

  const submit = async (st: Extract<Stage, { s: 'review' }>) => {
    setStage({ ...st, sending: true, error: null });
    const r = await submitScreening(token, {
      source_id: st.source.source_id, local_record_id: st.localId, kit_id: st.kit.kit_id, method: 'manual',
      readings: st.readings, dip_started_at: new Date(st.dipMs).toISOString(), read_at: new Date(st.readMs).toISOString(),
      ...(st.photo ? { photo: st.photo } : {}),
    });
    if (r.kind === 'auth_required') return onAuthExpired();
    // Same local id on retry: the server cannot record it twice.
    if (r.kind !== 'ok') return setStage({ ...st, sending: false, error: problemText(r) });
    const before = r.value.points.qualifying_screenings - (r.value.points_awarded > 0 ? 1 : 0);
    onPoints(r.value.points);
    setStage({ s: 'done', result: r.value,
               milestone: milestoneReached(before, r.value.points.qualifying_screenings, r.value.points.milestones) });
  };

  if (loadError) {
    return (
      <View style={s.pad}>
        <Pluccy mood="think" say={loadError} />
        <Pressable style={s.btn} onPress={() => void load()} accessibilityRole="button"><Text style={s.btnText}>Try again</Text></Pressable>
      </View>
    );
  }
  if (!sources || !kits) return <View style={s.pad}><Pluccy mood="think" say="Getting your sources and kits…" /></View>;

  switch (stage.s) {
    case 'source':
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood="wave" say="Hi! Which water source are you testing?" />
          {sources.length === 0 && <Text style={s.muted}>Your team has no water sources yet.</Text>}
          {sources.map((src) => (
            <Pressable key={src.source_id} style={s.choice} onPress={() => setStage({ s: 'kit', source: src })}
              accessibilityRole="button" testID={`pluccy-source-${src.source_id}`}>
              <Text style={s.choiceTitle}>{src.name}</Text>
              <Text style={s.muted}>{src.source_type.replace('_', ' ')}{src.village ? ` · ${src.village}` : ''}</Text>
            </Pressable>
          ))}
        </ScrollView>
      );
    case 'kit':
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood="wave" say={`Testing ${stage.source.name}. Which kit do you have?`} />
          {kits.map((kit) => (
            <Pressable key={kit.kit_id} style={s.choice} onPress={() => setStage({ s: 'dip', source: stage.source, kit })}
              accessibilityRole="button" testID={`pluccy-kit-${kit.kit_id}`}>
              <Text style={s.choiceTitle}>{kit.name}</Text>
              <Text style={s.muted}>Wait {formatCountdown(kit.wait_seconds)} · reads {kit.parameters.map((p) => p.label).join(', ')}</Text>
            </Pressable>
          ))}
          <Pressable style={s.ghost} onPress={restart} accessibilityRole="button"><Text style={s.ghostText}>Back</Text></Pressable>
        </ScrollView>
      );
    case 'dip':
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood="wave" say={stage.kit.dip_instruction ?? 'Dip the strip now.'} />
          <Card>
            <CardTitle>{stage.kit.name}</CardTitle>
            <Row label="Wait after dipping" value={formatCountdown(stage.kit.wait_seconds)} />
            <Row label="Read within" value={`${stage.kit.read_grace_seconds} s after that`} />
          </Card>
          <Pressable style={s.btn} onPress={() => setStage({ s: 'wait', source: stage.source, kit: stage.kit, dipMs: Date.now() })}
            accessibilityRole="button" testID="pluccy-dipped">
            <Text style={s.btnText}>I dipped it — start the timer</Text>
          </Pressable>
          <Pressable style={s.ghost} onPress={() => setStage({ s: 'kit', source: stage.source })} accessibilityRole="button">
            <Text style={s.ghostText}>Back</Text>
          </Pressable>
        </ScrollView>
      );
    case 'wait': {
      const p = phase!;
      const pullOut = () => setStage({ s: 'readings', source: stage.source, kit: stage.kit, dipMs: stage.dipMs, readMs: Date.now() });
      return (
        <ScrollView contentContainerStyle={s.pad}>
          {p.phase === 'waiting' && <Pluccy mood="dance" say="Waiting with you… keep the strip flat." size={110} />}
          {p.phase === 'read_now' && <Pluccy mood="alert" say="Now! Pull it out and read the colours." size={110} />}
          {p.phase === 'late' && <Pluccy mood="think" say="The read window has passed. Colours may have changed." size={110} />}
          <Text style={[s.clock, p.phase === 'read_now' && { color: colors.alert }]} accessibilityLiveRegion="polite" testID="pluccy-clock">
            {p.phase === 'late' ? 'Late' : formatCountdown(p.secondsLeft)}
          </Text>
          <Text style={s.center}>
            {p.phase === 'waiting' ? 'until you can read the strip'
              : p.phase === 'read_now' ? 'left to read it' : 'Start again with a fresh strip for points.'}
          </Text>
          <Pressable style={[s.btn, p.phase === 'waiting' && s.btnMuted]} onPress={pullOut} accessibilityRole="button" testID="pluccy-pulled">
            <Text style={s.btnText}>{p.phase === 'waiting' ? 'Pulled out early (no points)' : 'I pulled it out'}</Text>
          </Pressable>
          {p.phase === 'late' && (
            <Pressable style={s.ghost} onPress={restart} accessibilityRole="button"><Text style={s.ghostText}>Start again</Text></Pressable>
          )}
        </ScrollView>
      );
    }
    case 'readings': {
      const parsed = stage.kit.parameters.map((p) => [p, parseReading(p, raw[p.key] ?? '')] as const);
      const ready = parsed.every(([, r]) => 'value' in r);
      return (
        <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
          <Pluccy mood="think" say="Type what the chart shows. One box per reading." />
          {parsed.map(([p, r]) => (
            <Card key={p.key}>
              <CardTitle>{p.label}{p.unit ? ` (${p.unit})` : ''}</CardTitle>
              {p.input_kind === 'presence' ? (
                <View style={s.row}>
                  {([['0', 'Absent'], ['1', 'Present']] as const).map(([v, label]) => (
                    <Pressable key={v} style={[s.chip, raw[p.key] === v && s.chipOn]} onPress={() => setRaw({ ...raw, [p.key]: v })}
                      accessibilityRole="button" accessibilityState={{ selected: raw[p.key] === v }}>
                      <Text style={[s.chipText, raw[p.key] === v && s.chipTextOn]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <TextInput style={s.input} keyboardType="decimal-pad" value={raw[p.key] ?? ''} placeholder={`${p.min} – ${p.max}`}
                  placeholderTextColor={colors.textFaint} onChangeText={(t) => setRaw({ ...raw, [p.key]: t })}
                  accessibilityLabel={p.label} testID={`pluccy-reading-${p.key}`} />
              )}
              <Text style={s.tip}>💡 {p.tip}</Text>
              {'value' in r
                ? <Badge label={BAND_TEXT[bandFor(p, r.value)]} tone={TONE[bandFor(p, r.value)]} />
                : raw[p.key] ? <Text style={s.error}>{r.error}</Text> : null}
            </Card>
          ))}
          <Pressable style={[s.btn, !ready && s.btnMuted]} disabled={!ready} accessibilityRole="button" testID="pluccy-readings-done"
            onPress={() => setStage({ s: 'photo', source: stage.source, kit: stage.kit, dipMs: stage.dipMs, readMs: stage.readMs,
              readings: Object.fromEntries(parsed.map(([p, r]) => [p.key, 'value' in r ? r.value : 0])) })}>
            <Text style={s.btnText}>Next: photo</Text>
          </Pressable>
        </ScrollView>
      );
    }
    case 'photo': {
      const toReview = (photo: Photo | null) => setStage({ ...stage, s: 'review', photo, localId: randomUUID(), error: null, sending: false });
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood="wave" say="Snap the strip next to the colour chart as proof." />
          <PhotoCapture prompt="Hold the strip against the chart, in good light." onPhoto={toReview}
            onSkip={() => toReview(null)} skipLabel="Continue without a photo (no points)" />
        </ScrollView>
      );
    }
    case 'review':
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood={stage.error ? 'think' : 'wave'} say={stage.error ?? 'All set. Send it?'} />
          <Card>
            <CardTitle>{stage.source.name}</CardTitle>
            <Row label="Kit" value={stage.kit.name} />
            <Row label="Read after dip" value={formatCountdown((stage.readMs - stage.dipMs) / 1000)} />
            {stage.kit.parameters.map((p) => (
              <Row key={p.key} label={p.label} value={p.input_kind === 'presence'
                ? (stage.readings[p.key] ? 'Present' : 'Absent') : `${stage.readings[p.key]} ${p.unit}`.trim()} />
            ))}
            <Row label="Photo" value={stage.photo ? 'Attached' : 'None'} />
          </Card>
          <Pressable style={[s.btn, stage.sending && s.btnMuted]} disabled={stage.sending} onPress={() => void submit(stage)}
            accessibilityRole="button" testID="pluccy-submit">
            <Text style={s.btnText}>{stage.sending ? 'Sending…' : stage.error ? 'Try sending again' : 'Send screening'}</Text>
          </Pressable>
          <Pressable style={s.ghost} onPress={restart} accessibilityRole="button"><Text style={s.ghostText}>Discard</Text></Pressable>
        </ScrollView>
      );
    case 'done': {
      const r = stage.result;
      const say = stage.milestone ? `${stage.milestone} on-time screenings! You're a star!`
        : r.points_awarded ? `+${r.points_awarded} points! Nicely timed.` : 'Sent. No points this time — see why below.';
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood={r.points_awarded ? 'cheer' : 'wave'} say={say} size={stage.milestone ? 130 : 96} />
          <Card>
            <CardTitle>Screening sent</CardTitle>
            <Badge label={r.risk_level === 'unknown' ? 'Not assessed' : BAND_TEXT[r.risk_level]}
              tone={r.risk_level === 'unknown' ? 'unknown' : TONE[r.risk_level]} />
            <Text style={s.body}>{RESULT_TEXT[r.risk_level]}</Text>
            {r.assessment?.findings.map((f) => <Row key={f.parameter} label={f.parameter} value={`${f.value} · ${BAND_TEXT[f.level]}`} tone={TONE[f.level]} />)}
            <Text style={s.muted}>A field screening is not a laboratory test.</Text>
          </Card>
          <Card>
            <CardTitle>Points</CardTitle>
            <Row label="This screening" value={r.points_awarded ? `+${r.points_awarded}` : '0'} />
            <Row label="Balance" value={String(r.points.points_balance)} />
            <Row label="Streak" value={`${r.points.streak_days} day${r.points.streak_days === 1 ? '' : 's'}`} />
            {!r.points_awarded && <Text style={s.muted}>{r.points.rule}</Text>}
          </Card>
          <Pressable style={s.btn} onPress={restart} accessibilityRole="button" testID="pluccy-again">
            <Text style={s.btnText}>Test another source</Text>
          </Pressable>
        </ScrollView>
      );
    }
  }
}

const s = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  mascotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  drop: { position: 'absolute', backgroundColor: colors.accent, borderTopLeftRadius: 0, transform: [{ rotate: '45deg' }] },
  face: { position: 'absolute', alignItems: 'center' },
  eyes: { flexDirection: 'row', gap: 10 },
  sparkle: { position: 'absolute', top: 0, color: colors.watch, fontSize: 18, fontWeight: '800' },
  bang: { position: 'absolute', right: 2, top: -4, color: colors.alert, fontSize: 26, fontWeight: '900' },
  bubble: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  bubbleText: { ...type.body, fontWeight: '600' },
  body: { ...type.body },
  muted: { ...type.small },
  center: { ...type.small, textAlign: 'center' },
  clock: { fontSize: 56, fontWeight: '800', color: colors.primaryDark, textAlign: 'center', fontVariant: ['tabular-nums'] },
  choice: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  choiceTitle: { ...type.body, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
           fontSize: 18, color: colors.text, backgroundColor: colors.cardAlt },
  tip: { ...type.small, color: colors.primaryDark },
  error: { color: colors.alert, fontWeight: '600', fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...type.body, color: colors.text },
  chipTextOn: { color: colors.onPrimary, fontWeight: '700' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnMuted: { backgroundColor: colors.textFaint },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { ...type.body, color: colors.textMuted },
});
