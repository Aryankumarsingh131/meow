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
import { bandFor, judgeLocally, type Band, type Criterion, type Kit, type KitParameter, type ProtocolStep } from './pluccyModel.ts';
import type {
  ComplaintBody, Leaderboard, LoginResult, MapSource, PublicStats, MyComplaint, NewSource, Points, ScreeningRequest, ScreeningResult, StaffSource, ComplaintType, Photo,
} from './v2.ts';

interface DemoReport { report_id: string; source_id: string; source_name: string; status: string; version: number;
  risk_level: string; origin: 'screening' | 'resident'; created_at: string }
interface DemoComplaint { complaint_id: string; reference_number: string; complaint_type: string; status: 'new' | 'linked' | 'resolved';
  source_id: string | null; source_name: string | null; description: string | null; photo: string | null; submitted_at: string;
  resolution: string | null; also?: string[] }

export const DEMO_TOKEN_PREFIX = 'demo-offline:';
export const isDemoToken = (token: string | null | undefined): boolean => !!token && token.startsWith(DEMO_TOKEN_PREFIX);

const ACCOUNTS: Record<string, LoginResult['role']> = {
  '1@demo.org': 'field_worker', '3@demo.org': 'resident',
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
  hardness: p('hardness', 'Total hardness', 'mg/L CaCO3', 'number', 0, 2000, 0, 200, 0, 600,
    'Count the pads that changed colour and read the matching value.', 'BIS 10500 acceptable 200, permissible 600'),
  nitrate: p('nitrate', 'Nitrate', 'mg/L', 'number', 0, 500, 0, 45, 0, 45,
    'Wait for the full colour to develop before comparing.', 'BIS 10500 acceptable 45'),
  fluoride: p('fluoride', 'Fluoride', 'mg/L', 'number', 0, 20, 0, 1.0, 0, 1.5,
    'Compare in shade; direct sun washes out the pink shades.', 'BIS 10500 acceptable 1.0, permissible 1.5'),
  turbidity: p('turbidity', 'Turbidity', 'NTU', 'number', 0, 1000, 0, 1, 0, 5,
    'Look down through the tube against the printed mark on a white surface.', 'BIS 10500 acceptable 1, permissible 5'),
};
const step = (title: string, detail: string): ProtocolStep => ({ title, detail });
const COLLECT = [step('Wear gloves', 'Clean gloves for every source, so your hands do not contaminate the sample.'),
  step('Flush the source', 'Run the tap or pump for one minute before collecting.'),
  step('Rinse the container', 'Rinse the sample bottle three times with the source water, then fill it.'),
  step('Check the kit', 'Kit in date, strips dry, the pot closed right after taking a strip.')];
const PADS = step('Do not touch the pads', 'Hold the strip by its end; skin oil changes the colours.');
const DIP = 'Dip the strip so every pad is under water for 2 seconds, then hold it flat, pads up.';
const kit = (kit_id: string, name: string, strip_type: string, wait_seconds: number, parameters: KitParameter[],
             dip = DIP, protocol = [...COLLECT, PADS], read_grace_seconds = 60): Kit =>
  ({ kit_id, name, strip_type, dip_instruction: dip, wait_seconds, read_grace_seconds, protocol, parameters });

const KITS: Kit[] = [
  kit('demo-kit-chlorine', 'AquaCheck Chlorine Strip', 'chlorine', 30, [PARAMS.chlorine]),
  kit('demo-kit-coliform', 'AquaCheck Coliform Kit', 'coliform', 86_400, [PARAMS.coliform],
    'Fill the vial to the line, close it, and keep it upright and warm.', [...COLLECT,
      step('Fill to the line', 'Fill the vial exactly to the line; too much or too little changes the result.'),
      step('Keep it warm', 'Keep the vial upright near body temperature until it is read.')]),
  kit('demo-kit-iron', 'AquaCheck Iron Strip', 'iron', 60, [PARAMS.iron]),
  kit('demo-kit-ph', 'AquaCheck pH Strip', 'pH', 20, [PARAMS.ph]),
  kit('demo-kit-tds', 'AquaCheck TDS Meter Strip', 'TDS', 15, [PARAMS.tds], DIP,
    [...COLLECT, step('Calibrate', 'Zero the meter in clean water before the sample.')]),
  kit('demo-kit-multi', 'AquaCheck 6-in-1 Strip', 'multi', 60,
    [PARAMS.ph, PARAMS.chlorine, PARAMS.iron, PARAMS.hardness, PARAMS.nitrate, PARAMS.fluoride], DIP,
    [...COLLECT.slice(0, 3), step('Read in order', 'Read the pads top to bottom against the chart; chlorine fades first.')]),
  kit('demo-kit-turbidity', 'Turbidity Tube', 'turbidity', 10, [PARAMS.turbidity],
    'Fill the tube to the top line with the sample and stand it on a white card.',
    [COLLECT[1], step('Shade and white card', 'Stand in shade and hold the tube over a white card.'),
     step('Read the line', 'Pour out slowly until the mark on the base just appears; read the level.')], 120),
];

