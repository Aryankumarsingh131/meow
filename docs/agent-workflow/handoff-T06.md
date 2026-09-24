# Handoff — T06 Online membership authorization

Owner: agent, role C (API/contracts/schema/security). Requirement REQ-017,
acceptance AC-017 (online half). Date: 2026-09-22.

**Status: implementation complete and tested; NOT done.** Two things are
outstanding and neither is hidden: no OIDC provider has been chosen or
procured, and the mobile module is not wired into the app. AGENTS.md also
requires **independent review** for anything touching auth, which has not
happened. The `to-do.md` checkbox is deliberately left unchecked — the T06
card reserves it for after review.

## Dependency gate

The card gates T06 on "T03 T05 complete, reviewed, and reflected in
current-state.md with real evidence."

- **T05 — satisfied.** Real Pydantic schemas, FastAPI-generated
  `openapi.json`, generated `client.ts`, two real passing suites, and real
  recorded commands. T06 extends those commands rather than inventing new
  ones.
- **T03 — partially satisfied, and I did not treat it as fully green.** The
  scaffold and dependency resolution are real, but its device-dependent
  acceptance criteria (APK install, offline tensor) are genuinely blocked by
  a missing Android SDK. T06 needs neither, so I proceeded on the parts that
  do not depend on a device, and flagged rather than papered over the rest.
- **Neither T03 nor T05 has had real human review.** That gate is still
  unmet across this whole repo, consistent with T02–T05. I did not waive it
  silently; it is stated here.

## Changed files

| File | What |
|---|---|
| `services/api/app/auth.py` | **New.** OIDC access-token verification + tenant/role authorization |
| `tests/auth_test.py` | **New.** 44 tests: negatives, two-user/two-tenant, API-level |
| `apps/mobile/src/auth.ts` | **New.** PKCE public client + typed session state |
| `tests/auth_client.test.ts` | **New, scope addition** — see below |
| `docs/auth-provider.md` | **New.** Provider recommendation, session model, blockers |
| `services/api/requirements.txt` | **New, scope addition** — see below |

### Scope additions beyond the four files on the card

Both are flagged for reviewer approval rather than assumed:

1. `tests/auth_client.test.ts` — the card names `apps/mobile/src/auth.ts` but
   no check for it. AGENTS.md requires the smallest root-cause check to
   actually pass, and untested PKCE logic would not meet that.
2. `services/api/requirements.txt` — T05 introduced fastapi/pydantic usage
   with no pin file, and AGENTS.md requires pinned dependencies. **No package
   was installed or downloaded**; the file records versions already present.

**No new dependency was added.** `python-jose` was already installed, so T06
added zero supply-chain surface.

### Files deliberately NOT touched

- `apps/mobile/package.json` and the mobile lockfile — **declared files of
  T03 (role B)**. Wiring the mobile module needs `expo-auth-session`,
  `expo-crypto`, `expo-web-browser` and `expo-secure-store`, which would edit
  both. AGENTS.md requires agreeing that interface change with the owner
  first, so T06 did not do it unilaterally. **This needs a role-B
  conversation.**
- `services/api/app/main.py` — T05's declared file. The API-level tests build
  their own FastAPI app instead of wiring auth into it.
- `jalsakshi-blueprint/**` — reference package, untouched.
- Root `package.json` / `tsconfig.json` — the undeclared shared-config overlap
  current-state.md flagged. T06 needed no change to either.

## Exact commands and results

Build host: Windows 11, MINGW64_NT-10.0-26200. Python 3.13.7, Node v24.19.0.
Base commit: `1c371043629f061c945cf4a38af68c84af8e6bff` (branch `main`).
All commands run from the repository root.

```
python -m unittest tests.auth_test          ->  Ran 44 tests ... OK
node tests/auth_client.test.ts              ->  12/12 passed
python -m unittest services.api.app.tests.test_schemas  ->  Ran 15 tests ... OK   (T05 regression)
node tests/contracts.test.ts                ->  ALL CHECKS PASSED                (T05 regression)
npx tsc --noEmit                            ->  0 errors
```

`tsc` coverage was confirmed rather than assumed: `--listFiles` shows both new
TypeScript files, and a deliberately injected type error was observed to fail
the check before being reverted.

A secret scan over all six files returned no match.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| Issuer/audience/expiry checks | `TestIssuerAudienceExpiry` (8 tests) + `TestSignature` (7). Wrong issuer, wrong audience, expired, future `nbf`, future `iat`, missing `exp`, missing `sub`, unknown key, `alg:none`, HMAC confusion, tampered payload, garbage input |
| Tenant membership | `TestTenantMembership`, `TestTwoUserTwoTenantObjectAccess`. Tenant resolved from the membership lookup; a forged `tenant_id`/`role: admin` claim is proven to be ignored; revoked membership denied; ambiguous multi-tenant denied rather than guessed |
| No client/admin secret | `TestNoSecretMaterial` asserts `OIDCConfig`'s exact field set, that no private JWK parameter is published, and that denials never echo token material. Mobile: `assertNoClientSecret` on both config and token body, plus a source scan for a hardcoded secret |

## Verification from the card

1. **Two-user/two-tenant negative API tests — done, at the HTTP layer.**
   `TestApiSurface` drives a real ASGI app through `TestClient`: missing
   header → 401, expired → 401, foreign issuer → 401, cross-tenant sample →
   404 in both directions, worker on `/v1/cases` → 403, supervisor → 200.
   Cross-tenant and nonexistent IDs are asserted to return **byte-identical
   responses**, so IDs cannot be enumerated.
