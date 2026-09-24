/**
 * T33: a failed server call keeps the server's request id so a worker can
 * quote it, and the phone's diagnostics hold nothing sensitive.
 *
 * Run: node tests/diagnostics.test.ts
 */

import assert from 'node:assert/strict';

import { request } from '../apps/mobile/src/api.ts';
import { clearDiagnostics, failures, lastReference } from '../apps/mobile/src/diagnostics.ts';

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  clearDiagnostics();
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const problem = (status: number, body: object, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

await test('a problem response carries its request id to the caller and diagnostics', async () => {
  const r = await request('https://api', '/v1/sync/push', {
    method: 'POST', token: 'SECRET_TOKEN', body: { name: 'SECRET_BODY' },
    fetchImpl: problem(503, { code: 'TEMPORARILY_UNAVAILABLE', retryable: true, request_id: 'req-42' }),
  });
  assert.deepEqual(r, { kind: 'failed', status: 503, code: 'TEMPORARILY_UNAVAILABLE', retryable: true, requestId: 'req-42' });
  assert.equal(lastReference(), 'req-42');
});

await test('a non-JSON error still keeps the id from the X-Request-Id header', async () => {
  await request('https://api', '/v1/cases', { fetchImpl: problem(502, {}, { 'X-Request-Id': 'hdr-7' }) });
  assert.equal(lastReference(), 'hdr-7');
});

await test('diagnostics never hold tokens, bodies or query strings', async () => {
  await request('https://api', '/v1/evidence/abc/content?token=SECRET_QUERY', {
    token: 'SECRET_TOKEN', fetchImpl: problem(403, { code: 'FORBIDDEN', request_id: 'r1' }),
  });
  const text = JSON.stringify(failures());
  for (const secret of ['SECRET_QUERY', 'SECRET_TOKEN', 'token=']) assert.ok(!text.includes(secret), secret);
  assert.equal(failures()[0].path, '/v1/evidence/abc/content');
});

await test('only the last 20 failures are kept', async () => {
  for (let i = 0; i < 25; i++) await request('https://api', '/x', { fetchImpl: problem(500, { request_id: `r${i}` }) });
  assert.equal(failures().length, 20);
  assert.equal(lastReference(), 'r24');
});

console.log(`\n${passed} diagnostics tests passed`);
