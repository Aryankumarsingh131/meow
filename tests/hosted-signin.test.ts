/**
 * Hosted sign-in (Supabase Auth password grant) in the app's API client.
 *
 * Run: node tests/hosted-signin.test.ts
 */

import assert from 'node:assert/strict';

import { signIn } from '../apps/mobile/src/api.ts';

const HOSTED = { url: 'https://example-ref.supabase.co', key: 'sb_publishable_test' };
const SUB = '6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'ES256', kid: 'k1' })}.${b64({ sub: SUB, aud: 'authenticated' })}.sig`;

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

await test('signs in against Supabase with the publishable key and the email', async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const r = await signIn('https://unused', '  worker@example.org ', 'pw', {
    hosted: HOSTED, now: () => 1000, fetchImpl: fakeFetch(200, { access_token: TOKEN, expires_in: 3600 }, seen),
  });
  assert.equal(seen.url, 'https://example-ref.supabase.co/auth/v1/token?grant_type=password');
  assert.equal((seen.init!.headers as Record<string, string>).apikey, HOSTED.key);
  assert.deepEqual(JSON.parse(String(seen.init!.body)), { email: 'worker@example.org', password: 'pw' });
  assert.deepEqual(r, { kind: 'ok', value: { token: TOKEN, subject: SUB, expiresAtMs: 1000 + 3600 * 1000 } });
});

await test('a wrong email or password (Supabase answers 400) is "not recognised", not a server error', async () => {
  const r = await signIn('https://unused', 'a@b.c', 'bad', { hosted: HOSTED, fetchImpl: fakeFetch(400, { error: 'invalid_grant' }) });
  assert.deepEqual(r, { kind: 'auth_required' });
});

await test('no network is offline; a Supabase outage is a retryable failure', async () => {
  const down = (async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
  assert.deepEqual(await signIn('https://unused', 'a@b.c', 'pw', { hosted: HOSTED, fetchImpl: down }), { kind: 'offline' });
  const r = await signIn('https://unused', 'a@b.c', 'pw', { hosted: HOSTED, fetchImpl: fakeFetch(503, {}) });
  assert.equal(r.kind === 'failed' && r.retryable, true);
});

await test('without hosted settings the dev issuer is used, unchanged', async () => {
  const seen: { url?: string } = {};
  await signIn('http://10.0.2.2:8000', 'worker', 'jalsakshi', { hosted: null, fetchImpl: fakeFetch(401, {}, seen) });
  assert.equal(seen.url, 'http://10.0.2.2:8000/dev/v1/token');
});

console.log(`\n${passed} hosted sign-in tests passed`);
