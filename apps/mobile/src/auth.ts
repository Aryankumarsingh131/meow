/**
 * T06: mobile OIDC sign-in as a PUBLIC client (Authorization Code + PKCE).
 *
 * There is no client secret in this file, in the app bundle, or in the token
 * request. A shipped mobile binary cannot keep a secret - anyone can unzip an
 * APK - so the public-client + PKCE profile is the only correct choice here,
 * per jalsakshi-blueprint/docs/engineering/security-and-privacy.md line 24.
 * `assertNoClientSecret` below enforces that mechanically rather than by
 * convention, and tests/auth_client.test.ts fails the build if a secret is
 * ever threaded through.
 *
 * Platform primitives are injected rather than imported. Two reasons, in
 * order of importance:
 *   1. `expo-crypto` / `expo-auth-session` / `expo-secure-store` are NOT
 *      installed, and adding them means editing apps/mobile/package.json and
 *      the lockfile - both declared files of T03 (role B). AGENTS.md requires
 *      agreeing that interface change with its owner first, so T06 does not
 *      make it unilaterally. See docs/auth-provider.md, "Open blockers".
 *   2. It keeps this logic runnable under Node today, so the PKCE and session
 *      state machine are actually tested instead of merely written.
 *
 * Hermes has no `crypto.subtle`, so S256 cannot be computed without a native
 * module regardless - the injection point is where `expo-crypto` will plug in.
 */

/** Injected platform primitives. Node supplies these in tests; React Native
 *  will supply `expo-crypto` equivalents once the dependency is agreed. */
export interface PlatformCrypto {
  /** Cryptographically secure random bytes. NOT `Math.random()`. */
  randomBytes(length: number): Uint8Array;
  /** SHA-256 digest, for the S256 code challenge. */
  sha256(input: Uint8Array): Promise<Uint8Array>;
}

export interface OIDCClientConfig {
  /** Discovery-document `authorization_endpoint`. */
  authorizationEndpoint: string;
  /** Discovery-document `token_endpoint`. */
  tokenEndpoint: string;
  /** Public client id. Not a credential: it is not secret and proves nothing. */
  clientId: string;
  /** App-scheme redirect, e.g. `jalsakshi://auth`. */
  redirectUri: string;
  /** Audience of the API this session will call. */
  scope: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** Discriminated session state. Deliberately not a `isLoggedIn` boolean: the
 *  UI must be able to tell "never signed in" from "signed in but the access
 *  token expired", because only the second one may show cached tenant data
 *  while it refreshes. */
export type SessionState =
  | { status: "signed_out" }
  | { status: "signing_in"; pkce: PkcePair; state: string; nonce: string }
  | { status: "signed_in"; accessToken: string; refreshToken?: string; expiresAt: number }
  | { status: "expired"; refreshToken?: string };

export type AuthErrorCode =
  | "STATE_MISMATCH"
  | "TOKEN_REQUEST_FAILED"
  | "INVALID_TOKEN_RESPONSE"
  | "CLIENT_SECRET_PRESENT";

export class AuthError extends Error {
  // Plain field, not a constructor parameter property: Node's strip-only
  // TypeScript mode (how this repo runs .ts directly, per T04) rejects
  // parameter properties because they emit code rather than just types.
  readonly code: AuthErrorCode;

