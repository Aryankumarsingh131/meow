/**
 * Offline demo backend. When the server cannot be reached (no internet, a
 * captive portal, the tunnel down), the three demo accounts still sign in and
 * every screen works on this phone with hardcoded data and the SAME rules as
 * the server: screening bands (006 reading_parameters), the points rule, the
 * complaint lifecycle and link-at-version. Nothing leaves the phone and it is
 * gone when the app closes; the app shows a banner saying so.
 *
 * ponytail: in-memory only. Persist it (deviceDb) if offline demo data must
 * survive a restart.
 */

import type { ApiOutcome } from './api.ts';
import { bandFor, type Band, type Kit, type KitParameter } from './pluccyModel.ts';
import type {
  LoginResult, MapSource, MyComplaint, Points, Review, ScreeningRequest, ScreeningResult, StaffComplaint, StaffReport,
  StaffSource, ComplaintType, Photo,
} from './v2.ts';

export const DEMO_TOKEN_PREFIX = 'demo-offline:';
export const isDemoToken = (token: string | null | undefined): boolean => !!token && token.startsWith(DEMO_TOKEN_PREFIX);

const ACCOUNTS: Record<string, LoginResult['role']> = {
  '1@demo.org': 'field_worker', '2@demo.org': 'supervisor', '3@demo.org': 'resident',
};

export function demoLogin(email: string, password: string): LoginResult | null {
  const role = ACCOUNTS[email.trim().toLowerCase()];
  if (!role || password !== '1234') return null;
  return { token: `${DEMO_TOKEN_PREFIX}${role}`, role, expires_at: Math.floor(Date.now() / 1000) + 12 * 3600 };
}

const ok = <T>(value: T): ApiOutcome<T> => ({ kind: 'ok', value });
const refused = (status: number, code: string): ApiOutcome<never> => ({ kind: 'failed', status, code, retryable: false });

// --- hardcoded data (mirrors 006 and the East Plains demo team) ------------------------

const p = (key: string, label: string, unit: string, input_kind: KitParameter['input_kind'], min: number, max: number,
           ok_min: number | null, ok_max: number | null, watch_min: number | null, watch_max: number | null,
           tip: string, basis: string): KitParameter =>
  ({ key, label, unit, input_kind, min, max, ok_min, ok_max, watch_min, watch_max, tip, basis });

const PARAMS = {
  ph: p('ph', 'pH', '', 'number', 0, 14, 6.5, 8.5, 5.5, 9.5,
    'Match the pad to the colour chart in daylight, straight after pulling it out.', 'BIS 10500 acceptable 6.5-8.5'),
  chlorine: p('chlorine', 'Free chlorine', 'mg/L', 'number', 0, 10, 0.2, 1.0, 0, 4,
    'Read the chlorine pad first; its colour fades within a minute.', 'BIS 10500 residual 0.2-1.0'),
  iron: p('iron', 'Iron', 'mg/L', 'number', 0, 10, 0, 0.3, 0, 1.0,
    'Compare against the chart held flat; a pale orange tint counts.', 'BIS 10500 acceptable 0.3'),
  tds: p('tds', 'Total dissolved solids', 'mg/L', 'number', 0, 5000, 0, 500, 0, 2000,
    'Type the number shown on the meter strip, not the colour band.', 'BIS 10500 acceptable 500'),
  coliform: p('coliform', 'Coliform bacteria', '', 'presence', 0, 1, 0, 0, 0, 0,
    'Any colour change in the vial means present. When unsure, choose present.', 'BIS 10500: not detectable'),
};
const DIP = 'Dip the strip so every pad is under water for 2 seconds, then hold it flat, pads up.';
const kit = (kit_id: string, name: string, strip_type: string, wait_seconds: number, parameters: KitParameter[],
             dip = DIP): Kit => ({ kit_id, name, strip_type, dip_instruction: dip, wait_seconds, read_grace_seconds: 60, parameters });

const KITS: Kit[] = [
  kit('demo-kit-chlorine', 'AquaCheck Chlorine Strip', 'chlorine', 30, [PARAMS.chlorine]),
  kit('demo-kit-coliform', 'AquaCheck Coliform Kit', 'coliform', 86_400, [PARAMS.coliform],
    'Fill the vial to the line, close it, and keep it upright and warm.'),
  kit('demo-kit-iron', 'AquaCheck Iron Strip', 'iron', 60, [PARAMS.iron]),
  kit('demo-kit-ph', 'AquaCheck pH Strip', 'pH', 20, [PARAMS.ph]),
  kit('demo-kit-tds', 'AquaCheck TDS Meter Strip', 'TDS', 15, [PARAMS.tds]),
];

