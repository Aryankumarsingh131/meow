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

export interface Kit {
  kit_id: string;
  name: string;
  strip_type: string;
  dip_instruction: string | null;
  wait_seconds: number;
  read_grace_seconds: number;
  parameters: KitParameter[];
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
