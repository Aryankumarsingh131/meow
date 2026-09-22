/**
 * T06 verification for the mobile public client, run under Node with real
 * `node:crypto` primitives (no mocked crypto, no mocked success).
 *
 * Scope addition beyond the four files named on the T06 card: the card lists
 * `apps/mobile/src/auth.ts` but no check for it, and AGENTS.md requires the
 * smallest root-cause check to actually pass. Flagged in the handoff.
 *
 * Run:  node tests/auth_client.test.ts
 */

import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import assert from "node:assert/strict";

import {
  AuthError,
  assertNoClientSecret,
  base64UrlEncode,
  bearerHeader,
  beginSignIn,
  completeSignIn,
  createPkcePair,
  sessionAtTime,
  type OIDCClientConfig,
  type PlatformCrypto,
  type SessionState,
} from "../apps/mobile/src/auth.ts";

const crypto: PlatformCrypto = {
  randomBytes: (length) => new Uint8Array(nodeRandomBytes(length)),
  sha256: async (input) => new Uint8Array(createHash("sha256").update(input).digest()),
};

const config: OIDCClientConfig = {
  authorizationEndpoint: "https://idp.test.jalsakshi.invalid/realms/jalsakshi/protocol/openid-connect/auth",
  tokenEndpoint: "https://idp.test.jalsakshi.invalid/realms/jalsakshi/protocol/openid-connect/token",
  clientId: "jalsakshi-mobile",
  redirectUri: "jalsakshi://auth",
  scope: "openid profile offline_access",
};

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

test("PKCE verifier obeys RFC 7636 length and charset", async () => {
  const pkce = await createPkcePair(crypto);
  assert.ok(pkce.verifier.length >= 43 && pkce.verifier.length <= 128, pkce.verifier.length.toString());
  assert.match(pkce.verifier, /^[A-Za-z0-9\-._~]+$/);
  assert.equal(pkce.method, "S256");
});

test("PKCE challenge is the real base64url SHA-256 of the verifier", async () => {
  const pkce = await createPkcePair(crypto);
  const expected = base64UrlEncode(new Uint8Array(createHash("sha256").update(pkce.verifier).digest()));
  assert.equal(pkce.challenge, expected);
  assert.ok(!pkce.challenge.includes("="), "challenge must be unpadded base64url");
  assert.ok(!/[+/]/.test(pkce.challenge), "challenge must not contain +/");
});

test("PKCE pairs and state values are unique per sign-in", async () => {
  const [a, b] = [await createPkcePair(crypto), await createPkcePair(crypto)];
  assert.notEqual(a.verifier, b.verifier);
  const [first, second] = [await beginSignIn(config, crypto), await beginSignIn(config, crypto)];
  assert.notEqual(first.next.state, second.next.state);
  assert.notEqual(first.next.nonce, second.next.nonce);
});

test("authorization URL carries PKCE and no secret", async () => {
  const { url, next } = await beginSignIn(config, crypto);
  const params = new URL(url).searchParams;
  assert.equal(params.get("response_type"), "code");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(params.get("code_challenge"), next.pkce.challenge);
  assert.equal(params.get("client_id"), "jalsakshi-mobile");
  // The verifier must never leave the device in the authorize request.
  assert.equal(params.get("code_verifier"), null);
  assert.ok(!/secret/i.test(url), url);
});

test("token request sends code_verifier and never a client secret", async () => {
  const { next } = await beginSignIn(config, crypto);
  let sentBody = "";
  const fetchSpy: typeof globalThis.fetch = async (_url, init) => {
    sentBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ access_token: "at-1", expires_in: 900, refresh_token: "rt-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const session = await completeSignIn(config, next, { code: "auth-code", state: next.state }, {
    fetch: fetchSpy,
    now: () => 1_000_000,
  });
  const body = new URLSearchParams(sentBody);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), next.pkce.verifier);
  assert.equal(body.get("client_secret"), null);
  assert.ok(!/secret/i.test(sentBody), sentBody);
  assert.equal(session.status, "signed_in");
  assert.equal(session.accessToken, "at-1");
  assert.equal(session.expiresAt, 1_000_000 + 900_000);
});

