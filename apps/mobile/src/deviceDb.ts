/** `Sql` (storage.ts) over expo-sqlite's synchronous API, on the device. */

import { openDatabaseSync } from 'expo-sqlite';

import { migrate, type Sql } from './storage';

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
