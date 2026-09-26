import pg from 'pg'
export async function database() {
  if (!process.env.JALSAKSHI_DATABASE_URL) throw new Error('Missing JALSAKSHI_DATABASE_URL')
  const response = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('Could not load the Supabase database CA certificate')
  const url = new URL(process.env.JALSAKSHI_DATABASE_URL)
  url.searchParams.delete('sslmode')
  const client = new pg.Client({ connectionString: url.toString(), ssl: { ca: await response.text(), rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
  await client.connect()
  // These scripts build the old v1 supervisor tables. JalSakshi now runs the v2
  // schema (services/api/sql/public_v2), where the dashboard reads through the
  // API instead; running them there would collide with live tables.
  if ((await client.query("select to_regclass('public.residents') as v2")).rows[0].v2) {
    await client.end()
    throw new Error('This database runs the JalSakshi v2 schema; the v1 supervisor migrations and fixtures must not run against it.')
  }
  return client
}
