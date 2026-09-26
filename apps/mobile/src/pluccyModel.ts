/**
 * Pluccy's rules, as pure functions (tests/pluccy.test.ts).
 *
 * The server is the authority: it re-checks every reading and assesses risk
 * with the same bands (006 `assess_readings`). This preview only lets Pluccy
 * react while the worker types. Band words are "within band / watch /
 * outside band" - a screening band, never a drinking-water verdict.
 */

export interface KitParameter {
  key: string;
  label: string;
  unit: string;
  input_kind: 'number' | 'presence';
  min: number;
  max: number;
  ok_min: number | null;
  ok_max: number | null;
  watch_min: number | null;
  watch_max: number | null;
  tip: string;
  basis: string;
}

export interface ProtocolStep {
  title: string;
  detail: string;
}

export interface Kit {
  kit_id: string;
  name: string;
  strip_type: string;
  dip_instruction: string | null;
  wait_seconds: number;
  read_grace_seconds: number;
  protocol?: ProtocolStep[];
  parameters: KitParameter[];
}

/** One judgement question asked at the source (009 inspection_criteria). */
export interface Criterion {
  key: string;
  category: 'sanitary' | 'observation';
  question: string;
  tip: string;
}

export interface Judgement {
  sanitary_score: number;
  sanitary_total: number;
  sanitary_level: Band;
  observation_level: Band;
  flagged: string[];
}

/** Preview of the server's judge(): sanitary 0-2 low, 3-4 medium, 5+ high;
 *  any observation medium, reported illness high. The server decides. */
export function judgeLocally(criteria: Criterion[], answers: Record<string, boolean>): Judgement {
  const category = new Map(criteria.map((c) => [c.key, c.category]));
  const flagged = Object.keys(answers).filter((k) => answers[k] && category.has(k)).sort();
  const score = flagged.filter((k) => category.get(k) === 'sanitary').length;
  const observed = flagged.filter((k) => category.get(k) === 'observation');
  return {
    sanitary_score: score,
    sanitary_total: criteria.filter((c) => c.category === 'sanitary').length,
    sanitary_level: score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low',
    observation_level: observed.includes('illness_reports') ? 'high' : observed.length ? 'medium' : 'low',
    flagged,
  };
}

/** The steps of several kits as one checklist: a step shared by kits (same title) appears once. */
export function mergedProtocol(kits: Kit[]): ProtocolStep[] {
  const seen = new Set<string>();
  const steps: ProtocolStep[] = [];
  for (const kit of kits) {
    for (const step of kit.protocol ?? []) {
      if (seen.has(step.title)) continue;
      seen.add(step.title);
      steps.push(step);
    }
  }
  return steps;
}

export type AdviceStage = 'source' | 'kits' | 'protocol' | 'inspection' | 'dip' | 'wait' | 'readings' | 'photo' | 'review';

/** Pluccy's field tips. Worker-facing handling advice only: never a verdict on
 *  the water and never treatment advice for residents. */
export const ADVICE: Record<AdviceStage, string[]> = {
  source: ['Pick the source you are standing at. Wrong source, wrong case.', 'New source? Add it here with the phone\'s GPS.',
    'Test the busiest sources first: more people drink from them.'],
  kits: ['You can run several kits on one sample. Pluccy keeps a timer for each.', 'Check the expiry date on every pot before you start.',
    'Use a fresh strip for every kit; never dip one strip twice.'],
  protocol: ['Flushing clears water that has sat in the pipe; it gives a truer sample.', 'Gloves stop your hands changing the result.',
    'Tick each step only when you have really done it.'],
  inspection: ['Walk all the way round the source before answering.', 'If you are unsure, ask the people collecting water.',
    'A sanitary risk is about the surroundings, not the water colour.'],
  dip: ['Dip every pad fully for two seconds; half-dipped pads read wrong.', 'Hold strips flat after dipping so colours do not run.',
    'Start each timer the moment the strip leaves the water.'],
  wait: ['Keep strips out of direct sun while they develop.', 'Do not blow on or shake the strip while waiting.',
    'Reading too early or too late changes the colour; wait for the buzz.'],
  readings: ['Read in daylight or white light, never under a coloured bulb.', 'Between two colours? Enter the closer one; note it if unsure.',
    'Chlorine fades first, so read it first.'],
  photo: ['Put the strip right next to the chart so both are in the photo.', 'Use the torch in dark places; avoid glare on the strip.',
    'Hold still and tap the shutter once the frame guide lines up.'],
  review: ['Check the source name once more before sending.', 'Sending needs a connection; retrying never sends it twice.'],
};

/** What Pluccy tells the worker to do after a result. */
export function nextSteps(risk: 'unknown' | Band, judgement: Judgement | null): string[] {
  const steps: string[] = [];
  if (risk === 'high') steps.push('A case is open for your supervisor. Label and keep the sample bottle for the lab.');
  if (risk === 'medium') steps.push('Your supervisor can see this. Plan a repeat screening within a week.');
  if (risk === 'low') steps.push('Screen this source again on its normal schedule.');
  if (judgement && judgement.sanitary_level !== 'low') steps.push('Note the sanitary problems for the repair team; photos help.');
  if (judgement?.flagged.includes('illness_reports')) steps.push('People report illness: tell your supervisor by phone today as well.');
  steps.push('Rinse the kit, close the pots and wash your hands.');
  return steps;
}

export type Band = 'low' | 'medium' | 'high';

const inside = (v: number, lo: number | null, hi: number | null) => (lo === null || v >= lo) && (hi === null || v <= hi);

export function bandFor(p: KitParameter, value: number): Band {
  if (inside(value, p.ok_min, p.ok_max)) return 'low';
  if (inside(value, p.watch_min, p.watch_max)) return 'medium';
  return 'high';
}

export const BAND_TEXT: Record<Band, string> = {
  low: 'Within screening band',
  medium: 'Watch band',
  high: 'Outside screening band',
};

/** A typed value, or why it cannot be sent. */
export function parseReading(p: KitParameter, raw: string): { value: number } | { error: string } {
  const text = raw.trim().replace(',', '.');
  if (!text) return { error: 'Enter a value' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { error: 'Numbers only' };
  if (p.input_kind === 'presence' && value !== 0 && value !== 1) return { error: 'Choose present or absent' };
  if (value < p.min || value > p.max) return { error: `Between ${p.min} and ${p.max}` };
  return { value };
}

/** Where the strip is in its timing, from the dip time and now (ms). */
export type ReadPhase =
  | { phase: 'waiting'; secondsLeft: number }
  | { phase: 'read_now'; secondsLeft: number }   // inside the grace period: read it now
  | { phase: 'late' };

export function readPhase(dipMs: number, nowMs: number, kit: Pick<Kit, 'wait_seconds' | 'read_grace_seconds'>): ReadPhase {
  const elapsed = (nowMs - dipMs) / 1000;
  if (elapsed < kit.wait_seconds) return { phase: 'waiting', secondsLeft: Math.ceil(kit.wait_seconds - elapsed) };
  const graceLeft = kit.wait_seconds + kit.read_grace_seconds - elapsed;
  return graceLeft >= 0 ? { phase: 'read_now', secondsLeft: Math.floor(graceLeft) } : { phase: 'late' };
}

export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** The milestone crossed by going from `before` to `after` qualifying screenings, if any. */
export function milestoneReached(before: number, after: number, milestones: number[]): number | null {
  return milestones.find((m) => before < m && after >= m) ?? null;
}
