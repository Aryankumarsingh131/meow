/**
 * T45: offline grant, lock and revocation on the phone — with pending samples.
 *
 * Real API server (tests/apiServer.ts) for provisioning and re-login; the
 * phone's real `offlineAccess.ts`, T12 save SQL and T15 sync engine on
 * `node:sqlite`. Time is injected, so expiry and clock shifts are exact.
 * Server-side revocation is covered in tests/offline_grants_test.py.
 *
 * Run: node tests/offline-auth.test.ts
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { httpTransport, requestOfflineGrant, signIn, type SyncTransport } from '../apps/mobile/src/api.ts';
import {
  checkOfflineAccess, CLOCK_ROLLBACK_TOLERANCE_MS, LOCK_TEXT, OFFLINE_LIMIT_NOTE, offlineAccounts,
  recordGrant, revokeOfflineAccess, type ServerGrant,
} from '../apps/mobile/src/offlineAccess.ts';
import { buildSample } from '../apps/mobile/src/sample.ts';
import { bundleStatements, migrate, RECEIPT_SQL, saveConfirmedSample, type LocalReceipt, type Sql } from '../apps/mobile/src/storage.ts';
import { BANNED_WORDS } from '../apps/mobile/src/statusLabel.ts';
import { pendingCount, syncOnce } from '../apps/mobile/src/sync.ts';
import { startServer } from './apiServer.ts';
import { nodeSql } from './sqlNode.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTOCOL = JSON.parse(readFileSync(join(ROOT, 'protocols/SYN-COLOR-001.v1.json'), 'utf-8')) as { id: string; version: number };
const DEVICE = '5b0d7c1e-0000-4000-8000-0000000d0045';
const HOUR = 3_600_000;

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

/** Save one manual, photo-less record through T12's real SQL. */
async function savePending(sql: Sql, owner: string, sourceId: string): Promise<string> {
  const sampleId = randomUUID();
  const sample = buildSample(
    { sampleId, sourceId, protocol: PROTOCOL, kitLotId: '5b0d7c1e-0000-4000-8000-00000000c001', capturedAtDevice: new Date().toISOString(), clientBuild: 't45-test' },
    { state: 'in_window', timingValid: true, assistedPermitted: false, manualPermitted: true, elapsed: { kind: 'measured', seconds: 30, source: 'monotonic' }, secondsUntilWindow: null },
    { method: 'manual', machineBin: null, manualBin: 'bin_0', selectedBin: 'bin_0', indicativeFlag: 'no_flag', qualityReasons: [], baselineVersion: null, protocolVersion: 1, confidence: null, overrideReason: 'Synthetic offline test' },
  );
  await saveConfirmedSample(
    { owner, eventId: randomUUID(), assetId: null, sourceUri: null, mediaType: null, sample: sample as never },
    {
      files: { stage: async () => { throw new Error('no photo'); }, move: async () => '', list: async () => [], exists: async () => true, remove: async () => {} },
      database: {
        async commit(b) { sql.tx(() => { for (const [q, p] of bundleStatements(b)) sql.run(q, p); }); },
        async receipt(id) { return sql.all<LocalReceipt>(RECEIPT_SQL, [id])[0] ?? null; },
        async assetUris() { return []; },
      },
      hashText: async (v) => createHash('sha256').update(v).digest('hex'),
      now: () => new Date().toISOString(),
    },
  );
  return sampleId;
}

const records = (sql: Sql) => ({
  samples: sql.all<{ n: number }>('SELECT count(*) AS n FROM local_samples')[0].n,
  outbox: sql.all<{ n: number }>('SELECT count(*) AS n FROM outbox')[0].n,
});

/** A server-shaped grant for pure clock tests: lease measured from `serverTime`. */
function grantAt(subject: string, serverTimeMs: number, leaseMs = 72 * HOUR, captureOffline = true): ServerGrant {
  return {
    grant_id: randomUUID(), subject, tenant_id: 't', role: 'worker', capture_offline: captureOffline, policy_version: 1,
    server_time: new Date(serverTimeMs).toISOString(), expires_at: new Date(serverTimeMs + leaseMs).toISOString(),
  };
}

