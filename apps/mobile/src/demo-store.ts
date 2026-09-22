import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { openDatabaseAsync } from 'expo-sqlite';

import { nextSyncStep, type PhotoState, type SyncState } from './sync-state';

export type FixtureId = 'SYN-A' | 'SYN-B' | 'SYN-C' | 'SYN-D';

export type LocalRecord = {
  id: string;
  fixture_id: FixtureId;
  captured_at: string;
  image_uri: string;
  image_sha256: string;
  mime_type: 'image/jpeg' | 'image/png';
  metadata_state: SyncState;
  photo_state: PhotoState;
  last_error: string | null;
};

export type ServerRecord = {
  id: string;
  fixture_id: FixtureId;
  captured_at: string;
  metadata_state: 'SYNCED';
  photo_state: 'MISSING' | 'AVAILABLE';
  decision: 'ACCEPTED' | 'REFERRED' | null;
  decision_reason: string | null;
  version: number;
};

const dbPromise = openDatabaseAsync('jalsakshi-synthetic-demo.db').then(async (db) => {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY NOT NULL,
      fixture_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      image_sha256 TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      metadata_state TEXT NOT NULL,
      photo_state TEXT NOT NULL,
      last_error TEXT
    );
  `);
  return db;
});

export async function initializeStore() {
  await dbPromise;
}

export async function listLocalRecords() {
  const db = await dbPromise;
  return db.getAllAsync<LocalRecord>('SELECT * FROM records ORDER BY captured_at DESC');
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function saveImage(
  sourceUri: string,
  fixtureId: FixtureId,
  mimeType: 'image/jpeg' | 'image/png',
) {
  const id = randomUUID();
  const directory = new Directory(Paths.document, 'synthetic-demo-images');
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `${id}.${mimeType === 'image/png' ? 'png' : 'jpg'}`);
  await new File(sourceUri).copy(destination);
  const imageSha256 = hex(await digest(CryptoDigestAlgorithm.SHA256, await destination.bytes()));
  const capturedAt = new Date().toISOString();
  const db = await dbPromise;
  try {
    await db.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', NULL)`,
        id,
        fixtureId,
        capturedAt,
        destination.uri,
        imageSha256,
        mimeType,
      );
    });
  } catch (error) {
    destination.delete();
    throw error;
  }
  return id;
}

function apiRoot(value: string) {
  return value.trim().replace(/\/+$/, '');
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function syncPending(baseUrl: string) {
  const db = await dbPromise;
  const records = await listLocalRecords();
  for (const record of records) {
    let activeStep = nextSyncStep(record.metadata_state, record.photo_state);
    try {
      let metadataState = record.metadata_state;
      if (activeStep === 'METADATA') {
        const response = await fetch(`${apiRoot(baseUrl)}/demo/v1/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': record.id },
          body: JSON.stringify({
            id: record.id,
            fixture_id: record.fixture_id,
            captured_at: record.captured_at,
            client_build: 'android-synthetic-demo-1',
            image_sha256: record.image_sha256,
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        metadataState = 'SYNCED';
        await db.runAsync(
          "UPDATE records SET metadata_state = 'SYNCED', last_error = NULL WHERE id = ?",
          record.id,
        );
        activeStep = nextSyncStep(metadataState, record.photo_state);
      }
      if (activeStep === 'PHOTO') {
        const response = await fetch(`${apiRoot(baseUrl)}/demo/v1/records/${record.id}/photo`, {
          method: 'PUT',
          headers: {
            'Content-Type': record.mime_type,
            'X-Content-SHA256': record.image_sha256,
          },
          body: new File(record.image_uri),
        });
        if (!response.ok) throw new Error(await responseError(response));
        await db.runAsync(
          "UPDATE records SET photo_state = 'AVAILABLE', last_error = NULL WHERE id = ?",
          record.id,
        );
      }
    } catch (error) {
      await db.runAsync(
        `UPDATE records SET ${activeStep === 'METADATA' ? 'metadata_state' : 'photo_state'} = 'ERROR', last_error = ? WHERE id = ?`,
        String(error),
        record.id,
      );
    }
  }
}

export async function listServerRecords(baseUrl: string) {
  const response = await fetch(`${apiRoot(baseUrl)}/demo/v1/records?after=0&limit=100`);
  if (!response.ok) throw new Error(await responseError(response));
  return ((await response.json()) as { items: ServerRecord[] }).items.reverse();
}

export async function submitDecision(
  baseUrl: string,
  record: ServerRecord,
  decision: 'ACCEPTED' | 'REFERRED',
) {
  const response = await fetch(`${apiRoot(baseUrl)}/demo/v1/records/${record.id}/decisions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Demo-Role': 'supervisor',
    },
    body: JSON.stringify({
      expected_version: record.version,
      decision,
      reason: decision === 'ACCEPTED' ? 'Synthetic fixture visible' : 'Repeat synthetic capture',
    }),
  });
  if (!response.ok) throw new Error(await responseError(response));
}
