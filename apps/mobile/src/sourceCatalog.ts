/**
 * T07: pure logic behind the S02 Sources screen.
 *
 * Split out of `sources.tsx` so it can actually be tested: Node cannot
 * execute `.tsx` at all (no JSX transform in strip-only TypeScript mode), and
 * no React test renderer is installed - adding one would edit
 * apps/mobile/package.json and the mobile lockfile, which are declared files
 * of T03 (role B). This is a scope addition beyond the four files on the T07
 * card and is flagged in the handoff.
 *
 * Everything here is deterministic and dependency-free. `sources.tsx` holds
 * the JSX and nothing else worth testing.
 *
 * Governing docs:
 *   - ui-ux-specification.md S02: "Search first, QR secondary, recent/assigned
 *     sources; last known record", edge states "Empty assignment; stale
 *     timestamp; unknown QR; permission denied; no coordinates still usable".
 *   - AC-001: "Unknown QR never navigates arbitrary URLs; selecting source
 *     shows last known test with stale timestamp."
 */

/** Mirrors the server bound in services/api/migrations/source.py. */
export const MAX_QR_CODE_LENGTH = 64;

/** Same allowlist as the server's `_QR_TOKEN`. A JalSakshi QR is an opaque
 *  bounded token - never a URL, so there is nothing to navigate to. */
