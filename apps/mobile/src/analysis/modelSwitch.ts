/**
 * T37 kill switch: the server lists model files (by SHA-256) that must no
 * longer be used. The last list heard is kept on the phone, so a model
 * switched off stays off while offline. The check runs on every analysis, not
 * once per launch, so it applies as soon as the list arrives.
 */

import { request } from '../api.ts';
import { getMeta, setMeta, type Sql } from '../storage.ts';
import type { ModelState } from './model';

const KEY = 'disabled_models';

export async function refreshDisabledModels(sql: Sql, base: string, fetchImpl?: typeof fetch): Promise<void> {
  const r = await request<{ sha256?: unknown }>(base, '/models/disabled', { fetchImpl });
  // Only a well-formed answer replaces the list; a failure keeps the last one.
  if (r.kind === 'ok' && Array.isArray(r.value.sha256) && r.value.sha256.every((s) => typeof s === 'string')) {
    setMeta(sql, KEY, JSON.stringify(r.value.sha256));
  }
}

export function applyModelSwitch(state: ModelState, sql: Sql): ModelState {
  if (state.kind !== 'ready') return state;
  const disabled: string[] = JSON.parse(getMeta(sql, KEY) ?? '[]');
  return disabled.includes(state.model.manifest.sha256) ? { kind: 'unavailable', problem: 'model_disabled' } : state;
}
