/**
 * T07 verification for the S02 Sources screen logic (search / QR / offline).
 *
 * Scope addition beyond the T07 card, flagged in the handoff: the card names
 * `apps/mobile/src/sources.tsx` but no check for it, and that file cannot be
 * executed under Node (no JSX transform, no React test renderer installed).
 * The testable logic therefore lives in `apps/mobile/src/sourceCatalog.ts`
 * and is exercised here.
 *
 * Run:  node tests/sources_client.test.ts
 */

import assert from "node:assert/strict";

import {
  FRESH_MAX_MS,
  STALE_MAX_MS,
  buildHistorySlice,
  freshnessLabel,
  freshnessOf,
  isNavigableScan,
  needsStalenessWarning,
  parseScannedPayload,
  resolveScan,
  searchCache,
  type CachedSource,
  type HistoryRow,
} from "../apps/mobile/src/sourceCatalog.ts";

const CACHE: CachedSource[] = [
  { id: "src-a1", qrCode: "JS-A-0001", label: "Handpump 1", locality: "Sundarpur", latitude: null, longitude: null },
  { id: "src-a2", qrCode: "JS-A-0002", label: "Handpump 2", locality: "Sundarpur", latitude: 25.1, longitude: 82.3 },
  { id: "src-a3", qrCode: "JS-A-0003", label: "Well North", locality: "Rampur", latitude: null, longitude: null },
];

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// --- QR safety (AC-001) ----------------------------------------------------

test("hostile QR payloads are unreadable and never navigable", () => {
  const hostile = [
    "https://evil.example/pwn",
    "http://10.0.0.1/admin",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html;base64,PHNjcmlwdD4=",
    "jalsakshi://auth?code=stolen",
    "intent://scan/#Intent;scheme=http;end",
    "content://com.android.providers/secret",
    "//evil.example",
    "‮evil.example",
  ];
  for (const payload of hostile) {
    const outcome = parseScannedPayload(payload);
    assert.equal(outcome.kind, "unreadable", `${payload} was not rejected`);
    assert.equal(isNavigableScan(outcome), false);
  }
});

test("unreadable outcome never carries the scanned payload", () => {
  const outcome = parseScannedPayload("https://evil.example/<script>alert(1)</script>");
  assert.equal(outcome.kind, "unreadable");
  const serialised = JSON.stringify(outcome);
  assert.ok(!serialised.includes("evil.example"), serialised);
  assert.ok(!serialised.includes("script"), serialised);
});

test("no scan outcome is ever navigable, including a valid match", () => {
  for (const payload of ["JS-A-0001", "JS-A-9999", "https://evil.example", "", null]) {
    assert.equal(isNavigableScan(resolveScan(payload, CACHE)), false);
  }
});

test("empty and oversized payloads are typed, not crashes", () => {
  for (const payload of [null, undefined, "", "   "]) {
    const outcome = parseScannedPayload(payload);
    assert.equal(outcome.kind, "unreadable");
    assert.equal(outcome.kind === "unreadable" ? outcome.reason : null, "empty");
  }
  const big = parseScannedPayload("A".repeat(5000));
  assert.equal(big.kind === "unreadable" ? big.reason : null, "too_long");
});

test("known QR matches and unknown QR is distinct from unreadable", () => {
  const matched = resolveScan("JS-A-0001", CACHE);
  assert.equal(matched.kind, "matched");
  assert.equal(matched.kind === "matched" ? matched.source.id : null, "src-a1");

  // Well-formed but not in the catalogue: the worker should be told "not in
  // your list", not "that is not a valid code".
  const unknown = resolveScan("JS-A-9999", CACHE);
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.kind === "unknown" ? unknown.token : null, "JS-A-9999");
});

test("unknown QR against an empty cache does not throw", () => {
  assert.equal(resolveScan("JS-A-0001", []).kind, "unknown");
});

test("source without coordinates is still selectable", () => {
  const matched = resolveScan("JS-A-0001", CACHE);
  assert.equal(matched.kind, "matched");
  assert.equal(matched.kind === "matched" ? matched.source.latitude : "x", null);
});

// --- search ----------------------------------------------------------------

test("search matches label and locality, case-insensitively", () => {
  assert.deepEqual(searchCache(CACHE, "well").map((s) => s.id), ["src-a3"]);
  assert.deepEqual(searchCache(CACHE, "RAMPUR").map((s) => s.id), ["src-a3"]);
  assert.equal(searchCache(CACHE, "Handpump").length, 2);
});

test("blank search returns everything, no match returns nothing", () => {
  assert.equal(searchCache(CACHE, "   ").length, CACHE.length);
  assert.equal(searchCache(CACHE, "nonexistent").length, 0);
});

test("search does not treat input as a pattern", () => {
  // These are literal characters in a local search, not wildcards.
  assert.equal(searchCache(CACHE, "%").length, 0);
  assert.equal(searchCache(CACHE, ".*").length, 0);
  assert.equal(searchCache(CACHE, "_").length, 0);
});

test("search term is bounded, observably", () => {
  // As with the server test: assert the truncation is visible, not merely
  // that a silly query returns nothing (true with or without the bound).
  // A 60-char label matches a 70-char query only if the term was cut to 60.
  const label = "A".repeat(60);
  const cache: CachedSource[] = [
    { id: "src-long", qrCode: "JS-A-0100", label, locality: "Sundarpur", latitude: null, longitude: null },
  ];
  assert.deepEqual(searchCache(cache, "A".repeat(70)).map((s) => s.id), ["src-long"]);
});

