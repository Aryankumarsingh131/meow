# ADR-M1-002 — M1 authenticates through a synthetic dev token issuer

**Status:** Accepted — 2026-09-24
**Decided by:** project owner (explicit choice in session, 2026-09-24)
**Scope:** Milestone M1 (T05–T15, T45), development + synthetic data only.
**Superseded by:** the real OIDC provider decision (`docs/auth-provider.md`, still open).

## Context

T06 implemented real token verification (`services/api/app/auth.py`: RS256,
`kid`-selected JWKS key, issuer/audience/expiry checks, tenant from membership
lookup, 404 for cross-tenant objects). No identity provider has been chosen, so
nothing can produce a token that `authenticate()` accepts, and nothing in the
running API calls it.

M1 requires auth to be "enforced even while offline, not bypassed". Skipping
auth for the vertical slice would violate that; waiting for a provider blocks
T13, T15 and T45.

## Decision

Add `services/api/app/dev_issuer.py`, the auth analogue of ADR-M1-001: a
clearly synthetic issuer whose cryptography and verification path are real.

- Real RSA-2048 key, real RS256 JWTs (`kid`, `iss`, `aud`, `iat`, `exp`,
  `sub`), public JWKS at `GET /dev/v1/jwks.json`.
- `POST /dev/v1/token` exchanges the public demo credentials for a token.
  Unknown user and wrong password return the same 401 `AUTH_REQUIRED`.
- Tokens carry **no tenant or role claim**; T06's membership lookup decides.
  `MembershipStore.set_active` lets T45 revoke a membership mid-session.
- Issuer is `https://dev-issuer.jalsakshi.invalid/synthetic` (RFC 2606
  `.invalid`), so no real deployment's `OIDCConfig` can accept these tokens.
- Mounted only when `environment == "development"` **and**
  `tenant_data_mode == "synthetic"`, the same gate as the synthetic demo router.
  The module is not even imported otherwise.
- The private key persists at `.data/dev-issuer/key.pem` so tokens survive an
  API restart. `.data/`, `*.pem`, `*.key` are gitignored.

## What this does NOT do

- It does not choose, simulate or stand in for the production provider. The
  provider decision, provider tenant and real test accounts remain open (T06).
- It does not implement the mobile PKCE flow. The demo password grant exists
  only because the synthetic provider has no browser login page.
- It does not implement JWKS fetching/caching for a real provider.
- It does not replace the independent auth review AGENTS.md requires.

## Evidence

`python -m unittest tests.dev_issuer_test` (26 tests) proves:
- minted tokens pass T06's unmodified `authenticate()`;
- expired, wrong-issuer, wrong-audience and wrong-key tokens are denied;
- tenancy is resolved from membership and cross-tenant objects return 404;
- revocation takes effect on the next request;
- the JWKS contains no private parameters;
- the key path is gitignored and no key material is tracked;
- the routes exist in development+synthetic only (checked in fresh
  subprocesses for staging, development+research and production).

Six source mutations (gate forced on, gate ignoring data mode, private JWK
published, password check skipped, revocation no-op, gitignore removed) were
each caught.

## Exit

Delete `dev_issuer.py` and its router mount when a real provider is configured
for the environment in which M1 is demonstrated to a real user.
