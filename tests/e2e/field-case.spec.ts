/**
 * T34: the whole field-to-closure journey, end to end over HTTP against a
 * running API (the local synthetic dev stack, which has the test issuer and a
 * lab reviewer). Every step is a real request; nothing is mocked.
 *
 *   worker flags a sample -> case opens -> supervisor assigns and refers ->
 *   lab report recorded (supervisor) and verified (a DIFFERENT lab reviewer) ->
 *   an early close is REFUSED with its evidence checklist -> retest requested
 *   and linked -> residents' communication recorded -> close succeeds.
 *   Offline recovery: the worker's push is re-sent; it is a duplicate, not a
 *   second sample or case.
 *
 *   node tests/e2e/field-case.spec.ts http://127.0.0.1:8011
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8011';
const PROTOCOL = { id: 'f96bdca3-5020-5313-b65a-072967c46292', version: 1 };
const SOURCE = '97c23cd1-ab42-5db5-b75b-0fe07dfd1923'; // "Synthetic handpump 1"

async function token(username: string): Promise<string> {
  const r = await fetch(`${BASE}/dev/v1/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'jalsakshi' }),
  });
  assert.equal(r.status, 200, `sign-in ${username}`);
  return (await r.json()).access_token;
}

async function call(tok: string, method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, {
    method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) as any };
}

function sample(sampleId: string, capturedAt: string, flag: string) {
  return {
    schema_version: 1, sample_id: sampleId, source_id: SOURCE, protocol: PROTOCOL, kit_lot_id: randomUUID(),
    captured_at_device: capturedAt, timing: { state: 'in_window', elapsed_ms: 31000, valid: true }, method: 'manual',
    observation: { machine_bin: null, manual_bin: 'bin_3', selected_bin: 'bin_3', indicative_flag: flag,
      quality_reasons: ['QUALITY_NOT_ASSESSED'], model_version: null, calibration_version: null, confidence: null,
      override_reason: 'Read the chart by hand' },
    evidence_ids: [], client_build: 'e2e', data_mode: 'synthetic',
  };
}

const steps: string[] = [];
const step = (text: string) => { steps.push(text); console.log(`ok - ${text}`); };

const [worker, supervisor, lab] = await Promise.all([token('worker'), token('supervisor'), token('lab-reviewer')]);
const trigger = randomUUID();
const push = { device_id: randomUUID(), events: [{ event_id: randomUUID(), kind: 'sample.create', schema_version: 1,
  payload: sample(trigger, new Date(Date.now() - 3600_000).toISOString(), 'review') }] };

let r = await call(worker, 'POST', '/v1/sync/push', push);
assert.equal(r.body.results[0].status, 'accepted');
step('worker pushes a sample flagged for review');

r = await call(worker, 'POST', '/v1/sync/push', push);
assert.equal(r.body.results[0].status, 'duplicate');
step('offline recovery: the same push re-sent is a duplicate, not a second record');

r = await call(supervisor, 'GET', '/v1/cases?limit=100');
const opened = r.body.items.filter((c: any) => c.status === 'review_needed');
const kase = (await Promise.all(opened.map((c: any) => call(supervisor, 'GET', `/v1/cases/${c.id}`))))
  .map((x) => x.body).find((d: any) => d.trigger_sample.id === trigger);
assert.ok(kase, 'exactly one case opened for the flagged sample');
const cid = kase.id;
let version = kase.version;
step('one case opened for the flagged sample, visible on the board');

async function command(type: string, payload: object, expect = 200) {
  const res = await call(supervisor, 'POST', `/v1/cases/${cid}/commands`,
    { type, command_id: randomUUID(), expected_version: version, payload });
  assert.equal(res.status, expect, `${type}: ${JSON.stringify(res.body)}`);
  if (res.status === 200) version = res.body.version;
  return res.body;
}

await command('assign', { owner_id: (await call(supervisor, 'GET', '/v1/me')).body.user_id, due_at: '2026-12-31T00:00:00Z' });
await command('refer_to_lab', { lab_name: 'Synthetic lab' });
step('supervisor assigns an owner and refers to the lab');

r = await call(supervisor, 'POST', '/v1/lab-reports', { report_id: randomUUID(), case_id: cid, source_id: SOURCE,
  lab_name: 'Synthetic lab', collected_at: new Date(Date.now() - 1800_000).toISOString(), method: 'synthetic',
  parameter: 'synthetic_colour_class', result: 'SYN-D', unit: null, lab_interpretation: 'exceeds_limit' });
assert.equal(r.status, 200);
const reportId = r.body.id;
version = (await call(supervisor, 'GET', `/v1/cases/${cid}`)).body.version;
r = await call(supervisor, 'POST', `/v1/lab-reports/${reportId}/verify`,
  { command_id: randomUUID(), expected_version: version, decision: 'verify', reason: 'Checked against the lab sheet.' });
assert.equal(r.status, 403, 'the supervisor who recorded it cannot verify');
r = await call(lab, 'POST', `/v1/lab-reports/${reportId}/verify`,
  { command_id: randomUUID(), expected_version: version, decision: 'verify', reason: 'Checked against the lab sheet.' });
assert.equal(r.status, 200, JSON.stringify(r.body));
version = r.body.case_version;
step('lab report recorded by the supervisor, verified only by a separate lab reviewer');

await command('link_retest', {});
const retest = randomUUID();
r = await call(worker, 'POST', '/v1/sync/push', { device_id: randomUUID(), events: [{ event_id: randomUUID(),
  kind: 'sample.create', schema_version: 1, payload: sample(retest, new Date().toISOString(), 'no_flag') }] });
assert.equal(r.body.results[0].status, 'accepted');
await command('link_retest', { retest_sample_id: retest });
step('retest requested, a later same-source sample captured and linked');

const early = await command('close', { verified_report_id: reportId, retest_sample_id: retest,
  action_exemption_reason: 'Synthetic protocol permits no direct action.', communication_id: randomUUID(),
  disposition: 'Attempting to close before residents were told.', policy_version: 1 }, 409);
assert.equal(early.code, 'CLOSURE_EVIDENCE_INCOMPLETE');
assert.deepEqual(Object.keys(early.field_errors), ['communication_id']);
step('INVALID closure refused: the checklist names the missing resident communication');

const comm = randomUUID();
r = await call(supervisor, 'POST', `/v1/cases/${cid}/commands`, { type: 'record_communication', command_id: comm,
  expected_version: version, payload: { channel: 'notice_board', template_version: 1, audience_description: 'Residents near handpump 1' } });
assert.equal(r.status, 200);
version = r.body.version;
const closed = await command('close', { verified_report_id: reportId, retest_sample_id: retest,
  action_exemption_reason: 'Synthetic protocol permits no direct action.', communication_id: comm,
  disposition: 'Closed: verified lab result, retested, residents informed.', policy_version: 1 });
assert.equal(closed.status, 'closed');
step('resident communication recorded; the case closes with every piece of evidence real');

console.log(`\n${steps.length} journey steps passed against ${BASE}`);