await check('lock wording discloses the revocation limit and never claims water status', () => {
  for (const text of [...Object.values(LOCK_TEXT), OFFLINE_LIMIT_NOTE]) {
    for (const word of BANNED_WORDS) assert.ok(!new RegExp('\\b' + word + '\\b', 'i').test(text), `"${text}" contains "${word}"`);
  }
  assert.match(OFFLINE_LIMIT_NOTE, /only learns this when it reconnects/);
});

await check('the lease runs on the phone clock from issue, so a skewed phone cannot lengthen it', () => {
  const sql = nodeSql();
  migrate(sql);
  const phoneNow = Date.parse('2026-09-24T12:00:00Z');
  // Phone clock is a full day BEHIND the server. Using the server's expires_at
  // against the phone clock would give 96 h; the lease must stay 72 h.
  assert.ok(recordGrant(sql, 'Worker', grantAt('s1', phoneNow + 24 * HOUR), 's1', phoneNow));
  const access = checkOfflineAccess(sql, 's1', phoneNow + HOUR);
  assert.equal(access.kind, 'granted');
  if (access.kind === 'granted') {
    assert.equal(access.expiresAtMs - phoneNow, 72 * HOUR);
    assert.equal(access.grant.username, 'worker');
  }
  assert.equal(recordGrant(sql, 'x', grantAt('someone-else', phoneNow), 's2', phoneNow), false, 'grant for another subject');
  assert.equal(recordGrant(sql, 'x', grantAt('s2', phoneNow, 30 * 24 * HOUR), 's2', phoneNow), false, 'absurd lease');
  assert.equal(recordGrant(sql, 'x', grantAt('s2', phoneNow, -1), 's2', phoneNow), false, 'negative lease');
  assert.equal(checkOfflineAccess(sql, 's2', phoneNow).kind, 'locked');
});

await check('expiry locks access without touching pending records', async () => {
  const sql = nodeSql();
  migrate(sql);
  const t0 = Date.parse('2026-09-24T12:00:00Z');
  recordGrant(sql, 'worker', grantAt('w', t0), 'w', t0);
  await savePending(sql, 'w', randomUUID());
  await savePending(sql, 'w', randomUUID());
  assert.equal(checkOfflineAccess(sql, 'w', t0 + 72 * HOUR - 1).kind, 'granted');
  assert.deepEqual(checkOfflineAccess(sql, 'w', t0 + 72 * HOUR), { kind: 'locked', reason: 'expired' });
  assert.deepEqual(records(sql), { samples: 2, outbox: 2 });
  assert.equal(pendingCount(sql, 'w'), 2);
  assert.deepEqual(offlineAccounts(sql, t0 + 72 * HOUR), []);
});

await check('clock rollback locks, and winding the clock forward does not restore access', async () => {
  const sql = nodeSql();
  migrate(sql);
  const t0 = Date.parse('2026-09-24T12:00:00Z');
  recordGrant(sql, 'worker', grantAt('w', t0), 'w', t0);
  await savePending(sql, 'w', randomUUID());
  assert.equal(checkOfflineAccess(sql, 'w', t0 + 10 * HOUR).kind, 'granted'); // high-water now t0+10h
  // A small backward NTP correction (60 s, a literal: not derived from the
  // constant under test) is tolerated.
  assert.ok(CLOCK_ROLLBACK_TOLERANCE_MS > 60_000);
  assert.equal(checkOfflineAccess(sql, 'w', t0 + 10 * HOUR - 60_000).kind, 'granted');
  // Set back 5 h: still inside the lease by wall clock, but behind what the app has seen.
  assert.deepEqual(checkOfflineAccess(sql, 'w', t0 + 5 * HOUR), { kind: 'locked', reason: 'clock_rollback' });
  assert.deepEqual(checkOfflineAccess(sql, 'w', t0 + 11 * HOUR), { kind: 'locked', reason: 'no_grant' });
  assert.equal(pendingCount(sql, 'w'), 1);
});

