import { createPendingOutboxEvent, type PendingOutboxEvent } from './outbox.ts';
import type { ApiOutcome } from './api';
import type { CachedSource } from './sourceCatalog';

export type LocalSamplePayload = {
  schema_version: number;
  sample_id: string;
  captured_at_device: string;
  [key: string]: unknown;
};

export type LocalSaveInput = {
  /** Signed-in account subject. Records sync only under the account that made them. */
  owner: string;
  eventId: string;
  /**
   * The photo, or all three null for a manual reading without capture
   * (protocol `allow_manual_without_capture`; T11's camera-denied path).
   */
  assetId: string | null;
  sourceUri: string | null;
  mediaType: 'image/jpeg' | 'image/png' | null;
  sample: LocalSamplePayload;
};

export type LocalSaveBundle = {
  sample: {
    id: string;
    owner: string;
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
    mediaType: 'image/jpeg' | 'image/png';
    bytes: number;
  } | null;
  outbox: PendingOutboxEvent;
};

export type LocalReceipt = {
  status: 'saved';
  sampleId: string;
  owner: string;
  eventId: string;
  assetId: string | null;
  assetUri: string | null;
  assetSha256: string | null;
  assetBytes: number | null;
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

/**
 * T12 tables, shared by both database handles (this async one and the
 * synchronous `deviceSql`) so the two can never drift. `owner` scopes a record
 * to the account that saved it: on a shared phone, another account must not
 * push it under its own identity (found in T15).
 */
export const LOCAL_SAVE_DDL = `
  CREATE TABLE IF NOT EXISTS local_samples (
    id TEXT PRIMARY KEY NOT NULL,
    owner TEXT NOT NULL,
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
`;

/** T12's atomic save, as statements. One source for the device and the tests. */
export function bundleStatements(bundle: LocalSaveBundle): Array<[string, Array<string | number | null>]> {
  const statements: Array<[string, Array<string | number | null>]> = [
    [
      'INSERT INTO local_samples (id, owner, event_id, payload_json, payload_hash, captured_at, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [bundle.sample.id, bundle.sample.owner, bundle.sample.eventId, bundle.sample.payloadJson,
        bundle.sample.payloadHash, bundle.sample.capturedAt, bundle.sample.savedAt],
    ],
    [
      'INSERT INTO outbox (event_id, sample_id, payload_json, payload_hash, state, attempt, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [bundle.outbox.eventId, bundle.outbox.sampleId, bundle.outbox.payloadJson, bundle.outbox.payloadHash,
        bundle.outbox.state, bundle.outbox.attempt, bundle.outbox.nextAttemptAt],
    ],
  ];
  if (bundle.asset) {
    statements.splice(1, 0, [
      'INSERT INTO local_assets (id, sample_id, uri, sha256, media_type, bytes) VALUES (?, ?, ?, ?, ?, ?)',
      [bundle.asset.id, bundle.asset.sampleId, bundle.asset.uri, bundle.asset.sha256, bundle.asset.mediaType, bundle.asset.bytes],
    ]);
  }
  return statements;
}

/** The durable local receipt. Independent of the outbox, so acknowledging a push cannot erase it. */
export const RECEIPT_SQL = `SELECT 'saved' AS status, s.id AS sampleId, s.owner AS owner, s.event_id AS eventId,
        a.id AS assetId, a.uri AS assetUri, a.sha256 AS assetSha256,
        a.bytes AS assetBytes, s.payload_hash AS payloadHash, s.saved_at AS savedAt
   FROM local_samples s
   LEFT JOIN local_assets a ON a.sample_id = s.id
  WHERE s.id = ?`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNED_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:tmp|asset)$/i;
const SHA256 = /^[a-f0-9]{64}$/;

