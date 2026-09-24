"""M1 synthetic identity provider (ADR-M1-002).

T06 built real OIDC token *verification* (`auth.py`) but no identity provider
has been chosen, so nothing could obtain a token T06 would accept. M1 requires
auth to be "enforced even while offline, not bypassed", so it cannot simply be
skipped. This module is the auth analogue of the SYN-COLOR-001 protocol
decision: a clearly-labelled **synthetic** issuer whose cryptography is real.

## What is real and what is not

REAL:
  - A genuine RSA-2048 key pair.
  - Genuine RS256 JWTs with `kid`, `iss`, `aud`, `iat`, `exp`, `sub`.
  - A genuine public JWKS.
  - Verification by **T06's unmodified `verify_token` / `authenticate`** — the
    same code path a real provider would feed. Nothing here re-implements it.

NOT REAL:
  - The issuer. `DEV_ISSUER` uses the `.invalid` TLD (RFC 2606), which can
    never resolve, so a token from here can never be mistaken for one from a
    real provider or accepted by a real deployment's `OIDCConfig`.
  - The users and memberships, which are a synthetic fixture.
  - The credential check, which is a password grant against public demo
    credentials. A real mobile flow is T06's PKCE code flow (`auth.ts`).

## Gating

Mounted ONLY when `environment == "development"` AND
`tenant_data_mode == "synthetic"` — the exact gate `config.py` already applies
to the synthetic demo router, which also refuses to let production run with
synthetic data. The router is never imported in any other configuration.

## Key custody

The private key is generated on first use and persisted to
`.data/dev-issuer/key.pem` so tokens survive an API restart within a dev
session. `.data/` and `*.pem` are gitignored; `tests/dev_issuer_test.py`
asserts the key path is ignored so a regression cannot commit it.
"""

from __future__ import annotations

import hmac
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt
from jose.backends import RSAKey
from jose.constants import ALGORITHMS

from .auth import Membership, OIDCConfig

# `.invalid` is reserved by RFC 2606 and can never resolve.
DEV_ISSUER = "https://dev-issuer.jalsakshi.invalid/synthetic"
DEV_AUDIENCE = "jalsakshi-api"
DEV_KID = "dev-issuer-rs256-1"

#: Short, so expiry is actually exercised during M1 reconnect testing.
DEFAULT_TOKEN_TTL_SECONDS = 900

DEFAULT_KEY_PATH = Path(".data") / "dev-issuer" / "key.pem"


def _uid(name: str) -> str:
    """Stable synthetic UUID. Deterministic so fixtures and tests agree."""
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"jalsakshi.synthetic.{name}"))


#: The single synthetic tenant M1 operates in.
SYNTHETIC_TENANT_ID = _uid("tenant.riverside-demo")
#: A second synthetic tenant, used ONLY by tests to prove cross-tenant denial.
SYNTHETIC_OTHER_TENANT_ID = _uid("tenant.other-demo")


@dataclass(frozen=True)
class DemoUser:
    username: str
    password: str
    user_id: str


#: Public demo credentials. They are shown on the login screen and verify
#: nothing beyond "this is a synthetic user"; they are NOT secrets.
DEMO_USERS: tuple[DemoUser, ...] = (
    DemoUser("worker", "jalsakshi", _uid("user.worker")),
    DemoUser("supervisor", "jalsakshi", _uid("user.supervisor")),
    DemoUser("other-worker", "jalsakshi", _uid("user.other-worker")),
)

#: Synthetic memberships. T06's rule: tenant comes from THIS lookup, never from
#: a token claim or a request field.
_MEMBERSHIPS: tuple[Membership, ...] = (
    Membership(_uid("user.worker"), SYNTHETIC_TENANT_ID, "worker", active=True),
    Membership(_uid("user.supervisor"), SYNTHETIC_TENANT_ID, "supervisor", active=True),
    Membership(_uid("user.other-worker"), SYNTHETIC_OTHER_TENANT_ID, "worker", active=True),
)


class MembershipStore:
    """In-memory synthetic membership store.

    Mutable on purpose: T45 (offline grant and revocation) needs to revoke a
    membership mid-session and observe the effect. T06 re-reads membership on
    every request, so a revocation takes effect on the very next call.
    """

    def __init__(self, memberships: Sequence[Membership] = _MEMBERSHIPS) -> None:
        self._rows = list(memberships)

    def lookup(self, user_id: str) -> list[Membership]:
        return [m for m in self._rows if m.user_id == user_id]

    def set_active(self, user_id: str, tenant_id: str, active: bool) -> None:
        self._rows = [
            Membership(m.user_id, m.tenant_id, m.role, active)
            if (m.user_id == user_id and m.tenant_id == tenant_id)
            else m
            for m in self._rows
        ]