2. **Web session integration follows T18 — correctly not done here.** The card
   defers it; no web session, cookie or CSRF code was written.

## Mutation testing (how I know the tests aren't decorative)

Every check above was re-run against deliberately broken copies of `auth.py`
(source-level edits, reverted afterwards). An early monkeypatch-based attempt
gave false passes — `from x import Y` binds a copy and the dataclass default
had already frozen — so it was discarded for real source mutation.

14 mutants: **skip issuer check, skip audience check, skip signature verify,
24-hour leeway, ignore the `active` flag, tenant check always passes, tenant
denial returns 403 instead of 404, tenant denial returns allow, role check
always passes, pick the first of several memberships, ignore `kid`, ambiguous
key falls back to first, ignore the Bearer scheme** — all **CAUGHT**.

Three survive individually: allowing HS256/none, allowing `oct` keys, and
skipping the JWS header algorithm check. These are three overlapping defences
against the same attack, so removing any one is not observable. **Removing all
three together is caught** by
`test_hmac_token_denied_even_if_jwks_carries_a_symmetric_key`. That was
verified, not assumed.

## Two findings about `python-jose` 3.5.0

Found by mutation testing, reproduced by tests, worked around in `auth.py`:

1. It **ignores the JWS `kid` header** and walks the JWKS key set in order,
   aborting on the first key-type mismatch instead of trying the next key.
2. Therefore an **HS256 forgery is accepted** when an `oct` key sits first in
   the key set — a misconfigured provider or a poisoned JWKS cache — since a
   published symmetric key is a signing key.

`auth.py` now selects the key by `kid` itself, considers only `RSA` keys, and
pins RS256 in both the header check and `algorithms=`. Migration to PyJWT is
documented in `docs/auth-provider.md` and touches only `verify_token()`.

## Blockers — none hidden

1. **No OIDC provider chosen, no tenant, no test accounts.** Nothing ran
   against a hosted IdP. Tests mint their own RS256 tokens from locally
   generated keypairs: the cryptography is real, **the issuer is not**. No
   fictional provider tenant, client ID or credential was invented.
   **"Login works" is not claimed and would be false today.**
2. **Mobile module not wired into the app** — blocked on the role-B lockfile
   agreement above. The logic is tested under Node; it has never run on a
   device.
3. **Token storage not implemented** (`expo-secure-store`, same constraint).
   Until it exists, nothing should be persisted to disk.
4. **JWKS fetching/caching not implemented.** `auth.py` does no network I/O by
   design, so a JWKS outage cannot become a silent auth bypass — but whoever
   wires the provider must decide the failure mode explicitly.
5. **Independent auth review not done.** Required by AGENTS.md.
6. Revocation cannot reach a token before it expires. Deactivating a
   *membership* takes effect immediately (re-read per request); revoking the
   *token* does not. T45's offline lease widens this and needs its own
   analysis.

## Proposed status update (for the reviewer, not applied)

I have **not** checked the T06 box in `to-do.md`; the card reserves it for
after review, and `jalsakshi-blueprint/` is a reference package this repo does
not edit. Proposed wording once a reviewer signs off on both the provider
choice and the auth implementation:

> T06 — online verification implemented and tested; provider selection and
> real test accounts still outstanding; mobile wiring blocked on role-B
> dependency agreement.

## Artifact locations

- Code: `services/api/app/auth.py`, `apps/mobile/src/auth.ts`
- Tests: `tests/auth_test.py` (44), `tests/auth_client.test.ts` (12)
- Decision record and blockers: `docs/auth-provider.md`
- Pins: `services/api/requirements.txt`
- Evidence: the command block above, reproducible from commit
  `1c371043629f061c945cf4a38af68c84af8e6bff` plus these six files.

---

## M1 Definition-of-Done review — 2026-09-24

**Acceptance: met.** `auth.py` and `auth.ts` were not changed. The suites
`tests/auth_test.py` and `tests/auth_client.test.ts` still pass.

**Gap found.** Nothing could mint a token that `authenticate()` accepts, and no
production route calls it. M1 needs auth "enforced even while offline, not
bypassed", so T06 on its own gives M1 nothing to enforce.

**Resolution (project owner's choice): synthetic dev issuer,
[ADR-M1-002](../decisions/ADR-M1-002-synthetic-dev-issuer.md).**
`services/api/app/dev_issuer.py` provides:
- real RS256 tokens and a JWKS;
- an `.invalid` issuer;
- no tenant or role claims;
- mounting in development+synthetic only.

It does not re-implement verification. Its tokens go through T06's real
`authenticate()`.

Evidence (reproducible):

    python -m unittest tests.dev_issuer_test     # 26 OK
    python -m unittest tests.auth_test tests.sources_postgres_test   # 56 OK
    python -m pytest services/api -q             # 38 passed
    node --experimental-strip-types --test tests/*.test.ts   # 8/8 files pass

Mutation check: 6/6 caught. The mutants were:
- gate forced on;
- gate ignoring data mode;
- private JWK published;
- password check skipped;
- revocation made a no-op;
- `.data/` and `*.pem` removed from .gitignore.

**Handed on, not fixed here:**
- `apps/mobile/src/auth.ts` has a dead `refreshToken` field and no refresh
  function. It belongs to T15/T45, which own reconnect and offline lease.
- No API route calls `authenticate()` yet. T13 (ingestion) is the first
  consumer and must use `app.state.dev_issuer.oidc_config()` and
  `.memberships.lookup` in development.
- Real provider, JWKS fetching and the independent auth review are all still
  open. **Box not ticked.**
