import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthConfig } from './config.ts'

export interface Principal { id: string; email: string; role: 'supervisor'; team_id: string; team_name: string; dataMode: string }
export class AccessError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }

export const DEMO_PROFILE: Principal = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'demo.supervisor@jalsakshi.local',
  role: 'supervisor',
  team_id: '00000000-0000-0000-0000-000000000002',
  team_name: 'Riverside Demo District',
  dataMode: 'synthetic',
}

const SYNTHETIC_DATA = {
  water_sources: [
    { id: 'src-1', team_id: DEMO_PROFILE.team_id, name: 'Patel Nagar Hand Pump', locality: 'Kalyanpur · Ward 4', version: 1 },
    { id: 'src-2', team_id: DEMO_PROFILE.team_id, name: 'Shanti Nagar Borewell', locality: 'Near primary health centre', version: 1 },
    { id: 'src-3', team_id: DEMO_PROFILE.team_id, name: 'Govt Primary School Tube Well', locality: 'Sector 4', version: 1 },
  ],
  cases: [
    { id: 'c1010000-0000-0000-0000-000000000001', team_id: DEMO_PROFILE.team_id, source_id: 'src-1', screening_id: 'scr-1', origin: 'screening', status: 'under_review', priority: 'urgent', created_at: new Date(Date.now() - 7200000).toISOString(), version: 1, closed_at: null, closure_reason: null },
    { id: 'c1020000-0000-0000-0000-000000000002', team_id: DEMO_PROFILE.team_id, source_id: 'src-2', screening_id: 'scr-2', origin: 'screening', status: 'under_review', priority: 'critical', created_at: new Date(Date.now() - 50400000).toISOString(), version: 1, closed_at: null, closure_reason: null },
    { id: 'c1030000-0000-0000-0000-000000000003', team_id: DEMO_PROFILE.team_id, source_id: 'src-3', screening_id: 'scr-3', origin: 'screening', status: 'closed', priority: 'normal', created_at: new Date(Date.now() - 172800000).toISOString(), version: 1, closed_at: new Date(Date.now() - 86400000).toISOString(), closure_reason: 'Verified lab report' },
  ],
  screening_records: [
    { id: 'scr-1', source_id: 'src-1', sample_code: 'DEMO-SAMPLE-1', machine_suggestion: 'Low residual chlorine', human_observation: 'Cracked drainage apron.', screening_flag: 'flagged', captured_at: new Date(Date.now() - 7200000).toISOString(), created_by: 'worker-1', capture_name: null },
    { id: 'scr-2', source_id: 'src-2', sample_code: 'DEMO-SAMPLE-2', machine_suggestion: 'Image confidence low', human_observation: 'Unusual odour.', screening_flag: 'uncertain', captured_at: new Date(Date.now() - 50400000).toISOString(), created_by: 'worker-1', capture_name: null },
  ],
  lab_reports: [],
  case_actions: [],
  retests: [],
  resident_communications: [],
  ivr_complaints: [
    { id: 'ivr-1', source_id: 'src-1', case_id: null, summary: 'Caller reported intermittent odour near hand pump.', status: 'new', received_at: new Date().toISOString(), version: 1 },
  ],
  audit_log: [],
}


// --- JalSakshi API adapter ---------------------------------------------------------
// The dashboard's data lives in the JalSakshi v2 schema behind the FastAPI
// (services/api). Every read and write goes through its /v1/staff routes with
// the signed-in supervisor's token, so the API's role/team checks, report
// versions, lab-verification and closure rules all still apply. Rows are
// mapped into the workspace shape this UI was built for: cases = reports,
// screening_records = test records, lab_reports = lab referrals,
// case_actions = process photos, retests = lab re-reports,
// ivr_complaints = resident complaints.

type Json = Record<string, any>
interface ApiReport { report_id: string; source_id: string; source_name: string; test_record_id: string | null; risk_level: string; status: string; version: number; is_re_report: boolean; previous_report_id: string | null; created_at: string; closed_at: string | null; closure_reason: string | null; origin: 'screening' | 'resident' }

