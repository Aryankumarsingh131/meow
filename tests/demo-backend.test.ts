/**
 * Offline demo backend: demo accounts only, same bands and points rule as the
 * server, complaint lifecycle with link-at-version.
 *
 * Run:  node tests/demo-backend.test.ts
 */

import assert from 'node:assert/strict';

import { demo, demoLogin, isDemoToken } from '../apps/mobile/src/demoBackend.ts';

const tests: Array<[string, () => void]> = [];
const test = (n: string, f: () => void) => tests.push([n, f]);
const value = <T>(r: { kind: string; value?: T }): T => { assert.equal(r.kind, 'ok'); return r.value as T; };

const worker = demoLogin('1@demo.org', '1234')!;
const resident = demoLogin('3@demo.org', '1234')!;

test('only the demo accounts with 1234 sign in offline', () => {
  assert.deepEqual([worker.role, resident.role], ['field_worker', 'resident']);
  assert.ok(isDemoToken(worker.token));
  assert.equal(demoLogin('1@demo.org', 'wrong'), null);
  assert.equal(demoLogin('someone@example.org', '1234'), null);
  assert.ok(!isDemoToken('eyJ.real.jwt'));
});

const screen = (readings: Record<string, number>, waited: number, photo = true, local = String(Math.random())) => {
  const read = Date.now();
  return value(demo.submitScreening(worker.token, {
    source_id: 'demo-src-pump3', local_record_id: local, kit_id: 'demo-kit-tds', method: 'manual', readings,
    dip_started_at: new Date(read - waited * 1000).toISOString(), read_at: new Date(read).toISOString(),
    ...(photo ? { photo: { content_type: 'image/jpeg', data_base64: 'x' } } : {}),
  }));
};

test('the points rule matches the server', () => {
  const a = screen({ tds: 320 }, 30);
  assert.equal(a.points_awarded, 10);
  assert.equal(a.risk_level, 'low');
  assert.equal(screen({ tds: 320 }, 5).points_awarded, 0);         // too early
  assert.equal(screen({ tds: 320 }, 200).points_awarded, 0);       // too late
  assert.equal(screen({ tds: 320 }, 30, false).points_awarded, 0); // no photo
  assert.equal(screen({}, 30).points_awarded, 0);                  // reading missing
  assert.equal(value(demo.staffMe(worker.token)).points.points_balance, 10);
});

test('replaying a screening does not pay twice; a high reading opens a report', () => {
  const first = screen({ tds: 2500 }, 30, true, 'same-id');
  const again = screen({ tds: 2500 }, 30, true, 'same-id');
  assert.equal(first.risk_level, 'high');
  assert.ok(first.report_id);
  assert.equal(again.outcome, 'duplicate');
  assert.equal(value(demo.staffMe(worker.token)).points.points_balance, 20);
});

test('residents file complaints offline; no supervisor account on the phone', () => {
  assert.equal(demoLogin('2@demo.org', '1234'), null);
  const filed = value(demo.fileComplaint({ complaint_type: 'smell', source_id: 'demo-src-pond1' }));
  const mine = value(demo.myComplaints()).items;
  assert.equal(mine.find((x) => x.reference_number === filed.reference_number)!.status, 'new');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}
console.log(failed ? `\n${failed}/${tests.length} failed` : `\n${tests.length}/${tests.length} passed`);
if (failed) process.exit(1);
