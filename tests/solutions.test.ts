/**
 * Suggested solutions after a screening (apps/mobile/src/solutions.ts).
 *
 * Run:  node tests/solutions.test.ts
 */

import assert from 'node:assert/strict';

import { judgeLocally, type Criterion, type KitParameter } from '../apps/mobile/src/pluccyModel.ts';
import { solutionsFor } from '../apps/mobile/src/solutions.ts';
import { BANNED_WORDS } from '../apps/mobile/src/statusLabel.ts';

const tests: Array<[string, () => void]> = [];
const test = (n: string, f: () => void) => tests.push([n, f]);

const param = (key: string, ok_min: number | null, ok_max: number | null): KitParameter => ({
  key, label: key, unit: '', input_kind: key === 'coliform' ? 'presence' : 'number', min: 0, max: 5000, ok_min, ok_max,
  watch_min: null, watch_max: null, tip: '', basis: '',
});
const PARAMS = [param('ph', 6.5, 8.5), param('chlorine', 0.2, 1), param('iron', 0, 0.3), param('tds', 0, 500), param('coliform', 0, 0),
  param('hardness', 0, 200), param('nitrate', 0, 45), param('fluoride', 0, 1), param('turbidity', 0, 1)];
const CRITERIA: Criterion[] = ['latrine_nearby', 'animal_waste', 'standing_water', 'damaged_platform', 'drainage_broken', 'open_or_loose',
  'garbage_nearby', 'recent_flooding'].map((key) => ({ key, category: 'sanitary' as const, question: key, tip: '' }))
  .concat(['colour_change', 'odour', 'visible_particles', 'taste_reports', 'illness_reports']
    .map((key) => ({ key, category: 'observation' as const, question: key, tip: '' })));

test('nothing flagged, nothing suggested', () => {
  assert.deepEqual(solutionsFor([{ parameter: 'ph', value: 7.2, level: 'low' }], PARAMS, judgeLocally(CRITERIA, {})), []);
});

test('the side of the band picks the fix', () => {
  const low = solutionsFor([{ parameter: 'chlorine', value: 0.05, level: 'medium' }], PARAMS, null);
  const high = solutionsFor([{ parameter: 'chlorine', value: 3, level: 'medium' }], PARAMS, null);
  assert.match(low[0].title, /below band/);
  assert.match(high[0].title, /above band/);
  assert.match(solutionsFor([{ parameter: 'ph', value: 5, level: 'high' }], PARAMS, null)[0].title, /Acidic/);
  assert.match(solutionsFor([{ parameter: 'ph', value: 9.8, level: 'high' }], PARAMS, null)[0].title, /Alkaline/);
});

test('urgent items come first, sanitary answers are included', () => {
  const j = judgeLocally(CRITERIA, { latrine_nearby: true, damaged_platform: true, illness_reports: true });
  const tips = solutionsFor([{ parameter: 'iron', value: 0.6, level: 'medium' }, { parameter: 'coliform', value: 1, level: 'high' }], PARAMS, j);
  assert.equal(tips[0].priority, 'today');
  assert.ok(tips.slice(0, 2).some((t) => t.key === 'coliform:high'));
  assert.ok(tips.some((t) => t.key === 'illness_reports' && t.priority === 'today'));
  assert.ok(tips.some((t) => t.key === 'latrine_nearby'));
  assert.equal(new Set(tips.map((t) => t.key)).size, tips.length);
});

test('every suggestion names who acts, confirms with the lab where readings are the basis, and uses no banned words', () => {
  const findings = PARAMS.flatMap((p) => [{ parameter: p.key, value: 99, level: 'high' as const },
    { parameter: p.key, value: -1, level: 'medium' as const }]);
  const flagged = Object.fromEntries(CRITERIA.map((c) => [c.key, true]));
  const tips = solutionsFor(findings, PARAMS, judgeLocally(CRITERIA, flagged));
  assert.ok(tips.length >= 20, String(tips.length));
  for (const t of tips) {
    assert.ok(t.who && t.steps.length, t.key);
    const text = [t.title, t.why, ...t.steps, t.who].join(' ');
    for (const w of BANNED_WORDS) assert.ok(!new RegExp(`\\b${w}\\b`, 'i').test(text), `${t.key} uses "${w}"`);
  }
  for (const k of ['iron:high', 'fluoride:high', 'nitrate:high', 'coliform:high']) {
    assert.ok(tips.find((t) => t.key === k)!.steps.join(' ').includes('lab'), k);
  }
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
