/**
 * T33: the phone's side of request tracing. When a server call fails, keep
 * the server's request id so a worker can quote it and support can find the
 * exact server log line (services/api/app/telemetry.py).
 *
 * In memory only, the last 20 failures, and deliberately thin: time, path
 * WITHOUT its query (signed evidence URLs carry tokens there), status, code,
 * request id. Never tokens, bodies, names, photos or locations.
 */

export interface FailureRecord {
  at: string;
  path: string;
  status: number;
  code: string | null;
  requestId: string | null;
}

const MAX = 20;
const records: FailureRecord[] = [];

export function recordFailure(path: string, status: number, code: string | null, requestId: string | null): void {
  records.push({ at: new Date().toISOString(), path: path.split('?')[0], status, code, requestId });
  if (records.length > MAX) records.splice(0, records.length - MAX);
}

export function failures(): readonly FailureRecord[] {
  return [...records];
}

export function lastReference(): string | null {
  for (let i = records.length - 1; i >= 0; i--) if (records[i].requestId) return records[i].requestId;
  return null;
}

export function clearDiagnostics(): void {
  records.length = 0;
}
