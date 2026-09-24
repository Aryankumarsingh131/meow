/**
 * T45: offline access, bounded by the server's grant (services/api/app/offline_grants.py).
 *
 * security-and-privacy.md: the lease is separate from the online token; the
 * app checks expiry while it can; clock rollback prompts online revalidation;
 * an expired grant locks access WITHOUT deleting unsynced data. Nothing in
 * this module ever touches local_samples, local_assets or outbox.
 *
 * Offline entry is gated by the phone's own screen lock (assumption A08), not
 * by a password: a password cannot be checked offline, and pretending to
 * would be theatre.
 *
 * Known limit: without a native boot-time clock (role B, T08) the app cannot
 * measure elapsed time across its own restarts. The persisted clock
 * high-water mark catches any rollback below the latest time the app has
 * seen, but not a clock held just above it while the app stays closed.
 * ponytail: high-water mark only; bind SystemClock.elapsedRealtime() for a
 * monotonic lease.
 */

import { getMeta, setMeta, type Sql } from './storage.ts';

/** Engineering slack for small NTP corrections; not a domain value. */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 2 * 60_000;
/** A lease longer than this is not a lease this server issues; refuse it. */
export const MAX_ACCEPTED_LEASE_MS = 7 * 24 * 3_600_000;

export interface ServerGrant {
  grant_id: string;
  subject: string;
  tenant_id: string;
  role: string;
  capture_offline: boolean;
  policy_version: number;
  expires_at: string;
  server_time: string;
}

export interface StoredGrant {
  grantId: string;
  subject: string;
  username: string;
  role: string;
  captureOffline: boolean;
  policyVersion: number;
  /** Phone wall clock when the grant arrived. The lease runs from here. */
  deviceWallAtGrant: number;
  leaseMs: number;
}

export type OfflineAccess =
  | { kind: 'granted'; grant: StoredGrant; expiresAtMs: number }
  | { kind: 'locked'; reason: 'no_grant' | 'expired' | 'clock_rollback' | 'not_permitted' };

const grantKey = (subject: string) => `offline_grant:${subject}`;
const HIGH_WATER = 'clock_high_water_ms';

function noteTime(sql: Sql, nowMs: number): void {
  const seen = Number(getMeta(sql, HIGH_WATER) ?? 0);
  if (nowMs > seen) setMeta(sql, HIGH_WATER, String(nowMs));
}

/** Store a grant received online. Returns false (and stores nothing) if it is malformed. */
export function recordGrant(sql: Sql, username: string, grant: ServerGrant, subject: string, nowMs: number): boolean {
  const leaseMs = Date.parse(grant.expires_at) - Date.parse(grant.server_time);
  if (grant.subject !== subject || !(leaseMs > 0 && leaseMs <= MAX_ACCEPTED_LEASE_MS)) return false;
  const stored: StoredGrant = {
    grantId: grant.grant_id, subject, username: username.trim().toLowerCase(), role: grant.role,
    captureOffline: grant.capture_offline === true, policyVersion: grant.policy_version,
    deviceWallAtGrant: nowMs, leaseMs,
  };
  sql.tx(() => {
    setMeta(sql, grantKey(subject), JSON.stringify(stored));
    noteTime(sql, nowMs);
  });
  return true;
}

/** Drop this account's offline access (sign-out, revocation). Saved records are untouched. */
export function revokeOfflineAccess(sql: Sql, subject: string): void {
  sql.run('DELETE FROM meta WHERE key = ?', [grantKey(subject)]);
}

export function checkOfflineAccess(sql: Sql, subject: string, nowMs: number): OfflineAccess {
  const raw = getMeta(sql, grantKey(subject));
  if (!raw) return { kind: 'locked', reason: 'no_grant' };
  const grant = JSON.parse(raw) as StoredGrant;
  const highWater = Number(getMeta(sql, HIGH_WATER) ?? 0);
  if (nowMs < grant.deviceWallAtGrant - CLOCK_ROLLBACK_TOLERANCE_MS || nowMs < highWater - CLOCK_ROLLBACK_TOLERANCE_MS) {
    // Forget the grant: winding the clock forward again must not restore it.
    revokeOfflineAccess(sql, subject);
    return { kind: 'locked', reason: 'clock_rollback' };
  }
  const expiresAtMs = grant.deviceWallAtGrant + grant.leaseMs;
  if (nowMs >= expiresAtMs) {
    revokeOfflineAccess(sql, subject);
    return { kind: 'locked', reason: 'expired' };
  }
  if (!grant.captureOffline) return { kind: 'locked', reason: 'not_permitted' };
  noteTime(sql, nowMs);
  return { kind: 'granted', grant, expiresAtMs };
}

/** Accounts that may currently continue offline on this phone. */
export function offlineAccounts(sql: Sql, nowMs: number): Array<{ subject: string; username: string; expiresAtMs: number }> {
  const subjects = sql
    .all<{ key: string }>("SELECT key FROM meta WHERE key LIKE 'offline_grant:%'")
    .map((row) => row.key.slice('offline_grant:'.length));
  return subjects.flatMap((subject) => {
    const access = checkOfflineAccess(sql, subject, nowMs);
    return access.kind === 'granted'
      ? [{ subject, username: access.grant.username, expiresAtMs: access.expiresAtMs }]
      : [];
  });
}

export const LOCK_TEXT: Record<Exclude<OfflineAccess, { kind: 'granted' }>['reason'], string> = {
  no_grant: 'This phone has no offline access for this account. Connect to sign in.',
  expired: 'Offline access has ended. Connect to sign in again.',
  clock_rollback: 'The phone clock moved backwards, so offline access was stopped. Connect to sign in again.',
  not_permitted: 'This account cannot record tests offline.',
};

export const OFFLINE_LIMIT_NOTE =
  'Offline access lasts a limited time. If this account is removed while the phone is offline, the phone only learns this when it reconnects.';
