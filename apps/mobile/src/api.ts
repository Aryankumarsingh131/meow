/**
 * HTTP client for the JalSakshi API.
 *
 * Every call returns a discriminated outcome. "Offline", "sign in again" and
 * "the server refused" need different screens, and a thrown exception or a
 * boolean would let a caller collapse them.
 *
 * Budgets are api-contracts.md's: 10 s total per ordinary request. A timeout
 * is reported as `offline`; for a mutation it does NOT prove the server did
 * nothing (T15 reconciles by idempotency key before retrying).
 *
 * Sign-in goes to the synthetic dev issuer (ADR-M1-002). The token is held in
 * memory only: T06's handoff forbids persisting it until secure storage exists.
 */

import type { CachedSource } from './sourceCatalog';

/** Android emulator's alias for the host machine. */
export const DEV_API_BASE = 'http://10.0.2.2:8000';

export const REQUEST_TIMEOUT_MS = 10_000;

export type ApiOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'auth_required' }
  | { kind: 'offline' }
  | { kind: 'failed'; status: number; code: string | null; retryable: boolean };

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  token?: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function request<T>(base: string, path: string, opts: RequestOptions = {}): Promise<ApiOutcome<T>> {
  const { method = 'GET', token, body, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(base + path, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { kind: 'offline' };
  } finally {
    clearTimeout(timer);
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // A non-JSON body (e.g. a proxy error page) is handled by status below.
  }
  if (response.ok) return { kind: 'ok', value: json as T };
  if (response.status === 401) return { kind: 'auth_required' };
  const problem = (json ?? {}) as { code?: unknown; retryable?: unknown };
  return {
    kind: 'failed',
    status: response.status,
    code: typeof problem.code === 'string' ? problem.code : null,
    retryable: problem.retryable === true || [408, 429, 502, 503, 504].includes(response.status),
  };
}

export interface SignedIn {
  token: string;
  /** Token subject: the account id. Keys on-device data to one account. */
  subject: string;
  /** Device-clock estimate only; the server's `exp` is what is enforced. */
  expiresAtMs: number;
}

/** Decode (NOT verify) a JWT payload. The server verifies; this only reads `sub`. */
export function jwtSubject(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(b64)) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function signIn(
  base: string, username: string, password: string, opts: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<ApiOutcome<SignedIn>> {
  const r = await request<{ access_token: string; expires_in: number }>(base, '/dev/v1/token', {
    method: 'POST', body: { username: username.trim(), password }, fetchImpl: opts.fetchImpl,
  });
  if (r.kind !== 'ok') return r;
  const subject = jwtSubject(r.value.access_token);
  if (!subject) return { kind: 'failed', status: 200, code: 'MALFORMED_TOKEN', retryable: false };
  const now = (opts.now ?? Date.now)();
  return { kind: 'ok', value: { token: r.value.access_token, subject, expiresAtMs: now + r.value.expires_in * 1000 } };
}

interface SourcesPage {
  items: Array<{ id: string; qr_code: string; label: string; locality: string; latitude: number | null; longitude: number | null }>;
  next_cursor: string | null;
  served_at: string;
}

/** Upper bound on pages, so a server bug cannot make the phone loop forever. */
export const MAX_CATALOGUE_PAGES = 50;

/**
 * Fetch the whole assigned catalogue.
 *
 * `servedAt` is the FIRST page's server time: the oldest moment the snapshot
 * reflects, so staleness is never understated.
 */
export async function fetchCatalogue(
  base: string, token: string, fetchImpl?: typeof fetch,
): Promise<ApiOutcome<{ items: CachedSource[]; servedAt: string }>> {
  const items: CachedSource[] = [];
  let servedAt: string | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_CATALOGUE_PAGES; page++) {
    const query: string = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : '?limit=100';
    const r: ApiOutcome<SourcesPage> = await request<SourcesPage>(base, `/v1/sources${query}`, { token, fetchImpl });
    if (r.kind !== 'ok') return r;
    servedAt ??= r.value.served_at;
    for (const s of r.value.items) {
      items.push({ id: s.id, qrCode: s.qr_code, label: s.label, locality: s.locality, latitude: s.latitude, longitude: s.longitude });
    }
    cursor = r.value.next_cursor;
    if (!cursor) return { kind: 'ok', value: { items, servedAt: servedAt! } };
  }
  return { kind: 'failed', status: 0, code: 'TOO_MANY_PAGES', retryable: false };
}
