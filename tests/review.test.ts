/**
 * T11: deterministic indicative review and provenance-preserving fallback.
 *
 * Run: node tests/review.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  analyseBaseline,
  confirmSuggestion,
  MANUAL_REASON_MAX_LENGTH,
  recordManualInterpretation,
  type BaselineProfile,
  type ReviewAnalysis,
} from '../apps/mobile/src/analysis/baseline.ts';

const PROFILE: BaselineProfile = {
  id: 'fixture-profile',
  version: 1,
  protocolId: 'fixture-protocol',
  protocolVersion: 1,
  status: 'research',
  bins: [
    { key: 'bin_a', label: 'A', ordinal: 0, referenceRgb: [20, 20, 20], reviewTrigger: false },
    { key: 'bin_b', label: 'B', ordinal: 1, referenceRgb: [100, 100, 100], reviewTrigger: true },
    { key: 'bin_c', label: 'C', ordinal: 2, referenceRgb: [200, 200, 200], reviewTrigger: true },
  ],
};

const FEATURES = {
  schema_version: 1 as const,
  median_r: 95,
  median_g: 100,
  median_b: 105,
};

const ACCEPT = { decision: 'accept' as const, reasons: [] as string[] };

function analyse(overrides: Partial<Parameters<typeof analyseBaseline>[0]> = {}): ReviewAnalysis {
  return analyseBaseline({
    features: FEATURES,
    quality: ACCEPT,
    timingValid: true,
    profile: PROFILE,
    ...overrides,
  });
}

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

test('accepted inputs select the nearest ordinal bin without fake confidence', () => {
  const result = analyse();
  assert.equal(result.status, 'suggested');
  assert.equal(result.machineBin, 'bin_b');
  assert.equal(result.indicativeFlag, 'review');
  assert.equal(result.calibratedConfidence, null);
  assert.equal(result.baselineVersion, 'fixture-profile@1');
  assert.equal(result.researchOnly, true);
});

test('equal-distance ties resolve to the lower ordinal', () => {
  const result = analyse({
    features: { schema_version: 1, median_r: 60, median_g: 60, median_b: 60 },
  });
  assert.equal(result.machineBin, 'bin_a');
  assert.equal(result.indicativeFlag, 'no_flag');
});

test('camera denial or missing features requires manual interpretation', () => {
  const result = analyse({ features: null });
  assert.equal(result.status, 'manual_required');
  assert.equal(result.machineBin, null);
  assert.equal(result.indicativeFlag, 'uncertain');
  assert.equal(result.reason, 'features_unavailable');
});

test('invalid timing blocks assisted interpretation', () => {
  const result = analyse({ timingValid: false });
  assert.equal(result.status, 'manual_required');
  assert.equal(result.machineBin, null);
  assert.equal(result.indicativeFlag, 'invalid');
  assert.equal(result.reason, 'timing_invalid');
});

test('retake quality never fabricates a bin', () => {
  const result = analyse({ quality: { decision: 'retake', reasons: ['blur'] } });
  assert.equal(result.status, 'retake');
  assert.equal(result.machineBin, null);
  assert.deepEqual(result.qualityReasons, ['blur']);
});

test('uncertain quality abstains rather than producing a suggestion', () => {
  const result = analyse({ quality: { decision: 'review', reasons: ['glare'] } });
  assert.equal(result.status, 'manual_required');
  assert.equal(result.machineBin, null);
  assert.equal(result.reason, 'quality_uncertain');
});

test('missing or malformed profiles require manual interpretation', () => {
  assert.equal(analyse({ profile: null }).reason, 'profile_unavailable');
  assert.equal(analyse({ profile: { ...PROFILE, bins: [] } }).reason, 'profile_invalid');
  assert.equal(
    analyse({ profile: { ...PROFILE, bins: PROFILE.bins.map((bin) => ({ ...bin, ordinal: bin.ordinal + 1 })) } }).reason,
    'profile_invalid',
  );
  assert.equal(
    analyse({ profile: { ...PROFILE, bins: [{ ...PROFILE.bins[0], referenceRgb: [300, 0, 0] }] } }).reason,
    'profile_invalid',
  );
});

test('confirming a suggestion keeps machine and selected provenance separate', () => {
  const observation = confirmSuggestion(analyse());
  assert.equal(observation.method, 'assisted');
  assert.equal(observation.machineBin, 'bin_b');
  assert.equal(observation.manualBin, null);
  assert.equal(observation.selectedBin, 'bin_b');
  assert.equal(observation.confidence, null);
});

test('human disagreement preserves both bins and the reason', () => {
  const observation = recordManualInterpretation(analyse(), PROFILE.bins, 'bin_a', 'Card looked closer to A');
  assert.equal(observation.method, 'manual');
  assert.equal(observation.machineBin, 'bin_b');
  assert.equal(observation.manualBin, 'bin_a');
  assert.equal(observation.selectedBin, 'bin_a');
  assert.equal(observation.indicativeFlag, 'no_flag');
  assert.equal(observation.overrideReason, 'Card looked closer to A');
});

test('manual entry requires a valid bin and a non-empty reason', () => {
  assert.throws(() => recordManualInterpretation(analyse(), PROFILE.bins, 'bin_a', '   '), /reason/i);
  assert.throws(() => recordManualInterpretation(analyse(), PROFILE.bins, 'missing', 'Worker read it'), /bin/i);
  assert.throws(
    () => recordManualInterpretation(analyse(), PROFILE.bins, 'bin_a', 'x'.repeat(MANUAL_REASON_MAX_LENGTH + 1)),
    /too long/i,
  );
});

test('manual entry remains possible after camera denial', () => {
  const observation = recordManualInterpretation(
    analyse({ features: null }),
    PROFILE.bins,
    'bin_c',
    'Camera permission denied; read kit by eye',
  );
  assert.equal(observation.machineBin, null);
  assert.equal(observation.manualBin, 'bin_c');
  assert.equal(observation.selectedBin, 'bin_c');
});

test('review UI states the screening boundary and renders no percentage or potability claim', () => {
  const source = readFileSync(new URL('../apps/mobile/src/review.tsx', import.meta.url), 'utf8');
  assert.match(source, /Indicative screening/);
  assert.match(source, /not a complete water-safety assessment/);
  assert.match(source, /Experimental suggestion/);
  assert.doesNotMatch(source, /\d\s*%/);
  assert.doesNotMatch(source, /\bpotable\b|\bcertified\b/i);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed) process.exitCode = 1;
else console.log(`\n${tests.length} review tests passed`);