export function apiClient(config: AuthConfig, accessToken: string, request = fetch) {
  return async (path: string, options: { method?: string; body?: unknown } = {}): Promise<Json> => {
    let response: Response
    try {
      response = await request(`${config.apiUrl}${path}`, {
        method: options.method || 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(20000), redirect: 'error',
      })
    } catch { throw new AccessError(503, 'The JalSakshi API is unreachable. Check that it is running, then retry.') }
    const body = await response.json().catch(() => ({})) as Json
    if (response.ok) return body
    const detail = typeof body.detail === 'string' ? body.detail : 'The action could not be completed.'
    if (response.status === 401) throw new AccessError(401, 'Your session has expired. Please sign in again.')
    if ([403, 404, 409, 413, 422, 429].includes(response.status)) throw new AccessError(response.status, detail)
    throw new AccessError(503, 'The JalSakshi API could not complete this request. Please retry.')
  }
}

const NO_ACCESS = 'This account does not have supervisor access. Ask your administrator to assign a team.'

/** The signed-in account's supervisor profile, or AccessError(403). */
export async function supervisorProfile(config: AuthConfig, token: string, user: { id: string; email: string }, request = fetch, knownTeamName?: string): Promise<Principal> {
  const api = apiClient(config, token, request)
  const me = await api('/v1/staff/me').catch((error: unknown) => {
    if (error instanceof AccessError && error.status === 403) throw new AccessError(403, NO_ACCESS)
    throw error
  })
  if (me.role !== 'supervisor' || !me.team_id) throw new AccessError(403, NO_ACCESS)
  if (knownTeamName) return { ...user, id: user.id || me.profile_id, role: 'supervisor', team_id: me.team_id, team_name: knownTeamName, dataMode: config.dataMode }
  // The API has no team-name route; the team's sources carry its area name.
  const sources = await api('/v1/staff/sources')
  const villages = (sources.items as Json[]).map(s => s.village).filter(Boolean) as string[]
  const count = (v: string) => villages.filter(x => x === v).length
  const common = [...villages].sort((a, b) => count(b) - count(a))[0]
  return { ...user, id: user.id || me.profile_id, role: 'supervisor', team_id: me.team_id, team_name: common ? `${common} team` : 'Your team', dataMode: config.dataMode }
}

const PRIORITY: Record<string, string> = { high: 'critical', medium: 'urgent', low: 'normal' }
const short = (id: string) => id.slice(0, 8).toUpperCase()
// Record id -> photo_blobs id, filled while building a workspace, for downloads.
// ponytail: per-process map; a download after a server restart rebuilds it once.
const fileIndex = new Map<string, string>()
const blobId = (url: unknown) => typeof url === 'string' && url.startsWith('blob:') ? url.slice(5) : null

function describeReadings(test: Json): string {
  if (test.readings && Object.keys(test.readings).length) return Object.entries(test.readings).map(([k, v]) => `${k}: ${v}`).join(', ')
  if (test.human_observation) return Object.entries(test.human_observation as Json).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('; ')
  return 'No human observation recorded.'
}
function describeSuggestion(test: Json): string {
  if (test.machine_suggestion) return `Model suggestion: ${test.machine_suggestion.risk_band ?? 'recorded'}${test.machine_suggestion.model_version ? ` (${test.machine_suggestion.model_version})` : ''}`
  if (test.rule_assessment) return `Rule-based screening bands: ${test.rule_assessment.risk_level} (${(test.rule_assessment.findings as Json[]).map(f => `${f.parameter} ${f.level}`).join(', ')})`
  return 'No machine suggestion; manual reading.'
}

// Per-report detail calls (fallback only): the API opens one database connection per request; a team with dozens of
// reports fetched all at once exhausted the hosted database's connections
// (every detail call failed after ~4 s), so at most a few run at once.
// Normally the board uses the batch route GET /v1/staff/reports/details.
const DETAIL_CONCURRENCY = 6