const SOURCES: StaffSource[] = [
  { source_id: 'demo-src-pump3', name: 'East Plains Hand Pump #3', source_type: 'hand_pump', village: 'East Plains', current_public_status: 'not_tested' },
  { source_id: 'demo-src-pond1', name: 'East Plains Pond #1', source_type: 'pond', village: 'East Plains', current_public_status: 'under_review' },
  { source_id: 'demo-src-river2', name: 'East Plains River #2', source_type: 'river', village: 'East Plains', current_public_status: 'not_tested' },
];
const STATUS_LABEL: Record<string, string> = { not_tested: 'Not yet tested', under_review: 'Under review' };
const sourceName = (id: string | null | undefined) => SOURCES.find((s) => s.source_id === id)?.name ?? null;

// --- state (this app run only) --------------------------------------------------------

const RULE = 'Offline demo: +10 points for a screening with every reading, a photo, and the strip read inside the kit\'s window.';
const MILESTONES = [10, 50, 100];
const today = () => new Date().toISOString().slice(0, 10);
const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).toUpperCase().padStart(8, '0');

const state = {
  points: { balance: 0, qualifying: 0, days: new Set<string>() },
  screenings: new Map<string, ScreeningResult>(),
  reports: [
    { report_id: 'demo-rep-1', source_id: 'demo-src-pond1', source_name: 'East Plains Pond #1', status: 'open', version: 1,
      risk_level: 'medium', origin: 'screening', created_at: new Date(Date.now() - 86_400_000).toISOString() },
  ] as StaffReport[],
  complaints: [
    { complaint_id: 'demo-c-1', reference_number: 'JS-DEMO0001', complaint_type: 'discoloration', status: 'new',
      source_id: 'demo-src-pond1', source_name: 'East Plains Pond #1', description: 'Water looks brown since yesterday.',
      photo: null, submitted_at: new Date(Date.now() - 3_600_000).toISOString(), resolution: null as string | null },
  ] as Array<StaffComplaint & { resolution: string | null }>,
};

