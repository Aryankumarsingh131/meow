import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { database } from './database.ts'
const db = await database()
const check = process.argv.includes('--check')
try {
  await db.query('begin')
  await db.query("select pg_advisory_xact_lock(hashtext('jalsakshi-supervisor-migrations'))")
  await db.query('create schema if not exists supervisor_private')
  await db.query('create table if not exists supervisor_private.schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())')
  const applied = new Map((await db.query('select name,checksum from supervisor_private.schema_migrations')).rows.map(r => [r.name, r.checksum]))
  let count = 0
  for (const name of readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    if (applied.has(name)) {
      if (applied.get(name) !== checksum) throw new Error(`Applied migration changed: ${name}`)
      continue
    }
    await db.query(sql.replace(/^\s*begin;\s*/i, '').replace(/commit;\s*$/i, ''))
    await db.query('insert into supervisor_private.schema_migrations(name,checksum) values($1,$2)', [name,checksum])
    count++
  }
  await db.query(check ? 'rollback' : 'commit')
  console.log(`${count} pending migration(s) ${check ? 'validated and rolled back' : 'applied'}; existing checksums verified.`)
} catch (error) {
  await db.query('rollback')
  console.error(error instanceof Error ? error.message : 'Migration failed')
  process.exitCode = 1
} finally { await db.end() }
