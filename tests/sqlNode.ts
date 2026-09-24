/**
 * `Sql` (apps/mobile/src/storage.ts) over Node's built-in `node:sqlite`, so
 * the phone's storage code runs unmodified in tests against a real SQLite.
 */

import { DatabaseSync } from 'node:sqlite';

import type { Bind, Sql } from '../apps/mobile/src/storage.ts';

export function nodeSql(path = ':memory:'): Sql & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params = []) => void db.prepare(sql).run(...(params as Bind[])),
    all: <T>(sql: string, params: readonly Bind[] = []) => db.prepare(sql).all(...(params as Bind[])) as T[],
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
}
