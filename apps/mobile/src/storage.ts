import { createPendingOutboxEvent, type PendingOutboxEvent } from './outbox.ts';

export type LocalSamplePayload = {
  schema_version: number;
  sample_id: string;
  captured_at_device: string;
  [key: string]: unknown;
};

export type LocalSaveInput = {
  eventId: string;
  assetId: string;
  sourceUri: string;
  mediaType: 'image/jpeg' | 'image/png';
  sample: LocalSamplePayload;
};

export type LocalSaveBundle = {
  sample: {
    id: string;
    eventId: string;
    payloadJson: string;
    payloadHash: string;
    capturedAt: string;
    savedAt: string;
  };
  asset: {
    id: string;
    sampleId: string;
    uri: string;
    sha256: string;
    mediaType: LocalSaveInput['mediaType'];
    bytes: number;
  };
  outbox: PendingOutboxEvent;
};

export type LocalReceipt = {
  status: 'saved';
  sampleId: string;
  eventId: string;
  assetId: string;
  assetUri: string;
  assetSha256: string;
  assetBytes: number;
  payloadHash: string;
  savedAt: string;
};

export type LocalSaveDependencies = {
  files: {
    stage(sourceUri: string, name: string): Promise<{ uri: string; sha256: string; bytes: number }>;
    move(fromUri: string, name: string): Promise<string>;
    list(): Promise<Array<{ uri: string; name: string }>>;
    exists(uri: string): Promise<boolean>;
    remove(uri: string): Promise<void>;
  };
  database: {
    commit(bundle: LocalSaveBundle): Promise<void>;
    receipt(sampleId: string): Promise<LocalReceipt | null>;
    assetUris(): Promise<string[]>;
  };
  hashText(value: string): Promise<string>;
  now(): string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNED_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:tmp|asset)$/i;
const SHA256 = /^[a-f0-9]{64}$/;

function validate(input: LocalSaveInput) {
  if (!UUID.test(input.sample.sample_id)) throw new Error('Sample ID must be a UUID');
  if (!UUID.test(input.eventId)) throw new Error('Event ID must be a UUID');
  if (!UUID.test(input.assetId)) throw new Error('Asset ID must be a UUID');
  if (!input.sourceUri.trim()) throw new Error('Source asset URI is required');
  if (input.mediaType !== 'image/jpeg' && input.mediaType !== 'image/png') {
    throw new Error('Asset media type is unsupported');
  }
  if (!Number.isInteger(input.sample.schema_version) || input.sample.schema_version < 1) {
    throw new Error('Sample schema version is invalid');
  }
  if (!input.sample.captured_at_device.trim()) throw new Error('Capture time is required');
}

function toReceipt(bundle: LocalSaveBundle): LocalReceipt {
  return {
    status: 'saved',
    sampleId: bundle.sample.id,
    eventId: bundle.outbox.eventId,
    assetId: bundle.asset.id,
    assetUri: bundle.asset.uri,
    assetSha256: bundle.asset.sha256,
    assetBytes: bundle.asset.bytes,
    payloadHash: bundle.sample.payloadHash,
    savedAt: bundle.sample.savedAt,
  };
}

export async function saveConfirmedSample(
  input: LocalSaveInput,
  dependencies: LocalSaveDependencies,
): Promise<LocalReceipt> {
  validate(input);

  const outbox = await createPendingOutboxEvent(
    input.eventId,
    input.sample.sample_id,
    input.sample,
    dependencies.hashText,
  );
  const prior = await dependencies.database.receipt(input.sample.sample_id);
  if (prior) {
    if (prior.eventId !== input.eventId || prior.assetId !== input.assetId) {
      throw new Error('Sample ID is already associated with another save');
    }
    if (prior.payloadHash !== outbox.payloadHash) {
      throw new Error('Sample ID is already associated with a different payload');
    }
    if (!(await dependencies.files.exists(prior.assetUri))) {
      throw new Error('Saved sample asset is missing');
    }
    return prior;
  }

  const staged = await dependencies.files.stage(input.sourceUri, `${input.assetId}.tmp`);
  if (!SHA256.test(staged.sha256) || staged.bytes < 1) throw new Error('Staged asset is invalid');

  const finalUri = await dependencies.files.move(staged.uri, `${input.assetId}.asset`);
  const bundle: LocalSaveBundle = {
    sample: {
      id: input.sample.sample_id,
      eventId: input.eventId,
      payloadJson: outbox.payloadJson,
      payloadHash: outbox.payloadHash,
      capturedAt: input.sample.captured_at_device,
      savedAt: dependencies.now(),
    },
    asset: {
      id: input.assetId,
      sampleId: input.sample.sample_id,
      uri: finalUri,
      sha256: staged.sha256,
      mediaType: input.mediaType,
      bytes: staged.bytes,
    },
    outbox,
  };

  await dependencies.database.commit(bundle);
  return toReceipt(bundle);
}

