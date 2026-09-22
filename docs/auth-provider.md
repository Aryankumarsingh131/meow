# OIDC provider selection and session model — T06

Status: **recommendation, not a procurement decision.** Requirement REQ-017,
acceptance AC-017 (online half). Owner: role C. Needs independent review
before it is treated as settled — AGENTS.md requires independent review for
anything touching auth.

## What T06 actually delivered

Provider-agnostic verification and a public mobile client:

| Concern | Where | Status |
|---|---|---|
| Issuer / audience / expiry / signature checks | `services/api/app/auth.py` | Implemented, tested |
| Tenant membership resolution | `services/api/app/auth.py` | Implemented, tested |
| No client or admin secret | both legs | Implemented, enforced by test |
| Mobile PKCE public client | `apps/mobile/src/auth.ts` | Logic implemented and tested; **not wired into the app** (see blockers) |
| Offline grant / 72 h lease | — | Out of scope, T45 |
| Web cookie session + CSRF | — | Out of scope, T18, as the T06 card states |
| Full per-cell role matrix tests | — | Out of scope, T31 |

## The blocker: no provider has actually been chosen or procured

**No OIDC provider tenant exists, and no real test accounts exist.** Nothing
in this task was run against a hosted identity provider. Per AGENTS.md
"Blockers and instruction changes" this is recorded rather than worked
around, and no fictional provider tenant, client ID or test credential has
been invented.

What this means concretely:

- The tests mint their own RS256 tokens from locally generated RSA keypairs.
  The cryptography and the verification path are real; the **issuer is not**.
- No end-to-end sign-in has ever been performed. A statement like "login
  works" would be false today.
- Provider-specific behaviour is therefore unverified: claim naming, whether
  `aud` arrives as a string or an array, refresh-token rotation policy, and
  how the provider represents a disabled user.

The code is written to be provider-agnostic precisely so this decision can be
made later without a rewrite: `OIDCConfig` takes an issuer, an audience and a
JWKS document, all of which come from the provider's discovery document.

## Recommended provider (needs sign-off)

**Keycloak, self-hosted**, for the pilot. Reasoning, offered as a
recommendation a reviewer can overturn:

- The deployment is single-region and data-residency-sensitive (Indian water
  quality programme data); a self-hosted IdP keeps worker identity in the same
  jurisdiction as the rest of the data without a separate contractual review.
- It is a standards-complete OIDC provider with discovery, JWKS and PKCE
  public clients, so nothing above depends on a proprietary extension.
- No per-user licence cost, which matters when the user population is
  volunteer field workers rather than paid seats.

Costs a reviewer should weigh against it: Keycloak is a service somebody must
operate, patch and back up, and that operational burden lands on the same
small team. A hosted provider (Auth0, Entra ID, AWS Cognito) removes that at
the cost of per-user pricing and a data-residency review. **Choosing a hosted
provider would not change any code in `auth.py`** — only configuration.

This recommendation is not a purchase, a sign-up, or an external commitment.
Per AGENTS.md, documentation work does not authorize cloud purchases.

## Session model

Mobile is an **Authorization Code + PKCE public client**. There is no client
secret anywhere in the mobile app, and there is no admin or signing secret in
the API:

- A shipped mobile binary cannot keep a secret. Anyone can unzip an APK, so a
  "confidential" mobile client would publish its own credential to every user.
  PKCE's `code_verifier` is what binds the token exchange to the client that
  began the flow.
- The API only ever **verifies** tokens, using the provider's public JWKS. It
  holds no signing key, so there is nothing to leak.
- `OIDCConfig` has no field capable of holding a secret; a test asserts its
  exact field set so that adding one fails the build. `assertNoClientSecret`
  does the equivalent on the mobile side for the config and the token request.

**Tenant is resolved from the membership lookup, never from a token claim or
a request field.** The identity provider authenticates a person; it does not
own our tenancy, so a `tenant_id` claim is an assertion by the wrong
authority. A test signs a token carrying `tenant_id` for the *other* tenant
plus `role: admin` and asserts both are ignored.

A user with several active memberships is **denied, not guessed at**. v1 has
no tenant-switch UI and no endpoint carrying a tenant selector, so any choice
would be an arbitrary cross-tenant read.

Cross-tenant object access returns **404, not 403**, per the authorization
matrix: a 403 would confirm that another tenant's sample ID exists and let a
worker enumerate them.

## Two findings about `python-jose` 3.5.0

Both were found by mutation-testing this module and are reproduced by tests
in `tests/auth_test.py`.

1. **It ignores the JWS `kid` header** and walks the JWKS key set in order,
   aborting on the first key-type mismatch rather than trying the next key.
2. Consequently, **an HS256 forgery is accepted** if an `oct` key happens to
   sit first in the published key set — a misconfigured provider or a poisoned
   JWKS cache — because the published symmetric "public" key is a signing key.

`auth.py` therefore selects the verification key by `kid` itself and considers
only `RSA` keys, and pins the algorithm to RS256 both in the JWS header check
and in the `algorithms=` argument. These three defences overlap deliberately:
individually removing any one of them is not observable, but removing all
three is caught by a test.

**Migration path:** PyJWT is better maintained and does `kid` selection
correctly. Switching touches only `verify_token()` and requires no test
changes. It was not done here because PyJWT is not installed and T06 declined
to add a new supply-chain dependency for something the installed library can
do safely with an explicit key selection.

## What must happen before this is real

1. A human chooses the provider and signs off on this document.
2. Create a realm/tenant, a **public** mobile client with PKCE required and
   the `jalsakshi://auth` redirect registered, and an API audience.
3. Create at least two test users in two tenants, matching the fixture shape
   in `tests/auth_test.py`.
4. Wire JWKS fetching and caching. `auth.py` does **no network I/O** by
   design, so a JWKS outage cannot become a silent auth bypass; the caller
   must fetch, cache with a TTL, and decide the failure mode explicitly.
5. Re-run the suite against provider-issued tokens and confirm the claim
   shapes above. Only then may "login works" be claimed.
6. Wire `apps/mobile/src/auth.ts` into the app — this needs the dependency
   agreement below.

## Open blockers

- **No provider chosen, no tenant, no test accounts.** Nothing has been run
  against a hosted IdP. Recorded, not worked around.
- **`apps/mobile/src/auth.ts` is not wired into the running app.**
  `expo-auth-session`, `expo-crypto`, `expo-web-browser` and
  `expo-secure-store` are not installed, and installing them edits
  `apps/mobile/package.json` and the lockfile — both **declared files of T03,
  role B**. AGENTS.md requires agreeing that interface change with its owner
  first, so T06 did not make it unilaterally. The module takes its crypto
  primitives as injected parameters, which is where `expo-crypto` plugs in.
  Hermes has no `crypto.subtle`, so S256 needs a native module regardless.
- **Token storage is not implemented.** `expo-secure-store` is subject to the
  same ownership constraint. Until it exists, no token should be persisted to
  disk; holding the session in memory only is the safe interim behaviour.
- **JWKS fetching/caching is not implemented** (point 4 above). It belongs
  with whoever wires the real provider, and needs an explicit decision about
  what happens when the JWKS endpoint is unreachable.
- Revocation cannot reach a token before it expires. Membership is re-read
  from the lookup on every request, so *deactivating a membership* takes
  effect immediately; revoking the *token itself* does not. Keep access-token
  lifetimes short. The offline lease (T45) widens this window further and
  needs its own analysis.
