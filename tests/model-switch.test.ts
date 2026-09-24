/**
 * T37: a model switched off on the server stops being used on the phone,
 * stays off while offline, and a bad answer never clears the list.
 *
 * Run: node tests/model-switch.test.ts
 */

import assert from 'node:assert/strict';

import type { LoadedModel, ModelState } from '../apps/mobile/src/analysis/model.ts';
import { applyModelSwitch, refreshDisabledModels } from '../apps/mobile/src/analysis/modelSwitch.ts';
import { migrate } from '../apps/mobile/src/storage.ts';
import { nodeSql } from './sqlNode.ts';

const SHA = 'a'.repeat(64);
const ready: ModelState = { kind: 'ready', model: { manifest: { sha256: SHA } } as unknown as LoadedModel };
const serves = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const offline = (async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;

const sql = nodeSql();
migrate(sql);

assert.equal(applyModelSwitch(ready, sql), ready, 'nothing heard yet: the model runs');

await refreshDisabledModels(sql, 'https://api', serves({ sha256: [SHA] }));
assert.deepEqual(applyModelSwitch(ready, sql), { kind: 'unavailable', problem: 'model_disabled' });

await refreshDisabledModels(sql, 'https://api', offline);
await refreshDisabledModels(sql, 'https://api', serves({ code: 'INTERNAL_ERROR' }, 500));
await refreshDisabledModels(sql, 'https://api', serves({ sha256: 'not-a-list' }));
assert.equal(applyModelSwitch(ready, sql).kind, 'unavailable', 'offline, errors and junk keep it switched off');

await refreshDisabledModels(sql, 'https://api', serves({ sha256: [] }));
assert.equal(applyModelSwitch(ready, sql), ready, 'the server re-enabling it is heard');

const broken: ModelState = { kind: 'unavailable', problem: 'sha_mismatch' };
assert.equal(applyModelSwitch(broken, sql), broken, 'an existing problem is never masked');

console.log('ok - model kill switch: 5 checks');
