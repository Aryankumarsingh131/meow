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
 * Sign-in goes to Supabase Auth when the build sets EXPO_PUBLIC_SUPABASE_URL
 * and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (hosted deployments), otherwise to
 * the synthetic dev issuer (ADR-M1-002). The token is held in memory only:
 * T06's handoff forbids persisting it until secure storage exists.
 */

import { recordFailure } from './diagnostics.ts';
import type { CachedSource } from './sourceCatalog';

/** The backend, for every build: the local API behind ngrok
 *  (tools/dev_tunnel.sh), so it is only up while that script runs.
 *  EXPO_PUBLIC_API_BASE overrides it at build time. */
export const HOSTED_API_BASE = 'https://angelfish-juice-refresh.ngrok-free.dev';
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE || HOSTED_API_BASE;

/** The first call of a sign-in may wait on a cold tunnel and Supabase Auth; it
 *  gets a longer budget than the normal 10 s before reporting "offline". */
export const WAKE_TIMEOUT_MS = 75_000;

export type HostedAuth = { url: string; key: string };
export type Issuer = 'synthetic_dev_issuer' | 'supabase';

/** Sign-in settings. A build may pin them (EXPO_PUBLIC_SUPABASE_*); otherwise
 *  they come from the backend's public GET /auth/config, so no key is baked
 *  into the app. The publishable key is client-visible by design; the
 *  service_role key never reaches the app (the server refuses to serve it). */
const PINNED_AUTH: HostedAuth | null =
  process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ? { url: process.env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, ''), key: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY }
    : null;

let resolvedAuth: HostedAuth | null = PINNED_AUTH;
/** Which issuer this session came from; updated once the backend has said. */
export let ISSUER: Issuer = PINNED_AUTH ? 'supabase' : 'synthetic_dev_issuer';

export async function fetchAuthConfig(
  base: string, fetchImpl?: typeof fetch,
): Promise<ApiOutcome<HostedAuth | null>> {
  if (PINNED_AUTH) return { kind: 'ok', value: PINNED_AUTH };
  const r = await request<{ provider: string | null; url?: string; publishable_key?: string }>(
    base, '/auth/config', { fetchImpl, timeoutMs: WAKE_TIMEOUT_MS });
  if (r.kind !== 'ok') return r;
  if (r.value.provider === 'supabase' && r.value.url && r.value.publishable_key) {
    resolvedAuth = { url: r.value.url.replace(/\/$/, ''), key: r.value.publishable_key };
    ISSUER = 'supabase';
    return { kind: 'ok', value: resolvedAuth };
  }
  resolvedAuth = null;
  ISSUER = 'synthetic_dev_issuer';
  return { kind: 'ok', value: null };
}

export const REQUEST_TIMEOUT_MS = 10_000;

export type ApiOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'auth_required' }
  | { kind: 'offline' }
  | { kind: 'failed'; status: number; code: string | null; retryable: boolean; requestId?: string | null };

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  token?: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export async function request<T>(base: string, path: string, opts: RequestOptions = {}): Promise<ApiOutcome<T>> {
  const { method = 'GET', token, body, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS, headers = {} } = opts;
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
        ...headers,
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
  const problem = (json ?? {}) as { code?: unknown; retryable?: unknown; request_id?: unknown };
  const requestId = typeof problem.request_id === 'string' ? problem.request_id : response.headers.get('x-request-id');
  const code = typeof problem.code === 'string' ? problem.code : null;
  recordFailure(path, response.status, code, requestId);
  if (response.status === 401) return { kind: 'auth_required' };
  return {
    kind: 'failed',
    status: response.status,
    code,
    retryable: problem.retryable === true || [408, 429, 502, 503, 504].includes(response.status),
    ...(requestId ? { requestId } : {}),
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
  base: string, username: string, password: string,
  opts: { fetchImpl?: typeof fetch; now?: () => number; hosted?: HostedAuth | null } = {},
): Promise<ApiOutcome<SignedIn>> {
  let hosted = opts.hosted;
  if (hosted === undefined) {
    // Also wakes a sleeping backend, with the long timeout, before anything else.
    const config = await fetchAuthConfig(base, opts.fetchImpl);
    if (config.kind !== 'ok') return config;
    hosted = config.value;
  }
  const r = hosted
    // Supabase's password grant. A wrong email or password is 400 there, not 401.
    ? await request<{ access_token: string; expires_in: number }>(hosted.url, '/auth/v1/token?grant_type=password', {
        method: 'POST', body: { email: username.trim(), password }, fetchImpl: opts.fetchImpl,
        headers: { apikey: hosted.key },
      }).then((o) => (o.kind === 'failed' && o.status === 400 ? { kind: 'auth_required' as const } : o))
    : await request<{ access_token: string; expires_in: number }>(base, '/dev/v1/token', {
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

// --- T15: sync transport (T13 push, T14 pull/bootstrap) ---------------------

export interface PushEvent {
  event_id: string;
  kind: 'sample.create' | 'sample.correct';
  schema_version: 1;
  payload: unknown;
}

export interface EventReceipt {
  event_id: string;
  status: 'accepted' | 'duplicate' | 'rejected' | 'conflict';
  resource_id: string | null;
  resource_version: number | null;
  server_time: string;
  error: { code: string; detail: string; retryable: boolean } | null;
}

export interface PullChange {
  seq: number;
  entity_type: 'sample';
  entity_id: string;
  operation: 'upsert' | 'tombstone';
  version: number;
  sample: { id: string; event_id: string; status: string; received_at_server: string } | null;
}

export interface PullPage {
  changes: PullChange[];
  next_cursor: string;
  has_more: boolean;
  server_time: string;
}

export interface BootstrapPage {
  sources: SourcesPage['items'];
  next_cursor: string | null;
  snapshot_cursor: string | null;
  server_time: string;
}

export interface SyncTransport {
  push(deviceId: string, events: PushEvent[]): Promise<ApiOutcome<{ results: EventReceipt[] }>>;
  pull(cursor: string): Promise<ApiOutcome<PullPage>>;
  bootstrap(cursor: string | null): Promise<ApiOutcome<BootstrapPage>>;
}

export function httpTransport(base: string, token: string, fetchImpl?: typeof fetch): SyncTransport {
  const q = (cursor: string | null) => (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
  return {
    push: (deviceId, events) =>
      request(base, '/v1/sync/push', { method: 'POST', token, fetchImpl, body: { device_id: deviceId, events } }),
    pull: (cursor) => request(base, `/v1/sync/pull?limit=100${q(cursor)}`, { token, fetchImpl }),
    bootstrap: (cursor) => request(base, `/v1/bootstrap?limit=100${q(cursor)}`, { token, fetchImpl }),
  };
}

/** T45: request the server's offline lease. Scope and expiry are the server's. */
export function requestOfflineGrant(
  base: string, token: string, deviceId: string, clientBuild: string, fetchImpl?: typeof fetch,
): Promise<ApiOutcome<import('./offlineAccess').ServerGrant>> {
  return request(base, '/v1/session/offline-grant', { method: 'POST', token, fetchImpl, body: { device_id: deviceId, client_build: clientBuild } });
}
