/**
 * Build the server's `CanonicalSampleV1` (services/api/app/schemas.py) from
 * the T08 timing verdict and the T11 review observation.
 *
 * The three provenance fields stay separate (machine_bin / manual_bin /
 * selected_bin), and indeterminate timing carries a reason and NO elapsed
 * time: inventing `elapsed_ms` would be fabricated precision.
 *
 * `evidence_ids` is always empty in M1: the photo stays on the phone, and
 * private evidence upload is T16. Synced metadata is not an uploaded photo.
 *
 * Only `import type` from siblings, so Node's type stripping can run it.
 */

import type { ReviewObservation } from './analysis/baseline';
import type { TimingVerdict } from './timer';

export interface SampleContext {
  sampleId: string;
  sourceId: string;
  protocol: { id: string; version: number };
  kitLotId: string;
  capturedAtDevice: string;
  clientBuild: string;
}

export type CanonicalTiming =
  | { state: 'preparing' | 'waiting' | 'in_window' | 'late' | 'expired'; elapsed_ms: number; valid: boolean }
  | { state: 'indeterminate'; reason: string; valid: false };

export function toCanonicalTiming(verdict: TimingVerdict): CanonicalTiming {
  if (verdict.state === 'indeterminate' || verdict.elapsed.kind === 'indeterminate') {
    const reason = verdict.indeterminateReason
      ?? (verdict.elapsed.kind === 'indeterminate' ? verdict.elapsed.reason : 'read_window_malformed');
    return { state: 'indeterminate', reason, valid: false };
  }
  return {
    state: verdict.state,
    elapsed_ms: Math.max(0, Math.round(verdict.elapsed.seconds * 1000)),
    // The contract requires valid == (state == in_window); do not trust a flag.
    valid: verdict.state === 'in_window',
  };
}

export function buildSample(context: SampleContext, timing: TimingVerdict, observation: ReviewObservation) {
  return {
    schema_version: 1 as const,
    sample_id: context.sampleId,
    source_id: context.sourceId,
    protocol: { id: context.protocol.id, version: context.protocol.version },
    kit_lot_id: context.kitLotId,
    captured_at_device: context.capturedAtDevice,
    timing: toCanonicalTiming(timing),
    method: observation.method,
    observation: {
      machine_bin: observation.machineBin,
      manual_bin: observation.manualBin,
      selected_bin: observation.selectedBin,
      indicative_flag: observation.indicativeFlag,
      quality_reasons: [...observation.qualityReasons],
      model_version: observation.baselineVersion,
      calibration_version: null,
      confidence: null,
      override_reason: observation.overrideReason,
    },
    evidence_ids: [] as string[],
    client_build: context.clientBuild,
    // The server overwrites this from tenant policy; sent only because the
    // v1 envelope requires it.
    data_mode: 'synthetic' as const,
  };
}
