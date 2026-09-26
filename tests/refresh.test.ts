/**
 * Auto-refresh rules (apps/mobile/src/refreshModel.ts).
 *
 * Run:  node tests/refresh.test.ts
 */

import assert from 'node:assert/strict';

import { Refresher } from '../apps/mobile/src/refreshModel.ts';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (n: string, f: () => Promise<void>) => tests.push([n, f]);
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness(load: (bg: boolean) => Promise<boolean | void>, foreground = { on: true }) {
  let fire: (() => void) | null = null;
  let cleared = false;
  const states: Array<{ refreshing: boolean; updatedAt: number | null; failed: boolean }> = [];
  let t = 1000;
  const r = new Refresher({
    load, isForeground: () => foreground.on, onState: (st) => states.push(st), now: () => (t += 1000),
    setInterval: (fn) => { fire = fn; return 1; }, clearInterval: () => { cleared = true; },
  }, 30_000);
  return { r, states, fire: () => fire!(), cleared: () => cleared };
}

test('loads at start, then on each tick; records the time of the last success', async () => {
  const calls: boolean[] = [];
  const h = harness(async (bg) => { calls.push(bg); });
  h.r.start();
  await tick();
  h.fire();
  await tick();
  assert.deepEqual(calls, [false, true]);
  assert.equal(h.states.at(-1)!.updatedAt, 3000);
  assert.equal(h.states.at(-1)!.failed, false);
});

test('never two loads at once', async () => {
  let release!: () => void;
  let n = 0;
  const h = harness(() => { n++; return new Promise<void>((r) => { release = r; }); });
  h.r.start();
  h.fire();
  h.fire();
  void h.r.refresh();
  assert.equal(n, 1);
  release();
  await tick();
  h.fire();
  assert.equal(n, 2);
});

test('a failing or throwing load keeps the last update time and never throws', async () => {
  let mode: 'ok' | 'false' | 'throw' = 'ok';
  const h = harness(async () => { if (mode === 'throw') throw new Error('network'); return mode !== 'false'; });
  h.r.start();
  await tick();
  const good = h.states.at(-1)!.updatedAt;
  mode = 'throw';
  h.fire();
  await tick();
  assert.deepEqual([h.states.at(-1)!.failed, h.states.at(-1)!.updatedAt], [true, good]);
  mode = 'false';
  await h.r.refresh();
  assert.deepEqual([h.states.at(-1)!.failed, h.states.at(-1)!.updatedAt], [true, good]);
});

test('no background ticks while the app is in the background; stop() ends everything', async () => {
  const fg = { on: false };
  let n = 0;
  const h = harness(async () => { n++; }, fg);
  h.r.start();
  await tick();
  h.fire();
  await tick();
  assert.equal(n, 1);   // only the start load
  fg.on = true;
  h.r.stop();
  assert.ok(h.cleared());
  h.fire();
  await h.r.refresh();
  assert.equal(n, 1);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} failed` : `\n${tests.length}/${tests.length} passed`);
if (failed) process.exit(1);
