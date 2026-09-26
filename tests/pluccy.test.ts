/**
 * Pluccy's pure rules: screening bands (mirroring 006 assess_readings), input
 * parsing, the dip -> read timing window, and milestones.
 *
 * Run:  node tests/pluccy.test.ts
 */

import assert from 'node:assert/strict';

import {
  ADVICE, BAND_TEXT, bandFor, formatCountdown, judgeLocally, mergedProtocol, milestoneReached, nextSteps, parseReading,
  readPhase, type Criterion, type Kit, type KitParameter,
} from '../apps/mobile/src/pluccyModel.ts';
import { BANNED_WORDS } from '../apps/mobile/src/statusLabel.ts';

const tests: Array<[string, () => void]> = [];
const test = (n: string, f: () => void) => tests.push([n, f]);

const PH: KitParameter = {
  key: 'ph', label: 'pH', unit: '', input_kind: 'number', min: 0, max: 14,
  ok_min: 6.5, ok_max: 8.5, watch_min: 5.5, watch_max: 9.5, tip: 't', basis: 'b',
};
const COLIFORM: KitParameter = {
  key: 'coliform', label: 'Coliform', unit: '', input_kind: 'presence', min: 0, max: 1,
  ok_min: 0, ok_max: 0, watch_min: 0, watch_max: 0, tip: 't', basis: 'b',
};
const IRON: KitParameter = { ...PH, key: 'iron', min: 0, max: 10, ok_min: 0, ok_max: 0.3, watch_min: 0, watch_max: 1 };

test('bands match the server rules, edges inclusive', () => {
  assert.equal(bandFor(PH, 7.2), 'low');
  assert.equal(bandFor(PH, 6.5), 'low');
  assert.equal(bandFor(PH, 6.0), 'medium');
  assert.equal(bandFor(PH, 9.5), 'medium');
  assert.equal(bandFor(PH, 4.0), 'high');
  assert.equal(bandFor(IRON, 0.3), 'low');
  assert.equal(bandFor(IRON, 0.31), 'medium');
  assert.equal(bandFor(IRON, 1.5), 'high');
  assert.equal(bandFor(COLIFORM, 0), 'low');
  assert.equal(bandFor(COLIFORM, 1), 'high');
});

test('band wording is a screening band, never a verdict', () => {
  for (const text of Object.values(BAND_TEXT)) {
    for (const w of BANNED_WORDS) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(text), `${text} uses "${w}"`);
  }
});

test('readings are parsed and range-checked', () => {
  assert.deepEqual(parseReading(PH, ' 7,4 '), { value: 7.4 });
  assert.ok('error' in parseReading(PH, ''));
  assert.ok('error' in parseReading(PH, 'abc'));
  assert.ok('error' in parseReading(PH, '15'));
  assert.ok('error' in parseReading(COLIFORM, '0.5'));
  assert.deepEqual(parseReading(COLIFORM, '1'), { value: 1 });
});

test('read window: wait, then read inside the grace period, then late', () => {
  const kit = { wait_seconds: 30, read_grace_seconds: 60 };
  assert.deepEqual(readPhase(0, 10_000, kit), { phase: 'waiting', secondsLeft: 20 });
  assert.deepEqual(readPhase(0, 29_500, kit), { phase: 'waiting', secondsLeft: 1 });
  assert.deepEqual(readPhase(0, 30_000, kit), { phase: 'read_now', secondsLeft: 60 });
  assert.deepEqual(readPhase(0, 90_000, kit), { phase: 'read_now', secondsLeft: 0 });
  assert.deepEqual(readPhase(0, 90_500, kit), { phase: 'late' });
});

test('countdown formatting', () => {
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(75), '01:15');
  assert.equal(formatCountdown(86_400), '24:00:00');
  assert.equal(formatCountdown(-3), '00:00');
});

test('a milestone is reported once, when it is crossed', () => {
  const m = [10, 50, 100];
  assert.equal(milestoneReached(9, 10, m), 10);
  assert.equal(milestoneReached(10, 11, m), null);
  assert.equal(milestoneReached(49, 50, m), 50);
  assert.equal(milestoneReached(0, 0, m), null);
});

const CRITERIA: Criterion[] = [
  ...['latrine_nearby', 'animal_waste', 'standing_water', 'damaged_platform', 'drainage_broken', 'open_or_loose', 'garbage_nearby', 'recent_flooding']
    .map((key) => ({ key, category: 'sanitary' as const, question: key, tip: '' })),
  ...['colour_change', 'odour', 'illness_reports'].map((key) => ({ key, category: 'observation' as const, question: key, tip: '' })),
];

test('judgement preview matches the server rules', () => {
  const yes = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, true]));
  assert.equal(judgeLocally(CRITERIA, {}).sanitary_level, 'low');
  assert.equal(judgeLocally(CRITERIA, yes('latrine_nearby', 'animal_waste')).sanitary_level, 'low');
  assert.equal(judgeLocally(CRITERIA, yes('latrine_nearby', 'animal_waste', 'standing_water')).sanitary_level, 'medium');
  const five = judgeLocally(CRITERIA, yes('latrine_nearby', 'animal_waste', 'standing_water', 'damaged_platform', 'garbage_nearby'));
  assert.deepEqual([five.sanitary_score, five.sanitary_total, five.sanitary_level], [5, 8, 'high']);
  assert.equal(judgeLocally(CRITERIA, yes('odour')).observation_level, 'medium');
  assert.equal(judgeLocally(CRITERIA, yes('illness_reports')).observation_level, 'high');
  assert.equal(judgeLocally(CRITERIA, { latrine_nearby: false }).sanitary_score, 0);
});

test('protocols of several kits merge without repeating shared steps', () => {
  const kit = (name: string, titles: string[]): Kit => ({ kit_id: name, name, strip_type: name, dip_instruction: null, wait_seconds: 10,
    read_grace_seconds: 60, parameters: [], protocol: titles.map((title) => ({ title, detail: '' })) });
  const steps = mergedProtocol([kit('a', ['Wear gloves', 'Flush', 'Pads']), kit('b', ['Wear gloves', 'Flush', 'Calibrate'])]);
  assert.deepEqual(steps.map((s) => s.title), ['Wear gloves', 'Flush', 'Pads', 'Calibrate']);
});

test('advice never gives a water verdict or treatment instruction', () => {
  const all = [...Object.values(ADVICE).flat(), ...nextSteps('high', judgeLocally(CRITERIA, { illness_reports: true, latrine_nearby: true })),
    ...nextSteps('low', null)];
  for (const line of all) {
    for (const w of BANNED_WORDS) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(line), `${line} uses "${w}"`);
    assert.ok(!/boil|chlorinate your/i.test(line), line);
  }
  assert.ok(nextSteps('high', null)[0].includes('supervisor'));
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
