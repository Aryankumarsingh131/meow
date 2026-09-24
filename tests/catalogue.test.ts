/**
 * T07 on the phone: sign-in, catalogue fetch, and the on-device cache.
 *
 * Storage runs the phone's real code on a real SQLite (node:sqlite).
 *
 * Run:  node tests/catalogue.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fetchCatalogue, jwtSubject, request, signIn, MAX_CATALOGUE_PAGES } from '../apps/mobile/src/api.ts';
import { applyCatalogueFetch, loadCatalogue, migrate, replaceCatalogue } from '../apps/mobile/src/storage.ts';
import type { CachedSource } from '../apps/mobile/src/sourceCatalog.ts';
import { nodeSql } from './sqlNode.ts';

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (n: string, f: () => void | Promise<void>) => tests.push([n, f]);

const B = 'http://api.test';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwt = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

const src = (n: number): CachedSource => ({
  id: `00000000-0000-5000-8000-00000000000${n}`, qrCode: `JS-SYN-000${n}`,
  label: `Synthetic handpump ${n}`, locality: 'Riverside (synthetic)', latitude: null, longitude: null,
});

// --- request outcomes ------------------------------------------------------

test('network failure is offline, not an exception', async () => {
  const r = await request(B, '/x', { fetchImpl: async () => { throw new TypeError('Network request failed'); } });
  assert.deepEqual(r, { kind: 'offline' });
});

test('timeout is offline', async () => {
  const hang: typeof fetch = (_u, init) => new Promise((_, rej) =>
    init!.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  assert.deepEqual(await request(B, '/x', { fetchImpl: hang, timeoutMs: 20 }), { kind: 'offline' });
});

test('401 is auth_required, distinct from other failures', async () => {
  const r = await request(B, '/x', { fetchImpl: async () => json(401, { code: 'AUTH_REQUIRED' }) });
  assert.deepEqual(r, { kind: 'auth_required' });
});

test('problem+json code and retryable are carried through', async () => {
  const r = await request(B, '/x', { fetchImpl: async () => json(403, { code: 'FORBIDDEN', retryable: false }) });
  assert.deepEqual(r, { kind: 'failed', status: 403, code: 'FORBIDDEN', retryable: false });
  const busy = await request(B, '/x', { fetchImpl: async () => new Response('<html>bad gateway', { status: 502 }) });
  assert.deepEqual(busy, { kind: 'failed', status: 502, code: null, retryable: true });
});

test('bearer token is sent only when present', async () => {
  const seen: Array<string | null> = [];
  const f: typeof fetch = async (_u, init) => { seen.push(new Headers(init!.headers).get('authorization')); return json(200, {}); };
  await request(B, '/x', { fetchImpl: f });
  await request(B, '/x', { fetchImpl: f, token: 'abc' });
  assert.deepEqual(seen, [null, 'Bearer abc']);
});

// --- sign-in ----------------------------------------------------------------

test('sign-in returns token, subject and an expiry estimate', async () => {
  const token = jwt({ sub: 'user-1' });
  const r = await signIn(B, ' worker ', 'jalsakshi', {
    fetchImpl: async (_u, init) => {
      assert.deepEqual(JSON.parse(String(init!.body)), { username: 'worker', password: 'jalsakshi' });
      return json(200, { access_token: token, expires_in: 900 });
    },
    now: () => 1_000,
  });
  assert.deepEqual(r, { kind: 'ok', value: { token, subject: 'user-1', expiresAtMs: 901_000 } });
});

test('wrong credentials are auth_required', async () => {
  const r = await signIn(B, 'worker', 'x', { fetchImpl: async () => json(401, { code: 'AUTH_REQUIRED' }) });
  assert.equal(r.kind, 'auth_required');
});

test('a token without a subject is refused, not trusted', async () => {
  const r = await signIn(B, 'w', 'p', { fetchImpl: async () => json(200, { access_token: jwt({}), expires_in: 900 }) });
  assert.equal(r.kind, 'failed');
  assert.equal(jwtSubject('garbage'), null);
});

// --- catalogue fetch --------------------------------------------------------

function pagedServer(pages: Array<{ items: CachedSource[]; served_at: string }>): typeof fetch {
  return async (url) => {
    const cursor = new URL(String(url)).searchParams.get('cursor');
    const i = cursor ? Number(cursor) : 0;
    const p = pages[i];
    return json(200, {
      items: p.items.map((s) => ({ id: s.id, qr_code: s.qrCode, label: s.label, locality: s.locality, latitude: null, longitude: null })),
      next_cursor: i + 1 < pages.length ? String(i + 1) : null,
      served_at: p.served_at,
    });
  };
}

test('fetches every page and keeps the OLDEST served_at', async () => {
  const r = await fetchCatalogue(B, 't', pagedServer([
    { items: [src(1), src(2)], served_at: '2026-09-24T10:00:00Z' },
    { items: [src(3)], served_at: '2026-09-24T10:00:05Z' },
  ]));
  assert.equal(r.kind, 'ok');
  assert.deepEqual(r.kind === 'ok' && r.value.items.map((s) => s.qrCode), ['JS-SYN-0001', 'JS-SYN-0002', 'JS-SYN-0003']);
  assert.equal(r.kind === 'ok' && r.value.servedAt, '2026-09-24T10:00:00Z');
});

test('a failure on a later page fails the whole fetch (no partial catalogue)', async () => {
  let n = 0;
  const f: typeof fetch = async () => (n++ === 0
    ? json(200, { items: [], next_cursor: 'x', served_at: '2026-09-24T10:00:00Z' })
    : json(401, {}));
  assert.equal((await fetchCatalogue(B, 't', f)).kind, 'auth_required');
});

test('a server that never stops paging is bounded', async () => {
  let calls = 0;
  const f: typeof fetch = async () => { calls++; return json(200, { items: [], next_cursor: 'again', served_at: 'x' }); };
  const r = await fetchCatalogue(B, 't', f);
  assert.equal(r.kind, 'failed');
  assert.equal(calls, MAX_CATALOGUE_PAGES);
});

// --- on-device cache (real SQLite) -----------------------------------------

test('cache round-trips and survives reopening the database file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jalsakshi-cat-'));
  try {
    const path = join(dir, 'db.sqlite');
    let sql = nodeSql(path);
    migrate(sql);
    replaceCatalogue(sql, 'user-1', [src(2), src(1)], '2026-09-24T10:00:00Z');
    sql.close();
    sql = nodeSql(path); // an app restart
    migrate(sql);
    const c = loadCatalogue(sql, 'user-1');
    assert.deepEqual(c.items.map((s) => s.qrCode), ['JS-SYN-0001', 'JS-SYN-0002']);
    assert.equal(c.servedAt, '2026-09-24T10:00:00Z');
    sql.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('another account on the same phone does not see the cached catalogue', () => {
  const sql = nodeSql();
  migrate(sql);
  replaceCatalogue(sql, 'user-1', [src(1)], '2026-09-24T10:00:00Z');
  assert.deepEqual(loadCatalogue(sql, 'user-2'), { items: [], servedAt: null });
});

test('never-fetched cache is empty with no server time (labelled unknown, not fresh)', () => {
  const sql = nodeSql();
  migrate(sql);
  assert.deepEqual(loadCatalogue(sql, 'user-1'), { items: [], servedAt: null });
});

test('a failed replace leaves the previous catalogue intact', () => {
  const sql = nodeSql();
  migrate(sql);
  replaceCatalogue(sql, 'user-1', [src(1)], '2026-09-24T10:00:00Z');
  // Duplicate primary key forces a failure mid-transaction.
  assert.throws(() => replaceCatalogue(sql, 'user-1', [src(2), src(2)], '2026-09-24T11:00:00Z'));
  const c = loadCatalogue(sql, 'user-1');
  assert.deepEqual(c.items.map((s) => s.qrCode), ['JS-SYN-0001']);
  assert.equal(c.servedAt, '2026-09-24T10:00:00Z');
});

test('a successful fetch replaces the cache and is labelled network', () => {
  const sql = nodeSql();
  migrate(sql);
  replaceCatalogue(sql, 'user-1', [src(1)], '2026-09-24T09:00:00Z');
  const v = applyCatalogueFetch(sql, 'user-1', { kind: 'ok', value: { items: [src(2)], servedAt: '2026-09-24T10:00:00Z' } });
  assert.deepEqual([v.origin, v.problem, v.servedAt], ['network', null, '2026-09-24T10:00:00Z']);
  assert.deepEqual(v.items.map((s) => s.qrCode), ['JS-SYN-0002']);
});

test('offline, auth and server failures keep the cached list and say why', () => {
  const sql = nodeSql();
  migrate(sql);
  replaceCatalogue(sql, 'user-1', [src(1)], '2026-09-24T09:00:00Z');
  const cases = [
    [{ kind: 'offline' }, 'offline'],
    [{ kind: 'auth_required' }, 'auth_required'],
    [{ kind: 'failed', status: 500, code: null, retryable: true }, 'server_error'],
  ] as const;
  for (const [outcome, problem] of cases) {
    const v = applyCatalogueFetch(sql, 'user-1', outcome);
    assert.deepEqual([v.origin, v.problem, v.items.length, v.servedAt], ['cache', problem, 1, '2026-09-24T09:00:00Z']);
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
