/**
 * T26/T27: the app's model logic agrees with the Python pipeline, and every
 * way the model can be unusable falls back to a manual reading.
 *
 * The golden file (apps/mobile/assets/model-golden.json) carries logits that
 * onnxruntime produced from the ACTUAL bundled ONNX file, for validation
 * captures and for constructed probes, plus the decision ml/golden.py reached
 * under the manifest's calibration. The same file is replayed on the phone by
 * the Model check screen, which is where native-runtime parity is measured.
 *
 * Run: node tests/model-parity.test.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { confirmSuggestion } from '../apps/mobile/src/analysis/baseline.ts';
import {
  analyseWithModel, checkBytes, checkManifest, decide,
  type LoadedModel, type ModelManifest, type ModelState,
} from '../apps/mobile/src/analysis/model.ts';
import { buildSample } from '../apps/mobile/src/sample.ts';
import type { Protocol, TimingVerdict } from '../apps/mobile/src/timer.ts';

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf-8'));
const manifest: ModelManifest = json('../apps/mobile/assets/model-manifest.json');
const golden = json('../apps/mobile/assets/model-golden.json');
const protocol = json('../protocols/SYN-COLOR-001.v1.json');
const modelBytes = readFileSync(new URL('../apps/mobile/assets/syn-color-001-mlp.v1.onnx', import.meta.url));

const PROTOCOL = { id: protocol.id, version: protocol.version, binKeys: protocol.bins.map((b: { key: string }) => b.key) };
const BINS = protocol.bins.map((b: { key: string; labels: { en: string }; review_trigger: boolean }) => ({
  key: b.key, label: b.labels.en, reviewTrigger: b.review_trigger,
}));
assert.ok(manifest.calibration, 'the shipped manifest is calibrated (T27)');
const RANGE = manifest.calibration.range;
const CALIBRATED: ModelManifest = { ...manifest, calibration: { version: 'test-cal', temperature: 1, abstain_below: 0.9, range: RANGE } };
const IN_RANGE = [60, 125, 220] as const; // near the SYN-A training centroid
const FEATURES = { schema_version: 1 as const, median_r: IN_RANGE[0], median_g: IN_RANGE[1], median_b: IN_RANGE[2] };
const ACCEPT = { decision: 'accept' as const, reasons: [] as string[] };

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function modelReturning(logits: number[] | Error, m: ModelManifest = CALIBRATED): ModelState & { calls: number } {
  const state = {
    kind: 'ready' as const, calls: 0,
    model: {
      manifest: m,
      run: async () => { state.calls += 1; if (logits instanceof Error) throw logits; return logits; },
    } satisfies LoadedModel,
  };
  return state;
}

await test('the shipped manifest describes the shipped file and this protocol', () => {
  assert.equal(checkManifest(manifest, PROTOCOL), null);
  assert.equal(checkBytes(createHash('sha256').update(modelBytes).digest('hex'), manifest), null);
  assert.equal(manifest.bytes, modelBytes.length);
  assert.equal(golden.model_sha256, manifest.sha256);
  assert.equal(golden.calibration_version, manifest.calibration?.version);
});

await test('a model file that differs by one byte fails its integrity check', () => {
  const tampered = Buffer.from(modelBytes);
  tampered[tampered.length - 1] ^= 0xff;
  assert.equal(checkBytes(createHash('sha256').update(tampered).digest('hex'), manifest), 'sha_mismatch');
});

await test('wrong protocol, schema, classes or calibration make the model unusable', () => {
  const cal = manifest.calibration!;
  assert.equal(checkManifest({ ...manifest, protocol: { ...manifest.protocol, version: 2 } }, PROTOCOL), 'protocol_mismatch');
  assert.equal(checkManifest({ ...manifest, input: { ...manifest.input, feature_schema_version: 2 } }, PROTOCOL), 'schema_mismatch');
  assert.equal(checkManifest({ ...manifest, input: { ...manifest.input, features: ['median_b', 'median_g', 'median_r'] } }, PROTOCOL), 'schema_mismatch');
  assert.equal(checkManifest({ ...manifest, output: { ...manifest.output, classes: ['bin_1', 'bin_0', 'bin_2', 'bin_3'] } }, PROTOCOL), 'classes_mismatch');
  assert.equal(checkManifest({ ...manifest, calibration: { ...cal, temperature: 0 } }, PROTOCOL), 'manifest_invalid');
  assert.equal(checkManifest({ ...manifest, calibration: { ...cal, range: { ...cal.range, centroids: cal.range.centroids.slice(1) } } }, PROTOCOL), 'manifest_invalid');
  assert.equal(checkManifest({ ...manifest, calibration: { ...cal, range: { ...cal.range, max_distance: -1 } } }, PROTOCOL), 'manifest_invalid');
  assert.equal(checkManifest({ ...manifest, sha256: 'not-a-hash' }, PROTOCOL), 'manifest_invalid');
  assert.equal(checkManifest(null, PROTOCOL), 'manifest_invalid');
});

await test('every golden capture and probe reaches the decision Python reached', () => {
  assert.ok(golden.vectors.length >= 16 && golden.probes.length >= 5);
  for (const v of [...golden.vectors, ...golden.probes]) {
    assert.deepEqual(decide(v.logits, manifest, v.features), v.expected, v.record_id ?? v.name);
  }
  const probe = (name: string) => golden.probes.find((p: { name: string }) => p.name === name).expected;
  assert.deepEqual(probe('black'), { kind: 'abstain', reason: 'out_of_range' }, 'the range guard catches what softmax cannot');
  assert.deepEqual(probe('blue/green midpoint'), { kind: 'abstain', reason: 'model_uncertain' });
});

await test('decide: temperature, threshold, range, ties and malformed output', () => {
  assert.deepEqual(decide([5, 0, 0, 0], CALIBRATED, IN_RANGE), { kind: 'suggest', bin: 'bin_0' });
  assert.deepEqual(decide([1, 0.9, 0, 0], CALIBRATED, IN_RANGE), { kind: 'abstain', reason: 'model_uncertain' });
  // T = 0.02 turns the 0.1 logit gap into 5: p(bin_0) = 1 / (1 + e^-5 + 2e^-50) ≈ 0.993.
  const cooler = { ...CALIBRATED, calibration: { ...CALIBRATED.calibration!, temperature: 0.02 } };
  assert.deepEqual(decide([1, 0.9, 0, 0], cooler, IN_RANGE), { kind: 'suggest', bin: 'bin_0' });
  const low = { ...CALIBRATED, calibration: { ...CALIBRATED.calibration!, abstain_below: 0.2 } };
  assert.deepEqual(decide([2, 2, 0, 0], low, IN_RANGE), { kind: 'suggest', bin: 'bin_0' }, 'ties go to the first class, like numpy argmax');
  assert.deepEqual(decide([9, 0, 0, 0], CALIBRATED, [10, 10, 10]), { kind: 'abstain', reason: 'out_of_range' });
  assert.deepEqual(decide([9, 0, 0, 0], CALIBRATED, [Number.NaN, 0, 0]), { kind: 'abstain', reason: 'out_of_range' });
  assert.deepEqual(decide([1, Number.NaN, 0, 0], CALIBRATED, IN_RANGE), { kind: 'abstain', reason: 'output_invalid' });
  assert.deepEqual(decide([1, 0, 0], CALIBRATED, IN_RANGE), { kind: 'abstain', reason: 'output_invalid' });
  assert.deepEqual(decide([5, 0, 0, 0], { ...manifest, calibration: null }, IN_RANGE), { kind: 'abstain', reason: 'not_calibrated' });
});

await test('the model never runs when timing, quality or features rule it out', async () => {
  const state = modelReturning([9, 0, 0, 0]);
  const cases = [
    [{ features: FEATURES, quality: ACCEPT, timingValid: false }, 'timing_invalid'],
    [{ features: FEATURES, quality: { decision: 'review' as const, reasons: ['QUALITY_NOT_ASSESSED'] }, timingValid: true }, 'quality_uncertain'],
    [{ features: FEATURES, quality: { decision: 'retake' as const, reasons: ['BLUR_SUSPECTED'] }, timingValid: true }, 'quality_retake'],
    [{ features: null, quality: ACCEPT, timingValid: true }, 'features_unavailable'],
    [{ features: { ...FEATURES, median_r: 300 }, quality: ACCEPT, timingValid: true }, 'features_invalid'],
  ] as const;
  for (const [input, reason] of cases) {
    const result = await analyseWithModel(input, state, BINS);
    assert.equal(result.reason, reason);
    assert.equal(result.machineBin, null);
  }
  assert.equal(state.calls, 0);
});

await test('an unavailable, failing or uncalibrated model falls back to manual with the reason', async () => {
  const input = { features: FEATURES, quality: ACCEPT, timingValid: true };
  const unavailable = await analyseWithModel(input, { kind: 'unavailable', problem: 'sha_mismatch' }, BINS);
  assert.deepEqual([unavailable.status, unavailable.reason, unavailable.modelProblem], ['manual_required', 'model_unavailable', 'sha_mismatch']);
  const failing = await analyseWithModel(input, modelReturning(new Error('native crash')), BINS);
  assert.equal(failing.modelProblem, 'inference_failed');
  const uncalibrated = await analyseWithModel(input, modelReturning([9, 0, 0, 0], { ...manifest, calibration: null }), BINS);
  assert.deepEqual([uncalibrated.reason, uncalibrated.modelProblem, uncalibrated.machineBin], ['model_unavailable', 'not_calibrated', null]);
});

await test('uncertain or out-of-range input abstains; a confident one suggests, labelled research-only', async () => {
  const input = { features: FEATURES, quality: ACCEPT, timingValid: true };
  const unsure = await analyseWithModel(input, modelReturning([1, 0.95, 0, 0]), BINS);
  assert.deepEqual([unsure.status, unsure.reason, unsure.machineBin], ['manual_required', 'model_uncertain', null]);
  const shadow = { ...input, features: { ...FEATURES, median_r: 10, median_g: 10, median_b: 10 } };
  const dark = await analyseWithModel(shadow, modelReturning([0, 0, 0, 30]), BINS);
  assert.deepEqual([dark.status, dark.reason, dark.machineBin], ['manual_required', 'model_out_of_range', null]);
  const sure = await analyseWithModel(input, modelReturning([0, 0, 0, 9]), BINS);
  assert.deepEqual([sure.status, sure.machineBin, sure.indicativeFlag], ['suggested', 'bin_3', 'review']);
  assert.equal(sure.researchOnly, true);
  assert.equal(sure.calibratedConfidence, null, 'no confidence number leaves the model');
  assert.equal(sure.baselineVersion, 'syn-color-001-mlp@1');
});

await test('a confirmed model suggestion records which model and calibration produced it', async () => {
  const sure = await analyseWithModel({ features: FEATURES, quality: ACCEPT, timingValid: true }, modelReturning([0, 9, 0, 0]), BINS);
  const inWindow: TimingVerdict = {
    state: 'in_window', timingValid: true, assistedPermitted: true, manualPermitted: true,
    elapsed: { kind: 'measured', seconds: 31.4, source: 'monotonic' }, secondsUntilWindow: null,
  };
  const sample = buildSample(
    { sampleId: 's', sourceId: 'src', protocol: { id: protocol.id, version: 1 } as Protocol, kitLotId: 'lot',
      capturedAtDevice: '2026-09-24T00:00:00Z', clientBuild: 'test' },
    inWindow,
    confirmSuggestion(sure),
  );
  assert.equal(sample.observation.model_version, 'syn-color-001-mlp@1');
  assert.equal(sample.observation.calibration_version, 'test-cal');
  assert.equal(sample.observation.confidence, null);
});

console.log(`\n${passed} model parity tests passed`);
