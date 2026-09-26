/**
 * Client for the hosted v2 routes: email sign-in (staff and residents), the
 * staff app (/v1/staff: Pluccy kits and screenings, points, complaint review)
 * and the resident app (/v1/public). Thin typed wrappers over api.request, so
 * every call keeps its offline / sign-in-again / refused outcome.
 */

import { API_BASE, request, type ApiOutcome } from './api.ts';

/** The laptop running the API (tools/dev_tunnel.sh), used when ngrok cannot be
 *  reached - no internet, or the tunnel down. 10.0.2.2 is the host machine as
 *  seen from the Android emulator; a phone on the same Wi-Fi needs the laptop's
 *  address in EXPO_PUBLIC_LOCAL_API_BASE. */
export const LOCAL_API_BASE = process.env.EXPO_PUBLIC_LOCAL_API_BASE || 'http://10.0.2.2:8000';
/** Where this session's API calls go: set at sign-in. */
let base = API_BASE;
export const activeBase = (): string => base;
import { demo, demoLogin, isDemoToken } from './demoBackend.ts';
import type { Criterion, Judgement, Kit } from './pluccyModel.ts';

/** The resident web portal: the link staff share and residents open. */
export const PORTAL_URL = `${API_BASE}/portal`;

export interface LoginResult {
  token: string;
  role: 'supervisor' | 'field_worker' | 'resident';   // supervisors are refused on the phone
  expires_at: number;
}

/** Sign-in, in order: the API through ngrok; this laptop's API directly (it
 *  serves from its internal database when Supabase is unreachable, so the
 *  dashboard sees the same data); and last, the on-phone offline demo for the
 *  demo accounts. A wrong password on a reachable server never falls through. */
export async function login(email: string, password: string): Promise<ApiOutcome<LoginResult>> {
  const body = { email: email.trim(), password };
  const unreachable = (o: ApiOutcome<unknown>) => o.kind === 'offline' || (o.kind === 'failed' && o.status >= 500);
  let r = await request<LoginResult>(base, '/v1/auth/login', { method: 'POST', body, timeoutMs: 12_000 });
  base = API_BASE;
  if (unreachable(r) && LOCAL_API_BASE !== API_BASE) {
    const local = await request<LoginResult>(LOCAL_API_BASE, '/v1/auth/login', { method: 'POST', body, timeoutMs: 8_000 });
    if (!unreachable(local)) {
      r = local;
      base = LOCAL_API_BASE;
    }
  }
  const offline = unreachable(r) ? demoLogin(email, password) : null;
  return offline ? { kind: 'ok', value: offline } : r;
}

// --- staff ------------------------------------------------------------------

export interface Points {
  points_balance: number;
  qualifying_screenings: number;
  streak_days: number;
  milestones: number[];
  next_milestone: number | null;
  rule: string;
}

export const staffMe = (token: string) => isDemoToken(token) ? Promise.resolve(demo.staffMe()) :
  request<{ role: 'supervisor' | 'field_worker'; team_id: string | null; points: Points }>(base, '/v1/staff/me', { token });

export const fetchKits = (token: string) => isDemoToken(token) ? Promise.resolve(demo.kits()) :
  request<KitsResponse>(base, '/v1/staff/kits', { token });

export interface KitsResponse {
  items: Kit[];
  inspection_criteria: Criterion[];
  points_rule: string;
  notice: string;
}

export interface StaffSource {
  source_id: string;
  name: string;
  source_type: string;
  village: string | null;
  current_public_status: string;
}

export const staffSources = (token: string) => isDemoToken(token) ? Promise.resolve(demo.sources()) :
  request<{ items: StaffSource[] }>(base, '/v1/staff/sources', { token });

export const SOURCE_TYPES = [
  ['hand_pump', 'Hand pump'], ['tap', 'Tap'], ['well', 'Well'], ['tank', 'Tank'], ['pond', 'Pond'], ['river', 'River'], ['other', 'Other'],
] as const;

export interface NewSource {
  name: string;
  source_type: (typeof SOURCE_TYPES)[number][0];
  latitude: number;
  longitude: number;
  location_source: 'gps_auto';
  location_accuracy_m: number;
  village?: string;
  landmark?: string;
}

/** A field worker adds a source where they stand: GPS only (a hand-placed pin needs a supervisor). */
export const createSource = (token: string, body: NewSource) => isDemoToken(token) ? Promise.resolve(demo.createSource(body)) :
  request<{ source_id: string }>(base, '/v1/staff/sources', { method: 'POST', token, body, timeoutMs: 20_000 });

export interface Photo {
  content_type: 'image/jpeg';
  data_base64: string;
}

export interface ScreeningRequest {
  source_id: string;
  local_record_id: string;
  kit_id: string;
  method: 'manual';
  readings: Record<string, number>;
  dip_started_at: string;
  read_at: string;
  photo?: Photo;
  /** Up to 3 more photos after the first (011). */
  extra_photos?: Photo[];
  /** Judgement answers, key -> yes/no (inspection_criteria keys). */
  inspection?: Record<string, boolean>;
}