const QR_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface CachedSource {
  id: string;
  qrCode: string;
  label: string;
  locality: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * What a scan produced. Discriminated rather than `CachedSource | null`,
 * because the three cases need three different screens: open the source, "not
 * in your catalogue", and "that is not a JalSakshi code".
 */
export type ScanOutcome =
  | { kind: "matched"; source: CachedSource }
  | { kind: "unknown"; token: string }
  | { kind: "unreadable"; reason: "empty" | "too_long" | "illegal_characters" };

/**
 * Parse a scanned payload.
 *
 * This is the control behind AC-001. A camera will happily decode
 * `https://evil.example/pwn`, and the naive handler opens it. Here anything
 * that is not an allowlisted token becomes `unreadable`, and `unreadable`
 * carries a *reason code only* - never the payload - so there is no path by
 * which scanned bytes reach a Linking.openURL, a WebView, or a log.
 *
 * The allowlist is the control. A blocklist of "dangerous schemes" would need
 * updating forever and would still miss one.
 */
export function parseScannedPayload(payload: string | null | undefined): ScanOutcome {
  if (payload == null) return { kind: "unreadable", reason: "empty" };
  const token = payload.trim();
  if (token.length === 0) return { kind: "unreadable", reason: "empty" };
  // Length before pattern: do not run a regex over a megabyte of scanned data.
  if (token.length > MAX_QR_CODE_LENGTH) return { kind: "unreadable", reason: "too_long" };
  if (!QR_TOKEN.test(token)) return { kind: "unreadable", reason: "illegal_characters" };
  return { kind: "unknown", token };
}

/** Resolve a scan against the locally cached catalogue. */
export function resolveScan(payload: string | null | undefined, cache: readonly CachedSource[]): ScanOutcome {
  const parsed = parseScannedPayload(payload);
  if (parsed.kind !== "unknown") return parsed;
  const source = cache.find((candidate) => candidate.qrCode === parsed.token);
  return source ? { kind: "matched", source } : parsed;
}

/**
 * Never navigate to scanned content. Exported so the screen has one obvious
 * thing to call, and so a test can assert the app has no scan->navigate path
 * at all. There is deliberately no "but allow https" branch: a JalSakshi QR
 * is never a URL, so a URL in a QR is always either a mistake or an attack.
 */
export function isNavigableScan(_outcome: ScanOutcome): false {
  return false;
}

/** Bounded, case-insensitive, accent-naive local search over the cache. */
export function searchCache(cache: readonly CachedSource[], query: string): CachedSource[] {
  const term = query.trim().slice(0, 60).toLowerCase();
  if (!term) return [...cache];
  return cache.filter(
    (source) =>
      source.label.toLowerCase().includes(term) || source.locality.toLowerCase().includes(term),
  );
}

// --- freshness labelling ---------------------------------------------------

export const FRESH_MAX_MS = 60 * 60 * 1000; // 1 hour
export const STALE_MAX_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * How much to trust what is on screen.
 *
 * `unknown` is not a failure mode to be tidied away - it is the correct answer
 * when the device clock cannot be trusted. A field phone's clock can be wrong
 * or rolled back, and AGENTS.md forbids fabricated precision, so an age that
 * computes to "negative" becomes `unknown` rather than being clamped to zero
 * and rendered as "just now".
 */
export type Freshness =
  | { state: "fresh"; ageMs: number }
  | { state: "stale"; ageMs: number }
  | { state: "very_stale"; ageMs: number }
  | { state: "unknown"; reason: "no_server_time" | "clock_unreliable" };

export function freshnessOf(
  servedAtIso: string | null | undefined,
  nowMs: number,
): Freshness {
  if (!servedAtIso) return { state: "unknown", reason: "no_server_time" };
  const servedAt = Date.parse(servedAtIso);
  if (Number.isNaN(servedAt)) return { state: "unknown", reason: "no_server_time" };
  const ageMs = nowMs - servedAt;
  // Data from the future means the device clock is wrong (or was rolled back).
  // Showing "0 minutes ago" would be a fabricated certainty.
  if (ageMs < 0) return { state: "unknown", reason: "clock_unreliable" };
  if (ageMs <= FRESH_MAX_MS) return { state: "fresh", ageMs };
  if (ageMs <= STALE_MAX_MS) return { state: "stale", ageMs };
  return { state: "very_stale", ageMs };
}

/**
 * The exact words shown next to a cached history row.
 *
 * Every variant is qualified. None of them says the source is safe, clean or
 * current: this is the last *recorded screening*, which is not a lab result
 * and not a potability claim (AGENTS.md).
 */
export function freshnessLabel(freshness: Freshness): string {
  switch (freshness.state) {
    case "fresh":
      return "Last known record, updated just now";
    case "stale":
      return `Last known record, ${formatAge(freshness.ageMs)} old`;
    case "very_stale":
      return `Last known record, ${formatAge(freshness.ageMs)} old — may be out of date`;
    case "unknown":
      return freshness.reason === "clock_unreliable"
        ? "Last known record — device clock unreliable, age unknown"
        : "Last known record — never synced, age unknown";
  }
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * A history slice as the screen consumes it: rows plus how stale they are plus
 * whether this came from the network or the cache.
 *
 * `origin` is kept distinct from `freshness` on purpose. "Came from cache" and
 * "is old" are different facts - a cache refreshed one minute ago is current,
 * and a live fetch of a source nobody has tested in a year is not.
 */
export interface HistorySlice {
  sourceId: string;
  entries: readonly HistoryRow[];
  origin: "network" | "cache";
  freshness: Freshness;
  label: string;
}

export interface HistoryRow {
  sampleId: string;
  receivedAtServer: string;
  /** Machine screening outcome only. Never a lab result, never potability. */
  indicativeFlag: string;
  method: string;
}

export function buildHistorySlice(
  sourceId: string,
  entries: readonly HistoryRow[],
  origin: "network" | "cache",
  servedAtIso: string | null | undefined,
  nowMs: number,
): HistorySlice {
  const freshness = freshnessOf(servedAtIso, nowMs);
  return { sourceId, entries, origin, freshness, label: freshnessLabel(freshness) };
}

/**
 * Whether the screen may present this slice without a staleness warning.
 * Only a fresh network read qualifies. Anything from cache is labelled, even
 * when it is recent, because the worker is standing at the source deciding
 * whether to retest.
 */
export function needsStalenessWarning(slice: HistorySlice): boolean {
  return slice.origin === "cache" || slice.freshness.state !== "fresh";
}
