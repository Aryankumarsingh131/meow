/**
 * The canonical synthetic protocol must (a) conform to protocol-schema.md,
 * (b) be accepted by T08's real timer, and (c) be unmistakably synthetic.
 *
 * ADR-M1-001 adopted SYN-COLOR-001 as M1's explicit synthetic-only boundary.
 * This test is what makes that decision enforceable: if someone edits the
 * fixture into something that looks like a real kit, or breaks a schema
 * invariant, it fails.
 *
 * Run:  node tests/protocol-fixture.test.ts
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assessAttempt,
  evaluateEligibility,
  startAttempt,
  type ClockReading,
  type KitLot,
  type Protocol,
} from '../apps/mobile/src/timer.ts';

const raw = JSON.parse(
  await readFile(new URL('../protocols/SYN-COLOR-001.v1.json', import.meta.url), 'utf8'),
);

/** Languages active in the synthetic deployment. protocol-schema.md: a
 *  missing translation blocks approval rather than falling back silently. */
const ACTIVE_LANGUAGES = ['en'];

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (n: string, f: () => void | Promise<void>) => tests.push([n, f]);

// --- (a) protocol-schema.md conformance -----------------------------------

test('carries every top-level field the schema defines', () => {
  for (const f of [
    'schema_version', 'id', 'version', 'manufacturer', 'kit', 'parameter', 'unit',
    'method', 'read_window', 'bins', 'quality_policy', 'reference_card', 'validity',
    'approved_by',
  ]) {
    assert.ok(f in raw, `missing field ${f}`);
  }
  assert.equal(raw.schema_version, 1);
  assert.match(raw.id, /^[0-9a-f-]{36}$/);
});

test('bin ordinals are contiguous from 0 (schema "bins rules")', () => {
  const ordinals = raw.bins.map((b: { ordinal: number }) => b.ordinal);
  assert.deepEqual(ordinals, ordinals.map((_: unknown, i: number) => i));
});

test('bin keys are unique and stable', () => {
  const keys = raw.bins.map((b: { key: string }) => b.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('chart_value is a string, never parsed into a float', () => {
  for (const b of raw.bins) assert.equal(typeof b.chart_value, 'string', b.key);
});

test('every bin label covers every active language', () => {
  for (const b of raw.bins) {
    for (const lang of ACTIVE_LANGUAGES) {
      assert.ok(b.labels[lang], `bin ${b.key} missing a ${lang} label`);
    }
  }
});

test('at least one bin triggers review, so the review path is exercisable', () => {
  assert.ok(raw.bins.some((b: { review_trigger: boolean }) => b.review_trigger));
});

test('quality thresholds are numbers or null, never absent', () => {
  // null means "not yet fitted" -> THRESHOLD_UNSET, never "unlimited".
  for (const k of ['max_blur_variance', 'max_clipped_fraction', 'max_glare_fraction']) {
    assert.ok(k in raw.quality_policy, `missing ${k}`);
    const v = raw.quality_policy[k];
    assert.ok(v === null || typeof v === 'number', `${k} must be number|null`);
  }
});

test('no model is enabled: a research model cannot suggest by config alone', () => {
  assert.equal(raw.quality_policy.model.enabled, false);
  assert.equal(raw.quality_policy.model.min_confidence, null);
});

test('closure requirements are all on (default demo policy)', () => {
  const c = raw.quality_policy.closure_requires;
  for (const k of ['verified_report', 'accepted_action', 'linked_retest', 'communication']) {
    assert.equal(c[k], true, k);
  }
});

// --- (b) accepted by T08's real timer --------------------------------------

const PROTOCOL: Protocol = {
  id: raw.id,
  version: raw.version,
  manufacturer: raw.manufacturer,
  kit: raw.kit,
  parameter: raw.parameter,
  read_window: raw.read_window,
  validity: raw.validity,
  approved_by: raw.approved_by,
};

const LOT: KitLot = {
  id: 'd839e38e-3e34-529a-820f-996d5e64e099',
  protocol_id: raw.id,
  protocol_version: raw.version,
  lot: raw.reference_card.lot,
  expiry: '2099-01-01T00:00:00Z',
  verification_status: 'verified',
};

const NOW = Date.parse('2026-09-24T12:00:00Z');

test('the timer accepts the read window as well-formed', () => {
  const e = evaluateEligibility(PROTOCOL, LOT, NOW);
  assert.equal(e.state, 'eligible', JSON.stringify(e));
});

test('every timer state is reachable with the synthetic read window', () => {
  const start: ClockReading = { wallMs: NOW, monotonicMs: 1_000_000, bootId: 'b' };
  const attempt = startAttempt('a', PROTOCOL, LOT, start);
  const at = (s: number) =>
    assessAttempt(attempt, PROTOCOL, LOT, {
      wallMs: NOW + s * 1000,
      monotonicMs: 1_000_000 + s * 1000,
      bootId: 'b',
    }).timing.state;

  // prepare 10 s; window 30 ± 15 => [15, 45]; invalid after 120 s.
  assert.equal(at(5), 'preparing');
  assert.equal(at(12), 'waiting');
  assert.equal(at(30), 'in_window');
  assert.equal(at(60), 'late');
  assert.equal(at(130), 'expired');
});

test('the window is only valid inside read_at ± tolerance', () => {
  const start: ClockReading = { wallMs: NOW, monotonicMs: 0, bootId: 'b' };
  const attempt = startAttempt('a', PROTOCOL, LOT, start);
  const valid = (s: number) =>
    assessAttempt(attempt, PROTOCOL, LOT, { wallMs: NOW + s * 1000, monotonicMs: s * 1000, bootId: 'b' })
      .timing.timingValid;
  assert.equal(valid(14.9), false);
  assert.equal(valid(15), true);
  assert.equal(valid(45), true);
  assert.equal(valid(45.1), false);
});

test('the protocol is valid from its adoption date and not before', () => {
  const before = evaluateEligibility(PROTOCOL, LOT, Date.parse('2026-09-23T00:00:00Z'));
  assert.equal(before.state, 'blocked');
  assert.ok(before.state === 'blocked' && before.reasons.includes('protocol_not_yet_valid'));
});

// --- (c) unmistakably synthetic --------------------------------------------

test('the fixture labels itself synthetic in its own identity fields', () => {
  // A later edit that makes this look like a real kit must fail loudly.
  assert.match(raw.manufacturer, /SYNTHETIC/);
  assert.match(raw.kit, /synthetic/i);
  assert.match(raw.parameter, /synthetic/);
  assert.equal(raw.unit, null, 'a synthetic colour class has no unit');
});

test('approval is scoped to the synthetic boundary, not a domain review', () => {
  assert.equal(raw.approved_by.role, 'synthetic_boundary_authorization_only');
  assert.match(raw.approved_by.source_document, /ADR-M1-001/);
});

test('no personal identifier is recorded in a public repository', () => {
  const s = JSON.stringify(raw);
  assert.ok(!/@/.test(s), 'an email address was recorded');
});

test('bin labels never describe water', () => {
  for (const b of raw.bins) {
    for (const text of Object.values(b.labels) as string[]) {
      assert.ok(
        !/\b(safe|unsafe|clean|potable|drinkable|contaminated|mg\/l|ppm)\b/i.test(text),
        `bin ${b.key} label implies a water measurement: ${text}`,
      );
    }
  }
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
