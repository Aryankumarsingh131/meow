"""T06: online membership authorization.

Scope (REQ-017, AC-017 online half):

* Verify an OIDC access token: RS256 signature against the provider JWKS,
  exact issuer match, audience match, expiry/not-before/issued-at with
  bounded leeway.
* Resolve tenant membership. The tenant is resolved from the membership
  lookup, never read from a request field
  (jalsakshi-blueprint/docs/architecture/api-contracts.md, line 3).
* Apply the role matrix from
  jalsakshi-blueprint/docs/architecture/authorization-matrix.md.

Deliberately NOT in this module:

* `POST /v1/session/offline-grant` and the 72 h offline lease - that is T45.
* Web cookie/CSRF session - T18.
* PostgreSQL row-level security - T31. This module is the application-level
  control; RLS is the defence-in-depth backstop behind it.

There is no client secret, no admin secret and no signing key here. The
mobile app is a public PKCE client and this service only ever *verifies*
provider-issued tokens with public JWKS material. `OIDCConfig` has no field
that could hold one - see `test_no_secret_material_in_config`.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping, Sequence

from jose import jwt
from jose.exceptions import JWTError

# The only signature algorithm accepted. Pinning this is what makes an
# `alg: none` token and an HS256 token signed with the (public) JWKS modulus
# both fail closed instead of verifying.
ALLOWED_ALGORITHMS = ("RS256",)

# Clock skew tolerance between this API and the identity provider.
DEFAULT_LEEWAY_SECONDS = 60

Role = Literal["worker", "supervisor", "lab_reviewer", "admin"]

DenialCode = Literal[
    "AUTH_REQUIRED",  # token missing, malformed, unverifiable, or expired
    "FORBIDDEN",  # authenticated, but not permitted
    "NOT_FOUND",  # authenticated, but must not learn the object exists
]


@dataclass(frozen=True)
class OIDCConfig:
    """Provider configuration. Public values only.

    `jwks` is the provider's published JWK Set document (the parsed
    `{"keys": [...]}` mapping from the `jwks_uri` in OIDC discovery). Fetching
    and caching it is the caller's job; this module does no network I/O so it
    stays testable and so a JWKS outage cannot turn into a silent auth bypass.
    """

    issuer: str
    audience: str
    jwks: Mapping[str, Any]
    leeway_seconds: int = DEFAULT_LEEWAY_SECONDS


@dataclass(frozen=True)
class Membership:
    """One user's membership of one tenant. Mirrors the `memberships` row.

    `memberships.scopes` is deliberately absent: it is removed from v1 by
    docs/architecture/authorization-matrix.md.
    """

    user_id: str
    tenant_id: str
    role: Role
    active: bool


@dataclass(frozen=True)
class VerifiedToken:
    subject: str
    issuer: str
    audience: str
    expires_at: int
    claims: Mapping[str, Any]


@dataclass(frozen=True)
class Session:
    """An authenticated, tenant-scoped session. Its existence is the proof."""

    token: VerifiedToken
    membership: Membership

    @property
    def user_id(self) -> str:
        return self.membership.user_id

    @property
    def tenant_id(self) -> str:
        return self.membership.tenant_id

    @property
    def role(self) -> Role:
        return self.membership.role


@dataclass(frozen=True)
class Authorized:
    session: Session


@dataclass(frozen=True)
class Denied:
    code: DenialCode
    detail: str

    @property
    def status(self) -> int:
        return {"AUTH_REQUIRED": 401, "FORBIDDEN": 403, "NOT_FOUND": 404}[self.code]


# Discriminated outcome. Callers must match on the type; there is no boolean
# that would let a caller collapse "unauthenticated" and "wrong tenant" into
# one state.
Outcome = Authorized | Denied

MembershipLookup = Callable[[str], Sequence[Membership]]


def _select_key(header: Mapping[str, Any], jwks: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """Pick the one RSA verification key named by the token's `kid`.

    Only `RSA` keys are considered: a symmetric (`oct`) entry in a published
    key set is either a provider misconfiguration or an attack, and either way
    its "public" key is a signing key. Returns `None` when no single key can be
    chosen, which the caller turns into a denial - failing closed.
    """
    candidates = [k for k in jwks.get("keys", []) if k.get("kty") == "RSA"]
    kid = header.get("kid")
    if kid is not None:
        candidates = [k for k in candidates if k.get("kid") == kid]
    # No `kid` is only unambiguous when the provider publishes exactly one key.
    return candidates[0] if len(candidates) == 1 else None


def verify_token(token: str, config: OIDCConfig, *, now: int | None = None) -> VerifiedToken | Denied:
    """Verify signature, issuer, audience and time window.

    Every failure collapses to a single `AUTH_REQUIRED` denial with a generic
    detail: distinguishing "bad signature" from "expired" to an unauthenticated
    caller is an oracle, and the API contract forbids leaking token internals
    into problem responses.
    """
    if not token:
        return Denied("AUTH_REQUIRED", "No bearer token presented.")

    # Reject the declared algorithm before any key material is selected.
    try:
        header = jwt.get_unverified_header(token)
    except Exception:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")
    if header.get("alg") not in ALLOWED_ALGORITHMS:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")

    # Select the verification key by `kid` ourselves rather than handing the
    # whole key set to python-jose. Measured behaviour of python-jose 3.5.0:
    # it ignores `kid` and walks the key set in order, aborting on the first
    # key-type mismatch instead of trying the next key. Two consequences, both
    # reproduced in tests/auth_test.py:
    #   * an HS256 forgery is ACCEPTED if an `oct` key happens to sit first in
    #     the set, so the algorithm pin above is the only real defence;
    #   * a mixed-type key set can reject legitimate tokens outright.
    # Explicit `kid` selection is the standard OIDC behaviour and removes the
    # dependency on key ordering entirely.
    key = _select_key(header, config.jwks)
    if key is None:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")

    options = {
        "require_exp": True,
        "require_iat": True,
        "require_sub": True,
        "verify_aud": True,
        "verify_iss": True,
        "verify_signature": True,
        "leeway": config.leeway_seconds,
    }
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=list(ALLOWED_ALGORITHMS),
            audience=config.audience,
            issuer=config.issuer,
            options=options,
        )
    except JWTError:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")
    except Exception:  # malformed input reaches jose as ValueError/KeyError
        return Denied("AUTH_REQUIRED", "Token could not be verified.")

    # python-jose honours `leeway` for exp/nbf but we re-check exp against our
    # own clock so that a caller-supplied `now` (tests, replay analysis) is
    # authoritative rather than jose's internal time.time().
    reference = int(time.time()) if now is None else now
    if int(claims["exp"]) + config.leeway_seconds <= reference:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")
    nbf = claims.get("nbf")
    if nbf is not None and int(nbf) - config.leeway_seconds > reference:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")
    if int(claims["iat"]) - config.leeway_seconds > reference:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")

    subject = str(claims["sub"])
    if not subject:
        return Denied("AUTH_REQUIRED", "Token could not be verified.")

    return VerifiedToken(
        subject=subject,
        issuer=str(claims["iss"]),
        audience=config.audience,
        expires_at=int(claims["exp"]),
        claims=claims,
    )


def authenticate(
    token: str,
    config: OIDCConfig,
    lookup: MembershipLookup,
    *,
    now: int | None = None,
) -> Outcome:
    """Verify the token, then resolve exactly one active tenant membership.

    The tenant comes from `lookup`, never from the token and never from a
    request field: a token claim is asserted by the identity provider, which
    does not own our tenancy. A user with no active membership is 401-adjacent
    but is genuinely authenticated, so it is `FORBIDDEN`, not `AUTH_REQUIRED`.

    A user with more than one active membership is denied rather than guessed
    at. v1 has no tenant-switch UI and no endpoint that carries a tenant
    selector, so there is no safe way to pick one - guessing would be a
    silent cross-tenant read. Revisit when a real multi-tenant user exists.
    """
    verified = verify_token(token, config, now=now)
    if isinstance(verified, Denied):
        return verified

    active = [m for m in lookup(verified.subject) if m.active]
    if not active:
        return Denied("FORBIDDEN", "No active tenant membership.")
    if len(active) > 1:
        return Denied("FORBIDDEN", "Ambiguous tenant membership; not supported in v1.")

    return Authorized(Session(token=verified, membership=active[0]))


def bearer_token(authorization_header: str | None) -> str:
    """Extract the token from an `Authorization: Bearer <token>` header.

    Returns `""` for anything that is not a well-formed Bearer header - a
    Basic header, a bare token, or a missing one - which `verify_token` then
    turns into a 401. The scheme comparison is case-insensitive per RFC 7235.
    """
    if not authorization_header:
        return ""
    scheme, _, value = authorization_header.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return value.strip()


def require_role(session: Session, allowed: Sequence[Role]) -> Denied | None:
    """Endpoint-level check against the authorization matrix. `None` = allowed."""
    if session.role not in allowed:
        return Denied("FORBIDDEN", "Role not permitted for this endpoint.")
    return None


def require_tenant(session: Session, resource_tenant_id: str) -> Denied | None:
    """Object-level check. `None` = allowed.

    Returns 404, not 403: the matrix requires that an unauthorized ID be
    indistinguishable from a nonexistent one, so a caller cannot enumerate
    another tenant's sample and case IDs by reading the status code.
    """
    if session.tenant_id != resource_tenant_id:
        return Denied("NOT_FOUND", "Resource not found.")
    return None