/** fn over items, at most `limit` at a time, results in input order. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** One retry after a short pause for a transient API failure (503); anything else is thrown at once. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (error) {
    if (!(error instanceof AccessError) || error.status !== 503) throw error
    await new Promise(resolve => setTimeout(resolve, 400))
    return fn()
  }
}

export async function loadWorkspace(config: AuthConfig, token: string, principal: Principal, request = fetch) {
  const api = apiClient(config, token, request)
  const [sources, reports, complaints, kits] = await Promise.all([api('/v1/staff/sources'), api('/v1/staff/reports'), api('/v1/staff/complaints'), api('/v1/staff/kits')])
  const paramInfo = new Map<string, Json>()
  for (const k of kits.items as Json[]) for (const p of k.parameters as Json[]) paramInfo.set(p.key, p)
  const list = reports.items as ApiReport[]
  if (list.length > 1000) throw new AccessError(413, 'This team exceeds the current board limit. Ask your administrator to enable paginated access.')
  const one = (r: ApiReport) => withRetry(() => api(`/v1/staff/reports/${r.report_id}`))
  // One call for the whole team; the internal fallback DB has no batch route (404), so per report there.
  const batch = await withRetry(() => api('/v1/staff/reports/details')).catch((error: unknown) => {
    if (error instanceof AccessError && error.status === 404) return null
    throw error
  })
  const byId = new Map(((batch?.items ?? []) as Json[]).map(d => [d.report_id as string, d]))
  const details = await mapLimited(list, DETAIL_CONCURRENCY, r => byId.has(r.report_id) ? Promise.resolve(byId.get(r.report_id)!) : one(r))
  const team_id = principal.team_id
  const ws: Json = {
    water_sources: (sources.items as Json[]).map(s => ({ id: s.source_id, team_id, name: s.name, locality: [s.village, s.ward].filter(Boolean).join(' · ') || String(s.source_type).replace('_', ' '), version: 1,
      latitude: s.latitude, longitude: s.longitude, source_type: s.source_type, village: s.village, ward: s.ward,
      risk_level: s.current_risk_level, public_status: s.current_public_status })),
    cases: list.map(r => ({ id: r.report_id, team_id, source_id: r.source_id, screening_id: r.test_record_id, origin: r.origin === 'resident' ? 'ivr' : 'screening',
      status: r.status === 'closed' ? 'closed' : 'under_review', priority: PRIORITY[r.risk_level] || 'normal', created_at: r.created_at, version: r.version, closed_at: r.closed_at, closure_reason: r.closure_reason })),
    screening_records: [] as Json[], lab_reports: [] as Json[], case_actions: [] as Json[], retests: [] as Json[],
    resident_communications: [] as Json[], audit_log: [] as Json[],
    // Dismissed complaints (resolved without a case) have nothing left to act on.
    ivr_complaints: (complaints.items as Json[]).filter(c => c.status !== 'resolved' || c.linked_report_id).map(c => ({
      id: c.complaint_id, team_id, source_id: c.source_id, case_id: c.linked_report_id,
      summary: `${c.reference_number} · ${c.complaint_type}${c.description ? `: ${c.description}` : ''}`,
      status: c.status === 'new' ? 'new' : 'linked', received_at: c.submitted_at, version: c.version,
      photos: [c.photo, ...(c.extra_photos ?? [])].map(blobId).filter(Boolean) })),
  }
  const seenTests = new Set<string>()
  details.forEach((d, i) => {
    const r = list[i]
    if (d.test && r.test_record_id && !seenTests.has(r.test_record_id)) {
      seenTests.add(r.test_record_id)
      const photo = blobId(d.test.photo)
      if (photo) fileIndex.set(`screening_records:${r.test_record_id}`, photo)
      ws.screening_records.push({ id: r.test_record_id, team_id, source_id: r.source_id, sample_code: `TR-${short(r.test_record_id)}`,
        machine_suggestion: describeSuggestion(d.test), human_observation: describeReadings(d.test), screening_flag: d.test.computed_risk_level,
        captured_at: d.test.read_at || r.created_at, received_at: r.created_at, created_by: d.test.performed_by,
        capture_name: photo ? 'screening-photo.jpg' : null, capture_type: photo ? 'image/jpeg' : null,
        photos: [d.test.photo, ...(d.test.extra_photos ?? [])].map(blobId).filter(Boolean),
        readings: Object.entries((d.test.readings ?? {}) as Json).map(([key, value]) => ({ parameter: key,
          label: paramInfo.get(key)?.label ?? key, unit: paramInfo.get(key)?.unit ?? '', value,
          level: ((d.test.rule_assessment?.findings ?? []) as Json[]).find(f => f.parameter === key)?.level ?? null })) })
    }
    for (const l of d.lab_referrals as Json[]) {
      const file = blobId(l.result_file)
      if (file) fileIndex.set(`lab_reports:${l.lab_referral_id}`, file)
      ws.lab_reports.push({ id: l.lab_referral_id, team_id, case_id: r.report_id, source_id: r.source_id, screening_id: r.test_record_id,
        report_number: `LAB-${short(l.lab_referral_id)}`, lab_name: l.lab_name,
        result: l.verification_status === 'pending' ? 'Awaiting the laboratory result file' : l.verification_status === 'rejected' ? 'Result rejected by a supervisor' : 'Result file recorded',
        file_name: file ? 'lab-result' : null, file_type: null, file_sha256: 'not exposed by the API', uploaded_at: l.sent_at, uploaded_by: '',
        verification_status: l.verification_status === 'verified' ? 'verified' : l.verification_status === 'rejected' ? 'rejected' : 'uploaded',
        verified_at: l.verified_at, verified_by: l.verified_by, verification_note: l.re_report_requested ? 'The lab asked for a fresh sample (re-report).' : '' })
    }
    for (const ph of d.photos as Json[]) {
      const file = blobId(ph.photo)
      if (file) fileIndex.set(`case_actions:${ph.photo_id}`, file)
      ws.case_actions.push({ id: ph.photo_id, team_id, case_id: r.report_id, kind: ['corrective_action', 'closure'].includes(ph.process_stage) ? 'corrective' : 'referral',
        description: `${String(ph.process_stage).replace(/_/g, ' ')} photo (${ph.inspection_level ?? 'field'} inspection)`, performed_by: '', performed_at: ph.uploaded_at,
        evidence_name: file ? 'photo.jpg' : null, evidence_type: file ? 'image/jpeg' : null, photo: file, created_at: ph.uploaded_at, created_by: '' })
    }
    ;(d.history as Json[] ?? []).forEach((h, n) => ws.audit_log.push({ id: String(h.id), entity_id: r.report_id, sequence: n + 1,
      occurred_at: h.at, actor_id: h.actor, event: `${h.entity}.${h.action}`, event_hash: '', previous_hash: '', payload: h.details ?? {} }))
    for (const m of d.communications as Json[] ?? []) ws.resident_communications.push({ id: m.id, team_id, case_id: r.report_id,
      channel: m.channel === 'ivr' ? 'phone' : m.channel, message_summary: m.message, sent_at: m.sent_at,
      delivery_status: m.delivery_status === 'confirmed' ? 'delivered' : m.delivery_status, delivery_reference: '' })
    if (d.re_report) ws.retests.push({ id: d.re_report.report_id, team_id, case_id: r.report_id, requested_at: r.created_at, due_at: null,
      instructions: 'The laboratory asked for a fresh sample; it is tracked as its own re-report case.', linked_screening_id: null,
      status: d.re_report.status === 'closed' ? 'completed' : 'requested', completed_at: null })
  })
  return ws
}

// The follow-up sample for a re-report is the field worker's next screening, and the
// re-report is closed as its own case; there is no separate "link the sample" step.
const UNSUPPORTED: Record<string, string> = {
  retests: 'A requested retest is its own re-report case: the field worker screens the source again and the re-report is closed from its own case.',
}

/** RFC 4180 CSV. Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a leading quote. */
export function toCsv(rows: Json[], first: string[] = []): string {
  const columns = [...new Set([...first, ...rows.flatMap(Object.keys)])]
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\r\n')
}