test("mismatched state is rejected before the token request is made", async () => {
  const { next } = await beginSignIn(config, crypto);
  let called = false;
  const fetchSpy: typeof globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  await assert.rejects(
    () => completeSignIn(config, next, { code: "c", state: "attacker-state" }, { fetch: fetchSpy }),
    (e: AuthError) => e.code === "STATE_MISMATCH",
  );
  assert.equal(called, false, "token endpoint must not be contacted on state mismatch");
});

test("token endpoint failure does not leak the code or verifier", async () => {
  const { next } = await beginSignIn(config, crypto);
  const fetchSpy: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_grant", code_verifier: next.pkce.verifier }), { status: 400 });
  await assert.rejects(
    () => completeSignIn(config, next, { code: "the-code", state: next.state }, { fetch: fetchSpy }),
    (e: AuthError) => {
      assert.equal(e.code, "TOKEN_REQUEST_FAILED");
      assert.ok(!e.message.includes(next.pkce.verifier), "verifier leaked into error");
      assert.ok(!e.message.includes("the-code"), "auth code leaked into error");
      return true;
    },
  );
});

test("malformed token responses are rejected, not coerced", async () => {
  const { next } = await beginSignIn(config, crypto);
  const bad = [{}, { access_token: "" }, { access_token: "t" }, { access_token: 5, expires_in: 9 }];
  for (const payload of bad) {
    const fetchSpy: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify(payload), { status: 200 });
    await assert.rejects(
      () => completeSignIn(config, next, { code: "c", state: next.state }, { fetch: fetchSpy }),
      (e: AuthError) => e.code === "INVALID_TOKEN_RESPONSE",
      `accepted malformed payload ${JSON.stringify(payload)}`,
    );
  }
});

test("assertNoClientSecret catches secret-shaped keys in any casing", () => {
  for (const key of ["client_secret", "clientSecret", "CLIENT-SECRET", "password", "private_key"]) {
    assert.throws(() => assertNoClientSecret({ [key]: "x" }), (e: AuthError) => e.code === "CLIENT_SECRET_PRESENT", key);
  }
  assertNoClientSecret({ client_id: "ok", scope: "openid", redirect_uri: "jalsakshi://auth" });
});

test("expiry transitions signed_in -> expired and keeps the refresh token", () => {
  // 15-minute token, evaluated with the default 30 s early-refresh skew.
  const expiresAt = 900_000;
  const session: SessionState = { status: "signed_in", accessToken: "at", refreshToken: "rt", expiresAt };
  assert.equal(sessionAtTime(session, 0).status, "signed_in");
  assert.equal(sessionAtTime(session, expiresAt - 60_000).status, "signed_in");
  // Inside the skew window it is already treated as expired, so a refresh
  // starts before the token actually dies mid-request.
  assert.equal(sessionAtTime(session, expiresAt - 10_000).status, "expired");
  const expired = sessionAtTime(session, expiresAt);
  assert.equal(expired.status, "expired");
  // Losing the refresh token here would force a full re-login in the field.
  assert.equal(expired.status === "expired" ? expired.refreshToken : null, "rt");
});

test("bearerHeader is null unless genuinely signed in", () => {
  assert.equal(bearerHeader({ status: "signed_out" }), null);
  assert.equal(bearerHeader({ status: "expired" }), null);
  assert.deepEqual(bearerHeader({ status: "signed_in", accessToken: "at", expiresAt: 9e15 }), {
    Authorization: "Bearer at",
  });
});

test("source file contains no hardcoded secret", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../apps/mobile/src/auth.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!/client_secret\s*[:=]\s*["'][^"']+["']/.test(source), "hardcoded client_secret found");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(error as Error).message}`);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
