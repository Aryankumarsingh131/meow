/**
 * Client for the hosted v2 routes: email sign-in (staff and residents), the
 * staff app (/v1/staff: Pluccy kits and screenings, points, complaint review)
 * and the resident app (/v1/public). Thin typed wrappers over api.request, so
 * every call keeps its offline / sign-in-again / refused outcome.
 */

import { API_BASE, request, type ApiOutcome } from './api.ts';
import { demo, demoLogin, isDemoToken } from './demoBackend.ts';
import type { Kit } from './pluccyModel.ts';

/** The resident web portal: the link staff share and residents open. */
export const PORTAL_URL = `${API_BASE}/portal`;

export interface LoginResult {
  token: string;
  role: 'supervisor' | 'field_worker' | 'resident';
  expires_at: number;
}

/** Server sign-in. If the server cannot be reached or fails (no internet,
 *  captive portal, database down), a demo account signs in to the offline
 *  demo instead (demoBackend.ts) so the app still works end to end. A wrong
 *  password on a reachable server is never turned into a demo session. */
export async function login(email: string, password: string): Promise<ApiOutcome<LoginResult>> {
  const r = await request<LoginResult>(API_BASE, '/v1/auth/login',
    { method: 'POST', body: { email: email.trim(), password }, timeoutMs: 12_000 });
  const unreachable = r.kind === 'offline' || (r.kind === 'failed' && r.status >= 500);
  const offline = unreachable ? demoLogin(email, password) : null;
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

export const staffMe = (token: string) => isDemoToken(token) ? Promise.resolve(demo.staffMe(token)) :
  request<{ role: 'supervisor' | 'field_worker'; team_id: string | null; points: Points }>(API_BASE, '/v1/staff/me', { token });

export const fetchKits = (token: string) => isDemoToken(token) ? Promise.resolve(demo.kits()) :
  request<{ items: Kit[]; points_rule: string; notice: string }>(API_BASE, '/v1/staff/kits', { token });

export interface StaffSource {
  source_id: string;
  name: string;
  source_type: string;
  village: string | null;
  current_public_status: string;
}

export const staffSources = (token: string) => isDemoToken(token) ? Promise.resolve(demo.sources()) :
  request<{ items: StaffSource[] }>(API_BASE, '/v1/staff/sources', { token });

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
}

export interface ScreeningResult {
  test_record_id: string;
  outcome: 'accepted' | 'duplicate';
  report_id: string | null;
  risk_level: 'unknown' | 'low' | 'medium' | 'high';
  assessment: { risk_level: string; findings: Array<{ parameter: string; value: number; level: 'low' | 'medium' | 'high' }> } | null;
  points_awarded: number;
  points: Points;
}

/** Retry with the same local_record_id: the server is idempotent on it, so nothing is recorded twice. */
export const submitScreening = (token: string, body: ScreeningRequest) =>
  isDemoToken(token) ? Promise.resolve(demo.submitScreening(token, body)) :
  request<ScreeningResult>(API_BASE, '/v1/staff/test-records', { method: 'POST', token, body, timeoutMs: 30_000 });

export interface StaffComplaint {
  complaint_id: string;
  reference_number: string;
  complaint_type: string;
  status: 'new' | 'linked' | 'resolved';
  source_id: string | null;
  source_name: string | null;
  description: string | null;
  photo: string | null;
  submitted_at: string;
}

export const staffComplaints = (token: string) => isDemoToken(token) ? Promise.resolve(demo.staffComplaints()) :
  request<{ items: StaffComplaint[] }>(API_BASE, '/v1/staff/complaints?status=new', { token });

export interface StaffReport {
  report_id: string;
  source_id: string;
  source_name: string;
  status: string;
  version: number;
  risk_level: string;
  origin: 'screening' | 'resident';
  created_at: string;
}

export const staffReports = (token: string) => isDemoToken(token) ? Promise.resolve(demo.staffReports()) : request<{ items: StaffReport[] }>(API_BASE, '/v1/staff/reports', { token });

export type Review =
  | { action: 'link'; report_id: string; version: number }
  | { action: 'open_report'; risk_level: 'low' | 'medium' | 'high' }
  | { action: 'dismiss' };

export const reviewComplaint = (token: string, complaintId: string, body: Review) =>
  isDemoToken(token) ? Promise.resolve(demo.reviewComplaint(token, complaintId, body)) :
  request<{ status: string; report_id: string | null }>(API_BASE, `/v1/staff/complaints/${complaintId}/review`,
    { method: 'POST', token, body });

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
}

export const myComplaints = (token: string) => isDemoToken(token) ? Promise.resolve(demo.myComplaints()) : request<{ items: MyComplaint[] }>(API_BASE, '/v1/public/complaints', { token });

export const fileComplaint = (token: string, body: { complaint_type: ComplaintType; source_id?: string; description?: string; photo?: Photo }) =>
  isDemoToken(token) ? Promise.resolve(demo.fileComplaint(body)) :
  request<{ reference_number: string; status_label: string; notice: string }>(API_BASE, '/v1/public/complaints',
    { method: 'POST', token, body, timeoutMs: 30_000 });

export interface MapSource {
  source_id: string;
  name: string;
  source_type: string;
  status_label: string;
  location_precision: string;
}

export const publicMap = (token?: string) => isDemoToken(token) ? Promise.resolve(demo.publicMap()) :
  request<{ items: MapSource[]; disclaimer: string }>(API_BASE, '/v1/public/map');

/** What to tell a person when a call did not succeed. */
export function problemText(outcome: Exclude<ApiOutcome<unknown>, { kind: 'ok' }>): string {
  if (outcome.kind === 'offline') return 'Cannot reach the server. Check the connection and try again.';
  if (outcome.kind === 'auth_required') return 'Your sign-in has expired. Sign in again.';
  switch (outcome.code) {
    case 'CASE_VERSION_CONFLICT': return 'Someone else changed that report. The list has been reloaded; try again.';
    case 'COMPLAINT_ALREADY_REVIEWED': return 'Another supervisor already handled this complaint.';
    case 'RATE_LIMITED': return 'Too many requests. Wait a while and try again.';
    case 'VALIDATION_FAILED': return 'Something in the form was not accepted. Check it and try again.';
    case 'NOT_FOUND': return 'Not found. It may belong to another team.';
    default: return 'The server could not do that. Try again shortly.';
  }
}