const c = (key: string, category: Criterion['category'], question: string, tip: string): Criterion => ({ key, category, question, tip });
const CRITERIA: Criterion[] = [
  c('latrine_nearby', 'sanitary', 'Is there a latrine, soak pit or septic tank within 10 m?', 'Pace it out: about 12 of your steps.'),
  c('animal_waste', 'sanitary', 'Is there animal dung or waste within 10 m?', 'Look around the whole source, not only the spout.'),
  c('standing_water', 'sanitary', 'Is water pooling around the source?', 'Pools let dirty water seep back down the pipe or well.'),
  c('damaged_platform', 'sanitary', 'Is the platform or apron cracked, broken or missing?', 'Check the joint between the pump and the concrete too.'),
  c('drainage_broken', 'sanitary', 'Is the drain channel broken, blocked or missing?', 'Water should run away from the source, not sit beside it.'),
  c('open_or_loose', 'sanitary', 'Is the well open, or is the pump loose on its base?', 'Rock the pump gently; it should not move.'),
  c('garbage_nearby', 'sanitary', 'Is garbage or refuse dumped within 10 m?', 'Include piles hidden behind walls or bushes.'),
  c('recent_flooding', 'sanitary', 'Has the source flooded in the last month?', 'Ask the people collecting water if you are not sure.'),
  c('colour_change', 'observation', 'Does the water look coloured (brown, yellow, green)?', 'Look through a clear bottle against a white sheet.'),
  c('odour', 'observation', 'Does the water smell unusual?', 'Smell straight after filling; odours fade quickly.'),
  c('visible_particles', 'observation', 'Can you see particles or cloudiness?', 'Let the bottle stand one minute and look again.'),
  c('taste_reports', 'observation', 'Do residents report an odd taste?', 'Ask two or three people, not just one.'),
  c('illness_reports', 'observation', 'Do residents report stomach illness after drinking?', 'Any yes here raises the case for your supervisor straight away.'),
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
  screened: [] as Array<{ source_id: string; at: string }>,
  reports: [
    { report_id: 'demo-rep-1', source_id: 'demo-src-pond1', source_name: 'East Plains Pond #1', status: 'open', version: 1,
      risk_level: 'medium', origin: 'screening', created_at: new Date(Date.now() - 86_400_000).toISOString() },
  ] as DemoReport[],
  complaints: [
    { complaint_id: 'demo-c-1', reference_number: 'JS-DEMO0001', complaint_type: 'discoloration', status: 'new',
      source_id: 'demo-src-pond1', source_name: 'East Plains Pond #1', description: 'Water looks brown since yesterday.',
      photo: null, submitted_at: new Date(Date.now() - 3_600_000).toISOString(), resolution: null as string | null },
  ] as DemoComplaint[],
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
  staffMe: () => ok({ role: 'field_worker' as const, team_id: 'demo-team', points: points() }),
  kits: () => ok({ items: KITS, inspection_criteria: CRITERIA, points_rule: RULE, notice: 'Bands are screening bands, not a laboratory result.' }),
  sources: () => ok({ items: SOURCES }),

  createSource(body: NewSource): ApiOutcome<{ source_id: string }> {
    const source_id = `demo-src-${hex()}`;
    SOURCES.push({ source_id, name: body.name, source_type: body.source_type, village: body.village ?? null, current_public_status: 'not_tested' });
    return ok({ source_id });
  },

  submitScreening(token: string, body: ScreeningRequest): ApiOutcome<ScreeningResult> {
    const seen = state.screenings.get(body.local_record_id);
    if (seen) return ok({ ...seen, outcome: 'duplicate' });
    const k = KITS.find((x) => x.kit_id === body.kit_id);
    if (!k || !SOURCES.some((s) => s.source_id === body.source_id)) return refused(404, 'NOT_FOUND');
    const rank: Record<Band, number> = { low: 1, medium: 2, high: 3 };
    const findings = k.parameters.filter((pm) => pm.key in body.readings)
      .map((pm) => ({ parameter: pm.key, value: body.readings[pm.key], level: bandFor(pm, body.readings[pm.key]) }));
    if (body.inspection && Object.keys(body.inspection).some((key) => !CRITERIA.some((x) => x.key === key))) return refused(422, 'VALIDATION_FAILED');
    const readingsWorst = findings.reduce<Band | null>((w, f) => (!w || rank[f.level] > rank[w] ? f.level : w), null);
    const judged = body.inspection ? judgeLocally(CRITERIA, body.inspection) : null;
    const worst = [readingsWorst, judged?.sanitary_level ?? null, judged?.observation_level ?? null]
      .reduce<Band | null>((w, l) => (l && (!w || rank[l] > rank[w]) ? l : w), null);
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
    state.screened.push({ source_id: body.source_id, at: new Date().toISOString() });
    const result: ScreeningResult = {
      test_record_id: `demo-rec-${hex()}`, outcome: 'accepted', report_id, risk_level: worst ?? 'unknown',
      assessment: { risk_level: worst ?? 'unknown', readings_risk: readingsWorst ?? 'unknown', inspection: judged, findings }, points_awarded: qualifies ? 10 : 0, points: points(),
    };
    state.screenings.set(body.local_record_id, result);
    return ok(result);
  },

  myComplaints: () => ok({
    items: state.complaints.map((c): MyComplaint => ({
      reference_number: c.reference_number, complaint_type: c.complaint_type as ComplaintType, status: c.status,
      status_label: { new: 'Received - not yet reviewed', linked: 'Linked to an investigation', resolved: 'Resolved' }[c.status],
      resolution_label: c.resolution === 'dismissed' ? 'Reviewed by a supervisor; no investigation was opened.' : null,
      source_name: c.source_name, submitted_at: c.submitted_at, description: c.description, also: c.also as ComplaintType[],
    })),
  }),

  fileComplaint(body: ComplaintBody) {
    const reference_number = `JS-${hex().slice(0, 8)}D`;
    state.complaints.unshift({
      complaint_id: `demo-c-${hex()}`, reference_number, complaint_type: body.complaint_type, status: 'new',
      source_id: body.source_id ?? null, source_name: sourceName(body.source_id), description: body.description ?? null,
      photo: body.photo ? 'offline-photo' : null, submitted_at: new Date().toISOString(), resolution: null,
      also: body.also ?? [],
    });
    return ok({ reference_number, status_label: 'Received - not yet reviewed',
                notice: 'Saved in the offline demo on this phone only. A complaint is not a test result.' });
  },

  publicMap: () => ok({
    items: SOURCES.map((s, i): MapSource => {
      const mine = state.screened.filter((x) => x.source_id === s.source_id);
      return { source_id: s.source_id, name: s.name, source_type: s.source_type,
        status: s.current_public_status, status_label: STATUS_LABEL[s.current_public_status] ?? 'Not yet tested',
        latitude: 26.85 + i * 0.004, longitude: 80.95 + i * 0.004, location_precision: 'approximate (about 500 m)',
        last_updated: new Date().toISOString(), village: s.village, ward: null,
        last_screened_at: mine.length ? mine[mine.length - 1].at : null, screenings_30d: mine.length,
        open_issues: state.reports.filter((r) => r.source_id === s.source_id && r.status !== 'closed').length, lab_verified_at: null };
    }),
    disclaimer: 'Offline demo data. This list is not a guarantee about any water source.',
  }),

  leaderboard: (): ApiOutcome<Leaderboard> => ok({
    field_workers: [
      { name: 'You (demo)', points: state.points.balance, on: state.points.qualifying, n: state.screened.length },
      { name: 'Asha K.', points: 120, on: 12, n: 15 }, { name: 'Ravi S.', points: 80, on: 8, n: 11 }, { name: 'Meena P.', points: 40, on: 4, n: 9 },
    ].sort((a, b) => b.points - a.points)
      .map((w, i) => ({ rank: i + 1, display_name: w.name, area: 'East Plains', points: w.points, on_time_screenings: w.on, screenings: w.n })),
    areas: [{ rank: 1, area: 'East Plains', sources: SOURCES.length, screenings_30d: state.screened.length,
              open_issues: state.reports.filter((r) => r.status !== 'closed').length }],
    disclaimer: 'Offline demo data. Points reward on-time field screening. They say nothing about whether any water source is safe to drink.',
  }),

  stats(): ApiOutcome<PublicStats> {
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 77);
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(monday.getTime() + i * 7 * 86_400_000);
      const screenings = 8 + ((i * 7) % 5) + (i === 11 ? state.screened.length : 0);
      return { week_start: d.toISOString().slice(0, 10), screenings, flagged: 1 + (i % 3), reports_opened: 1 + (i % 3),
               reports_closed: i % 2, complaints: (i * 3) % 4 };
    });
    const byType: Record<string, number> = {};
    for (const s of SOURCES) byType[s.source_type] = (byType[s.source_type] ?? 0) + 1;
    return ok({
      weeks, risk_30d: { low: 24, medium: 5, high: 2, unknown: 0 }, sources_by_type: byType,
      sources_by_status: { not_tested: SOURCES.length - 1, under_review: 1 }, complaints_by_type: { smell: 3, discoloration: 2, taste: 1 },
      totals: { sources: SOURCES.length, screenings: weeks.reduce((n, w) => n + w.screenings, 0), reports: state.reports.length,
                open_reports: state.reports.filter((r) => r.status !== 'closed').length, escalated_to_authority: 0,
                complaints: state.complaints.length },
      disclaimer: 'Offline demo data. Counts of monitoring activity, not a statement about any water.',
    });
  },
};
