/**
 * M1's protocol boundary: SYN-COLOR-001 (ADR-M1-001), imported from the
 * canonical `protocols/` JSON rather than copied, so the app and
 * `tests/protocol-fixture.test.ts` read the same values.
 *
 * SYNTHETIC. The read window exercises the timer; it means nothing about any
 * real kit. The lot below is a synthetic placeholder and is honestly
 * `unverified`, so assisted reading stays blocked and every reading is manual.
 */

import raw from '../../../protocols/SYN-COLOR-001.v1.json';
import type { ManualBin } from './analysis/baseline';
import type { KitLot, Protocol } from './timer';

export const PROTOCOL: Protocol = {
  id: raw.id,
  version: raw.version,
  manufacturer: raw.manufacturer,
  kit: raw.kit,
  parameter: raw.parameter,
  read_window: raw.read_window,
  validity: raw.validity,
  approved_by: raw.approved_by,
};

export const SYNTHETIC_LOT: KitLot = {
  id: '5b0d7c1e-0000-4000-8000-00000000c001',
  protocol_id: raw.id,
  protocol_version: raw.version,
  lot: raw.reference_card.lot,
  expiry: '2027-12-31',
  verification_status: 'unverified',
};

export const BINS: readonly ManualBin[] = raw.bins.map((bin) => ({
  key: bin.key,
  label: bin.labels.en,
  reviewTrigger: bin.review_trigger,
}));

export const REQUIRE_REFERENCE_CARD = raw.quality_policy.require_reference_card;

export const INSTRUCTIONS: readonly string[] = [
  'SYNTHETIC TEST — printed colour card, not a water test kit.',
  'Place the SYN-COLOR-001 card on a flat surface in even light.',
  'Start the timer, then wait for the read window before recording.',
];
