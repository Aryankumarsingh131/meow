/**
 * Pluccy - the field guidance mascot - and the guided screening it runs:
 *
 *   source (or add one by GPS) -> kits (one or several) -> protocol checklist
 *   -> judgement questions at the source -> dip each strip, one timer per kit,
 *   read each inside its window -> proof photos (up to 4) -> send (one test record
 *   per kit) -> result, next steps, points.
 *
 * Kits, protocols and judgement questions come from GET /v1/staff/kits;
 * nothing about a kit is hardcoded here. The server re-checks the readings,
 * judges the answers, assesses risk and decides points (006, 009); this
 * screen only guides.
 *
 * ponytail: the dip times live in memory, so closing the app mid-wait loses
 * the screening. Persist them (deviceDb) before long-incubation kits such as
 * the 24 h coliform vial are used in the field.
 */

import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';

import { PhotoSet, photoFields } from './photoSet';
import { RefreshBar, useAutoRefresh } from './refresh';
import { PRIORITY_TEXT, solutionsFor, type Priority } from './solutions';
import {
  ADVICE, BAND_TEXT, bandFor, formatCountdown, judgeLocally, mergedProtocol, milestoneReached, nextSteps, parseReading, readPhase,
  type AdviceStage, type Band, type Criterion, type Kit,
} from './pluccyModel';
import { colors, radius, spacing, type } from './theme';
import { Badge, Card, CardTitle, Row, type Tone } from './ui';
import {
  createSource, fetchKits, problemText, SOURCE_TYPES, staffSources, submitScreening, type NewSource, type Photo, type Points,
  type ScreeningResult, type StaffSource,
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

/** "Pluccy's tip": one field tip for this stage, tap for the next one. */
function Tip({ stage }: { stage: AdviceStage }): React.JSX.Element {
  const [i, setI] = useState(0);
  const tips = ADVICE[stage];
  return (
    <Pressable style={s.tipBox} onPress={() => setI((i + 1) % tips.length)} accessibilityRole="button" accessibilityHint="Shows the next tip">
      <Text style={s.tipHead}>💡 Pluccy's tip {i + 1}/{tips.length}</Text>
      <Text style={s.tipText}>{tips[i % tips.length]}</Text>
    </Pressable>
  );
}

// --- the guided screening ----------------------------------------------------------

type Step = 'source' | 'add_source' | 'kits' | 'protocol' | 'inspection' | 'run' | 'photo' | 'review' | 'done';

/** One kit in this screening: its own dip time, read time, readings and record id. */
interface KitRun {
  kit: Kit;
  dipMs: number | null;
  readMs: number | null;
  raw: Record<string, string>;
  localId: string;
}

const TONE: Record<Band, Tone> = { low: 'ok', medium: 'watch', high: 'alert' };
const PRIORITY_TONE: Record<Priority, Tone> = { today: 'alert', this_week: 'watch', routine: 'unknown' };
const RANK: Record<string, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
const RESULT_TEXT: Record<string, string> = {
  low: 'All readings and answers are within the screening bands.',
  medium: 'Something is in the watch band. Your supervisor can see it.',
  high: 'Something is outside the screening band. A report is open for your supervisor.',
  unknown: 'No readings to assess.',
};

const readingsOf = (run: KitRun) => {
  const parsed = run.kit.parameters.map((p) => [p, parseReading(p, run.raw[p.key] ?? '')] as const);
  return { parsed, ready: run.readMs !== null && parsed.every(([, r]) => 'value' in r) };
};

export function ScreeningFlow({ token, onAuthExpired, onPoints }: {
  token: string;
  onAuthExpired(): void;
  onPoints(points: Points): void;
}): React.JSX.Element {
  const [sources, setSources] = useState<StaffSource[] | null>(null);
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<StaffSource | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<KitRun[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, ScreeningResult>>({});
  const [milestone, setMilestone] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const buzzed = useRef(new Set<string>());

  const load = async (selectId?: string, background = false): Promise<boolean> => {
    const [src, kit] = await Promise.all([staffSources(token), fetchKits(token)]);
    for (const r of [src, kit]) {
      if (r.kind === 'auth_required') { onAuthExpired(); return false; }
      if (r.kind !== 'ok') {
        // A background refresh that fails keeps the list already on screen.
        if (!background || !sources) setLoadError(problemText(r));
        return false;
      }
    }
    setLoadError(null);
    if (src.kind === 'ok') {
      setSources(src.value.items);
      const added = selectId && src.value.items.find((x) => x.source_id === selectId);
      if (added) { setSource(added); setStep('kits'); }
    }
    if (kit.kind === 'ok') { setKits(kit.value.items); setCriteria(kit.value.inspection_criteria ?? []); }
    return true;
  };
  // The source list refreshes every 30 s, but only while it is on screen: a
  // screening in progress is never disturbed.
  const listRefresh = useAutoRefresh((bg) => load(undefined, bg), token, step === 'source');

  // One clock for all running timers; buzz once per kit when its read window opens.
  useEffect(() => {
    if (step !== 'run') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [step]);
  useEffect(() => {
    for (const run of runs) {
      if (run.dipMs === null || run.readMs !== null || buzzed.current.has(run.kit.kit_id)) continue;
      if (readPhase(run.dipMs, now, run.kit).phase === 'read_now') {
        buzzed.current.add(run.kit.kit_id);
        Vibration.vibrate([0, 400, 150, 400]);
      }
    }
  }, [now, runs]);

  const restart = () => {
    setStep('source'); setSource(null); setPicked([]); setTicked(new Set()); setAnswers({}); setRuns([]);
    setPhotos([]); setError(null); setSent({}); setMilestone(null); buzzed.current.clear();
  };
  const updateRun = (kitId: string, change: Partial<KitRun>) =>
    setRuns((rs) => rs.map((r) => (r.kit.kit_id === kitId ? { ...r, ...change } : r)));

  const submit = async () => {
    setSending(true);
    setError(null);
    const results = { ...sent };
    for (const [i, run] of runs.entries()) {
      if (results[run.kit.kit_id]) continue;   // already recorded on an earlier try
      const { parsed } = readingsOf(run);
      const r = await submitScreening(token, {
        source_id: source!.source_id, local_record_id: run.localId, kit_id: run.kit.kit_id, method: 'manual',
        readings: Object.fromEntries(parsed.map(([p, v]) => [p.key, 'value' in v ? v.value : 0])),
        dip_started_at: new Date(run.dipMs!).toISOString(), read_at: new Date(run.readMs!).toISOString(),
        ...photoFields(photos),
        // The judgement belongs to the visit, not to each strip: send it once so it opens one case, not one per kit.
        ...(i === 0 && criteria.length ? { inspection: answers } : {}),
      });
      if (r.kind === 'auth_required') return onAuthExpired();
      // Same local ids on retry: the server cannot record any of them twice.
      if (r.kind !== 'ok') { setSent(results); setSending(false); return setError(problemText(r)); }
      results[run.kit.kit_id] = r.value;
    }
    const all = runs.map((run) => results[run.kit.kit_id]);
    const last = all[all.length - 1];
    const earned = all.reduce((n, x) => n + (x.points_awarded > 0 ? 1 : 0), 0);
    setMilestone(milestoneReached(last.points.qualifying_screenings - earned, last.points.qualifying_screenings, last.points.milestones));
    onPoints(last.points);
    setSent(results);
    setSending(false);
    setStep('done');
  };

  if (loadError) {
    return (
      <View style={s.pad}>
        <Pluccy mood="think" say={loadError} />
        <Pressable style={s.btn} onPress={listRefresh.refresh} accessibilityRole="button"><Text style={s.btnText}>Try again</Text></Pressable>
      </View>
    );
  }
  if (!sources || !kits) return <View style={s.pad}><Pluccy mood="think" say="Getting your sources and kits…" /></View>;
  const chosenKits = kits.filter((k) => picked.includes(k.kit_id));
  const Back = ({ to }: { to: Step }) => (
    <Pressable style={s.ghost} onPress={() => setStep(to)} accessibilityRole="button"><Text style={s.ghostText}>Back</Text></Pressable>
  );

  switch (step) {
    case 'source':
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <View style={s.refreshRow}><RefreshBar state={listRefresh} /></View>
          <Pluccy mood="wave" say="Hi! Which water source are you testing?" />
          <Tip stage="source" />
          <Pressable style={s.btnAlt} onPress={() => setStep('add_source')} accessibilityRole="button" testID="pluccy-add-source">
            <Text style={s.btnAltText}>＋ Add a new water source here</Text>
          </Pressable>
          {sources.length === 0 && <Text style={s.muted}>Your team has no water sources yet.</Text>}
          {sources.map((src) => (
            <Pressable key={src.source_id} style={s.choice} onPress={() => { setSource(src); setStep('kits'); }}
              accessibilityRole="button" testID={`pluccy-source-${src.source_id}`}>
              <Text style={s.choiceTitle}>{src.name}</Text>
              <Text style={s.muted}>{src.source_type.replace('_', ' ')}{src.village ? ` · ${src.village}` : ''}</Text>
            </Pressable>
          ))}
        </ScrollView>
      );
    case 'add_source':
      return <AddSource token={token} onAuthExpired={onAuthExpired} onCancel={() => setStep('source')}
        onAdded={(id) => void load(id)} />;
    case 'kits':
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood="wave" say={`Testing ${source!.name}. Which kits do you have? Pick one or more.`} />
          <Tip stage="kits" />
          {kits.map((kit) => {
            const on = picked.includes(kit.kit_id);
            return (
              <Pressable key={kit.kit_id} style={[s.choice, on && s.choiceOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                onPress={() => setPicked(on ? picked.filter((x) => x !== kit.kit_id) : [...picked, kit.kit_id])} testID={`pluccy-kit-${kit.kit_id}`}>
                <Text style={s.choiceTitle}>{on ? '☑' : '☐'}  {kit.name}</Text>
                <Text style={s.muted}>Wait {formatCountdown(kit.wait_seconds)} · reads {kit.parameters.map((p) => p.label).join(', ')}</Text>
              </Pressable>
            );
          })}
          <Pressable style={[s.btn, !picked.length && s.btnMuted]} disabled={!picked.length} accessibilityRole="button" testID="pluccy-kits-done"
            onPress={() => { setTicked(new Set()); setStep('protocol'); }}>
            <Text style={s.btnText}>Next: protocol ({picked.length} kit{picked.length === 1 ? '' : 's'})</Text>
          </Pressable>
          <Back to="source" />
        </ScrollView>
      );
    case 'protocol': {
      const steps = mergedProtocol(chosenKits);
      const done = steps.every((st) => ticked.has(st.title));
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood="think" say={steps.length ? 'Follow the protocol. Tick each step as you do it.' : 'These kits have no extra steps.'} />
          <Tip stage="protocol" />
          {steps.map((st, n) => {
            const on = ticked.has(st.title);
            return (
              <Pressable key={st.title} style={[s.choice, on && s.choiceOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                onPress={() => { const next = new Set(ticked); if (on) next.delete(st.title); else next.add(st.title); setTicked(next); }}>
                <Text style={s.choiceTitle}>{on ? '☑' : '☐'}  {n + 1}. {st.title}</Text>
                <Text style={s.muted}>{st.detail}</Text>
              </Pressable>
            );
          })}
          <Pressable style={[s.btn, !done && s.btnMuted]} disabled={!done} accessibilityRole="button" testID="pluccy-protocol-done"
            onPress={() => setStep(criteria.length ? 'inspection' : 'run')}>
            <Text style={s.btnText}>{done ? 'Next: look around the source' : `${steps.length - ticked.size} step(s) left`}</Text>
          </Pressable>
          <Back to="kits" />
        </ScrollView>
      );
    }
    case 'inspection': {
      const answered = criteria.every((c) => c.key in answers);
      const j = judgeLocally(criteria, answers);
      const startRun = () => {
        setRuns(chosenKits.map((kit) => ({ kit, dipMs: null, readMs: null, raw: {}, localId: randomUUID() })));
        buzzed.current.clear();
        setStep('run');
      };
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood={j.observation_level === 'high' ? 'alert' : 'think'}
            say={j.observation_level === 'high' ? 'Illness reported. This goes to your supervisor with the screening.'
              : 'Look around the source and answer honestly. It helps your supervisor judge the risk.'} />
          <Tip stage="inspection" />
          {(['sanitary', 'observation'] as const).map((cat) => (
            <Card key={cat}>
              <CardTitle>{cat === 'sanitary' ? 'Around the source' : 'The water and the people'}</CardTitle>
              {criteria.filter((c) => c.category === cat).map((c) => (
                <View key={c.key} style={s.question}>
                  <Text style={s.body}>{c.question}</Text>
                  <Text style={s.tip}>{c.tip}</Text>
                  <View style={s.row}>
                    {([[true, 'Yes'], [false, 'No']] as const).map(([v, label]) => (
                      <Pressable key={label} style={[s.chip, answers[c.key] === v && (v ? s.chipYes : s.chipOn)]}
                        onPress={() => setAnswers({ ...answers, [c.key]: v })} accessibilityRole="radio"
                        accessibilityState={{ selected: answers[c.key] === v }} testID={`pluccy-q-${c.key}-${label.toLowerCase()}`}>
                        <Text style={[s.chipText, answers[c.key] === v && s.chipTextOn]}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </Card>
          ))}
          <Card>
            <CardTitle>Pluccy's judgement preview</CardTitle>
            <Row label="Sanitary risk score" value={`${j.sanitary_score} of ${j.sanitary_total}`} tone={TONE[j.sanitary_level]} />
            <Row label="Sanitary level" value={BAND_TEXT[j.sanitary_level]} tone={TONE[j.sanitary_level]} />
            <Row label="Observations" value={BAND_TEXT[j.observation_level]} tone={TONE[j.observation_level]} />
            <Text style={s.muted}>The server makes the final judgement together with the strip readings.</Text>
          </Card>
          <Pressable style={[s.btn, !answered && s.btnMuted]} disabled={!answered} onPress={startRun} accessibilityRole="button"
            testID="pluccy-inspection-done">
            <Text style={s.btnText}>{answered ? 'Next: dip the strips' : `${criteria.length - Object.keys(answers).length} question(s) left`}</Text>
          </Pressable>
          <Pressable style={s.ghost} onPress={() => setAnswers(Object.fromEntries(criteria.map((c) => [c.key, answers[c.key] ?? false])))}
            accessibilityRole="button"><Text style={s.ghostText}>Mark the rest as No</Text></Pressable>
          <Back to="protocol" />
        </ScrollView>
      );
    }
    case 'run': {
      const phases = runs.map((run) => (run.dipMs === null || run.readMs !== null ? null : readPhase(run.dipMs, now, run.kit)));
      const readNow = phases.some((p) => p?.phase === 'read_now');
      const waiting = phases.some((p) => p?.phase === 'waiting');
      const allReady = runs.every((run) => readingsOf(run).ready);
      const mood: Mood = readNow ? 'alert' : waiting ? 'dance' : allReady ? 'cheer' : 'wave';
      const say = readNow ? 'A strip is ready! Pull it out and read it now.' : waiting ? 'Timers running… keep the strips flat.'
        : allReady ? 'All read. Next, the proof photo.' : 'Dip each strip and start its timer.';
      return (
        <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
          <Pluccy mood={mood} say={say} />
          <Tip stage={readNow || runs.some((r) => r.readMs !== null) ? 'readings' : waiting ? 'wait' : 'dip'} />
          {runs.map((run, n) => {
            const p = phases[n];
            const { parsed } = readingsOf(run);
            return (
              <Card key={run.kit.kit_id}>
                <CardTitle>{run.kit.name}</CardTitle>
                {run.dipMs === null ? (
                  <>
                    <Text style={s.body}>{run.kit.dip_instruction ?? 'Dip the strip now.'}</Text>
                    <Row label="Wait after dipping" value={formatCountdown(run.kit.wait_seconds)} />
                    <Row label="Read within" value={`${run.kit.read_grace_seconds} s after that`} />
                    <Pressable style={s.btn} onPress={() => updateRun(run.kit.kit_id, { dipMs: Date.now() })} accessibilityRole="button"
                      testID={`pluccy-dipped-${run.kit.kit_id}`}>
                      <Text style={s.btnText}>I dipped it — start the timer</Text>
                    </Pressable>
                  </>
                ) : p ? (
                  <>
                    <Text style={[s.clock, p.phase === 'read_now' && { color: colors.alert }]} accessibilityLiveRegion="polite">
                      {p.phase === 'late' ? 'Late' : formatCountdown(p.secondsLeft)}
                    </Text>
                    <Text style={s.center}>
                      {p.phase === 'waiting' ? 'until you can read it' : p.phase === 'read_now' ? 'left to read it'
                        : 'The window has passed; colours may have changed. It still counts, without points.'}
                    </Text>
                    <Pressable style={[s.btn, p.phase === 'waiting' && s.btnMuted]} accessibilityRole="button" testID={`pluccy-pulled-${run.kit.kit_id}`}
                      onPress={() => updateRun(run.kit.kit_id, { readMs: Date.now() })}>
                      <Text style={s.btnText}>{p.phase === 'waiting' ? 'Pulled out early (no points)' : 'I pulled it out — read it'}</Text>
                    </Pressable>
                    {p.phase === 'late' && (
                      <Pressable style={s.ghost} onPress={() => { buzzed.current.delete(run.kit.kit_id); updateRun(run.kit.kit_id, { dipMs: null }); }}
                        accessibilityRole="button"><Text style={s.ghostText}>Use a fresh strip</Text></Pressable>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={s.muted}>Read {formatCountdown((run.readMs! - run.dipMs) / 1000)} after the dip.</Text>
                    {parsed.map(([pm, r]) => (
                      <View key={pm.key} style={s.question}>
                        <Text style={s.choiceTitle}>{pm.label}{pm.unit ? ` (${pm.unit})` : ''}</Text>
                        {pm.input_kind === 'presence' ? (
                          <View style={s.row}>
                            {([['0', 'Absent'], ['1', 'Present']] as const).map(([v, label]) => (
                              <Pressable key={v} style={[s.chip, run.raw[pm.key] === v && s.chipOn]} accessibilityRole="button"
                                onPress={() => updateRun(run.kit.kit_id, { raw: { ...run.raw, [pm.key]: v } })}
                                accessibilityState={{ selected: run.raw[pm.key] === v }}>
                                <Text style={[s.chipText, run.raw[pm.key] === v && s.chipTextOn]}>{label}</Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : (
                          <TextInput style={s.input} keyboardType="decimal-pad" value={run.raw[pm.key] ?? ''} placeholder={`${pm.min} – ${pm.max}`}
                            placeholderTextColor={colors.textFaint} accessibilityLabel={pm.label} testID={`pluccy-reading-${pm.key}`}
                            onChangeText={(t) => updateRun(run.kit.kit_id, { raw: { ...run.raw, [pm.key]: t } })} />
                        )}
                        <Text style={s.tip}>💡 {pm.tip}</Text>
                        {'value' in r
                          ? <Badge label={BAND_TEXT[bandFor(pm, r.value)]} tone={TONE[bandFor(pm, r.value)]} />
                          : run.raw[pm.key] ? <Text style={s.error}>{r.error}</Text> : null}
                      </View>
                    ))}
                  </>
                )}
              </Card>
            );
          })}
          <Pressable style={[s.btn, !allReady && s.btnMuted]} disabled={!allReady} onPress={() => setStep('photo')} accessibilityRole="button"
            testID="pluccy-readings-done">
            <Text style={s.btnText}>Next: photo</Text>
          </Pressable>
          <Pressable style={s.ghost} onPress={restart} accessibilityRole="button"><Text style={s.ghostText}>Discard and start again</Text></Pressable>
        </ScrollView>
      );
    }
    case 'photo': {
      const toReview = () => { setError(null); setStep('review'); };
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood="wave" say={runs.length > 1 ? 'Lay all the strips beside the chart and snap them together.' : 'Snap the strip next to the colour chart as proof.'} />
          <Tip stage="photo" />
          <Text style={s.body}>Take up to 4 photos: the strips beside the chart first, then the source and anything you noticed.</Text>
          <PhotoSet photos={photos} onChange={setPhotos} prompt="Line the strips up inside the frame, in good light" />
          <Pressable style={[s.btn, !photos.length && s.btnMuted]} disabled={!photos.length} onPress={toReview} accessibilityRole="button"
            testID="photos-done">
            <Text style={s.btnText}>{photos.length ? `Next: review (${photos.length} photo${photos.length === 1 ? '' : 's'})` : 'Take at least one photo'}</Text>
          </Pressable>
          <Pressable style={s.ghost} onPress={() => { setPhotos([]); toReview(); }} accessibilityRole="button">
            <Text style={s.ghostText}>Continue without a photo (no points)</Text>
          </Pressable>
        </ScrollView>
      );
    }
    case 'review': {
      const j = criteria.length ? judgeLocally(criteria, answers) : null;
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood={error ? 'think' : 'wave'} say={error ?? `All set. Send ${runs.length} screening${runs.length === 1 ? '' : 's'}?`} />
          <Tip stage="review" />
          <Card>
            <CardTitle>{source!.name}</CardTitle>
            {runs.map((run) => {
              const { parsed } = readingsOf(run);
              return (
                <View key={run.kit.kit_id} style={s.question}>
                  <Text style={s.choiceTitle}>{run.kit.name}{sent[run.kit.kit_id] ? ' · sent' : ''}</Text>
                  <Row label="Read after dip" value={formatCountdown((run.readMs! - run.dipMs!) / 1000)} />
                  {parsed.map(([pm, r]) => (
                    <Row key={pm.key} label={pm.label} value={'value' in r
                      ? (pm.input_kind === 'presence' ? (r.value ? 'Present' : 'Absent') : `${r.value} ${pm.unit}`.trim()) : '—'} />
                  ))}
                </View>
              );
            })}
            {j && <Row label="Sanitary score" value={`${j.sanitary_score} of ${j.sanitary_total}`} tone={TONE[j.sanitary_level]} />}
            {j && <Row label="Flagged" value={j.flagged.length ? String(j.flagged.length) : 'None'} />}
            <Row label="Photos" value={photos.length ? String(photos.length) : 'None'} />
          </Card>
          <Pressable style={[s.btn, sending && s.btnMuted]} disabled={sending} onPress={() => void submit()} accessibilityRole="button"
            testID="pluccy-submit">
            <Text style={s.btnText}>{sending ? 'Sending…' : error ? 'Try sending again' : 'Send screening'}</Text>
          </Pressable>
          {!sending && <Pressable style={s.ghost} onPress={() => setStep('photo')} accessibilityRole="button"><Text style={s.ghostText}>{photos.length ? 'Change photos' : 'Add a photo (for points)'}</Text></Pressable>}
          <Pressable style={s.ghost} onPress={restart} accessibilityRole="button"><Text style={s.ghostText}>Discard</Text></Pressable>
        </ScrollView>
      );
    }
    case 'done': {
      const results = runs.map((run) => ({ run, r: sent[run.kit.kit_id] }));
      const earned = results.reduce((n, x) => n + x.r.points_awarded, 0);
      const last = results[results.length - 1].r;
      const risk = results.reduce((w, x) => (RANK[x.r.risk_level] > RANK[w] ? x.r.risk_level : w), 'unknown' as ScreeningResult['risk_level']);
      const judged = results.find((x) => x.r.assessment?.inspection)?.r.assessment?.inspection ?? null;
      const say = milestone ? `${milestone} on-time screenings! You're a star!`
        : earned ? `+${earned} points! Nicely timed.` : 'Sent. No points this time — see why below.';
      return (
        <ScrollView contentContainerStyle={s.pad}>
          <Pluccy mood={earned ? 'cheer' : risk === 'high' ? 'alert' : 'wave'} say={say} size={milestone ? 130 : 96} />
          <Card>
            <CardTitle>Screening sent · {source!.name}</CardTitle>
            <Badge label={risk === 'unknown' ? 'Not assessed' : BAND_TEXT[risk]} tone={risk === 'unknown' ? 'unknown' : TONE[risk]} />
            <Text style={s.body}>{RESULT_TEXT[risk]}</Text>
            {results.map(({ run, r }) => (
              <View key={run.kit.kit_id} style={s.question}>
                <Text style={s.choiceTitle}>{run.kit.name}{r.points_awarded ? ` · +${r.points_awarded}` : ''}</Text>
                {r.assessment?.findings.map((f) => <Row key={f.parameter} label={f.parameter} value={`${f.value} · ${BAND_TEXT[f.level]}`} tone={TONE[f.level]} />)}
              </View>
            ))}
            {judged && <Row label="Sanitary score" value={`${judged.sanitary_score} of ${judged.sanitary_total}`} tone={TONE[judged.sanitary_level]} />}
            {judged && <Row label="Observations" value={BAND_TEXT[judged.observation_level]} tone={TONE[judged.observation_level]} />}
            <Text style={s.muted}>A field screening is not a laboratory test.</Text>
          </Card>
          <Card>
            <CardTitle>Pluccy says: what to do next</CardTitle>
            {nextSteps(risk, judged).map((line, n) => <Text key={line} style={s.body}>{n + 1}. {line}</Text>)}
          </Card>
          <Card>
            <CardTitle>Suggested solutions</CardTitle>
            {(() => {
              const found = results.flatMap(({ r }) => r.assessment?.findings ?? []);
              const tips = solutionsFor(found, runs.flatMap((x) => x.kit.parameters), judged);
              if (!tips.length) return <Text style={s.body}>Nothing was flagged, so nothing needs fixing at the source. Keep the normal screening schedule.</Text>;
              return tips.map((tip) => (
                <View key={tip.key} style={s.solution}>
                  <View style={s.solutionHead}>
                    <Text style={[s.choiceTitle, { flex: 1 }]}>{tip.title}</Text>
                    <Badge label={PRIORITY_TEXT[tip.priority]} tone={PRIORITY_TONE[tip.priority]} />
                  </View>
                  <Text style={s.muted}>{tip.why}</Text>
                  {tip.steps.map((step, n) => <Text key={step} style={s.body}>{n + 1}. {step}</Text>)}
                  <Text style={s.tip}>Who: {tip.who}</Text>
                </View>
              ));
            })()}
            <Text style={s.muted}>Suggestions for you and the water team, from a field screening. Confirm with the lab before changing anything at the source.</Text>
          </Card>
          <Card>
            <CardTitle>Points</CardTitle>
            <Row label="This visit" value={earned ? `+${earned}` : '0'} />
            <Row label="Balance" value={String(last.points.points_balance)} />
            <Row label="Streak" value={`${last.points.streak_days} day${last.points.streak_days === 1 ? '' : 's'}`} />
            {last.points.next_milestone && <Row label="Next badge at" value={`${last.points.next_milestone} on-time screenings`} />}
            {!earned && <Text style={s.muted}>{last.points.rule}</Text>}
          </Card>
          <Pressable style={s.btn} onPress={restart} accessibilityRole="button" testID="pluccy-again">
            <Text style={s.btnText}>Test another source</Text>
          </Pressable>
        </ScrollView>
      );
    }
  }
}

// --- add a water source where the worker stands --------------------------------------

function AddSource({ token, onAuthExpired, onCancel, onAdded }: {
  token: string;
  onAuthExpired(): void;
  onCancel(): void;
  onAdded(sourceId: string): void;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<NewSource['source_type']>('hand_pump');
  const [village, setVillage] = useState('');
  const [landmark, setLandmark] = useState('');
  const [fix, setFix] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [busy, setBusy] = useState<'gps' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locate = async () => {
    setBusy('gps');
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return setError('JalSakshi needs location permission to pin a new source.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      setFix({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: Math.max(1, Math.round(pos.coords.accuracy ?? 999)) });
    } catch {
      setError('Could not get a GPS fix. Step into the open and try again.');
    } finally {
      setBusy(null);
    }
  };
  useEffect(() => { void locate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const precise = !!fix && fix.accuracy <= 100;   // the server refuses a GPS pin worse than 100 m
  const ready = precise && name.trim().length > 0;
  const save = async () => {
    if (!fix) return;
    setBusy('save');
    setError(null);
    const r = await createSource(token, {
      name: name.trim(), source_type: kind, latitude: fix.latitude, longitude: fix.longitude, location_source: 'gps_auto',
      location_accuracy_m: fix.accuracy, ...(village.trim() ? { village: village.trim() } : {}), ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
    });
    setBusy(null);
    if (r.kind === 'auth_required') return onAuthExpired();
    if (r.kind !== 'ok') return setError(problemText(r));
    onAdded(r.value.source_id);
  };

  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Pluccy mood={busy === 'gps' ? 'think' : 'wave'} say={busy === 'gps' ? 'Finding where you are…' : 'Stand right next to the new source, then give it a name.'} />
      <Card>
        <CardTitle>Location</CardTitle>
        {fix ? (
          <>
            <Row label="Latitude, longitude" value={`${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}`} />
            <Row label="Accuracy" value={`± ${fix.accuracy} m`} tone={precise ? 'ok' : 'watch'} />
            {!precise && <Text style={s.error}>Too rough. Move into the open, away from walls, and refresh.</Text>}
          </>
        ) : <Text style={s.muted}>{busy === 'gps' ? 'Waiting for GPS…' : 'No position yet.'}</Text>}
        <Pressable style={s.ghost} onPress={() => void locate()} disabled={busy !== null} accessibilityRole="button" testID="source-gps">
          <Text style={s.ghostText}>{busy === 'gps' ? 'Locating…' : 'Refresh GPS'}</Text>
        </Pressable>
      </Card>
      <Card>
        <CardTitle>About the source</CardTitle>
        <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name, e.g. School Hand Pump" placeholderTextColor={colors.textFaint}
          maxLength={120} accessibilityLabel="Source name" testID="source-name" />
        <View style={s.wrap}>
          {SOURCE_TYPES.map(([value, label]) => (
            <Pressable key={value} style={[s.pill, kind === value && s.chipOn]} onPress={() => setKind(value)} accessibilityRole="radio"
              accessibilityState={{ selected: kind === value }}>
              <Text style={[s.chipText, kind === value && s.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput style={s.input} value={village} onChangeText={setVillage} placeholder="Village (optional)" placeholderTextColor={colors.textFaint}
          maxLength={120} accessibilityLabel="Village" />
        <TextInput style={s.input} value={landmark} onChangeText={setLandmark} placeholder="Landmark (optional)" placeholderTextColor={colors.textFaint}
          maxLength={120} accessibilityLabel="Landmark" />
      </Card>
      {error && <Text style={s.error}>{error}</Text>}
      <Pressable style={[s.btn, (!ready || busy) && s.btnMuted]} disabled={!ready || busy !== null} onPress={() => void save()}
        accessibilityRole="button" testID="source-save">
        <Text style={s.btnText}>{busy === 'save' ? 'Saving…' : 'Save and test this source'}</Text>
      </Pressable>
      <Text style={s.muted}>A pin placed by hand needs a supervisor; do that from the dashboard.</Text>
      <Pressable style={s.ghost} onPress={onCancel} accessibilityRole="button"><Text style={s.ghostText}>Back</Text></Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  pad: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  refreshRow: { marginHorizontal: -spacing.lg, marginTop: -spacing.md },
  mascotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  drop: { position: 'absolute', backgroundColor: colors.accent, borderTopLeftRadius: 0, transform: [{ rotate: '45deg' }] },
  face: { position: 'absolute', alignItems: 'center' },
  eyes: { flexDirection: 'row', gap: 10 },
  sparkle: { position: 'absolute', top: 0, color: colors.watch, fontSize: 18, fontWeight: '800' },
  bang: { position: 'absolute', right: 2, top: -4, color: colors.alert, fontSize: 26, fontWeight: '900' },
  bubble: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  bubbleText: { ...type.body, fontWeight: '600' },
  tipBox: { backgroundColor: colors.primarySoft, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  tipHead: { ...type.small, color: colors.primaryDark, fontWeight: '700' },
  tipText: { ...type.body, color: colors.primaryDark },
  body: { ...type.body },
  muted: { ...type.small },
  center: { ...type.small, textAlign: 'center' },
  clock: { fontSize: 44, fontWeight: '800', color: colors.primaryDark, textAlign: 'center', fontVariant: ['tabular-nums'] },
  choice: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceTitle: { ...type.body, fontWeight: '700' },
  question: { gap: spacing.xs, paddingVertical: spacing.xs },
  solution: { gap: 4, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  solutionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
           fontSize: 18, color: colors.text, backgroundColor: colors.cardAlt },
  tip: { ...type.small, color: colors.primaryDark },
  error: { color: colors.alert, fontWeight: '600', fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: { paddingVertical: 8, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chip: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipYes: { backgroundColor: colors.watch, borderColor: colors.watch },
  chipText: { ...type.body, color: colors.text },
  chipTextOn: { color: colors.onPrimary, fontWeight: '700' },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnMuted: { backgroundColor: colors.textFaint },
  btnText: { ...type.body, color: colors.onPrimary, fontWeight: '700' },
  btnAlt: { borderRadius: radius.md, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.primary, paddingVertical: spacing.md, alignItems: 'center' },
  btnAltText: { ...type.body, color: colors.primary, fontWeight: '700' },
  ghost: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, alignItems: 'center' },
  ghostText: { ...type.body, color: colors.textMuted },
});
