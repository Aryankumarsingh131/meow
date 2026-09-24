// T30: server and reconnect load benchmark (performance-plan.md "Load steps").
//
// Open-loop: requests are scheduled at a fixed arrival rate whether or not
// earlier ones finished, so a slow server shows up as queueing and latency,
// not as a politely slower client. Each request is one POST /v1/sync/push with
// one new sample; 5% re-send an earlier event, which must be answered
// `duplicate` and never create a second row.
//
//   node tests/load/scenarios.js http://127.0.0.1:8010 [seconds-per-step]
//
// Needs the local synthetic dev stack (tokens from /dev/v1/token). Never point
// it at a shared or free-tier deployment. Writes raw samples to
// docs/benchmarks/raw-server-<step>.tsv and a JSON summary on stdout.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:8010';
const SECONDS = Number(process.argv[3] || 60);
const PROTOCOL = { id: 'f96bdca3-5020-5313-b65a-072967c46292', version: 1 };
const TENANTS = {
  a: { user: 'worker', sources: ['97c23cd1-ab42-5db5-b75b-0fe07dfd1923', 'd0133b20-9102-587a-907a-065b61ae17f4'] },
  b: { user: 'other-worker', sources: ['d5c0050b-b422-5cd8-a011-7a7e9eb20138'] },
};
const STEPS = [
  { name: '1rps-hot', rate: 1, mix: ['a'] },
  { name: '10rps-hot', rate: 10, mix: ['a'] },
  { name: '50rps-hot', rate: 50, mix: ['a'] },
  { name: '50rps-two-tenants', rate: 50, mix: ['a', 'b'] },
];

async function token(user) {
  const r = await fetch(`${BASE}/dev/v1/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: 'jalsakshi' }),
  });
  if (!r.ok) throw new Error(`token for ${user}: ${r.status}`);
  return (await r.json()).access_token;
}

function event(sourceId) {
  return {
    event_id: randomUUID(), kind: 'sample.create', schema_version: 1,
    payload: {
      schema_version: 1, sample_id: randomUUID(), source_id: sourceId, protocol: PROTOCOL,
      kit_lot_id: randomUUID(), captured_at_device: new Date().toISOString(),
      timing: { state: 'in_window', elapsed_ms: 31000, valid: true }, method: 'manual',
      observation: {
        machine_bin: null, manual_bin: 'bin_1', selected_bin: 'bin_1', indicative_flag: 'no_flag',
        quality_reasons: ['QUALITY_NOT_ASSESSED'], model_version: null, calibration_version: null,
        confidence: null, override_reason: 'load test',
      },
      evidence_ids: [], client_build: 'load-test', data_mode: 'synthetic',
    },
  };
}

function pct(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
}

async function runStep(step, tokens) {
  const samples = [];
  const sent = new Map(); // tenant -> event ids sent as new
  const inFlight = [];
  const total = step.rate * SECONDS;
  const started = performance.now();
  for (let i = 0; i < total; i++) {
    const due = started + (i * 1000) / step.rate;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const tenant = step.mix[i % step.mix.length];
    const ids = sent.get(tenant) || [];
    const replay = ids.length > 10 && i % 20 === 0;
    const ev = replay ? ids[Math.floor(ids.length / 2)] : event(TENANTS[tenant].sources[i % TENANTS[tenant].sources.length]);
    if (!replay) sent.set(tenant, [...ids, ev]);
    const t0 = performance.now();
    inFlight.push(fetch(`${BASE}/v1/sync/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[tenant]}` },
      body: JSON.stringify({ device_id: randomUUID(), events: [ev] }),
    }).then(async (r) => {
      const body = r.ok ? await r.json() : null;
      samples.push({ ms: performance.now() - t0, http: r.status, result: body?.results?.[0]?.status ?? 'error', replay, tenant });
    }).catch(() => samples.push({ ms: performance.now() - t0, http: 0, result: 'network', replay, tenant })));
  }
  await Promise.all(inFlight);
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const count = (f) => samples.filter(f).length;
  const file = path.join('docs', 'benchmarks', `raw-server-${step.name}.tsv`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'ms\thttp\tresult\treplay\ttenant\n' +
    samples.map((s) => `${s.ms.toFixed(2)}\t${s.http}\t${s.result}\t${s.replay}\t${s.tenant}`).join('\n') + '\n');
  return {
    step: step.name, target_rps: step.rate, seconds: SECONDS, requests: samples.length,
    achieved_rps: +(samples.length / ((performance.now() - started) / 1000)).toFixed(1),
    new_sent: [...sent.values()].reduce((n, v) => n + v.length, 0),
    accepted: count((s) => s.result === 'accepted'),
    duplicate_on_replay: count((s) => s.replay && s.result === 'duplicate'),
    replays: count((s) => s.replay),
    errors: count((s) => s.http !== 200 || !['accepted', 'duplicate'].includes(s.result)),
    ms: { p50: +pct(ms, 0.5).toFixed(1), p95: +pct(ms, 0.95).toFixed(1), p99: +pct(ms, 0.99).toFixed(1), max: +ms[ms.length - 1].toFixed(1) },
  };
}

(async () => {
  const tokens = { a: await token(TENANTS.a.user), b: await token(TENANTS.b.user) };
  const results = [];
  for (const step of STEPS) results.push(await runStep(step, tokens));
  console.log(JSON.stringify(results, null, 1));
})();
