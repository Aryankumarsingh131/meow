import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createAuthHandler } from './auth.ts'
import { readConfig } from './config.ts'

const config = readConfig({ JALSAKSHI_API_URL: 'http://127.0.0.1:8000' })
const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }))
const REPORT = '11111111-1111-4111-8111-111111111111'
const COMPLAINT = '22222222-2222-4222-8222-222222222222'
const REFERRAL = '33333333-3333-4333-8333-333333333333'

async function server(run: (base: string, state: { role: string; posts: Array<[string, unknown]> }) => Promise<void>) {
  const state = { role: 'supervisor', posts: [] as Array<[string, unknown]>, noBatch: false, singleDetailCalls: 0 }
  const provider: typeof fetch = (url, options) => {
    const path = String(url).replace(config.apiUrl, '')
    if (path === '/v1/auth/login') return json({ token: 'private-access-token', role: state.role, expires_at: Math.floor(Date.now() / 1000) + 3600 })
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer private-access-token')
    if (options?.method === 'POST') {
      state.posts.push([path, JSON.parse(String(options.body))])
      if (path.endsWith('/lab-referrals')) return json({ lab_referral_id: REFERRAL })
      if (path.endsWith('/transition')) return json({ version: 4 })
      return json({ ok: true })
    }
    if (path === '/v1/staff/me') return state.role === 'supervisor' ? json({ profile_id: 'p1', role: 'supervisor', team_id: 't1' }) : json({ detail: 'Supervisors only.' }, 403)
    if (path === '/v1/staff/sources') return json({ items: [{ source_id: 's1', name: '=HYPERLINK("evil")', village: 'East Plains', ward: 'Ward 2', source_type: 'hand_pump' }] })
    if (path === '/v1/staff/reports') return json({ items: [{ report_id: REPORT, source_id: 's1', source_name: 'Pump', test_record_id: 'tr1', risk_level: 'high', status: 'open', version: 3, is_re_report: false, previous_report_id: null, created_at: '2026-09-25T10:00:00Z', closed_at: null, closure_reason: null, origin: 'screening' }] })
    const detail = { report_id: REPORT, status: 'open', version: 3, test: { computed_risk_level: 'high', readings: { tds: 2500 }, rule_assessment: { risk_level: 'high', findings: [{ parameter: 'tds', level: 'high' }] }, photo: 'blob:b1', performed_by: 'w1', read_at: '2026-09-25T09:59:00Z' }, lab_referrals: [{ lab_referral_id: REFERRAL, lab_name: 'District Lab', verification_status: 'uploaded', re_report_requested: false, result_file: 'blob:b2', verified_by: null, verified_at: null, sent_at: '2026-09-25T11:00:00Z' }], photos: [], linked_complaints: [], re_report: null }
    if (path === '/v1/staff/reports/details') return state.noBatch ? json({ detail: 'Not found.' }, 404) : json({ items: [detail] })
    if (path === `/v1/staff/reports/${REPORT}`) { state.singleDetailCalls++; return json(detail) }
    if (path === '/v1/staff/complaints') return json({ items: [{ complaint_id: COMPLAINT, reference_number: 'JS-ABC', complaint_type: 'smell', status: 'new', resolution: null, source_id: 's1', source_name: 'Pump', description: 'PRIVATE OBSERVATION', photo: null, linked_report_id: null, submitted_at: '2026-09-25T09:00:00Z', linked_at: null, version: 1 }] })
    if (path === '/v1/staff/team') return json({ items: [{ profile_id: 'p1', email: 'sup@example.org', full_name: 'Sup', role: 'supervisor', active: true, points_balance: 0, tests: 0, reports_raised: 0, on_time_screenings: 0 },
      { profile_id: 'w1', email: 'w@example.org', full_name: 'Worker One', role: 'field_worker', active: true, points_balance: 30, tests: 4, reports_raised: 1, on_time_screenings: 3 }] })
    if (path === '/v1/staff/kits') return json({ items: [{ kit_id: 'k1', name: 'Chlorine Strip', strip_type: 'chlorine', wait_seconds: 30, parameters: [{ label: 'Free chlorine', unit: 'mg/L' }] }] })
    throw new Error(`Unexpected upstream path ${path}`)
  }
  const handler = createAuthHandler(config, provider)
  const http = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end() }))
  http.listen(0, '127.0.0.1'); await once(http, 'listening'); const address = http.address(); assert(address && typeof address === 'object')
  try { await run(`http://127.0.0.1:${address.port}`, state) } finally { http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve())) }
}
const login = (base: string) => fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: '2@demo.org', password: '1234' }) })
const cookieOf = async (base: string) => (await login(base)).headers.get('set-cookie')!.split(';')[0]
const post = (base: string, cookie: string, path: string, body: unknown) => fetch(base + '/api/supervisor/' + path, { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('workers cannot obtain a supervisor session', () => server(async (base, state) => {
  state.role = 'field_worker'
  const response = await login(base)
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('set-cookie'), null)
}))

test('role changes invalidate access on the next authenticated request', () => server(async (base, state) => {
  const cookie = await cookieOf(base)
  assert.equal((await fetch(base + '/api/supervisor/workspace', { headers: { Cookie: cookie } })).status, 200)
  state.role = 'field_worker'
  assert.equal((await fetch(base + '/api/supervisor/workspace', { headers: { Cookie: cookie } })).status, 403)
}))

test('the workspace maps v2 reports, tests, labs and resident complaints into the board shape', () => server(async base => {
  const ws = await (await fetch(base + '/api/supervisor/workspace', { headers: { Cookie: await cookieOf(base) } })).json() as Record<string, any>
  assert.deepEqual(ws.cases.map((c: any) => [c.id, c.status, c.priority, c.version, c.origin]), [[REPORT, 'under_review', 'critical', 3, 'screening']])
  assert.equal(ws.screening_records[0].human_observation, 'tds: 2500')
  assert.match(ws.screening_records[0].machine_suggestion, /Rule-based screening bands: high/)
  assert.deepEqual([ws.lab_reports[0].id, ws.lab_reports[0].verification_status], [REFERRAL, 'uploaded'])
  assert.deepEqual([ws.ivr_complaints[0].id, ws.ivr_complaints[0].status, ws.ivr_complaints[0].case_id], [COMPLAINT, 'new', null])
  assert.equal(ws.water_sources[0].locality, 'East Plains · Ward 2')
  assert.equal(ws.profile.team_name, 'East Plains team')
}))

test('report details come from one batch call; without the batch route (internal DB) they are fetched per report', () => server(async (base, state) => {
  const cookie = await cookieOf(base)
  const load = async () => (await (await fetch(base + '/api/supervisor/workspace', { headers: { Cookie: cookie } })).json() as Record<string, any>).lab_reports
  assert.equal((await load())[0].id, REFERRAL)
  assert.equal(state.singleDetailCalls, 0)
  state.noBatch = true
  assert.equal((await load())[0].id, REFERRAL)
  assert.equal(state.singleDetailCalls, 1)
}))

test('export uses only aggregate counts: no private values or spreadsheet formulas', () => server(async base => {
  const response = await fetch(base + '/api/supervisor/export', { headers: { Cookie: await cookieOf(base) } })
  const csv = await response.text()
  assert.match(csv, /total_cases,1/)
  for (const leak of ['PRIVATE', 'HYPERLINK', REPORT, 's1']) assert(!csv.includes(leak), leak)
}))

test('plain case PATCH is rejected even with a valid supervisor session', () => server(async base => {
  const cookie = await cookieOf(base)
  const response = await fetch(base + '/api/supervisor/cases?id=eq.' + REPORT, { method: 'PATCH', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"status":"closed"}' })
  assert.equal(response.status, 405)
}))

test('supervisor actions become guarded API calls, with the case version', () => server(async (base, state) => {
  const cookie = await cookieOf(base)
  assert.equal((await post(base, cookie, 'rpc/link_ivr_complaint_to_case', { p_complaint_id: COMPLAINT, p_case_id: REPORT, p_expected_version: 3 })).status, 200)
  assert.equal((await post(base, cookie, 'rpc/verify_lab_report', { p_report_id: REFERRAL, p_expected_version: 3 })).status, 200)
  assert.equal((await post(base, cookie, 'rpc/close_case', { p_case_id: REPORT, p_expected_version: 3, p_reason: 'Lab verified and pump repaired.' })).status, 200)
  assert.equal((await post(base, cookie, 'rpc/close_case', { p_case_id: REPORT, p_expected_version: 2, p_reason: 'stale' })).status, 409)
  assert.equal((await post(base, cookie, 'retests', { case_id: REPORT, expected_case_version: 3 })).status, 200)
  assert.equal((await post(base, cookie, 'notes', { case_id: REPORT, text: 'Called the ward office.' })).status, 200)
  assert.equal((await post(base, cookie, 'resident_communications', { case_id: REPORT, channel: 'email', message_summary: 'x', delivery_status: 'sent' })).status, 422)
  assert.deepEqual(state.posts, [
    [`/v1/staff/complaints/${COMPLAINT}/review`, { action: 'link', report_id: REPORT, version: 3 }],
    [`/v1/staff/lab-referrals/${REFERRAL}/verify`, { decision: 'verified' }],
    [`/v1/staff/reports/${REPORT}/transition`, { to: 'action_taken', version: 3 }],
    [`/v1/staff/reports/${REPORT}/close`, { version: 4, closure_reason: 'Lab verified and pump repaired.' }],
    [`/v1/staff/reports/${REPORT}/re-report`, { version: 3 }],
    [`/v1/staff/reports/${REPORT}/notes`, { text: 'Called the ward office.' }],
  ])
}))

test('metrics, test-kits, team, and leaderboards endpoints return valid JSON responses', () => server(async base => {
  const cookie = await cookieOf(base)
  const metrics = await (await fetch(base + '/api/supervisor/metrics', { headers: { Cookie: cookie } })).json() as { cases_open: number; tests_done: number }
  assert.deepEqual([metrics.cases_open, metrics.tests_done], [1, 1])
  const kits = await (await fetch(base + '/api/supervisor/test-kits', { headers: { Cookie: cookie } })).json() as { test_kits: Array<{ name: string }> }
  assert.deepEqual(kits.test_kits.map(k => k.name), ['Chlorine Strip'])
  const team = await (await fetch(base + '/api/supervisor/team', { headers: { Cookie: cookie } })).json() as { members: unknown[] }
  assert.equal(team.members.length, 2)
  const lb = await (await fetch(base + '/api/supervisor/leaderboards/field-workers', { headers: { Cookie: cookie } })).json() as { disclaimer: string; field_workers: Array<{ name: string; points: number }>; locations: Array<{ locality: string }> }
  assert.match(lb.disclaimer, /not a water-quality signal/)
  assert.deepEqual(lb.field_workers.map(w => [w.name, w.points]), [['Worker One', 30]])
  assert.deepEqual(lb.locations.map(l => l.locality), ['East Plains'])
}))

test('toCsv quotes separators and neutralises spreadsheet formulas', async () => {
  const { toCsv } = await import('./supervisor.ts')
  const csv = toCsv([{ a: 'x,y', b: 'say "hi"' }, { a: '=HYPERLINK("evil")', c: { k: 1 }, b: null }], ['c'])
  assert.equal(csv, 'c,a,b\r\n,"x,y","say ""hi"""\r\n"{""k"":1}","\'=HYPERLINK(""evil"")",')
})