await check('clock set before the grant was issued locks', () => {
  const sql = nodeSql();
  migrate(sql);
  const t0 = Date.parse('2026-09-24T12:00:00Z');
  recordGrant(sql, 'worker', grantAt('w', t0), 'w', t0);
  assert.deepEqual(checkOfflineAccess(sql, 'w', t0 - HOUR), { kind: 'locked', reason: 'clock_rollback' });
});

await check('restart ("reboot" of the app): grant and clock high-water survive; rollback after restart still detected', async () => {
  const dir = join(ROOT, '.data');
  const path = join(dir, `t45-${randomUUID()}.sqlite3`);
  (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const t0 = Date.parse('2026-09-24T12:00:00Z');
  try {
    let sql = nodeSql(path);
    migrate(sql);
    recordGrant(sql, 'worker', grantAt('w', t0), 'w', t0);
    await savePending(sql, 'w', randomUUID());
    assert.equal(checkOfflineAccess(sql, 'w', t0 + 20 * HOUR).kind, 'granted');
    sql.close();
    sql = nodeSql(path); // process killed and relaunched
    migrate(sql);
    assert.equal(checkOfflineAccess(sql, 'w', t0 + 21 * HOUR).kind, 'granted');
    assert.deepEqual(checkOfflineAccess(sql, 'w', t0 + 2 * HOUR), { kind: 'locked', reason: 'clock_rollback' });
    assert.deepEqual(records(sql), { samples: 1, outbox: 1 });
    sql.close();
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }
});

await check('a role without offline capture gets no offline entry', () => {
  const sql = nodeSql();
  migrate(sql);
  const t0 = Date.parse('2026-09-24T12:00:00Z');
  recordGrant(sql, 'lab', grantAt('lab', t0, 72 * HOUR, false), 'lab', t0);
  assert.deepEqual(checkOfflineAccess(sql, 'lab', t0 + HOUR), { kind: 'locked', reason: 'not_permitted' });
  assert.deepEqual(offlineAccounts(sql, t0 + HOUR), []);
});

const server = await startServer();
try {
  await check('first provisioning is online: sign in, then the server issues a 72 h lease for this device', async () => {
    const sql = nodeSql();
    migrate(sql);
    const signed = await signIn(server.base, 'worker', 'jalsakshi');
    assert.equal(signed.kind, 'ok');
    if (signed.kind !== 'ok') return;
    assert.deepEqual(checkOfflineAccess(sql, signed.value.subject, Date.now()), { kind: 'locked', reason: 'no_grant' });
    const unauth = await requestOfflineGrant(server.base, '', DEVICE, 't45');
    assert.equal(unauth.kind, 'auth_required');
    const grant = await requestOfflineGrant(server.base, signed.value.token, DEVICE, 't45');
    assert.equal(grant.kind, 'ok');
    if (grant.kind !== 'ok') return;
    const now = Date.now();
    assert.ok(recordGrant(sql, 'worker', grant.value, signed.value.subject, now));
    const access = checkOfflineAccess(sql, signed.value.subject, now + 1000);
    assert.equal(access.kind, 'granted');
    if (access.kind === 'granted') assert.equal(access.expiresAtMs - now, 72 * HOUR);
    assert.deepEqual(offlineAccounts(sql, now + 1000).map((a) => a.username), ['worker']);
  });

  await check('revocation discovered on reconnect: sending is refused, the lease is dropped, records stay', async () => {
    const sql = nodeSql();
    migrate(sql);
    const signed = await signIn(server.base, 'worker', 'jalsakshi');
    if (signed.kind !== 'ok') throw new Error('sign-in failed');
    const W = signed.value.subject;
    const now = Date.now();
    const grant = await requestOfflineGrant(server.base, signed.value.token, DEVICE, 't45');
    if (grant.kind !== 'ok') throw new Error('grant failed');
    recordGrant(sql, 'worker', grant.value, W, now);
    const id = await savePending(sql, W, randomUUID());
    // What the real server answers a revoked member (tests/offline_grants_test.py).
    const revoked: SyncTransport = {
      push: async () => ({ kind: 'failed', status: 403, code: 'FORBIDDEN', retryable: false }),
      pull: async () => ({ kind: 'failed', status: 403, code: 'FORBIDDEN', retryable: false }),
      bootstrap: async () => ({ kind: 'failed', status: 403, code: 'FORBIDDEN', retryable: false }),
    };
    const r = await syncOnce({ sql, transport: revoked, owner: W, deviceId: DEVICE, now: () => now, random: () => 0 }, { autoAttempts: 0 }, { manual: true });
    assert.deepEqual([r.push, r.pull], ['forbidden', 'skipped']);
    revokeOfflineAccess(sql, W); // what workerApp does on `forbidden`
    assert.deepEqual(checkOfflineAccess(sql, W, now + 1000), { kind: 'locked', reason: 'no_grant' });
    assert.deepEqual(records(sql), { samples: 1, outbox: 1 }, 'quarantined, not discarded');
    assert.equal(sql.all<{ attempt: number }>('SELECT attempt FROM outbox')[0].attempt, 0, 'a refusal is not a failed attempt');
    assert.equal(sql.all<LocalReceipt>(RECEIPT_SQL, [id])[0].status, 'saved');
  });

  await check('re-login after lock: a fresh lease is issued and the pending records sync', async () => {
    const sql = nodeSql();
    migrate(sql);
    const first = await signIn(server.base, 'worker', 'jalsakshi');
    if (first.kind !== 'ok') throw new Error('sign-in failed');
    const W = first.value.subject;
    const t0 = Date.now();
    const g1 = await requestOfflineGrant(server.base, first.value.token, DEVICE, 't45');
    if (g1.kind !== 'ok') throw new Error('grant failed');
    recordGrant(sql, 'worker', g1.value, W, t0);
    // Bootstrap the catalogue so the offline records use a real source id.
    await syncOnce({ sql, transport: httpTransport(server.base, first.value.token), owner: W, deviceId: DEVICE, now: () => t0, random: () => 0 }, { autoAttempts: 0 }, { manual: true });
    const source = sql.all<{ id: string }>("SELECT id FROM source_cache ORDER BY label LIMIT 1")[0].id;
    const a = await savePending(sql, W, source);
    const b = await savePending(sql, W, source);
    // Lease runs out while offline; access locks, nothing is lost.
    assert.deepEqual(checkOfflineAccess(sql, W, t0 + 73 * HOUR), { kind: 'locked', reason: 'expired' });
    assert.equal(pendingCount(sql, W), 2);
    // Back online: sign in again, new lease, then the queue drains.
    const again = await signIn(server.base, 'worker', 'jalsakshi');
    if (again.kind !== 'ok') throw new Error('re-login failed');
    const g2 = await requestOfflineGrant(server.base, again.value.token, DEVICE, 't45');
    if (g2.kind !== 'ok') throw new Error('grant failed');
    const t1 = Date.now();
    recordGrant(sql, 'worker', g2.value, W, t1);
    assert.equal(checkOfflineAccess(sql, W, t1 + HOUR).kind, 'granted');
    const r = await syncOnce({ sql, transport: httpTransport(server.base, again.value.token), owner: W, deviceId: DEVICE, now: () => t1, random: () => 0 }, { autoAttempts: 0 }, { manual: true });
    assert.equal(r.accepted, 2);
    assert.equal(pendingCount(sql, W), 0);
    const statuses = sql.all<{ status: string }>(
      'SELECT r.status FROM sync_receipts r JOIN local_samples s ON s.event_id = r.event_id WHERE s.id IN (?, ?)', [a, b],
    ).map((row) => row.status);
    assert.deepEqual(statuses, ['accepted', 'accepted']);
  });

  console.log(`${passed} offline-auth tests passed`);
} finally {
  server.child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows may hold files briefly */ }
}
