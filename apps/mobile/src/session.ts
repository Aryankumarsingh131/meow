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
 * rather than via a "resident" login. Inventing a resident account would add a
 * fifth identity the matrix deliberately does not have, and would imply
 * residents have permissions they do not.
 *
 * ## This is not authentication yet
 *
 * T06 built real OIDC token verification, but no provider has been chosen and
 * no test accounts exist, so there is nothing to authenticate against. The
 * accounts below are DEMO accounts checked locally. They are clearly labelled
 * as such in the UI, and `isRealAuthentication` is false so no caller can
 * mistake this for a verified session.
 *
 * When the provider is wired, `signIn` is the single function that changes:
 * it starts the PKCE flow in `auth.ts` and resolves the role from the
 * membership lookup instead of this table.
 */

/** Fixed by authorization-matrix.md. `resident` is deliberately NOT here. */
export type Role = 'worker' | 'supervisor' | 'lab_reviewer' | 'admin';

/** The two product surfaces. */
export type Surface = 'field' | 'public';

export interface DemoAccount {
  username: string;
  password: string;
  role: Role;
  displayName: string;
  tenantName: string;
}

/**
 * Demo accounts. Not secrets: they authenticate nothing real, grant no access
 * to any server, and exist only so the two surfaces can be demonstrated before
 * an identity provider exists. Replaced wholesale by OIDC, not extended.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    username: 'worker',
    password: 'jalsakshi',
    role: 'worker',
    displayName: 'Field worker (demo)',
    tenantName: 'Riverside District',
  },
  {
    username: 'supervisor',
    password: 'jalsakshi',
    role: 'supervisor',
    displayName: 'Block supervisor (demo)',
    tenantName: 'Riverside District',
  },
];

/** True only when a real identity provider has verified the session. */
export const isRealAuthentication = false;

export interface Session {
  kind: 'staff';
  role: Role;
  displayName: string;
  tenantName: string;
  /** Always false until OIDC is wired. Surfaces must show this. */
  verified: boolean;
}

export interface PublicVisitor {
  kind: 'public';
}

export type AppSession = Session | PublicVisitor | null;

export type SignInResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'empty_username' | 'empty_password' | 'unknown_account' };

/**
 * Check demo credentials.
 *
 * Distinguishes empty input from a wrong credential, but does NOT distinguish
 * "no such user" from "wrong password" — that difference tells an attacker
 * which usernames exist, and the habit matters even in a demo, because this is
 * the function the real implementation replaces.
 */
export function signIn(username: string, password: string): SignInResult {
  const u = username.trim().toLowerCase();
  if (!u) return { ok: false, reason: 'empty_username' };
  if (!password) return { ok: false, reason: 'empty_password' };

  const account = DEMO_ACCOUNTS.find(
    (a) => a.username === u && a.password === password,
  );
  if (!account) return { ok: false, reason: 'unknown_account' };

  return {
    ok: true,
    session: {
      kind: 'staff',
      role: account.role,
      displayName: account.displayName,
      tenantName: account.tenantName,
      verified: isRealAuthentication,
    },
  };
}

export const SIGN_IN_ERROR: Record<
  Exclude<SignInResult & { ok: false }, { ok: true }>['reason'],
  string
> = {
  empty_username: 'Enter your username.',
  empty_password: 'Enter your password.',
  unknown_account: 'Those details were not recognised.',
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