  constructor(message: string, code: AuthErrorCode) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** RFC 7636 requires the verifier to be 43-128 unreserved characters. */
function toCodeVerifier(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += UNRESERVED[byte % UNRESERVED.length];
  return out;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa exists in both Hermes and Node 16+.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createPkcePair(crypto: PlatformCrypto): Promise<PkcePair> {
  // 96 bytes -> 96 verifier characters, inside the RFC 7636 43-128 range.
  const verifier = toCodeVerifier(crypto.randomBytes(96));
  const digest = await crypto.sha256(new TextEncoder().encode(verifier));
  return { verifier, challenge: base64UrlEncode(digest), method: "S256" };
}

/** Opaque, single-use random string for the `state` and `nonce` parameters. */
export function createOpaqueValue(crypto: PlatformCrypto, bytes = 32): string {
  return base64UrlEncode(crypto.randomBytes(bytes));
}

/**
 * Throws if anything secret-shaped is threaded into the client config.
 * A public client that sends a secret is not merely redundant: it publishes
 * that secret to every user of the app and to any proxy in between.
 */
export function assertNoClientSecret(candidate: Record<string, unknown>): void {
  const banned = ["client_secret", "clientsecret", "secret", "password", "private_key", "privatekey"];
  for (const key of Object.keys(candidate)) {
    const normalised = key.toLowerCase().replace(/[-_]/g, "");
    if (banned.some((b) => normalised.includes(b.replace(/[-_]/g, "")))) {
      throw new AuthError(`Public client must not carry ${key}.`, "CLIENT_SECRET_PRESENT");
    }
  }
}

export async function beginSignIn(
  config: OIDCClientConfig,
  crypto: PlatformCrypto,
): Promise<{ url: string; next: Extract<SessionState, { status: "signing_in" }> }> {
  assertNoClientSecret(config as unknown as Record<string, unknown>);
  const pkce = await createPkcePair(crypto);
  const state = createOpaqueValue(crypto);
  const nonce = createOpaqueValue(crypto);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
    nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
  });
  return {
    url: `${config.authorizationEndpoint}?${params.toString()}`,
    next: { status: "signing_in", pkce, state, nonce },
  };
}

/**
 * Exchange the authorization code for tokens. No `client_secret` is sent -
 * the PKCE `code_verifier` is what proves this is the same client that began
 * the flow.
 */
export async function completeSignIn(
  config: OIDCClientConfig,
  pending: Extract<SessionState, { status: "signing_in" }>,
  callback: { code: string; state: string },
  deps: { fetch: typeof globalThis.fetch; now?: () => number },
): Promise<Extract<SessionState, { status: "signed_in" }>> {
  // Compare before anything else: a mismatched `state` means this redirect is
  // not the one we started, i.e. a CSRF / code-injection attempt.
  if (callback.state !== pending.state) {
    throw new AuthError("Authorization state did not match.", "STATE_MISMATCH");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: callback.code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: pending.pkce.verifier,
  });
  assertNoClientSecret(Object.fromEntries(body));

  const response = await deps.fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!response.ok) {
    // Deliberately does not include the response body: token endpoints echo
    // request parameters on error, which would put the code/verifier in logs.
    throw new AuthError(`Token endpoint returned ${response.status}.`, "TOKEN_REQUEST_FAILED");
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const accessToken = payload.access_token;
  const expiresIn = payload.expires_in;
  if (typeof accessToken !== "string" || !accessToken || typeof expiresIn !== "number") {
    throw new AuthError("Token response missing access_token/expires_in.", "INVALID_TOKEN_RESPONSE");
  }

  const now = deps.now ? deps.now() : Date.now();
  return {
    status: "signed_in",
    accessToken,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : undefined,
    expiresAt: now + expiresIn * 1000,
  };
}

/**
 * Expiry is evaluated against the device clock, which a field phone may have
 * wrong or may have rolled back. This is a client-side hint for when to
 * refresh - it is NEVER the authorization decision. The API re-verifies every
 * token on every request (services/api/app/auth.py), so a phone with a
 * tampered clock gains nothing.
 */
export function sessionAtTime(session: SessionState, now: number, skewMs = 30_000): SessionState {
  if (session.status !== "signed_in") return session;
  if (session.expiresAt - skewMs <= now) {
    return { status: "expired", refreshToken: session.refreshToken };
  }
  return session;
}

/** Authorization header for API calls, or `null` when there is no usable token. */
export function bearerHeader(session: SessionState): { Authorization: string } | null {
  return session.status === "signed_in" ? { Authorization: `Bearer ${session.accessToken}` } : null;
}
