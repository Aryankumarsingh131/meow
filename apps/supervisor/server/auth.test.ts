import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createAuthHandler } from './auth.ts'
import { readConfig } from './config.ts'

// The dashboard's only upstream is the JalSakshi API (mocked here).
const config = readConfig({ JALSAKSHI_API_URL: 'http://127.0.0.1:8000' })
const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }))

type Provider = typeof fetch
function provider(state: { loginStatus?: number; meStatus?: number; role?: string; down?: boolean; calls?: string[] } = {}): Provider {
  return (url, options) => {
    const path = String(url).replace(config.apiUrl, '')
    state.calls?.push(path)
    if (state.down) return Promise.reject(new Error('connect ECONNREFUSED internal-diagnostic-detail'))
    if (path === '/v1/auth/login') {
      if (state.loginStatus) return json({ detail: 'Email or password is incorrect.', internal: 'upstream-secret' }, state.loginStatus)
      return json({ token: 'private-access-token', role: state.role ?? 'supervisor', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    }
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer private-access-token')
    if (path === '/v1/staff/me') return state.meStatus ? json({ detail: 'x' }, state.meStatus) : json({ profile_id: 'p1', role: state.role ?? 'supervisor', team_id: 't1' })
    if (path === '/v1/staff/sources') return json({ items: [{ source_id: 's1', name: 'Pump', village: 'East Plains', source_type: 'hand_pump' }] })
    throw new Error(`Unexpected upstream path ${path}`)
  }
}

async function serve(request: Provider, run: (base: string) => Promise<void>) {
  const handler = createAuthHandler(config, request)
  const http = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end() }))
  http.listen(0, '127.0.0.1'); await once(http, 'listening')
  const address = http.address(); assert(address && typeof address === 'object')
  try { await run(`http://127.0.0.1:${address.port}`) } finally { http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())) }
}
const login = (base: string, body: object = { email: '2@demo.org', password: '1234' }, headers: Record<string, string> = {}) =>
  fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('configuration rejects a non-local plain-HTTP API and unsupported modes', () => {
  assert.throws(() => readConfig({ JALSAKSHI_API_URL: 'http://example.org' }), /HTTPS/)
  assert.throws(() => readConfig({ JALSAKSHI_API_URL: '[not a url](http://x)' }), /plain URL/)
  assert.throws(() => readConfig({ JALSAKSHI_TENANT_DATA_MODE: 'real' }), /synthetic or live/)
  assert.throws(() => readConfig({ JALSAKSHI_ENVIRONMENT: 'production' }), /SESSION_SECRET/)
  assert.equal(readConfig({ JALSAKSHI_API_URL: 'https://x.ngrok-free.dev/' }).apiUrl, 'https://x.ngrok-free.dev')
  assert.equal(readConfig({}).apiUrl, 'http://127.0.0.1:8000')
})

test('API login, opaque cookie, and logout invalidation', () => serve(provider(), async base => {
  const response = await login(base)
  assert.equal(response.status, 200)
  const profile = await response.json() as { team_name: string; role: string }
  assert.deepEqual([profile.role, profile.team_name], ['supervisor', 'East Plains team'])
  const cookie = response.headers.get('set-cookie')!
  assert.match(cookie, /HttpOnly; SameSite=Strict/)
  assert(!cookie.includes('private-access-token'), 'the API token must be sealed, not readable')
  const session = cookie.split(';')[0]
  assert.equal((await fetch(base + '/api/auth/session', { headers: { Cookie: session } })).status, 200)
  const out = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: base, Cookie: session } })
  assert.match(out.headers.get('set-cookie')!, /Max-Age=0/)
  assert.equal((await fetch(base + '/api/auth/session')).status, 401)
}))

test('bad credentials are denied, 1234 is no longer a demo bypass, and retries are not locked out', () => serve(provider({ loginStatus: 401 }), async base => {
  const denied = await login(base)
  assert.equal(denied.status, 401)
  assert(!(await denied.text()).includes('upstream-secret'))
  for (let i = 0; i < 12; i++) assert.equal((await login(base)).status, 401)
}))

test('cross-origin and oversized requests do not reach the API', async () => {
  const calls: string[] = []
  await serve(provider({ calls }), async base => {
    assert.equal((await login(base, undefined, { Origin: 'https://evil.example' })).status, 403)
    assert.equal((await login(base, { email: 'x'.repeat(5000), password: 'p' })).status, 413)
  })
  assert.deepEqual(calls, [])
})

test('API outage fails closed and does not leak upstream diagnostics', () => serve(provider({ down: true }), async base => {
  const response = await login(base)
  assert.equal(response.status, 503)
  assert(!(await response.text()).includes('internal-diagnostic-detail'))
}))

test('revoked API credentials invalidate the local session', async () => {
  const state: { meStatus?: number } = {}
  await serve(provider(state), async base => {
    const session = (await login(base)).headers.get('set-cookie')!.split(';')[0]
    state.meStatus = 401
    const response = await fetch(base + '/api/auth/session', { headers: { Cookie: session } })
    assert.equal(response.status, 401)
    assert.match(response.headers.get('set-cookie')!, /Max-Age=0/)
  })
})

test('the explicit demo account still opens the read-only synthetic workspace', () => serve(provider({ down: true }), async base => {
  const response = await login(base, { email: 'demo.supervisor@jalsakshi.local', password: 'anything' })
  assert.equal(response.status, 200)
  assert.equal((await response.json() as { team_name: string }).team_name, 'Riverside Demo District')
}))
