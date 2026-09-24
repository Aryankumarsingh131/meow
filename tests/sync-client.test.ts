/**
 * T15: foreground sync client, end to end against the REAL API.
 *
 * Starts the actual FastAPI app (T13 push + T14 pull/bootstrap, synthetic dev
 * issuer) on a throwaway SQLite database in a temp directory, then drives the
 * phone's real modules: T12 `saveConfirmedSample` through its real SQL
 * (`bundleStatements`, `RECEIPT_SQL`) on `node:sqlite`, and `sync.ts`.
 * Server row counts are read from the server's own database file.
 *
 * All data is synthetic (ADR-M1-001).
 *
 * Run: node tests/sync-client.test.ts   (needs `python` with the API deps)
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';

import { httpTransport, signIn, type SyncTransport } from '../apps/mobile/src/api.ts';
import type { ReviewObservation } from '../apps/mobile/src/analysis/baseline.ts';
import { buildSample } from '../apps/mobile/src/sample.ts';
import {
  bundleStatements, getMeta, loadCatalogue, migrate, RECEIPT_SQL, saveConfirmedSample,
  setMeta, type LocalReceipt, type LocalSaveDependencies, type Sql,
} from '../apps/mobile/src/storage.ts';
import { BANNED_WORDS } from '../apps/mobile/src/statusLabel.ts';
import {
  FOREGROUND_NOTE, MAX_AUTO_ATTEMPTS_PER_SESSION, PHOTO_NOTE, pendingCount, QUEUE_TEXT, queueItems, STEP_TEXT, syncOnce,
  type SyncDeps, type SyncSession,
} from '../apps/mobile/src/sync.ts';
import type { TimingVerdict } from '../apps/mobile/src/timer.ts';
import { startServer } from './apiServer.ts';
import { nodeSql } from './sqlNode.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROTOCOL = JSON.parse(readFileSync(join(ROOT, 'protocols/SYN-COLOR-001.v1.json'), 'utf-8')) as { id: string; version: number };
const KIT_LOT = '5b0d7c1e-0000-4000-8000-00000000c001'; // synthetic lot, not a real kit
const DEVICE = '5b0d7c1e-0000-4000-8000-0000000d0001';

// --- the frozen contract, so the phone-built sample is checked against it ---
const require = createRequire(import.meta.url);
const addFormats = require('ajv-formats') as (ajv: Ajv2020) => void;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema({ $id: 'openapi.json', ...JSON.parse(readFileSync(join(ROOT, 'contracts/openapi.json'), 'utf-8')) });
const canonicalSample = ajv.getSchema('openapi.json#/components/schemas/CanonicalSampleV1')!;

// --- phone side ---------------------------------------------------------------

/** T12's real save, with its real SQL, on real SQLite. Files are in memory. */
function phoneStore(sql: Sql, captures: Map<string, Uint8Array>): LocalSaveDependencies {
  const files = new Map(captures);
  const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
  return {
    files: {
      async stage(uri, name) {
        const bytes = files.get(uri);
        if (!bytes) throw new Error('source missing');
        files.set(`private://${name}`, bytes);
        return { uri: `private://${name}`, bytes: bytes.byteLength, sha256: sha(bytes) };
      },
      async move(from, name) {
        files.set(`private://${name}`, files.get(from)!);
        files.delete(from);
        return `private://${name}`;
      },
      async list() { return [...files.keys()].filter((u) => u.startsWith('private://')).map((uri) => ({ uri, name: uri.slice(10) })); },
      async exists(uri) { return files.has(uri); },
      async remove(uri) { files.delete(uri); },
    },
    database: {
      async commit(bundle) { sql.tx(() => { for (const [q, p] of bundleStatements(bundle)) sql.run(q, p); }); },
      async receipt(id) { return sql.all<LocalReceipt>(RECEIPT_SQL, [id])[0] ?? null; },
      async assetUris() { return sql.all<{ uri: string }>('SELECT uri FROM local_assets').map((r) => r.uri); },
    },
    hashText: async (v) => sha(v),
    now: () => new Date().toISOString(),
  };
}