export interface ScreeningResult {
  test_record_id: string;
  outcome: 'accepted' | 'duplicate';
  report_id: string | null;
  risk_level: 'unknown' | 'low' | 'medium' | 'high';
  assessment: { risk_level: string; readings_risk?: string; inspection?: Judgement | null;
    findings: Array<{ parameter: string; value: number; level: 'low' | 'medium' | 'high' }> } | null;
  points_awarded: number;
  points: Points;
}

/** Retry with the same local_record_id: the server is idempotent on it, so nothing is recorded twice. */
export const submitScreening = (token: string, body: ScreeningRequest) =>
  isDemoToken(token) ? Promise.resolve(demo.submitScreening(token, body)) :
  request<ScreeningResult>(base, '/v1/staff/test-records', { method: 'POST', token, body, timeoutMs: 30_000 });

// --- residents ----------------------------------------------------------------

export const COMPLAINT_TYPES = [
  ['discoloration', 'Colour has changed'],
  ['smell', 'Bad smell'],
  ['taste', 'Strange taste'],
  ['sediment', 'Dirt or particles'],
  ['illness', 'People feel unwell'],
  ['other', 'Something else'],
] as const;

export type ComplaintType = (typeof COMPLAINT_TYPES)[number][0];

export interface MyComplaint {
  reference_number: string;
  complaint_type: ComplaintType;
  status: 'new' | 'linked' | 'resolved';
  status_label: string;
  resolution_label: string | null;
  source_name: string | null;
  submitted_at: string;
  description: string | null;
  /** Further problems noticed besides complaint_type (011). */
  also?: ComplaintType[];
}

export const myComplaints = (token: string) => isDemoToken(token) ? Promise.resolve(demo.myComplaints()) : request<{ items: MyComplaint[] }>(base, '/v1/public/complaints', { token });

export interface ComplaintBody {
  complaint_type: ComplaintType;
  also?: ComplaintType[];
  source_id?: string;
  description?: string;
  photo?: Photo;
  extra_photos?: Photo[];
}

export const fileComplaint = (token: string, body: ComplaintBody) =>
  isDemoToken(token) ? Promise.resolve(demo.fileComplaint(body)) :
  request<{ reference_number: string; status_label: string; notice: string }>(base, '/v1/public/complaints',
    { method: 'POST', token, body, timeoutMs: 30_000 });

export interface MapSource {
  source_id: string;
  name: string;
  source_type: string;
  status: string;
  status_label: string;
  latitude: number | null;
  longitude: number | null;
  location_precision: string;
  last_updated: string;
  village: string | null;
  ward: string | null;
  last_screened_at: string | null;
  screenings_30d: number;
  open_issues: number;
  lab_verified_at: string | null;
}

export const publicMap = (token?: string) => isDemoToken(token) ? Promise.resolve(demo.publicMap()) :
  request<{ items: MapSource[]; disclaimer: string }>(base, '/v1/public/map');

export interface Leaderboard {
  field_workers: Array<{ rank: number; display_name: string; area: string | null; points: number; on_time_screenings: number; screenings: number }>;
  areas: Array<{ rank: number; area: string; sources: number; screenings_30d: number; open_issues: number }>;
  disclaimer: string;
}

export interface PublicStats {
  weeks: Array<{ week_start: string; screenings: number; flagged: number; reports_opened: number; reports_closed: number; complaints: number }>;
  risk_30d: Record<'low' | 'medium' | 'high' | 'unknown', number>;
  sources_by_type: Record<string, number>;
  sources_by_status: Record<string, number>;
  complaints_by_type: Record<string, number>;
  totals: { sources: number; screenings: number; reports: number; open_reports: number; escalated_to_authority: number; complaints: number };
  disclaimer: string;
}

export const publicStats = (token?: string) => isDemoToken(token) ? Promise.resolve(demo.stats()) :
  request<PublicStats>(base, '/v1/public/stats');

/** A new resident account; the server signs it in straight away. */
export const registerResident = (body: { email: string; password: string; full_name?: string; phone?: string }) =>
  request<LoginResult>(base, '/v1/public/accounts', { method: 'POST', body, timeoutMs: 20_000 });

export const publicLeaderboard = (token?: string) => isDemoToken(token) ? Promise.resolve(demo.leaderboard()) :
  request<Leaderboard>(base, '/v1/public/leaderboard');

/** What to tell a person when a call did not succeed. */
export function problemText(outcome: Exclude<ApiOutcome<unknown>, { kind: 'ok' }>): string {
  if (outcome.kind === 'offline') return 'Cannot reach the server. Check the connection and try again.';
  if (outcome.kind === 'auth_required') return 'Your sign-in has expired. Sign in again.';
  switch (outcome.code) {
    case 'CASE_VERSION_CONFLICT': return 'Someone else changed that report. The list has been reloaded; try again.';
    case 'RATE_LIMITED': return 'Too many requests. Wait a while and try again.';
    case 'VALIDATION_FAILED': return 'Something in the form was not accepted. Check it and try again.';
    case 'EMAIL_ALREADY_REGISTERED': return 'This email already has an account. Sign in instead.';
    case 'PHONE_ALREADY_REGISTERED': return 'This phone number already has an account.';
    case 'NOT_FOUND': return 'Not found. It may belong to another team.';
    default: return 'The server could not do that. Try again shortly.';
  }
}
