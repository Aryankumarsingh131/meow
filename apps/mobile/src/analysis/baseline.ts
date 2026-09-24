import type { FeatureVectorV1 } from '../../../../modules/capture-native/index';

export type IndicativeFlag = 'no_flag' | 'review' | 'uncertain' | 'invalid';

export interface ReviewBin {
  key: string;
  label: string;
  ordinal: number;
  referenceRgb: readonly [number, number, number];
  reviewTrigger: boolean;
}

/** What a manual reading needs. No reference colour: a protocol without one
 * (SYN-COLOR-001) still supports manual review, and inventing RGB would be
 * fabricated data. */
export type ManualBin = Pick<ReviewBin, 'key' | 'label' | 'reviewTrigger'>;

export interface BaselineProfile {
  id: string;
  version: number;
  protocolId: string;
  protocolVersion: number;
  status: 'research' | 'approved';
  bins: readonly ReviewBin[];
}

export interface ReviewInput {
  features: Pick<FeatureVectorV1, 'schema_version' | 'median_r' | 'median_g' | 'median_b'> | null;
  quality: { decision: 'accept' | 'review' | 'retake'; reasons: readonly string[] };
  timingValid: boolean;
  profile: BaselineProfile | null;
}

export type ReviewReason =
  | 'features_unavailable'
  | 'features_invalid'
  | 'profile_unavailable'
  | 'profile_invalid'
  | 'quality_uncertain'
  | 'quality_retake'
  | 'timing_invalid';

export interface ReviewAnalysis {
  status: 'suggested' | 'manual_required' | 'retake';
  reason: ReviewReason | null;
  machineBin: string | null;
  indicativeFlag: IndicativeFlag;
  qualityReasons: readonly string[];
  calibratedConfidence: null;
  baselineVersion: string | null;
  protocolVersion: number | null;
  researchOnly: boolean;
}

export interface ReviewObservation {
  method: 'assisted' | 'manual';
  machineBin: string | null;
  manualBin: string | null;
  selectedBin: string;
  indicativeFlag: IndicativeFlag;
  qualityReasons: readonly string[];
  baselineVersion: string | null;
  protocolVersion: number | null;
  confidence: null;
  overrideReason: string | null;
}

export const MANUAL_REASON_MAX_LENGTH = 2000;

function abstain(
  input: ReviewInput,
  reason: ReviewReason,
  status: ReviewAnalysis['status'] = 'manual_required',
  flag: IndicativeFlag = 'uncertain',
): ReviewAnalysis {
  return {
    status,
    reason,
    machineBin: null,
    indicativeFlag: flag,
    qualityReasons: [...input.quality.reasons],
    calibratedConfidence: null,
    baselineVersion: input.profile ? `${input.profile.id}@${input.profile.version}` : null,
    protocolVersion: input.profile?.protocolVersion ?? null,
    researchOnly: input.profile?.status === 'research',
  };
}

function validProfile(profile: BaselineProfile): boolean {
  if (
    !profile.id.trim() ||
    !profile.protocolId.trim() ||
    !Number.isInteger(profile.version) ||
    profile.version < 1 ||
    !Number.isInteger(profile.protocolVersion) ||
    profile.protocolVersion < 1 ||
    profile.bins.length === 0
  ) return false;

  const keys = new Set<string>();
  const ordinals = new Set<number>();
  for (const bin of profile.bins) {
    if (
      !bin.key.trim() ||
      !bin.label.trim() ||
      !Number.isInteger(bin.ordinal) ||
      keys.has(bin.key) ||
      ordinals.has(bin.ordinal) ||
      bin.referenceRgb.length !== 3 ||
      bin.referenceRgb.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)
    ) return false;
    keys.add(bin.key);
    ordinals.add(bin.ordinal);
  }
  return profile.bins.every((_, ordinal) => ordinals.has(ordinal));
}

export function analyseBaseline(input: ReviewInput): ReviewAnalysis {
  if (!input.timingValid) return abstain(input, 'timing_invalid', 'manual_required', 'invalid');
  if (input.quality.decision === 'retake') return abstain(input, 'quality_retake', 'retake');
  if (input.quality.decision === 'review') return abstain(input, 'quality_uncertain');
  if (!input.features) return abstain(input, 'features_unavailable');

  const rgb = [input.features.median_r, input.features.median_g, input.features.median_b] as const;
  if (input.features.schema_version !== 1 || rgb.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)) {
    return abstain(input, 'features_invalid');
  }
  if (!input.profile) return abstain(input, 'profile_unavailable');
  if (!validProfile(input.profile)) return abstain(input, 'profile_invalid');

  const selected = input.profile.bins
    .map((bin) => ({
      bin,
      distance: bin.referenceRgb.reduce((sum, channel, index) => sum + (rgb[index] - channel) ** 2, 0),
    }))
    .sort((a, b) => a.distance - b.distance || a.bin.ordinal - b.bin.ordinal)[0].bin;

  return {
    status: 'suggested',
    reason: null,
    machineBin: selected.key,
    indicativeFlag: selected.reviewTrigger ? 'review' : 'no_flag',
    qualityReasons: [...input.quality.reasons],
    calibratedConfidence: null,
    baselineVersion: `${input.profile.id}@${input.profile.version}`,
    protocolVersion: input.profile.protocolVersion,
    researchOnly: input.profile.status === 'research',
  };
}

export function confirmSuggestion(analysis: ReviewAnalysis): ReviewObservation {
  if (analysis.status !== 'suggested' || !analysis.machineBin) {
    throw new Error('No machine suggestion is available to confirm');
  }
  return {
    method: 'assisted',
    machineBin: analysis.machineBin,
    manualBin: null,
    selectedBin: analysis.machineBin,
    indicativeFlag: analysis.indicativeFlag,
    qualityReasons: [...analysis.qualityReasons],
    baselineVersion: analysis.baselineVersion,
    protocolVersion: analysis.protocolVersion,
    confidence: null,
    overrideReason: null,
  };
}

export function recordManualInterpretation(
  analysis: ReviewAnalysis,
  bins: readonly ManualBin[],
  selectedBin: string,
  reason: string,
): ReviewObservation {
  const bin = bins.find((candidate) => candidate.key === selectedBin);
  if (!bin) throw new Error('Select a valid kit bin');
  const cleanReason = reason.trim();
  if (!cleanReason) throw new Error('Manual interpretation requires a reason');
  if (cleanReason.length > MANUAL_REASON_MAX_LENGTH) throw new Error('Manual interpretation reason is too long');

  return {
    method: 'manual',
    machineBin: analysis.machineBin,
    manualBin: bin.key,
    selectedBin: bin.key,
    indicativeFlag: analysis.reason === 'timing_invalid' ? 'invalid' : bin.reviewTrigger ? 'review' : 'no_flag',
    qualityReasons: [...analysis.qualityReasons],
    baselineVersion: analysis.baselineVersion,
    protocolVersion: analysis.protocolVersion,
    confidence: null,
    overrideReason: cleanReason,
  };
}
