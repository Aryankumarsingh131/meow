/**
 * T26: Model check (research). Runs the bundled model on this phone, offline,
 * on the golden vectors, and compares every logit and decision with what
 * onnxruntime produced on a desktop CPU from the same file. That comparison
 * is the device half of T26's parity check.
 *
 * Every vector is a SYNTHETIC validation capture. Nothing on this screen is a
 * water reading, nothing is saved, and nothing is sent.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import golden from '../assets/model-golden.json';
import { decide, MODEL_PROBLEM_TEXT, type Decision, type ModelState } from './analysis/model';
import { loadBundledModel } from './analysis/modelLoader';
import { BINS } from './m1Protocol';
import { colors, radius, spacing, type } from './theme';
import { Card, CardTitle, Row } from './ui';

interface Result {
  id: string;
  title: string;
  expected: Decision;
  got: Decision;
  maxDiff: number;
  pass: boolean;
}

interface Case {
  id: string;
  title: string;
  features: number[];
  logits: number[];
  expected: Decision;
}

const sameDecision = (a: Decision, b: Decision) =>
  a.kind === b.kind && (a.kind === 'suggest' ? a.bin === (b as typeof a).bin : a.reason === (b as typeof a).reason);

const binLabel = (key: string) => BINS.find((b) => b.key === key)?.label ?? key;

const ABSTAIN_TEXT: Record<Extract<Decision, { kind: 'abstain' }>['reason'], string> = {
  model_uncertain: 'abstains: not sure enough',
  out_of_range: 'abstains: unlike anything it was trained on',
  not_calibrated: 'abstains: not calibrated',
  output_invalid: 'abstains: invalid output',
};

const describe = (d: Decision) => (d.kind === 'suggest' ? `suggests ${binLabel(d.bin)}` : ABSTAIN_TEXT[d.reason]);

const CASES: Case[] = [
  ...golden.vectors.map((v) => ({
    id: v.record_id, title: `${binLabel(v.label)} capture, ${v.domain.replaceAll('_', ' ')}`,
    features: v.features, logits: v.logits, expected: v.expected as Decision,
  })),
  ...golden.probes.map((p) => ({
    id: p.name, title: `Constructed probe: ${p.name}`, features: p.features, logits: p.logits, expected: p.expected as Decision,
  })),
];

export function ModelCheckScreen({ onBack }: { onBack(): void }): React.JSX.Element {
  const [state, setState] = useState<ModelState | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [msPerRun, setMsPerRun] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const loaded = await loadBundledModel();
      if (!live) return;
      setState(loaded);
      if (loaded.kind !== 'ready') return;
      const out: Result[] = [];
      const times: number[] = [];
      for (const c of CASES) {
        const rgb = c.features as [number, number, number];
        const started = performance.now();
        const logits = await loaded.model.run(rgb);
        times.push(performance.now() - started);
        const got = decide(logits, loaded.model.manifest, rgb);
        const maxDiff = Math.max(...logits.map((x, i) => Math.abs(x - c.logits[i])));
        out.push({ id: c.id, title: c.title, expected: c.expected, got, maxDiff,
          pass: maxDiff <= golden.logit_tolerance && sameDecision(got, c.expected) });
      }
      if (!live) return;
      times.sort((a, b) => a - b);
      setMsPerRun(times[Math.floor(times.length / 2)]);
      setResults(out);
    })();
    return () => { live = false; };
  }, []);

  const passed = results?.filter((r) => r.pass).length ?? 0;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <CardTitle>Model check (research)</CardTitle>
        <Text style={s.body}>
          Runs the bundled model on this phone, with no network, on synthetic test captures, and checks it gives the
          same answers as the desktop build. These are not water readings and nothing here is saved.
        </Text>
      </Card>

      {!state && <Text style={s.body} testID="model-check-loading">Loading the model on this phone…</Text>}

      {state?.kind === 'unavailable' && (
        <Card>
          <CardTitle>Model unavailable</CardTitle>
          <Text style={s.body} testID="model-check-unavailable">{MODEL_PROBLEM_TEXT[state.problem]}</Text>
          <Text style={s.meta}>Readings stay manual. This is the same fallback the review step uses.</Text>
        </Card>
      )}

      {state?.kind === 'ready' && (
        <Card>
          <Row label="Model" value={`${state.model.manifest.model_id}@${state.model.manifest.version}`} />
          <Row label="File check" value={`SHA-256 ${state.model.manifest.sha256.slice(0, 12)}… verified`} />
          <Row label="Calibration" value={state.model.manifest.calibration?.version ?? 'not calibrated: it will not suggest'} />
          <Row label="Status" value="Research only, trained on synthetic data" />
          {msPerRun !== null && <Row label="Time per analysis" value={`${msPerRun.toFixed(1)} ms (median)`} />}
        </Card>
      )}

      {results && (
        <Card>
          <CardTitle>{passed === results.length ? 'Matches the desktop build' : 'Does NOT match the desktop build'}</CardTitle>
          <Text style={[s.summary, passed !== results.length && s.fail]} testID="model-check-summary">
            {passed} of {results.length} checks match
          </Text>
          {results.map((r) => (
            <View key={r.id} style={s.result}>
              <Text style={[s.mark, !r.pass && s.fail]}>{r.pass ? 'Match' : 'Differs'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.body}>{r.title}: {describe(r.got)}</Text>
                {!r.pass && <Text style={s.meta}>Expected: {describe(r.expected)}. Largest logit difference {r.maxDiff.toExponential(1)}.</Text>}
              </View>
            </View>
          ))}
        </Card>
      )}

      <Pressable style={s.btn} onPress={onBack} accessibilityRole="button" testID="model-check-back">
        <Text style={s.btnText}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: spacing.lg, gap: spacing.md },
  body: { ...type.body, color: colors.text },
  meta: { ...type.small },
  summary: { ...type.h3, color: colors.primaryDark, marginBottom: spacing.sm },
  fail: { color: colors.watch },
  result: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  mark: { ...type.small, width: 56, fontWeight: '700', color: colors.primaryDark },
  btn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnText: { ...type.body, color: '#fff', fontWeight: '700' },
});
