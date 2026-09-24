/**
 * T26: the bundled on-device model (syn-color-001-mlp), fully offline.
 *
 * Research-only, trained on SYNTHETIC data (ml/model-card.md). It runs only
 * after the same gates as the baseline pass (timing, capture quality, valid
 * features), and it never shows a confidence number: the calibrated
 * probability decides only between suggesting a bin and abstaining.
 *
 * Every way the model can be unusable is a typed problem, and every problem
 * falls back to a manual reading with the reason shown, never to a guess.
 *
 * Pure logic. The native loader (analysis/modelLoader.ts) is separate, so
 * tests/model-parity.test.ts runs this file under Node.
 */

import { gate, type ManualBin, type ReviewAnalysis, type ReviewInput } from './baseline.ts';

export interface ModelCalibration {
  version: string;
  temperature: number;
  abstain_below: number;
  /** Abstain when the input RGB is further than max_distance from every class centroid. */
  range: { centroids: readonly (readonly number[])[]; max_distance: number };
}

export interface ModelManifest {
  manifest_version: 1;
  model_id: string;
  version: number;
  status: 'research' | 'approved';
  data_mode: string;
  file: string;
  sha256: string;
  bytes: number;
  protocol: { id: string; version: number };
  input: { name: string; dtype: 'float32'; feature_schema_version: number; features: readonly string[] };
  output: { name: string; classes: readonly string[] };
  calibration: ModelCalibration | null;
}

export type ModelProblem =
  | 'manifest_invalid'
  | 'protocol_mismatch'
  | 'schema_mismatch'
  | 'classes_mismatch'
  | 'sha_mismatch'
  | 'not_calibrated'
  | 'load_failed'
  | 'inference_failed'
  | 'output_invalid'
  | 'model_disabled';

export const MODEL_PROBLEM_TEXT: Record<ModelProblem, string> = {
  model_disabled: 'This model version has been switched off by the programme.',
  manifest_invalid: 'The bundled model description is invalid.',
  protocol_mismatch: 'The bundled model was built for a different protocol.',
  schema_mismatch: 'The bundled model expects different camera features.',
  classes_mismatch: "The bundled model's bins do not match this protocol.",
  sha_mismatch: 'The bundled model file failed its integrity check.',
  not_calibrated: 'The bundled model has not been calibrated.',
  load_failed: 'The bundled model could not be loaded on this phone.',
  inference_failed: 'The bundled model failed while analysing.',
  output_invalid: 'The bundled model returned an invalid result.',
};

export interface ProtocolRef {
  id: string;
  version: number;
  binKeys: readonly string[];
}

const FEATURES = ['median_r', 'median_g', 'median_b'] as const;
const SHA256 = /^[0-9a-f]{64}$/;

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function checkManifest(value: unknown, protocol: ProtocolRef): ModelProblem | null {
  const m = value as Partial<ModelManifest> | null;
  const c = m?.calibration;
  const shapeOk =
    !!m &&
    m.manifest_version === 1 &&
    typeof m.model_id === 'string' && m.model_id.trim() !== '' &&
    Number.isInteger(m.version) && (m.version ?? 0) >= 1 &&
    (m.status === 'research' || m.status === 'approved') &&
    typeof m.sha256 === 'string' && SHA256.test(m.sha256) &&
    typeof m.input?.name === 'string' && m.input.dtype === 'float32' && Array.isArray(m.input.features) &&
    typeof m.output?.name === 'string' && Array.isArray(m.output.classes) &&
    !!m.protocol &&
    (c === null || (!!c && typeof c.version === 'string' && Number.isFinite(c.temperature) && c.temperature > 0 &&
      Number.isFinite(c.abstain_below) && c.abstain_below > 0 && c.abstain_below <= 1 &&
      Number.isFinite(c.range?.max_distance) && c.range.max_distance > 0 &&
      Array.isArray(c.range.centroids) && c.range.centroids.length === m.output?.classes?.length &&
      c.range.centroids.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))));
  if (!shapeOk) return 'manifest_invalid';
  if (m.protocol!.id !== protocol.id || m.protocol!.version !== protocol.version) return 'protocol_mismatch';
  if (m.input!.feature_schema_version !== 1 || !same(m.input!.features, FEATURES)) return 'schema_mismatch';
  if (!same(m.output!.classes, protocol.binKeys)) return 'classes_mismatch';
  return null;
}

