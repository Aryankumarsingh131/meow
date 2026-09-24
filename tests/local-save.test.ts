/**
 * T12: crash-safe local save and startup recovery.
 *
 * Run: node tests/local-save.test.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  recoverLocalStorage,
  saveConfirmedSample,
  type LocalReceipt,
  type LocalSaveBundle,
  type LocalSaveDependencies,
  type LocalSaveInput,
} from '../apps/mobile/src/storage.ts';

type FailurePoint = 'disk' | 'before_move' | 'after_move' | 'before_commit' | 'after_commit';

const SAMPLE_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const SOURCE_URI = 'source://capture';
const CAPTURE = new Uint8Array([1, 3, 3, 7]);
const SAVED_AT = '2026-09-24T12:34:56.000Z';

const input: LocalSaveInput = {
  eventId: EVENT_ID,
  assetId: ASSET_ID,
  sourceUri: SOURCE_URI,
  mediaType: 'image/jpeg',
  sample: {
    schema_version: 1,
    sample_id: SAMPLE_ID,
    captured_at_device: '2026-09-24T12:30:00.000Z',
    observation: { selected_bin: 'bin_b', method: 'assisted' },
  },
};

function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

function receipt(
  sample: LocalSaveBundle['sample'],
  asset: LocalSaveBundle['asset'],
): LocalReceipt {
  return {
    status: 'saved',
    sampleId: sample.id,
    eventId: sample.eventId,
    assetId: asset.id,
    assetUri: asset.uri,
    assetSha256: asset.sha256,
    assetBytes: asset.bytes,
    payloadHash: sample.payloadHash,
    savedAt: sample.savedAt,
  };
}

function memoryStore(failAt?: FailurePoint) {
  const files = new Map<string, Uint8Array>([[SOURCE_URI, CAPTURE]]);
  const samples = new Map<string, LocalSaveBundle['sample']>();
  const assets = new Map<string, LocalSaveBundle['asset']>();
  const outbox = new Map<string, LocalSaveBundle['outbox']>();

  const dependencies: LocalSaveDependencies = {
    files: {
      async stage(sourceUri, name) {
        if (failAt === 'disk') throw new Error('disk full');
        const bytes = files.get(sourceUri);
        if (!bytes) throw new Error('source missing');
        const uri = `private://${name}`;
        files.set(uri, bytes.slice());
        return { uri, bytes: bytes.byteLength, sha256: sha256(bytes) };
      },
      async move(fromUri, name) {
        if (failAt === 'before_move') throw new Error('process killed before rename');
        const bytes = files.get(fromUri);
        if (!bytes) throw new Error('staged file missing');
        const uri = `private://${name}`;
        files.set(uri, bytes);
        files.delete(fromUri);
        if (failAt === 'after_move') throw new Error('process killed after rename');
        return uri;
      },
      async list() {
        return [...files]
          .filter(([uri]) => uri.startsWith('private://'))
          .map(([uri]) => ({ uri, name: uri.slice('private://'.length) }));
      },
      async exists(uri) {
        return files.has(uri);
      },
      async remove(uri) {
        files.delete(uri);
      },
    },
    database: {
      async commit(bundle) {
        if (failAt === 'before_commit') throw new Error('process killed before commit');
        samples.set(bundle.sample.id, bundle.sample);
        assets.set(bundle.asset.id, bundle.asset);
        outbox.set(bundle.outbox.eventId, bundle.outbox);
        if (failAt === 'after_commit') throw new Error('commit acknowledgement lost');
      },
      async receipt(sampleId) {
        const sample = samples.get(sampleId);
        if (!sample) return null;
        const asset = [...assets.values()].find((candidate) => candidate.sampleId === sampleId);
        return asset ? receipt(sample, asset) : null;
      },
      async assetUris() {
        return [...assets.values()].map((asset) => asset.uri);
      },
    },
    hashText: async (value) => sha256(value),
    now: () => SAVED_AT,
  };

  return { dependencies, files, samples, assets, outbox };
}

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

test('save returns a receipt only after the asset, sample and outbox are durable', async () => {
  const store = memoryStore();
  const saved = await saveConfirmedSample(input, store.dependencies);

  assert.equal(saved.status, 'saved');
  assert.equal(saved.assetSha256, sha256(CAPTURE));
  assert.equal(saved.assetBytes, CAPTURE.byteLength);
  assert.deepEqual(
    [store.samples.size, store.assets.size, store.outbox.size],
    [1, 1, 1],
  );
  const event = store.outbox.get(EVENT_ID)!;
  assert.equal(event.payloadHash, sha256(event.payloadJson));
  assert.equal(saved.payloadHash, event.payloadHash);
  assert.equal(event.state, 'pending');
  assert.equal(event.attempt, 0);

  store.outbox.delete(EVENT_ID);
  assert.equal((await store.dependencies.database.receipt(SAMPLE_ID))?.status, 'saved');
});

test('disk failure never reports success or creates database rows', async () => {
  const store = memoryStore('disk');
  await assert.rejects(saveConfirmedSample(input, store.dependencies), /disk full/);
  assert.deepEqual([store.samples.size, store.assets.size, store.outbox.size], [0, 0, 0]);
});

for (const point of ['before_move', 'after_move', 'before_commit'] as const) {
  test(`${point.replace('_', ' ')} leaves no rows and startup removes only the owned orphan`, async () => {
    const store = memoryStore(point);
    await assert.rejects(saveConfirmedSample(input, store.dependencies));
    assert.deepEqual([store.samples.size, store.assets.size, store.outbox.size], [0, 0, 0]);

    const recovery = await recoverLocalStorage(store.dependencies);
    assert.equal(recovery.removed.length, 1);
    assert.equal((await store.dependencies.files.list()).length, 0);
  });
}

test('lost commit acknowledgement recovers one receipt without deleting its asset', async () => {
  const store = memoryStore('after_commit');
  await assert.rejects(saveConfirmedSample(input, store.dependencies), /acknowledgement lost/);
  assert.deepEqual([store.samples.size, store.assets.size, store.outbox.size], [1, 1, 1]);

  const recovery = await recoverLocalStorage(store.dependencies);
  assert.deepEqual(recovery, { removed: [], missing: [] });
  const recovered = await store.dependencies.database.receipt(SAMPLE_ID);
  assert.equal(recovered?.assetSha256, sha256(CAPTURE));

  const retry = await saveConfirmedSample(input, store.dependencies);
  assert.equal(retry.assetSha256, sha256(CAPTURE));
  assert.deepEqual([store.samples.size, store.assets.size, store.outbox.size], [1, 1, 1]);

  await assert.rejects(
    saveConfirmedSample(
      { ...input, sample: { ...input.sample, observation: { selected_bin: 'bin_a', method: 'manual' } } },
      store.dependencies,
    ),
    /different payload/,
  );
});

test('recovery preserves unknown files and reports missing referenced assets', async () => {
  const store = memoryStore();
  await saveConfirmedSample(input, store.dependencies);
  const assetUri = `private://${ASSET_ID}.asset`;
  store.files.set('private://notes.txt', new Uint8Array([9]));
  store.files.set('private://44444444-4444-4444-8444-444444444444.tmp', new Uint8Array([8]));
  store.files.delete(assetUri);

  const recovery = await recoverLocalStorage(store.dependencies);
  assert.deepEqual(recovery.removed, ['private://44444444-4444-4444-8444-444444444444.tmp']);
  assert.deepEqual(recovery.missing, [assetUri]);
  assert.equal(store.files.has('private://notes.txt'), true);
  assert.deepEqual([store.samples.size, store.assets.size, store.outbox.size], [1, 1, 1]);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

if (failed) process.exitCode = 1;
else console.log(`\n${tests.length} local-save tests passed`);