const inWindow: TimingVerdict = {
  state: 'in_window', timingValid: true, assistedPermitted: false, manualPermitted: true,
  elapsed: { kind: 'measured', seconds: 31.4, source: 'monotonic' }, secondsUntilWindow: null,
};
const manualReading: ReviewObservation = {
  method: 'manual', machineBin: null, manualBin: 'bin_1', selectedBin: 'bin_1', indicativeFlag: 'no_flag',
  qualityReasons: [], baselineVersion: null, protocolVersion: 1, confidence: null,
  overrideReason: 'Synthetic test: read by eye against the printed chart',
};

async function saveOne(sql: Sql, owner: string, sourceId: string, payloadOverride?: (p: Record<string, unknown>) => void) {
  const sampleId = randomUUID();
  const payload = buildSample(
    { sampleId, sourceId, protocol: PROTOCOL, kitLotId: KIT_LOT, capturedAtDevice: new Date().toISOString(), clientBuild: 't15-test' },
    inWindow, manualReading,
  ) as unknown as Record<string, unknown>;
  payloadOverride?.(payload);
  const uri = `capture://${sampleId}`;
  const receipt = await saveConfirmedSample(
    { owner, eventId: randomUUID(), assetId: randomUUID(), sourceUri: uri, mediaType: 'image/jpeg', sample: payload as never },
    phoneStore(sql, new Map([[uri, new Uint8Array([0xff, 0xd8, 1, 2, 3])]])),
  );
  return receipt;
}

function deps(sql: Sql, transport: SyncTransport, owner: string, now = () => Date.now()): SyncDeps {
  return { sql, transport, owner, deviceId: DEVICE, now, random: () => 0 };
}

const offline: SyncTransport = {
  push: async () => ({ kind: 'offline' }),
  pull: async () => ({ kind: 'offline' }),
  bootstrap: async () => ({ kind: 'offline' }),
};

/** Push reaches the server and COMMITS, then the response is lost. */
function losesPushAck(real: SyncTransport): SyncTransport {
  return { ...real, push: async (d, e) => { await real.push(d, e); return { kind: 'offline' }; } };
}

const state = (sql: Sql, owner: string, id: string) => queueItems(sql, owner).find((q) => q.sampleId === id)!;

// --- run ---------------------------------------------------------------------

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

await check('queue wording never claims water status, closed-app sending or photo upload', () => {
  const strings = [
    ...Object.values(QUEUE_TEXT).flatMap((t) => [t.label, t.detail]),
    ...Object.values(STEP_TEXT), PHOTO_NOTE, FOREGROUND_NOTE,
  ];
  for (const text of strings) {
    for (const word of BANNED_WORDS) assert.ok(!new RegExp('\\b' + word + '\\b', 'i').test(text), `"${text}" contains "${word}"`);
    assert.ok(!/%|verified|background|while closed|uploaded/i.test(text), `"${text}" overclaims`);
  }
  // "Saved" is never worded as "sent", and "accepted" never as anything more.
  assert.match(QUEUE_TEXT.saved_on_phone.detail, /not sent/i);
  assert.match(FOREGROUND_NOTE, /only while this app is open/);
});

