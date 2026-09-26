/**
 * Public map page, source-type colours, resident sign-up checks, offline stats.
 *
 * Run:  node tests/public-map.test.ts
 */

import assert from 'node:assert/strict';

import { demo } from '../apps/mobile/src/demoBackend.ts';
import { mapHtml, SOURCE_TYPE_COLORS, SOURCE_TYPE_LABELS } from '../apps/mobile/src/publicMapModel.ts';
import { canonicalPhone, registrationProblem } from '../apps/mobile/src/residentForm.ts';
import { BANNED_WORDS } from '../apps/mobile/src/statusLabel.ts';
import type { MapSource } from '../apps/mobile/src/v2.ts';

const tests: Array<[string, () => void]> = [];
const test = (n: string, f: () => void) => tests.push([n, f]);

const src = (over: Partial<MapSource>): MapSource => ({
  source_id: 's', name: 'Temple Well', source_type: 'well', status: 'not_tested', status_label: 'Not yet tested', latitude: 22.7,
  longitude: 75.9, location_precision: 'approximate (about 500 m)', last_updated: '2026-09-26T00:00:00Z', village: 'East Plains',
  ward: 'Ward 3', last_screened_at: null, screenings_30d: 0, open_issues: 0, lab_verified_at: null, ...over,
});

test('every source type has its own colour and a label', () => {
  const types = ['tap', 'well', 'hand_pump', 'tank', 'pond', 'river', 'other'];
  for (const t of types) assert.ok(SOURCE_TYPE_COLORS[t] && SOURCE_TYPE_LABELS[t], t);
  assert.equal(new Set(types.map((t) => SOURCE_TYPE_COLORS[t])).size, types.length);
});

test('the map page carries each located source with its type colour', () => {
  const html = mapHtml([src({}), src({ source_id: 't', name: 'Tap', source_type: 'tap' }), src({ source_id: 'x', latitude: null, longitude: null })]);
  const pts = JSON.parse(/var pts=(.*);\n/.exec(html)![1]);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].color, SOURCE_TYPE_COLORS.well);
  assert.equal(pts[1].type, 'Tap');
  assert.ok(html.includes('tile.openstreetmap.org'));
});

test('a source name cannot break out of the map script', () => {
  const html = mapHtml([src({ name: '</script><img src=x onerror=alert(1)>' })]);
  assert.ok(!html.includes('</script><img'));
  assert.ok(html.includes('\\u003c/script>'));
});

test('resident sign-up form checks', () => {
  const ok = { name: 'Sunita', email: 's@example.com', phone: '', password: 'riverbank9', confirm: 'riverbank9' };
  assert.equal(registrationProblem(ok), null);
  assert.match(registrationProblem({ ...ok, name: '' })!, /name/);
  assert.match(registrationProblem({ ...ok, email: 'nope' })!, /email/);
  assert.match(registrationProblem({ ...ok, password: 'short', confirm: 'short' })!, /8 characters/);
  assert.match(registrationProblem({ ...ok, confirm: 'different1' })!, /do not match/);
  assert.match(registrationProblem({ ...ok, phone: '12' })!, /country code/);
  assert.equal(canonicalPhone('98765 43210'), '+919876543210');
  assert.equal(canonicalPhone('+44 7700 900123'), '+447700900123');
  assert.equal(canonicalPhone(''), undefined);
});

test('offline stats have 12 weeks and honest wording', () => {
  const r = demo.stats();
  assert.equal(r.kind, 'ok');
  if (r.kind !== 'ok') return;
  assert.equal(r.value.weeks.length, 12);
  for (const w of BANNED_WORDS) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(r.value.disclaimer), w);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} failed` : `\n${tests.length}/${tests.length} passed`);
if (failed) process.exit(1);
