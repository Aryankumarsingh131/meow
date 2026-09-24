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

import type { ApiOutcome } from './api';
import type { CachedSource } from './sourceCatalog';

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
}

function getMeta(sql: Sql, key: string): string | null {
  return sql.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])[0]?.value ?? null;
}

function setMeta(sql: Sql, key: string, value: string): void {
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
  sql.tx(() => {
    sql.run('DELETE FROM source_cache');
    for (const s of items) {
      sql.run(
        'INSERT INTO source_cache (id, qr_code, label, locality, latitude, longitude) VALUES (?,?,?,?,?,?)',
        [s.id, s.qrCode, s.label, s.locality, s.latitude, s.longitude],
      );
    }
    setMeta(sql, 'catalogue_owner', owner);
    setMeta(sql, 'catalogue_served_at', servedAt);
  });
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
