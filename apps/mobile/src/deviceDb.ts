/** `Sql` (storage.ts) over expo-sqlite's synchronous API, on the device. */

import { randomUUID } from 'expo-crypto';
import { openDatabaseSync } from 'expo-sqlite';

import { getMeta, migrate, setMeta, type Sql } from './storage';

let instance: Sql | null = null;

export function deviceSql(): Sql {
  if (instance) return instance;
  const db = openDatabaseSync('jalsakshi.db');
  const sql: Sql = {
    exec: (s) => db.execSync(s),
    run: (s, params = []) => void db.runSync(s, [...params]),
    all: <T,>(s: string, params: readonly (string | number | null)[] = []) => db.getAllSync<T>(s, [...params]),
    tx: (fn) => db.withTransactionSync(fn),
  };
  migrate(sql);
  instance = sql;
  return sql;
}

/** Stable per-install id, sent with pushes and grant requests. */
export function deviceId(): string {
  const sql = deviceSql();
  let id = getMeta(sql, 'device_id');
  if (!id) {
    id = randomUUID();
    setMeta(sql, 'device_id', id);
  }
  return id;
}
