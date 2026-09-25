/**
 * Which app surface a person lands on, and why.
 *
 * Pure logic, no React — so the routing rules are testable without rendering
 * anything (tests/session.test.ts).
 *
 * ## Two sign-in paths
 *
 * Hosted (Supabase Auth): one email + password sign-in (`v2.login`) for staff
 * and residents. The server answers with the role - `field_worker`,
 * `supervisor` or `resident` - and that picks the surface: the staff app
 * (Pluccy screening, points, complaint review) or the resident app
 * (complaints). Residents became accounts by owner decision on 2026-09-25
 * (006); they are never staff profiles.
 *
 * Synthetic dev issuer (below): the M1 field flow, staff only. The public
 * water-quality page stays reachable without any account.
 *
 * ## Sign-in is checked by the server, not by this file
 *
 * Until M1 (2026-09-24) this file compared passwords against a local table,
 * which authenticated nothing. Credentials now go to the API's synthetic dev
 * issuer (ADR-M1-002, `api.signIn`), which returns an RS256 token that every
 * API route verifies with T06's real code. The issuer is still SYNTHETIC -
 * not a real identity provider - and the session says so (`issuer`).
 *
 * The role is not known here: the token carries no role claim, because the
 * server resolves it from membership on every request. Every staff member
 * goes to the field surface (see `surfaceFor`), so routing does not need it.
 */

import { ISSUER, type Issuer, type SignedIn } from './api.ts';

/** M1 roles, fixed by authorization-matrix.md (synthetic dev issuer only). */
export type Role = 'worker' | 'supervisor' | 'lab_reviewer' | 'admin';

/** field: M1 flow. staff: hosted staff app. resident: resident app. public: no account. */
export type Surface = 'field' | 'staff' | 'resident' | 'public';

/** Public synthetic demo usernames (password "jalsakshi") of the M1 dev issuer. */
export const DEMO_USERNAMES = ['worker', 'supervisor'] as const;

/** Demo accounts offered in the login dropdown (007_easy_demo_logins.sql).
 *  DEMO ONLY: remove before any real use. */
export const DEMO_LOGINS = [
  { label: 'Field worker', email: '1@demo.org', password: '1234' },
  { label: 'Supervisor', email: '2@demo.org', password: '1234' },
  { label: 'Resident', email: '3@demo.org', password: '1234' },
] as const;

export interface Session {
  kind: 'staff';
  username: string;
  /** In memory only; never persisted until secure storage exists (T06/T45). */
  auth: SignedIn;
  /** Who vouched for this session. Surfaces must show a synthetic issuer. */
  issuer: Issuer;
  /**
   * T45. Null for an online sign-in. For an offline session (no token, entry
   * gated by the phone's screen lock) the end of the server-issued lease.
   */
  offlineUntilMs: number | null;
}

export interface PublicVisitor {
  kind: 'public';
}

/** Hosted sign-in. The token is in memory only, like the M1 session's. */
export interface StaffV2Session {
  kind: 'staff_v2';
  email: string;
  role: 'supervisor' | 'field_worker';
  token: string;
}

export interface ResidentSession {
  kind: 'resident';
  email: string;
  token: string;
}

export type AppSession = Session | StaffV2Session | ResidentSession | PublicVisitor | null;

/** Route a hosted sign-in by the role the server returned. */
export function hostedSession(email: string, role: string, token: string): StaffV2Session | ResidentSession | null {
  const e = email.trim().toLowerCase();
  if (role === 'resident') return { kind: 'resident', email: e, token };
  if (role === 'supervisor' || role === 'field_worker') return { kind: 'staff_v2', email: e, role, token };
  return null;
}

export type SignInFailure = 'empty_username' | 'empty_password' | 'unknown_account' | 'offline' | 'server_error';

/** Checked before any network call; empty input is not a credential failure. */
export function checkSignInInput(username: string, password: string): SignInFailure | null {
  if (!username.trim()) return 'empty_username';
  if (!password) return 'empty_password';
  return null;
}

/** Map an API sign-in outcome kind to what the worker is told. */
export function signInFailureFor(kind: 'auth_required' | 'offline' | 'failed'): SignInFailure {
  switch (kind) {
    case 'auth_required':
      return 'unknown_account';
    case 'offline':
      return 'offline';
    case 'failed':
      return 'server_error';
  }
}

export function staffSession(username: string, auth: SignedIn): Session {
  return { kind: 'staff', username: username.trim().toLowerCase(), auth, issuer: ISSUER, offlineUntilMs: null };
}

/** T45: continue under a stored offline grant. There is no token; nothing can be sent until sign-in. */
export function offlineSession(username: string, subject: string, expiresAtMs: number): Session {
  return {
    kind: 'staff', username, issuer: ISSUER, offlineUntilMs: expiresAtMs,
    auth: { token: '', subject, expiresAtMs },
  };
}

export const SIGN_IN_ERROR: Record<SignInFailure, string> = {
  empty_username: 'Enter your username.',
  empty_password: 'Enter your password.',
  // One message for unknown user and wrong password: the difference tells an
  // attacker which usernames exist. The server enforces the same rule.
  unknown_account: 'Those details were not recognised.',
  offline: 'Cannot reach the server. First sign-in needs a connection.',
  server_error: 'The server could not sign you in. Try again shortly.',
};

/**
 * Which surface a session sees.
 *
 * Every staff role goes to the field app for now. `supervisor`, `lab_reviewer`
 * and `admin` each have their own screens in later tasks (T18 supervisor
 * queue, T19 lab review); until those exist, sending them to the field app is
 * honest, whereas inventing empty dashboards would not be.
 */
export function surfaceFor(session: AppSession): Surface | null {
  if (!session) return null;
  switch (session.kind) {
    case 'public': return 'public';
    case 'staff': return 'field';
    case 'staff_v2': return 'staff';
    case 'resident': return 'resident';
  }
}

/** The public water-quality page needs no credentials. */
export function continueAsPublic(): PublicVisitor {
  return { kind: 'public' };
}