export async function recoverLocalStorage(dependencies: LocalSaveDependencies) {
  const referenced = new Set(await dependencies.database.assetUris());
  const removed: string[] = [];

  for (const file of await dependencies.files.list()) {
    if (OWNED_FILE.test(file.name) && !referenced.has(file.uri)) {
      await dependencies.files.remove(file.uri);
      removed.push(file.uri);
    }
  }

  const missing: string[] = [];
  for (const uri of referenced) {
    if (!(await dependencies.files.exists(uri))) missing.push(uri);
  }
  return { removed: removed.sort(), missing: missing.sort() };
}

export async function openLocalStorage() {
  const [{ CryptoDigestAlgorithm, digest, digestStringAsync }, { Directory, File, Paths }, { openDatabaseAsync }] =
    await Promise.all([import('expo-crypto'), import('expo-file-system'), import('expo-sqlite')]);

  const directory = new Directory(Paths.document, 'jalsakshi-assets');
  directory.create({ idempotent: true, intermediates: true });
  const database = await openDatabaseAsync('jalsakshi.db');
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS local_samples (
      id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT UNIQUE NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_assets (
      id TEXT PRIMARY KEY NOT NULL,
      sample_id TEXT UNIQUE NOT NULL REFERENCES local_samples(id),
      uri TEXT UNIQUE NOT NULL,
      sha256 TEXT NOT NULL,
      media_type TEXT NOT NULL,
      bytes INTEGER NOT NULL CHECK (bytes > 0)
    );
    CREATE TABLE IF NOT EXISTS outbox (
      event_id TEXT PRIMARY KEY NOT NULL,
      sample_id TEXT UNIQUE NOT NULL REFERENCES local_samples(id),
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state = 'pending'),
      attempt INTEGER NOT NULL CHECK (attempt >= 0),
      next_attempt_at TEXT
    );
  `);

  const dependencies: LocalSaveDependencies = {
    files: {
      async stage(sourceUri, name) {
        const target = new File(directory, name);
        await new File(sourceUri).copy(target);
        const bytes = await target.bytes();
        const hash = await digest(CryptoDigestAlgorithm.SHA256, bytes);
        return { uri: target.uri, bytes: bytes.byteLength, sha256: hex(hash) };
      },
      async move(fromUri, name) {
        const destination = new File(directory, name);
        await new File(fromUri).move(destination);
        return destination.uri;
      },
      async list() {
        return directory
          .list()
          .filter((item): item is InstanceType<typeof File> => item instanceof File)
          .map((file) => ({ uri: file.uri, name: file.name }));
      },
      async exists(uri) {
        return new File(uri).exists;
      },
      async remove(uri) {
        const file = new File(uri);
        if (file.exists) file.delete();
      },
    },
    database: {
      async commit(bundle) {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync(
            'INSERT INTO local_samples (id, event_id, payload_json, payload_hash, captured_at, saved_at) VALUES (?, ?, ?, ?, ?, ?)',
            bundle.sample.id,
            bundle.sample.eventId,
            bundle.sample.payloadJson,
            bundle.sample.payloadHash,
            bundle.sample.capturedAt,
            bundle.sample.savedAt,
          );
          await transaction.runAsync(
            'INSERT INTO local_assets (id, sample_id, uri, sha256, media_type, bytes) VALUES (?, ?, ?, ?, ?, ?)',
            bundle.asset.id,
            bundle.asset.sampleId,
            bundle.asset.uri,
            bundle.asset.sha256,
            bundle.asset.mediaType,
            bundle.asset.bytes,
          );
          await transaction.runAsync(
            'INSERT INTO outbox (event_id, sample_id, payload_json, payload_hash, state, attempt, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            bundle.outbox.eventId,
            bundle.outbox.sampleId,
            bundle.outbox.payloadJson,
            bundle.outbox.payloadHash,
            bundle.outbox.state,
            bundle.outbox.attempt,
            bundle.outbox.nextAttemptAt,
          );
        });
      },
      async receipt(sampleId) {
        return database.getFirstAsync<LocalReceipt>(
          `SELECT 'saved' AS status, s.id AS sampleId, s.event_id AS eventId,
                  a.id AS assetId, a.uri AS assetUri, a.sha256 AS assetSha256,
                  a.bytes AS assetBytes, s.payload_hash AS payloadHash, s.saved_at AS savedAt
             FROM local_samples s
             JOIN local_assets a ON a.sample_id = s.id
            WHERE s.id = ?`,
          sampleId,
        );
      },
      async assetUris() {
        const rows = await database.getAllAsync<{ uri: string }>('SELECT uri FROM local_assets');
        return rows.map((row) => row.uri);
      },
    },
    hashText: async (value) => String(await digestStringAsync(CryptoDigestAlgorithm.SHA256, value)),
    now: () => new Date().toISOString(),
  };

  const recovery = await recoverLocalStorage(dependencies);
  return {
    recovery,
    save: (input: LocalSaveInput) => saveConfirmedSample(input, dependencies),
    receipt: (sampleId: string) => dependencies.database.receipt(sampleId),
  };
}

function hex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