export function checkBytes(sha256Hex: string, manifest: ModelManifest): ModelProblem | null {
  return sha256Hex.toLowerCase() === manifest.sha256 ? null : 'sha_mismatch';
}

export type Decision =
  | { kind: 'suggest'; bin: string }
  | { kind: 'abstain'; reason: 'not_calibrated' | 'model_uncertain' | 'output_invalid' | 'out_of_range' };

/**
 * The same rule, in the same order, as ml/golden.py `decide`: calibration,
 * output, range, then softmax(logits / T) against the threshold. The range
 * check exists because a softmax threshold cannot catch inputs unlike any
 * fixture: this model scores black as SYN-D at 100% (release-evaluation.md).
 */
export function decide(logits: readonly number[], manifest: ModelManifest, rgb: readonly number[]): Decision {
  const calibration = manifest.calibration;
  if (!calibration) return { kind: 'abstain', reason: 'not_calibrated' };
  if (logits.length !== manifest.output.classes.length || logits.some((v) => !Number.isFinite(v))) {
    return { kind: 'abstain', reason: 'output_invalid' };
  }
  const nearest = Math.min(...calibration.range.centroids.map((c) => Math.hypot(...c.map((v, i) => v - rgb[i]))));
  if (!(nearest <= calibration.range.max_distance)) return { kind: 'abstain', reason: 'out_of_range' };
  const scaled = logits.map((v) => v / calibration.temperature);
  const max = Math.max(...scaled);
  const weights = scaled.map((v) => Math.exp(v - max));
  let best = 0;
  weights.forEach((w, i) => { if (w > weights[best]) best = i; }); // first max, like numpy argmax
  const probability = weights[best] / weights.reduce((a, b) => a + b, 0);
  if (probability < calibration.abstain_below) return { kind: 'abstain', reason: 'model_uncertain' };
  return { kind: 'suggest', bin: manifest.output.classes[best] };
}

export interface LoadedModel {
  manifest: ModelManifest;
  run(rgb: readonly [number, number, number]): Promise<readonly number[]>;
}

export type ModelState = { kind: 'ready'; model: LoadedModel } | { kind: 'unavailable'; problem: ModelProblem };

/** Input for the model path: no kit profile is involved. */
export type ModelInput = Omit<ReviewInput, 'profile'>;

export async function analyseWithModel(input: ModelInput, state: ModelState, bins: readonly ManualBin[]): Promise<ReviewAnalysis> {
  const gated = gate({ ...input, profile: null });
  if (gated) return gated;

  const unavailable = (problem: ModelProblem): ReviewAnalysis => ({
    status: 'manual_required', reason: 'model_unavailable', machineBin: null, indicativeFlag: 'uncertain',
    qualityReasons: [...input.quality.reasons], calibratedConfidence: null, baselineVersion: null,
    protocolVersion: null, researchOnly: false, modelProblem: problem,
  });
  if (state.kind === 'unavailable') return unavailable(state.problem);

  const { manifest } = state.model;
  const f = input.features!;
  const rgb = [f.median_r, f.median_g, f.median_b] as const;
  let logits: readonly number[];
  try {
    logits = await state.model.run(rgb);
  } catch {
    return unavailable('inference_failed');
  }
  const decision = decide(logits, manifest, rgb);
  if (decision.kind === 'abstain' && (decision.reason === 'not_calibrated' || decision.reason === 'output_invalid')) {
    return unavailable(decision.reason);
  }

  const provenance = {
    qualityReasons: [...input.quality.reasons],
    calibratedConfidence: null,
    baselineVersion: `${manifest.model_id}@${manifest.version}`,
    protocolVersion: manifest.protocol.version,
    researchOnly: manifest.status !== 'approved',
    calibrationVersion: manifest.calibration?.version ?? null,
  };
  if (decision.kind === 'abstain') {
    const reason = decision.reason === 'out_of_range' ? 'model_out_of_range' : 'model_uncertain';
    return { status: 'manual_required', reason, machineBin: null, indicativeFlag: 'uncertain', ...provenance };
  }
  const bin = bins.find((b) => b.key === decision.bin);
  if (!bin) return unavailable('classes_mismatch');
  return {
    status: 'suggested', reason: null, machineBin: bin.key,
    indicativeFlag: bin.reviewTrigger ? 'review' : 'no_flag', ...provenance,
  };
}