const server = await startServer();
const serverDb = () => new DatabaseSync(join(server.dir, '.data', 'dev.sqlite3'), { readOnly: true });
const serverCount = (table: string, id: string) => {
  const db = serverDb();
  try {
    const col = table === 'changefeed' ? 'entity_id' : 'id';
    return (db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${col} = ?`).get(id) as { n: number }).n;
  } finally { db.close(); }
};

try {
  const worker = await signIn(server.base, 'worker', 'jalsakshi');
  const other = await signIn(server.base, 'other-worker', 'jalsakshi');
  assert.equal(worker.kind, 'ok');
  assert.equal(other.kind, 'ok');
  if (worker.kind !== 'ok' || other.kind !== 'ok') throw new Error('unreachable');
  const W = worker.value.subject;
  const real = httpTransport(server.base, worker.value.token);
  const phonePath = join(server.dir, 'phone.sqlite3');
  let sql = nodeSql(phonePath);
  migrate(sql);
  const session: SyncSession = { autoAttempts: 0 };
  let sourceId = '';

  await check('first sync bootstraps the catalogue and a tenant-bound cursor', async () => {
    const r = await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.deepEqual([r.push, r.pull], ['nothing_due', 'done']);
    const catalogue = loadCatalogue(sql, W);
    assert.deepEqual(catalogue.items.map((s) => s.label).sort(), ['Synthetic handpump 1', 'Synthetic handpump 2', 'Synthetic well north']);
    assert.ok(getMeta(sql, `sync_cursor:${W}`));
    sourceId = catalogue.items.find((s) => s.label === 'Synthetic handpump 1')!.id;
  });

  await check('the phone-built sample validates against the frozen v1 contract', () => {
    const sample = buildSample(
      { sampleId: randomUUID(), sourceId, protocol: PROTOCOL, kitLotId: KIT_LOT, capturedAtDevice: '2026-09-24T10:00:00.000Z', clientBuild: 'x' },
      inWindow, manualReading,
    );
    assert.ok(canonicalSample(sample), JSON.stringify(canonicalSample.errors));
    const rebooted = buildSample(
      { sampleId: randomUUID(), sourceId, protocol: PROTOCOL, kitLotId: KIT_LOT, capturedAtDevice: '2026-09-24T10:00:00.000Z', clientBuild: 'x' },
      { ...inWindow, state: 'indeterminate', timingValid: false, elapsed: { kind: 'indeterminate', reason: 'reboot' }, indeterminateReason: 'reboot' },
      manualReading,
    );
    assert.deepEqual(rebooted.timing, { state: 'indeterminate', reason: 'reboot', valid: false });
    assert.ok(canonicalSample(rebooted), JSON.stringify(canonicalSample.errors));
  });

  let offlineId = '';
  await check('offline: save, restart, and the record is still queued with its backoff', async () => {
    const saved = await saveOne(sql, W, sourceId);
    offlineId = saved.sampleId;
    const t0 = Date.now();
    const r = await syncOnce(deps(sql, offline, W, () => t0), session);
    assert.deepEqual([r.push, r.pull], ['offline', 'skipped']);
    assert.equal(state(sql, W, offlineId).state, 'waiting_to_retry');
    assert.equal(state(sql, W, offlineId).attempt, 1);

    // "Restart": close the database file and open it again.
    sql.close();
    sql = nodeSql(phonePath);
    migrate(sql);
    assert.equal(pendingCount(sql, W), 1);
    assert.equal(state(sql, W, offlineId).state, 'waiting_to_retry');
    assert.equal(serverCount('samples', offlineId), 0, 'nothing reached the server');

    // Before the backoff elapses an automatic pass sends nothing, even online.
    const early = await syncOnce(deps(sql, real, W, () => t0), session);
    assert.equal(early.push, 'nothing_due');
    assert.equal(serverCount('samples', offlineId), 0);
  });

  await check('lost acknowledgement: the replay is a duplicate and the server holds ONE record', async () => {
    const r1 = await syncOnce(deps(sql, losesPushAck(real), W), session, { manual: true });
    assert.equal(r1.push, 'offline');
    assert.equal(serverCount('samples', offlineId), 1, 'the server committed');
    assert.equal(state(sql, W, offlineId).state, 'waiting_to_retry', 'the phone must not assume success');

    const r2 = await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(r2.push, 'done');
    assert.equal(r2.accepted, 1);
    const receipt = sql.all<{ status: string }>('SELECT status FROM sync_receipts s JOIN local_samples l ON l.event_id = s.event_id WHERE l.id = ?', [offlineId])[0];
    assert.equal(receipt.status, 'duplicate');
    assert.equal(state(sql, W, offlineId).state, 'accepted_confirmed', 'pull confirmed it in server records');
    assert.equal(pendingCount(sql, W), 0);
    assert.deepEqual([serverCount('samples', offlineId), serverCount('changefeed', offlineId)], [1, 1]);
    // The durable local receipt survives the outbox row's removal.
    assert.equal(sql.all<LocalReceipt>(RECEIPT_SQL, [offlineId])[0].status, 'saved');
  });

  await check('process death between receipt and outbox delete rolls back; retry settles once', async () => {
    const saved = await saveOne(sql, W, sourceId);
    const crashing: Sql = {
      ...sql,
      run(q, p) {
        if (q.startsWith('DELETE FROM outbox')) throw new Error('process killed mid-settle');
        sql.run(q, p);
      },
      tx: (fn) => sql.tx(fn),
    };
    await assert.rejects(syncOnce(deps(crashing, real, W), session, { manual: true }), /process killed/);
    assert.equal(state(sql, W, saved.sampleId).state, 'saved_on_phone', 'receipt insert rolled back with the delete');
    assert.equal(sql.all('SELECT 1 FROM sync_receipts s JOIN local_samples l ON l.event_id = s.event_id WHERE l.id = ?', [saved.sampleId]).length, 0);
    assert.equal(serverCount('samples', saved.sampleId), 1);
    const again = await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(again.accepted, 1);
    assert.equal(state(sql, W, saved.sampleId).state, 'accepted_confirmed');
    assert.equal(serverCount('samples', saved.sampleId), 1);
  });

  await check('auth failure pauses sending and touches no record', async () => {
    const saved = await saveOne(sql, W, sourceId);
    const expired = httpTransport(server.base, 'not-a-valid-token');
    const r = await syncOnce(deps(sql, expired, W), session, { manual: true });
    assert.deepEqual([r.push, r.pull], ['auth_paused', 'skipped']);
    assert.equal(state(sql, W, saved.sampleId).state, 'saved_on_phone');
    assert.equal(state(sql, W, saved.sampleId).attempt, 0, 'an auth pause is not a failed attempt');
    assert.equal((await syncOnce(deps(sql, real, W), session, { manual: true })).accepted, 1);
  });

  await check('one invalid record is isolated; it cannot block the records behind it', async () => {
    const good1 = await saveOne(sql, W, sourceId);
    // Contradictory timing the server's contract refuses (valid with state=late).
    const bad = await saveOne(sql, W, sourceId, (p) => { p.timing = { state: 'late', elapsed_ms: 99_000, valid: true }; });
    const good2 = await saveOne(sql, W, sourceId);
    const r = await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(r.accepted, 2);
    assert.equal(r.needsAttention, 1);
    assert.equal(state(sql, W, bad.sampleId).state, 'needs_attention');
    assert.equal(state(sql, W, bad.sampleId).code, 'VALIDATION_FAILED');
    assert.deepEqual([good1, good2].map((s) => state(sql, W, s.sampleId).state), ['accepted_confirmed', 'accepted_confirmed']);
    assert.equal(serverCount('samples', bad.sampleId), 0);
    // Not dropped: the record and its receipt stay on the phone.
    assert.equal(sql.all<LocalReceipt>(RECEIPT_SQL, [bad.sampleId]).length, 1);
  });

  await check("another account on the same phone never sends this account's records", async () => {
    const mine = await saveOne(sql, W, sourceId);
    const O = other.value.subject;
    const theirs = httpTransport(server.base, other.value.token);
    const r = await syncOnce(deps(sql, theirs, O), { autoAttempts: 0 }, { manual: true });
    assert.equal(r.push, 'nothing_due');
    assert.equal(state(sql, W, mine.sampleId).state, 'saved_on_phone');
    assert.equal(serverCount('samples', mine.sampleId), 0);
    assert.equal(queueItems(sql, O).length, 0);
    await assert.rejects(
      saveConfirmedSample(
        { owner: O, eventId: mine.eventId, assetId: mine.assetId, sourceUri: 'capture://x', mediaType: 'image/jpeg',
          sample: JSON.parse(sql.all<{ payload_json: string }>('SELECT payload_json FROM local_samples WHERE id = ?', [mine.sampleId])[0].payload_json) },
        phoneStore(sql, new Map()),
      ),
      /another save/,
    );
    await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(state(sql, W, mine.sampleId).state, 'accepted_confirmed');
  });

  await check('a failed page apply leaves the cursor unmoved; the next pass applies it', async () => {
    const saved = await saveOne(sql, W, sourceId);
    const before = getMeta(sql, `sync_cursor:${W}`);
    const failing: Sql = {
      ...sql,
      run(q, p) {
        if (q.startsWith('INSERT INTO server_samples')) throw new Error('disk full mid-page');
        sql.run(q, p);
      },
      tx: (fn) => sql.tx(fn),
    };
    await assert.rejects(syncOnce(deps(failing, real, W), session, { manual: true }), /disk full/);
    assert.equal(getMeta(sql, `sync_cursor:${W}`), before);
    assert.equal(state(sql, W, saved.sampleId).state, 'accepted', 'push settled; pull did not');
    await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(state(sql, W, saved.sampleId).state, 'accepted_confirmed');
    assert.notEqual(getMeta(sql, `sync_cursor:${W}`), before);
  });

  await check('a refused cursor re-bootstraps and keeps pending records', async () => {
    const pending = await saveOne(sql, W, sourceId);
    setMeta(sql, `sync_cursor:${W}`, 'forged-cursor');
    // Hold the record back so this pass is pull-only while it stays pending.
    sql.run('UPDATE outbox SET next_attempt_at = ? WHERE sample_id = ?', ['9999-01-01T00:00:00.000Z', pending.sampleId]);
    const r3 = await syncOnce(deps(sql, real, W), session);
    assert.deepEqual([r3.push, r3.pull], ['nothing_due', 'done']);
    assert.notEqual(getMeta(sql, `sync_cursor:${W}`), 'forged-cursor');
    assert.equal(pendingCount(sql, W), 1, 'the reset kept the pending record');
    await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(state(sql, W, pending.sampleId).state, 'accepted_confirmed');
  });

  await check('a manual reading without a photo is saved durably and accepted', async () => {
    const sampleId = randomUUID();
    const payload = buildSample(
      { sampleId, sourceId, protocol: PROTOCOL, kitLotId: KIT_LOT, capturedAtDevice: new Date().toISOString(), clientBuild: 't15-test' },
      inWindow, manualReading,
    );
    const store = phoneStore(sql, new Map());
    const noPhoto = { owner: W, eventId: randomUUID(), sample: payload as never };
    await assert.rejects(
      saveConfirmedSample({ ...noPhoto, assetId: randomUUID(), sourceUri: null, mediaType: null }, store),
      /asset ID, source URI and media type/,
    );
    const receipt = await saveConfirmedSample({ ...noPhoto, assetId: null, sourceUri: null, mediaType: null }, store);
    assert.deepEqual([receipt.status, receipt.assetId, receipt.assetUri], ['saved', null, null]);
    assert.equal(sql.all<LocalReceipt>(RECEIPT_SQL, [sampleId])[0].assetUri, null, 'receipt survives with no asset row');
    await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(state(sql, W, sampleId).state, 'accepted_confirmed');
  });

  await check('a retryable rejection stays queued instead of becoming a verdict', async () => {
    // A correction that reaches the server before its original: T13 answers
    // SUPERSEDED_SAMPLE_NOT_FOUND, retryable.
    const early = await saveOne(sql, W, sourceId, (p) => { p.supersedes_id = randomUUID(); });
    const r = await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(r.accepted + r.needsAttention, 0);
    assert.equal(state(sql, W, early.sampleId).state, 'waiting_to_retry');
    assert.equal(sql.all('SELECT 1 FROM sync_receipts s JOIN local_samples l ON l.event_id = s.event_id WHERE l.id = ?', [early.sampleId]).length, 0);
    sql.run('DELETE FROM outbox WHERE sample_id = ?', [early.sampleId]); // test cleanup: an orphan correction
    sql.run('DELETE FROM local_assets WHERE sample_id = ?', [early.sampleId]);
    sql.run('DELETE FROM local_samples WHERE id = ?', [early.sampleId]);
  });

  await check('a 200 that omits an event is not an acknowledgement; foreign receipts are ignored', async () => {
    const a = await saveOne(sql, W, sourceId);
    const b = await saveOne(sql, W, sourceId);
    const foreign = randomUUID();
    // Saved in the same millisecond, a and b are ordered by their random event
    // ids, so the acknowledged one is whichever the phone sent first.
    let acked = '';
    const partial: SyncTransport = {
      ...real,
      push: async (_d, events) => (acked = events[0].event_id, {
        kind: 'ok',
        value: {
          results: [
            { event_id: events[0].event_id, status: 'accepted', resource_id: null, resource_version: 1, server_time: '2026-09-24T00:00:00Z', error: null },
            { event_id: foreign, status: 'accepted', resource_id: null, resource_version: 1, server_time: '2026-09-24T00:00:00Z', error: null },
          ],
        },
      }),
    };
    const r = await syncOnce(deps(sql, partial, W), session, { manual: true });
    assert.equal(r.accepted, 1);
    const [first, second] = a.eventId === acked ? [a, b] : [b, a];
    assert.equal(second.eventId !== acked && first.eventId === acked, true, 'one of a/b was acknowledged');
    assert.equal(['accepted', 'accepted_confirmed'].includes(state(sql, W, first.sampleId).state), true);
    assert.equal(state(sql, W, second.sampleId).state, 'waiting_to_retry');
    assert.equal(sql.all('SELECT 1 FROM sync_receipts WHERE event_id = ?', [foreign]).length, 0);
    // The real server then settles both: neither was really sent, so both are
    // accepted now.
    await syncOnce(deps(sql, real, W), session, { manual: true });
    assert.equal(state(sql, W, second.sampleId).state, 'accepted_confirmed');
  });

  await check('automatic retries stop at the per-session cap; Sync Now still works', async () => {
    const saved = await saveOne(sql, W, sourceId);
    const fresh: SyncSession = { autoAttempts: 0 };
    let clock = Date.now();
    const results: string[] = [];
    let lastAttemptAt = 0;
    for (let i = 0; i < MAX_AUTO_ATTEMPTS_PER_SESSION + 2; i++) {
      clock += 120_000; // past any backoff
      const step = (await syncOnce(deps(sql, offline, W, () => clock), fresh)).push;
      if (step === 'offline') lastAttemptAt = clock;
      results.push(step);
    }
    assert.deepEqual(results, [...Array(MAX_AUTO_ATTEMPTS_PER_SESSION).fill('offline'), 'session_limit', 'session_limit']);
    assert.equal(state(sql, W, saved.sampleId).attempt, MAX_AUTO_ATTEMPTS_PER_SESSION, 'backoff is not deletion');
    const next = new Date(state(sql, W, saved.sampleId).nextAttemptAt!).getTime() - lastAttemptAt;
    assert.equal(next, 30_000, 'attempt 8 waits 60 s × jitter 0.5 (random=0)');
    assert.equal((await syncOnce(deps(sql, real, W), fresh, { manual: true })).accepted, 1);
  });

  console.log(`${passed} sync-client tests passed`);
} finally {
  server.child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(server.dir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
}