def load_or_create_key(path: Path = DEFAULT_KEY_PATH) -> rsa.RSAPrivateKey:
    """Load the dev private key, generating it on first use.

    Written with owner-only permissions where the platform honours them.
    """
    if path.exists():
        return serialization.load_pem_private_key(path.read_bytes(), password=None)  # type: ignore[return-value]
    path.parent.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    path.write_bytes(pem)
    try:
        os.chmod(path, 0o600)
    except OSError:  # pragma: no cover - Windows ignores POSIX modes
        pass
    return key


class DevIssuer:
    """Mints real RS256 tokens that T06's real verifier accepts."""

    def __init__(
        self,
        key: rsa.RSAPrivateKey,
        memberships: MembershipStore | None = None,
        ttl_seconds: int = DEFAULT_TOKEN_TTL_SECONDS,
    ) -> None:
        self._signing = RSAKey(key, ALGORITHMS.RS256)
        public = self._signing.public_key().to_dict()
        public.update({"kid": DEV_KID, "use": "sig", "alg": "RS256"})
        self._jwks = {"keys": [public]}
        self.memberships = memberships or MembershipStore()
        self.ttl_seconds = ttl_seconds

    @property
    def jwks(self) -> Mapping[str, Any]:
        return self._jwks

    def oidc_config(self) -> OIDCConfig:
        """The OIDCConfig T06's `authenticate` should be given in dev."""
        return OIDCConfig(issuer=DEV_ISSUER, audience=DEV_AUDIENCE, jwks=self._jwks)

    def mint(self, user_id: str, *, now: int | None = None, ttl_seconds: int | None = None) -> str:
        issued = int(time.time()) if now is None else now
        ttl = self.ttl_seconds if ttl_seconds is None else ttl_seconds
        claims = {
            "sub": user_id,
            "iss": DEV_ISSUER,
            "aud": DEV_AUDIENCE,
            "iat": issued,
            "exp": issued + ttl,
        }
        return jwt.encode(claims, self._signing, algorithm="RS256", headers={"kid": DEV_KID})


def check_credentials(username: str, password: str) -> str | None:
    """Return the user id for valid demo credentials, else None.

    Constant-time comparison, and "no such user" is indistinguishable from
    "wrong password" — the same enumeration-resistance rule as the mobile
    `session.ts`, applied at the server where it actually matters.
    """
    u = (username or "").strip().lower()
    match: DemoUser | None = None
    for user in DEMO_USERS:
        if hmac.compare_digest(user.username, u):
            match = user
    # Always perform a comparison so timing does not reveal whether the
    # username existed.
    expected = match.password if match else "\x00invalid\x00"
    ok = hmac.compare_digest(expected.encode(), (password or "").encode())
    return match.user_id if (match and ok) else None


# --- HTTP surface (mounted only in development + synthetic; see main.py) ---

from fastapi import APIRouter  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from .errors import ApiError  # noqa: E402


class TokenRequest(BaseModel):
    # Bounded at the trust boundary.
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int
    issuer: str
    #: Always true here. Present so a client can never mistake this for a
    #: token from a real identity provider.
    synthetic: bool = True


def build_router(issuer: DevIssuer) -> APIRouter:
    router = APIRouter(prefix="/dev/v1", tags=["synthetic-dev-issuer"])

    @router.get("/jwks.json")
    def jwks() -> Mapping[str, Any]:
        """Public keys only. Contains no private RSA parameters."""
        return issuer.jwks

    @router.post("/token", response_model=TokenResponse)
    def token(body: TokenRequest) -> TokenResponse:
        user_id = check_credentials(body.username, body.password)
        if user_id is None:
            # One message for both unknown user and wrong password. Status,
            # title and retryable come from errors.ERROR_CODES (401, not
            # retryable) so this matches the shared problem+json contract.
            raise ApiError(code="AUTH_REQUIRED", detail="Those details were not recognised.")
        return TokenResponse(
            access_token=issuer.mint(user_id),
            expires_in=issuer.ttl_seconds,
            issuer=DEV_ISSUER,
        )

    return router