/** Every record on the board as one CSV: a record_type column tells the tables apart. Photos are counted, not embedded. */
function fullExport(ws: Json, team: Json[] = []): string {
  const sourceName = new Map((ws.water_sources as Json[]).map(s => [s.id, s.name]))
  const tables: Array<[string, Json[]]> = [['water_source', ws.water_sources], ['case', ws.cases], ['screening', ws.screening_records],
    ['lab_report', ws.lab_reports], ['case_action', ws.case_actions], ['re_report', ws.retests],
    ['resident_communication', ws.resident_communications], ['resident_complaint', ws.ivr_complaints], ['case_history', ws.audit_log],
    // Staff, so created_by / performed_by ids can be matched to a name.
    ['team_member', team.map(m => ({ id: m.profile_id, name: m.full_name || m.email, email: m.email, role: m.role, status: m.active ? 'active' : 'inactive', tests: m.tests, points: m.points_balance }))]]
  const rows = tables.flatMap(([type, list]) => (list ?? []).map(record => {
    // Internal or unusable outside this board: team ids, empty hash fields, private photo references.
    const { team_id: _t, event_hash: _e, previous_hash: _p, file_sha256: _f, capture_type: _c, evidence_type: _v, photos, photo, readings, ...rest } = record
    return { record_type: type, source_name: record.source_id ? sourceName.get(record.source_id) ?? '' : '', ...rest,
      ...(Array.isArray(readings) ? { readings: (readings as Json[]).map(r => `${r.label} ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.level ? ` (${r.level})` : ''}`).join('; ') } : {}),
      ...(photos !== undefined || photo !== undefined ? { photo_count: Array.isArray(photos) ? photos.length : photo ? 1 : 0 } : {}) }
  }))
  return toCsv(rows, ['record_type', 'id', 'source_name'])
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function validateFile(input: Record<string, unknown>) {
  const data = input.file_base64 ?? input.evidence_base64
  if (data === undefined || data === null) return
  const mime = input.file_type ?? input.evidence_type
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new AccessError(400, 'Invalid attachment encoding.')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length > 2 * 1024 * 1024 || bytes.length < 4) throw new AccessError(400, 'Choose a PDF, PNG, or JPEG file up to 2 MB.')
  const good = mime === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-' : mime === 'image/png' ? bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' : mime === 'image/jpeg' && bytes.subarray(0,3).toString('hex') === 'ffd8ff'
  if (!good) throw new AccessError(400, 'The attachment content does not match its file type.')
}
export async function supervisorApi(req: IncomingMessage, res: ServerResponse, config: AuthConfig, token: string, principal: Principal, request = fetch) {
  const reply = (status: number, body: object) => { res.statusCode = status; res.end(JSON.stringify(body)) }
  const url = new URL(req.url!, 'http://local')
  const path = url.pathname.replace('/api/supervisor/', '')
  // The built-in demo account (demo.supervisor@jalsakshi.local) keeps its synthetic, read-only workspace.
  const demo = token === 'demo-token'
  const api = apiClient(config, token, request)
  let cached: Json | undefined
  const workspace = async (): Promise<Json> => cached ??= demo ? SYNTHETIC_DATA as Json : await loadWorkspace(config, token, principal, request)
  const getRows = async (table: string) => ((await workspace())[table] ?? []) as unknown[]
  try {
    if (path === 'workspace' && req.method === 'GET') return reply(200, { ...(await workspace()), profile: principal })

    if (path === 'export' && req.method === 'GET') {
      const cases = await getRows('cases') as Array<{ status: string; priority: string }>
      // Only fixed labels and aggregate counts: no identities, locations, notes or attachments.
      const rows = [['data_mode','metric','count'], [principal.dataMode,'total_cases',String(cases.length)], ...['under_review','closed'].map(status => [principal.dataMode,status,String(cases.filter(c => c.status===status).length)]), ...['normal','urgent','critical'].map(priority => [principal.dataMode,`priority_${priority}`,String(cases.filter(c => c.priority===priority).length)])]
      res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="jalsakshi-safe-summary.csv"')
      res.end(rows.map(row => row.join(',')).join('\r\n'));return
    }
    if (path === 'export/full' && req.method === 'GET') {
      const [ws, team] = await Promise.all([workspace(), demo ? { items: [] } : api('/v1/staff/team')])
      const csv = fullExport(ws, team.items as Json[])
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="jalsakshi-full-export-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.end('﻿' + csv); return   // BOM: Excel reads the file as UTF-8
    }
    if (path === 'metrics' && req.method === 'GET') {
      const cases = await getRows('cases') as Array<{ status: string; priority: string; created_at: string; closed_at: string | null }>
      const screeningsCount = (await getRows('screening_records')).length
      const closedCases = cases.filter(c => c.status === 'closed' && c.closed_at && c.created_at)
      const totalClosureMs = closedCases.reduce((sum, c) => sum + (new Date(c.closed_at!).getTime() - new Date(c.created_at).getTime()), 0)
      const avgClosureHours = closedCases.length ? Math.round((totalClosureMs / closedCases.length / (1000 * 60 * 60)) * 10) / 10 : 0
      return reply(200, {
        team_id: principal.team_id, team_name: principal.team_name, data_mode: principal.dataMode,
        tests_done: screeningsCount,
        cases_open: cases.filter(c => c.status === 'under_review').length,
        cases_closed: closedCases.length,
        avg_closure_time_hours: avgClosureHours,
        cases_by_priority: {
          normal: cases.filter(c => c.priority === 'normal').length,
          urgent: cases.filter(c => c.priority === 'urgent').length,
          critical: cases.filter(c => c.priority === 'critical').length,
        }
      })
    }
    if (path.startsWith('reports/') && path.endsWith('/audit') && req.method === 'GET') {
      // The API keeps its audit log server-side and does not expose it to this board.
      return reply(200, { case_id: path.split('/')[1], audit_events: [] })
    }
    if (path === 'test-kits' && req.method === 'GET') {
      if (demo) return reply(200, { test_kits: [] })
      const kits = await api('/v1/staff/kits')
      return reply(200, { test_kits: (kits.items as Json[]).map(k => ({ id: k.kit_id, name: k.name, code: String(k.strip_type).toUpperCase(),
        parameter: (k.parameters as Json[]).map(p => p.label).join(', '), unit: (k.parameters as Json[]).map(p => p.unit || 'reading').join(', '), wait_seconds: k.wait_seconds })) })
    }
    if (demo && ['team', 'leaderboards/field-workers', 'leaderboards/locations', 'sponsors', 'rewards'].includes(path)) {
      return reply(200, { members: [], field_workers: [], locations: [], sponsors: [], rewards: [],
        disclaimer: 'Points reward on-time field screening; they are not a water-quality signal.' })
    }
    if (path === 'team' && req.method === 'GET') {
      const team = await api('/v1/staff/team')
      return reply(200, { team_id: principal.team_id, team_name: principal.team_name,
        members: (team.items as Json[]).map(m => ({ id: m.profile_id, email: m.email, role: m.role, status: m.active ? 'active' : 'inactive',
          name: m.full_name || m.email.split('@')[0], tests: m.tests, points: m.points_balance })) })
    }
    if ((path === 'leaderboards/field-workers' || path === 'leaderboards/locations') && req.method === 'GET') {
      const [team, ws] = await Promise.all([api('/v1/staff/team'), workspace()])
      const workers = (team.items as Json[]).filter(m => m.role === 'field_worker')
        .sort((a, b) => b.points_balance - a.points_balance || b.tests - a.tests)
      const monthAgo = Date.now() - 30 * 86400000
      const byVillage = new Map<string, Json[]>()
      for (const s of ws.water_sources as Json[]) byVillage.set(s.village || 'Unnamed area', [...(byVillage.get(s.village || 'Unnamed area') ?? []), s])
      const locations = [...byVillage.entries()].map(([locality, sources]) => {
        const ids = new Set(sources.map(s => s.id))
        const screenings = (ws.screening_records as Json[]).filter(r => ids.has(r.source_id))
        const within = screenings.filter(r => r.screening_flag === 'low').length
        return { locality, sources_monitored: sources.length,
          test_frequency_per_month: screenings.filter(r => Date.parse(r.captured_at) >= monthAgo).length,
          within_band_percent: screenings.length ? Math.round(within / screenings.length * 100) : null }
      }).sort((a, b) => b.test_frequency_per_month - a.test_frequency_per_month).map((l, n) => ({ rank: n + 1, ...l }))
      return reply(200, {
        disclaimer: 'Points reward on-time field screening; they are not a water-quality signal.',
        field_workers: workers.map((m, n) => ({ rank: n + 1, id: m.profile_id, name: m.full_name || m.email.split('@')[0],
          tests_completed: m.tests, cases_flagged: m.reports_raised, points: m.points_balance })),
        locations,
      })
    }
    if ((path === 'sponsors' || path === 'rewards') && req.method === 'GET') {
      // The sponsor rewards catalogue was retired (006): points are a single ledger for field workers.
      return reply(200, { disclaimer: 'Points reward on-time field screening; they are not a water-quality signal.', sponsors: [], rewards: [] })
    }

    // Newest team photos (complaints, screenings, field process photos): one cheap query, polled every 2 s.
    if (path === 'photos' && req.method === 'GET') {
      if (demo) return reply(200, { items: [] })
      return reply(200, await api('/v1/staff/photos/recent?limit=60'))
    }
    if (path.startsWith('photo/') && req.method === 'GET') {
      const id = path.slice(6)
      if (!uuid.test(id)) throw new AccessError(400, 'Invalid photo request.')
      if (demo) throw new AccessError(404, 'Photo not found.')
      let response: Response
      try {
        response = await request(`${config.apiUrl}/v1/staff/blobs/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000), redirect: 'error' })
      } catch { throw new AccessError(503, 'Unable to load the photo.') }
      if (!response.ok) throw new AccessError(response.status === 409 ? 409 : 404, 'Photo not available.')
      res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg')
      // A blob id never changes content, so the browser may keep it for this session.
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable'); res.setHeader('X-Content-Type-Options', 'nosniff')
      res.end(Buffer.from(await response.arrayBuffer())); return
    }

    if (path.startsWith('files/') && req.method === 'GET') {
      const [,table,id] = path.split('/')
      if (!['lab_reports','case_actions','screening_records'].includes(table) || !uuid.test(id || '')) throw new AccessError(400,'Invalid attachment request.')
      if (demo) throw new AccessError(404,'Attachment not found.')
      let blob = fileIndex.get(`${table}:${id}`)
      if (!blob) { await workspace(); blob = fileIndex.get(`${table}:${id}`) }
      if (!blob) throw new AccessError(404,'Attachment not found.')
      let response: Response
      try {
        response = await request(`${config.apiUrl}/v1/staff/blobs/${blob}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000), redirect: 'error' })
      } catch { throw new AccessError(503,'Unable to download attachment.') }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as Json
        throw new AccessError(response.status === 409 ? 409 : 404, typeof body.detail === 'string' ? body.detail : 'Attachment not found.')
      }
      const type = response.headers.get('content-type') || 'application/octet-stream'
      res.setHeader('Content-Type',type)
      res.setHeader('Content-Disposition',`attachment; filename="${table}-${id.slice(0,8)}.${type.includes('pdf') ? 'pdf' : type.includes('png') ? 'png' : 'jpg'}"`);res.setHeader('X-Content-Type-Options','nosniff')
      res.end(Buffer.from(await response.arrayBuffer()));return
    }

    // --- supervisor actions -> guarded JalSakshi API calls ---
    const route = path.split('?')[0]
    if (UNSUPPORTED[route] && req.method === 'PATCH') throw new AccessError(422, UNSUPPORTED[route])
    const patchSource = req.method === 'PATCH' && route === 'water_sources'
    if (req.method !== 'POST' && !patchSource) throw new AccessError(405,'This operation is not available to supervisors.')
    let raw = ''
    for await (const chunk of req) { raw += chunk; if(Buffer.byteLength(raw)>3000000) throw new AccessError(413,'Request exceeds the 2 MB attachment limit.') }
    let input: Record<string,unknown>
    try { input = JSON.parse(raw) } catch { throw new AccessError(400,'Invalid request.') }
    if (!input || Array.isArray(input) || typeof input!=='object') throw new AccessError(400,'Invalid request.')
    validateFile(input)
    if (demo) throw new AccessError(422, 'The demo workspace is read-only. Sign in with a JalSakshi supervisor account to act on cases.')
    const id = (key: string) => { const v = input[key]; if (typeof v !== 'string' || !uuid.test(v)) throw new AccessError(400, 'Select one record.'); return v }
    const version = (key: string) => { const v = Number(input[key]); if (!Number.isInteger(v)) throw new AccessError(400, 'Refresh the case and try again.'); return v }

    if (patchSource) {
      const target = url.searchParams.get('id') || ''
      if (!target.startsWith('eq.') || !uuid.test(target.slice(3))) throw new AccessError(400,'Select one record to update.')
      const [village, ...ward] = String(input.locality ?? '').split('·').map(s => s.trim())
      await api(`/v1/staff/sources/${target.slice(3)}`, { method: 'PATCH', body: { name: input.name || undefined, village: village || undefined, ward: ward.join(' · ') || undefined } })
    } else if (route === 'retests') {
      await api(`/v1/staff/reports/${id('case_id')}/re-report`, { method: 'POST', body: { version: version('expected_case_version') } })
    } else if (route === 'resident_communications') {
      const channel = input.channel === 'phone' ? 'ivr' : input.channel
      if (channel !== 'sms' && channel !== 'ivr') throw new AccessError(422, 'Record SMS or phone updates; other channels are not stored.')
      await api(`/v1/staff/reports/${id('case_id')}/communications`, { method: 'POST', body: {
        channel, message: String(input.message_summary ?? ''), sent_at: input.sent_at || null,
        delivery_status: input.delivery_status === 'delivered' ? 'confirmed' : input.delivery_status } })
    } else if (route === 'notes') {
      await api(`/v1/staff/reports/${id('case_id')}/notes`, { method: 'POST', body: { text: String(input.text ?? '') } })
    } else if (route === 'rpc/verify_case_audit') {
      // No hash chain in this API: check that the recorded history agrees with the case's current state.
      const d = await api(`/v1/staff/reports/${id('p_case_id')}`)
      const events = (d.history as Json[]).map(h => h.action)
      const ordered = (d.history as Json[]).every((h, n, all) => n === 0 || all[n - 1].at <= h.at)
      const valid = ordered && (d.status !== 'closed' || events.includes('closed'))
      return reply(200, { valid, events: events.length })
    } else if (route === 'rpc/link_ivr_complaint_to_case') {
      await api(`/v1/staff/complaints/${id('p_complaint_id')}/review`, { method: 'POST', body: { action: 'link', report_id: id('p_case_id'), version: version('p_expected_version') } })
    } else if (route === 'rpc/create_case_from_ivr') {
      await api(`/v1/staff/complaints/${id('p_complaint_id')}/review`, { method: 'POST', body: { action: 'open_report', risk_level: 'medium' } })
    } else if (route === 'rpc/verify_lab_report') {
      await api(`/v1/staff/lab-referrals/${id('p_report_id')}/verify`, { method: 'POST', body: { decision: 'verified' } })
    } else if (route === 'rpc/close_case') {
      const caseId = id('p_case_id')
      let current = version('p_expected_version')
      const detail = await api(`/v1/staff/reports/${caseId}`)
      if (detail.version !== current) throw new AccessError(409, 'Someone else changed this case. Review the refreshed evidence before trying again.')
      // The API closes only from 'action_taken'; the dashboard has one close step, so record that first.
      if (detail.status !== 'action_taken') current = (await api(`/v1/staff/reports/${caseId}/transition`, { method: 'POST', body: { to: 'action_taken', version: current } })).version
      await api(`/v1/staff/reports/${caseId}/close`, { method: 'POST', body: { version: current, closure_reason: String(input.p_reason ?? '') } })
    } else if (route === 'lab_reports') {
      if (typeof input.file_base64 !== 'string') throw new AccessError(422, 'Attach the laboratory report file.')
      const referral = await api(`/v1/staff/reports/${id('case_id')}/lab-referrals`, { method: 'POST', body: { lab_name: String(input.lab_name || 'Laboratory'), version: version('expected_case_version') } })
      await api(`/v1/staff/lab-referrals/${referral.lab_referral_id}/result`, { method: 'POST', body: { content_type: input.file_type, data_base64: input.file_base64 } })
    } else if (route === 'case_actions') {
      if (typeof input.evidence_base64 !== 'string' || !['image/jpeg', 'image/png'].includes(String(input.evidence_type))) throw new AccessError(422, 'Attach a JPEG or PNG photo of the action; the API records actions as evidence photos.')
      await api(`/v1/staff/reports/${id('case_id')}/photos`, { method: 'POST', body: {
        content_type: input.evidence_type, data_base64: input.evidence_base64,
        process_stage: input.kind === 'corrective' ? 'corrective_action' : 'lab_referral', inspection_level: 'supervisor' } })
    } else {
      throw new AccessError(405,'This operation is not available to supervisors.')
    }
    // Mutation bodies can include private file data; do not echo them back.
    return reply(200, { ok: true })
  } catch(error) {
    if(error instanceof AccessError) return reply(error.status,{error:error.message})
    return reply(503,{error:'The service is unavailable. Please retry; your action was not confirmed.'})
  }
}