function points(): Points {
  const days = [...state.points.days].sort().reverse();
  let streak = 0;
  const cursor = new Date();
  if (days[0] !== today()) cursor.setDate(cursor.getDate() - 1);
  for (const d of days) {
    if (d !== cursor.toISOString().slice(0, 10)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { points_balance: state.points.balance, qualifying_screenings: state.points.qualifying, streak_days: streak,
           milestones: MILESTONES, next_milestone: MILESTONES.find((m) => m > state.points.qualifying) ?? null, rule: RULE };
}

// --- the routes -----------------------------------------------------------------------

const ROLE = (token: string) => token.slice(DEMO_TOKEN_PREFIX.length) as LoginResult['role'];

export const demo = {
  staffMe: (token: string) => ok({ role: ROLE(token) as 'supervisor' | 'field_worker', team_id: 'demo-team', points: points() }),
  kits: () => ok({ items: KITS, points_rule: RULE, notice: 'Bands are screening bands, not a laboratory result.' }),
  sources: () => ok({ items: SOURCES }),

  submitScreening(token: string, body: ScreeningRequest): ApiOutcome<ScreeningResult> {
    const seen = state.screenings.get(body.local_record_id);
    if (seen) return ok({ ...seen, outcome: 'duplicate' });
    const k = KITS.find((x) => x.kit_id === body.kit_id);
    if (!k || !SOURCES.some((s) => s.source_id === body.source_id)) return refused(404, 'NOT_FOUND');
    const rank: Record<Band, number> = { low: 1, medium: 2, high: 3 };
    const findings = k.parameters.filter((pm) => pm.key in body.readings)
      .map((pm) => ({ parameter: pm.key, value: body.readings[pm.key], level: bandFor(pm, body.readings[pm.key]) }));
    const worst = findings.reduce<Band | null>((w, f) => (!w || rank[f.level] > rank[w] ? f.level : w), null);
    const elapsed = (Date.parse(body.read_at) - Date.parse(body.dip_started_at)) / 1000;
    const qualifies = ROLE(token) === 'field_worker' && !!body.photo && k.parameters.every((pm) => pm.key in body.readings)
      && elapsed >= k.wait_seconds && elapsed <= k.wait_seconds + k.read_grace_seconds;
    if (qualifies) {
      state.points.balance += 10;
      state.points.qualifying += 1;
      state.points.days.add(today());
    }
    let report_id: string | null = null;
    if (worst === 'medium' || worst === 'high') {
      report_id = `demo-rep-${hex()}`;
      state.reports.unshift({ report_id, source_id: body.source_id, source_name: sourceName(body.source_id) ?? '', status: 'open',
                              version: 1, risk_level: worst, origin: 'screening', created_at: new Date().toISOString() });
    }
    const result: ScreeningResult = {
      test_record_id: `demo-rec-${hex()}`, outcome: 'accepted', report_id, risk_level: worst ?? 'unknown',
      assessment: { risk_level: worst ?? 'unknown', findings }, points_awarded: qualifies ? 10 : 0, points: points(),
    };
    state.screenings.set(body.local_record_id, result);
    return ok(result);
  },

  staffComplaints: () => ok({ items: state.complaints.filter((c) => c.status === 'new') }),
  staffReports: () => ok({ items: state.reports }),

  reviewComplaint(token: string, id: string, review: Review): ApiOutcome<{ status: string; report_id: string | null }> {
    if (ROLE(token) !== 'supervisor') return refused(403, 'FORBIDDEN');
    const c = state.complaints.find((x) => x.complaint_id === id);
    if (!c) return refused(404, 'NOT_FOUND');
    if (c.status !== 'new') return refused(409, 'COMPLAINT_ALREADY_REVIEWED');
    if (review.action === 'dismiss') {
      c.status = 'resolved';
      c.resolution = 'dismissed';
      return ok({ status: 'resolved', report_id: null });
    }
    let report: StaffReport | undefined;
    if (review.action === 'link') {
      report = state.reports.find((r) => r.report_id === review.report_id && r.status !== 'closed');
      if (!report) return refused(404, 'NOT_FOUND');
      if (report.version !== review.version) return refused(409, 'CASE_VERSION_CONFLICT');
      report.version += 1;
    } else {
      if (!c.source_id) return refused(422, 'VALIDATION_FAILED');
      report = { report_id: `demo-rep-${hex()}`, source_id: c.source_id, source_name: c.source_name ?? '', status: 'open', version: 1,
                 risk_level: review.risk_level, origin: 'resident', created_at: new Date().toISOString() };
      state.reports.unshift(report);
    }
    c.status = 'linked';
    return ok({ status: 'linked', report_id: report.report_id });
  },

  myComplaints: () => ok({
    items: state.complaints.map((c): MyComplaint => ({
      reference_number: c.reference_number, complaint_type: c.complaint_type as ComplaintType, status: c.status,
      status_label: { new: 'Received - not yet reviewed', linked: 'Linked to an investigation', resolved: 'Resolved' }[c.status],
      resolution_label: c.resolution === 'dismissed' ? 'Reviewed by a supervisor; no investigation was opened.' : null,
      source_name: c.source_name, submitted_at: c.submitted_at, description: c.description,
    })),
  }),

  fileComplaint(body: { complaint_type: ComplaintType; source_id?: string; description?: string; photo?: Photo }) {
    const reference_number = `JS-${hex().slice(0, 8)}D`;
    state.complaints.unshift({
      complaint_id: `demo-c-${hex()}`, reference_number, complaint_type: body.complaint_type, status: 'new',
      source_id: body.source_id ?? null, source_name: sourceName(body.source_id), description: body.description ?? null,
      photo: body.photo ? 'offline-photo' : null, submitted_at: new Date().toISOString(), resolution: null,
    });
    return ok({ reference_number, status_label: 'Received - not yet reviewed',
                notice: 'Saved in the offline demo on this phone only. A complaint is not a test result.' });
  },

  publicMap: () => ok({
    items: SOURCES.map((s): MapSource => ({ source_id: s.source_id, name: s.name, source_type: s.source_type,
      status_label: STATUS_LABEL[s.current_public_status] ?? 'Not yet tested', location_precision: 'approximate (about 500 m)' })),
    disclaimer: 'Offline demo data. This list is not a guarantee about any water source.',
  }),
};
