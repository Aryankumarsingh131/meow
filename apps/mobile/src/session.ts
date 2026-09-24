/**
 * Which app surface a person lands on, and why.
 *
 * Pure logic, no React — so the routing rules are testable without rendering
 * anything (tests/session.test.ts).
 *
 * ## Roles come from the authorization matrix, not from this file
 *
 * jalsakshi-blueprint/docs/architecture/authorization-matrix.md fixes the role
 * enum at exactly `worker`, `supervisor`, `lab_reviewer`, `admin`, and is
 * explicit that a **resident is not a user**: "No account, no login. Receives
 * operator-recorded communication only."
 *
 * That is why the public water-quality portal is reachable WITHOUT credentials
 * rather than via a "resident" login.
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

import type { SignedIn } from './api';

/** Fixed by authorization-matrix.md. `resident` is deliberately NOT here. */
export type Role = 'worker' | 'supervisor' | 'lab_reviewer' | 'admin';

/** The two product surfaces. */
export type Surface = 'field' | 'public';

/** Public synthetic demo usernames (password "jalsakshi"), shown on the login screen. */
export const DEMO_USERNAMES = ['worker', 'supervisor'] as const;

export interface Session {
  kind: 'staff';
  username: string;
  /** In memory only; never persisted until secure storage exists (T06/T45). */
  auth: SignedIn;
  /** Who vouched for this session. Surfaces must show a synthetic issuer. */
  issuer: 'synthetic_dev_issuer';
  /**
   * T45. Null for an online sign-in. For an offline session (no token, entry
   * gated by the phone's screen lock) the end of the server-issued lease.
   */
  offlineUntilMs: number | null;
}

export interface PublicVisitor {
  kind: 'public';
}

export type AppSession = Session | PublicVisitor | null;

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
  return { kind: 'staff', username: username.trim().toLowerCase(), auth, issuer: 'synthetic_dev_issuer', offlineUntilMs: null };
}

/** T45: continue under a stored offline grant. There is no token; nothing can be sent until sign-in. */
export function offlineSession(username: string, subject: string, expiresAtMs: number): Session {
  return {
    kind: 'staff', username, issuer: 'synthetic_dev_issuer', offlineUntilMs: expiresAtMs,
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
  return session.kind === 'public' ? 'public' : 'field';
}

/** The public portal needs no credentials, per the authorization matrix. */
export function continueAsPublic(): PublicVisitor {
  return { kind: 'public' };
}