function validate(input: LocalSaveInput) {
  if (!UUID.test(input.sample.sample_id)) throw new Error('Sample ID must be a UUID');
  if (!UUID.test(input.eventId)) throw new Error('Event ID must be a UUID');
  if (!input.owner.trim()) throw new Error('Owner is required');
  const photoFields = [input.assetId, input.sourceUri, input.mediaType].filter((v) => v !== null).length;
  if (photoFields !== 0 && photoFields !== 3) throw new Error('A photo needs its asset ID, source URI and media type');
  if (photoFields === 3) {
    if (!UUID.test(input.assetId!)) throw new Error('Asset ID must be a UUID');
    if (!input.sourceUri!.trim()) throw new Error('Source asset URI is required');
    if (input.mediaType !== 'image/jpeg' && input.mediaType !== 'image/png') {
      throw new Error('Asset media type is unsupported');
    }
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
    owner: bundle.sample.owner,
    eventId: bundle.outbox.eventId,
    assetId: bundle.asset?.id ?? null,
    assetUri: bundle.asset?.uri ?? null,
    assetSha256: bundle.asset?.sha256 ?? null,
    assetBytes: bundle.asset?.bytes ?? null,
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
    if (prior.eventId !== input.eventId || prior.assetId !== input.assetId || prior.owner !== input.owner) {
      throw new Error('Sample ID is already associated with another save');
    }
    if (prior.payloadHash !== outbox.payloadHash) {
      throw new Error('Sample ID is already associated with a different payload');
    }
    if (prior.assetUri && !(await dependencies.files.exists(prior.assetUri))) {
      throw new Error('Saved sample asset is missing');
    }
    return prior;
  }

  let asset: LocalSaveBundle['asset'] = null;
  if (input.assetId && input.sourceUri && input.mediaType) {
    const staged = await dependencies.files.stage(input.sourceUri, `${input.assetId}.tmp`);
    if (!SHA256.test(staged.sha256) || staged.bytes < 1) throw new Error('Staged asset is invalid');
    const finalUri = await dependencies.files.move(staged.uri, `${input.assetId}.asset`);
    asset = {
      id: input.assetId,
      sampleId: input.sample.sample_id,
      uri: finalUri,
      sha256: staged.sha256,
      mediaType: input.mediaType,
      bytes: staged.bytes,
    };
  }
  const bundle: LocalSaveBundle = {
    sample: {
      id: input.sample.sample_id,
      owner: input.owner,
      eventId: input.eventId,
      payloadJson: outbox.payloadJson,
      payloadHash: outbox.payloadHash,
      capturedAt: input.sample.captured_at_device,
      savedAt: dependencies.now(),
    },
    asset,
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

/**
 * `sql` is the app's one database connection (`deviceSql()`, already migrated).
 * Saving through a second connection to the same file would contend with sync
 * for the write lock at exactly the moment a save must not fail.
 */
export async function openLocalStorage(sql: Sql) {
  const [{ CryptoDigestAlgorithm, digest, digestStringAsync }, { Directory, File, Paths }] =
    await Promise.all([import('expo-crypto'), import('expo-file-system')]);

  const directory = new Directory(Paths.document, 'jalsakshi-assets');
  directory.create({ idempotent: true, intermediates: true });

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
        sql.tx(() => {
          for (const [statement, params] of bundleStatements(bundle)) sql.run(statement, params);
        });
      },
      async receipt(sampleId) {
        return sql.all<LocalReceipt>(RECEIPT_SQL, [sampleId])[0] ?? null;
      },
      async assetUris() {
        return sql.all<{ uri: string }>('SELECT uri FROM local_assets').map((row) => row.uri);
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


/**
 * On-device database.
 *
 * Written against the tiny synchronous `Sql` interface below, so the same code
 * runs on expo-sqlite on the phone (`deviceDb.ts`) and on `node:sqlite` in the
 * tests (`tests/sqlNode.ts`). Nothing here imports a platform module.
 *
 * T07 owns the catalogue cache. T12 adds samples/outbox to this same database.
 *
 * Only `import type` from sibling modules: Node's type stripping cannot
 * resolve the extensionless imports Metro requires, and type imports are
 * erased.
 */


export type Bind = string | number | null;

export interface Sql {
  exec(sql: string): void;
  run(sql: string, params?: readonly Bind[]): void;
  all<T>(sql: string, params?: readonly Bind[]): T[];
  /** Runs `fn` in one transaction; rolls back and rethrows on error. */
  tx(fn: () => void): void;
}

export function migrate(sql: Sql): void {
  // WAL + FULL: a commit that returned is on disk, even across a power cut.
  sql.exec('PRAGMA journal_mode = WAL');
  sql.exec('PRAGMA synchronous = FULL');
  sql.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS source_cache (
    id TEXT PRIMARY KEY NOT NULL,
    qr_code TEXT NOT NULL,
    label TEXT NOT NULL,
    locality TEXT NOT NULL,
    latitude REAL,
    longitude REAL
  )`);
  sql.exec('PRAGMA foreign_keys = ON');
  sql.exec(LOCAL_SAVE_DDL);
  // T15. What the server said about each pushed event. Kept after the outbox
  // row is removed, so "accepted" and "needs attention" stay visible.
  sql.exec(`CREATE TABLE IF NOT EXISTS sync_receipts (
    event_id TEXT PRIMARY KEY NOT NULL,
    sample_id TEXT NOT NULL REFERENCES local_samples(id),
    status TEXT NOT NULL CHECK (status IN ('accepted', 'duplicate', 'rejected', 'conflict')),
    code TEXT,
    detail TEXT,
    server_time TEXT NOT NULL
  )`);
  // T15. Records the server confirmed through the ordered pull (T14).
  sql.exec(`CREATE TABLE IF NOT EXISTS server_samples (
    owner TEXT NOT NULL,
    id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    status TEXT NOT NULL,
    received_at_server TEXT NOT NULL,
    PRIMARY KEY (owner, id)
  )`);
}

export function getMeta(sql: Sql, key: string): string | null {
  return sql.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])[0]?.value ?? null;
}

export function setMeta(sql: Sql, key: string, value: string): void {
  sql.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export interface Catalogue {
  items: CachedSource[];
  /** Server clock when fetched; labels staleness (T07). Null = never fetched. */
  servedAt: string | null;
}

/**
 * Replace the cached catalogue atomically and record whose it is.
 *
 * `owner` is the signed-in account's subject. The server scopes the catalogue
 * to that account's tenant, so on a shared phone the cache belongs to one
 * account only; see `loadCatalogue`.
 */
export function replaceCatalogue(sql: Sql, owner: string, items: readonly CachedSource[], servedAt: string): void {
  sql.tx(() => writeCatalogue(sql, owner, items, servedAt));
}

/** `replaceCatalogue` without its own transaction, for callers already in one. */
export function writeCatalogue(sql: Sql, owner: string, items: readonly CachedSource[], servedAt: string): void {
  sql.run('DELETE FROM source_cache');
  for (const s of items) {
    sql.run(
      'INSERT INTO source_cache (id, qr_code, label, locality, latitude, longitude) VALUES (?,?,?,?,?,?)',
      [s.id, s.qrCode, s.label, s.locality, s.latitude, s.longitude],
    );
  }
  setMeta(sql, 'catalogue_owner', owner);
  setMeta(sql, 'catalogue_served_at', servedAt);
}

/** The cached catalogue, or an empty one if it belongs to another account. */
export function loadCatalogue(sql: Sql, owner: string): Catalogue {
  if (getMeta(sql, 'catalogue_owner') !== owner) return { items: [], servedAt: null };
  const rows = sql.all<{
    id: string; qr_code: string; label: string; locality: string;
    latitude: number | null; longitude: number | null;
  }>('SELECT * FROM source_cache ORDER BY label, id');
  return {
    items: rows.map((r) => ({
      id: r.id, qrCode: r.qr_code, label: r.label, locality: r.locality,
      latitude: r.latitude, longitude: r.longitude,
    })),
    servedAt: getMeta(sql, 'catalogue_served_at'),
  };
}

export interface CatalogueView extends Catalogue {
  origin: 'network' | 'cache';
  /** Why the network copy was not used. `auth_required` means sign in again. */
  problem: 'offline' | 'auth_required' | 'server_error' | null;
}

/**
 * Combine a catalogue fetch with the cache.
 *
 * Success replaces the cache. Any failure keeps the cached copy on screen and
 * says why; a failed refresh never empties a worker's list in the field.
 */
export function applyCatalogueFetch(
  sql: Sql,
  owner: string,
  outcome: ApiOutcome<{ items: CachedSource[]; servedAt: string }>,
): CatalogueView {
  if (outcome.kind === 'ok') {
    replaceCatalogue(sql, owner, outcome.value.items, outcome.value.servedAt);
    return { ...loadCatalogue(sql, owner), origin: 'network', problem: null };
  }
  const problem = outcome.kind === 'failed' ? 'server_error' : outcome.kind;
  return { ...loadCatalogue(sql, owner), origin: 'cache', problem };
}