test("empty assignment is an empty list, not an error", () => {
  assert.deepEqual(searchCache([], "anything"), []);
  assert.deepEqual(searchCache([], ""), []);
});

// --- offline / staleness (AC-001 second half) ------------------------------

const NOW = Date.parse("2026-09-22T12:00:00Z");
const rows: HistoryRow[] = [
  { sampleId: "smp-1", receivedAtServer: "2026-09-01T10:00:00Z", indicativeFlag: "review", method: "assisted" },
];

test("freshness buckets follow the declared thresholds", () => {
  assert.equal(freshnessOf(new Date(NOW - 1000).toISOString(), NOW).state, "fresh");
  assert.equal(freshnessOf(new Date(NOW - FRESH_MAX_MS + 1000).toISOString(), NOW).state, "fresh");
  assert.equal(freshnessOf(new Date(NOW - FRESH_MAX_MS - 1000).toISOString(), NOW).state, "stale");
  assert.equal(freshnessOf(new Date(NOW - STALE_MAX_MS - 1000).toISOString(), NOW).state, "very_stale");
});

test("missing or unparseable server time is unknown, not assumed fresh", () => {
  for (const value of [null, undefined, "", "not-a-date"]) {
    const freshness = freshnessOf(value, NOW);
    assert.equal(freshness.state, "unknown");
    assert.equal(freshness.state === "unknown" ? freshness.reason : null, "no_server_time");
  }
});

test("a future timestamp reports an unreliable clock rather than 'just now'", () => {
  // A rolled-back device clock must never render as fabricated freshness.
  const freshness = freshnessOf(new Date(NOW + 3_600_000).toISOString(), NOW);
  assert.equal(freshness.state, "unknown");
  assert.equal(freshness.state === "unknown" ? freshness.reason : null, "clock_unreliable");
});

test("every freshness label is qualified and claims no safety", () => {
  const labels = [
    freshnessLabel(freshnessOf(new Date(NOW - 1000).toISOString(), NOW)),
    freshnessLabel(freshnessOf(new Date(NOW - 7_200_000).toISOString(), NOW)),
    freshnessLabel(freshnessOf(new Date(NOW - 5 * STALE_MAX_MS).toISOString(), NOW)),
    freshnessLabel(freshnessOf(null, NOW)),
    freshnessLabel(freshnessOf(new Date(NOW + 1000).toISOString(), NOW)),
  ];
  for (const label of labels) {
    assert.match(label, /last known record/i, `unqualified label: ${label}`);
    // AGENTS.md: screening is not potability. No label may imply a verdict.
    assert.ok(!/\b(safe|clean|potable|drinkable|pass(ed)?|ok to drink)\b/i.test(label), label);
    assert.ok(!/\bcurrent\b/i.test(label), label);
  }
});

test("cached history is labelled stale even when recently refreshed", () => {
  const slice = buildHistorySlice("src-a1", rows, "cache", new Date(NOW - 1000).toISOString(), NOW);
  assert.equal(slice.freshness.state, "fresh");
  // Fresh, but still from cache - the worker is standing at the source.
  assert.equal(needsStalenessWarning(slice), true);
});

test("only a fresh network read escapes the staleness warning", () => {
  const live = buildHistorySlice("src-a1", rows, "network", new Date(NOW - 1000).toISOString(), NOW);
  assert.equal(needsStalenessWarning(live), false);
  const oldLive = buildHistorySlice("src-a1", rows, "network", "2026-09-01T10:00:00Z", NOW);
  assert.equal(needsStalenessWarning(oldLive), true);
  const noTime = buildHistorySlice("src-a1", rows, "network", null, NOW);
  assert.equal(needsStalenessWarning(noTime), true);
});

test("origin and freshness stay separate facts", () => {
  const slice = buildHistorySlice("src-a1", rows, "cache", "2026-09-01T10:00:00Z", NOW);
  assert.equal(slice.origin, "cache");
  assert.equal(slice.freshness.state, "very_stale");
  // Collapsing these into one boolean would lose which one is true.
  assert.ok("origin" in slice && "freshness" in slice);
});

test("history rows keep screening provenance separate from any verdict", () => {
  const slice = buildHistorySlice("src-a1", rows, "network", "2026-09-22T11:59:00Z", NOW);
  const row = slice.entries[0];
  assert.equal(row.indicativeFlag, "review");
  assert.equal(row.method, "assisted");
  assert.ok(!("result" in row), "a merged 'result' field would collapse provenance");
  assert.ok(!("safe" in row));
});

test("a source with no history yields an empty labelled slice, not an error", () => {
  const slice = buildHistorySlice("src-a2", [], "cache", null, NOW);
  assert.deepEqual(slice.entries, []);
  assert.equal(needsStalenessWarning(slice), true);
  assert.match(slice.label, /never synced/i);
});

test("sources.tsx contains no navigation/eval path for scanned content", async () => {
  // sources.tsx cannot be executed here (no JSX transform under Node, no
  // React test renderer installed - that would edit T03's lockfile), so this
  // is a source-level guard on the one property that file must hold. tsc
  // type-checks it separately via apps/mobile/tsconfig.json.
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../apps/mobile/src/sources.tsx", import.meta.url),
    "utf8",
  );
  const forbidden = [
    /Linking\./,
    /openURL/,
    /WebView/,
    /\beval\(/,
    /dangerouslySetInnerHTML/,
    /new\s+Function\(/,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(source), `sources.tsx matches forbidden pattern ${pattern}`);
  }
  // The screen must route scans through the validating resolver.
  assert.ok(/resolveScan\(/.test(source), "sources.tsx does not use resolveScan");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
