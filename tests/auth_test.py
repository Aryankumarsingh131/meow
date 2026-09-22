"""T06 verification: two-user / two-tenant negative authorization tests.

Real RSA keypairs are generated in-process and real RS256 JWTs are signed and
verified. Nothing here is mocked: `verify_token` runs the same signature path
it will run in production, only against a locally minted issuer instead of a
hosted one. No real OIDC provider tenant or test account exists yet - that
blocker is recorded in docs/auth-provider.md and in current-state.md, and an
end-to-end login against a live provider is NOT claimed by this file.

Run:  python -m unittest tests.auth_test -v
"""

from __future__ import annotations

import base64
import json
import time
import unittest
from typing import Any, Sequence

from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt
from jose.backends import RSAKey
from jose.constants import ALGORITHMS

from services.api.app.auth import (
    DEFAULT_LEEWAY_SECONDS,
    Authorized,
    Denied,
    Membership,
    OIDCConfig,
    Session,
    VerifiedToken,
    authenticate,
    bearer_token,
    require_role,
    require_tenant,
    verify_token,
)

ISSUER = "https://idp.test.jalsakshi.invalid/realms/jalsakshi"
AUDIENCE = "jalsakshi-api"

# Two tenants, two users - the fixture the acceptance criteria call for.
TENANT_A = "tenant-a-block-01"
TENANT_B = "tenant-b-block-02"
USER_A = "user-a-worker"
USER_B = "user-b-supervisor"

MEMBERSHIPS = {
    USER_A: [Membership(USER_A, TENANT_A, "worker", active=True)],
    USER_B: [Membership(USER_B, TENANT_B, "supervisor", active=True)],
    "user-revoked": [Membership("user-revoked", TENANT_A, "worker", active=False)],
    "user-two-tenants": [
        Membership("user-two-tenants", TENANT_A, "worker", active=True),
        Membership("user-two-tenants", TENANT_B, "worker", active=True),
    ],
}


def lookup(user_id: str) -> Sequence[Membership]:
    return MEMBERSHIPS.get(user_id, [])


def _b64url(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _keypair(kid: str) -> tuple[RSAKey, dict[str, Any]]:
    """Generate a real RSA keypair and its published JWK."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    signing_key = RSAKey(private, ALGORITHMS.RS256)
    public_jwk = signing_key.public_key().to_dict()
    public_jwk["kid"] = kid
    public_jwk["use"] = "sig"
    public_jwk["alg"] = "RS256"
    return signing_key, public_jwk


class AuthTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.signing_key, cls.jwk = _keypair("kid-provider-1")
        # A second, unrelated keypair: an attacker's own IdP.
        cls.rogue_key, cls.rogue_jwk = _keypair("kid-rogue-1")
        cls.config = OIDCConfig(issuer=ISSUER, audience=AUDIENCE, jwks={"keys": [cls.jwk]})
        cls.now = int(time.time())

    def token(
        self,
        subject: str,
        *,
        issuer: str = ISSUER,
        audience: str = AUDIENCE,
        exp_delta: int = 900,
        iat_delta: int = 0,
        key: RSAKey | None = None,
        kid: str = "kid-provider-1",
        extra: dict[str, Any] | None = None,
    ) -> str:
        claims: dict[str, Any] = {
            "sub": subject,
            "iss": issuer,
            "aud": audience,
            "iat": self.now + iat_delta,
            "exp": self.now + exp_delta,
        }
        claims.update(extra or {})
        return jwt.encode(
            claims,
            key or self.signing_key,
            algorithm="RS256",
            headers={"kid": kid},
        )

    def authorize(self, token: str) -> Authorized | Denied:
        return authenticate(token, self.config, lookup, now=self.now)

    def session_for(self, user_id: str) -> Session:
        outcome = self.authorize(self.token(user_id))
        assert isinstance(outcome, Authorized), outcome
        return outcome.session


class TestPositivePath(AuthTestBase):
    def test_valid_token_yields_tenant_scoped_session(self) -> None:
        session = self.session_for(USER_A)
        self.assertEqual(session.user_id, USER_A)
        self.assertEqual(session.tenant_id, TENANT_A)
        self.assertEqual(session.role, "worker")

    def test_tenant_comes_from_membership_not_from_the_token(self) -> None:
        """A forged `tenant_id` claim must not influence the resolved tenant."""
        token = self.token(USER_A, extra={"tenant_id": TENANT_B, "role": "admin"})
        outcome = self.authorize(token)
        assert isinstance(outcome, Authorized)
        self.assertEqual(outcome.session.tenant_id, TENANT_A)
        self.assertEqual(outcome.session.role, "worker")


class TestIssuerAudienceExpiry(AuthTestBase):
    def test_wrong_issuer_denied(self) -> None:
        token = self.token(USER_A, issuer="https://evil.invalid/realms/jalsakshi")
        self.assertEqual(self.authorize(token), Denied("AUTH_REQUIRED", "Token could not be verified."))

    def test_wrong_audience_denied(self) -> None:
        token = self.token(USER_A, audience="some-other-api")
        self.assertIsInstance(self.authorize(token), Denied)

    def test_expired_token_denied(self) -> None:
        token = self.token(USER_A, exp_delta=-3600)
        outcome = self.authorize(token)
        assert isinstance(outcome, Denied)
        self.assertEqual(outcome.status, 401)

    def test_expiry_leeway_is_bounded(self) -> None:
        """Just inside the 60 s skew window passes; well outside it does not."""
        self.assertIsInstance(self.authorize(self.token(USER_A, exp_delta=-30)), Authorized)
        self.assertIsInstance(self.authorize(self.token(USER_A, exp_delta=-120)), Denied)

    def test_default_leeway_is_small(self) -> None:
        """A generous skew window silently extends every token's life. Assert
        the shipped default is minutes, not hours - a mutation test showed
        that widening it to 24 h was otherwise caught by nothing."""
        self.assertEqual(OIDCConfig(ISSUER, AUDIENCE, {"keys": []}).leeway_seconds, DEFAULT_LEEWAY_SECONDS)
        self.assertLessEqual(DEFAULT_LEEWAY_SECONDS, 300)

    def test_expired_token_denied_with_zero_leeway_config(self) -> None:
        strict = OIDCConfig(ISSUER, AUDIENCE, {"keys": [self.jwk]}, leeway_seconds=0)
        outcome = verify_token(self.token(USER_A, exp_delta=-1), strict, now=self.now)
        self.assertIsInstance(outcome, Denied)

    def test_not_before_in_the_future_denied(self) -> None:
        token = self.token(USER_A, extra={"nbf": self.now + 3600})
        self.assertIsInstance(self.authorize(token), Denied)

    def test_issued_in_the_future_denied(self) -> None:
        token = self.token(USER_A, iat_delta=3600)
        self.assertIsInstance(self.authorize(token), Denied)

    def test_missing_expiry_denied(self) -> None:
        claims = {"sub": USER_A, "iss": ISSUER, "aud": AUDIENCE, "iat": self.now}
        token = jwt.encode(claims, self.signing_key, algorithm="RS256", headers={"kid": "kid-provider-1"})
        self.assertIsInstance(self.authorize(token), Denied)

    def test_missing_subject_denied(self) -> None:
        claims = {"iss": ISSUER, "aud": AUDIENCE, "iat": self.now, "exp": self.now + 900}
        token = jwt.encode(claims, self.signing_key, algorithm="RS256", headers={"kid": "kid-provider-1"})
        self.assertIsInstance(self.authorize(token), Denied)


class TestSignature(AuthTestBase):
    def test_token_signed_by_unknown_key_denied(self) -> None:
        token = self.token(USER_A, key=self.rogue_key, kid="kid-rogue-1")
        self.assertIsInstance(self.authorize(token), Denied)

    def test_unsigned_alg_none_token_denied(self) -> None:
        """`alg: none` must fail closed, not be treated as 'already verified'.

        Hand-crafted rather than minted with jose, which refuses to sign
        `none` at all - an attacker has no such scruples, so the forged token
        has to be built byte by byte to actually reach `verify_token`.
        """
        header = {"alg": "none", "typ": "JWT", "kid": "kid-provider-1"}
        claims = {"sub": USER_A, "iss": ISSUER, "aud": AUDIENCE, "iat": self.now, "exp": self.now + 900}
        token = f"{_b64url(header)}.{_b64url(claims)}."
        self.assertIsInstance(self.authorize(token), Denied)

    def test_hmac_confusion_with_public_key_denied(self) -> None:
        """Classic attack: sign HS256 using the published RSA modulus as the
        shared secret. Pinning ALLOWED_ALGORITHMS to RS256 is what stops it."""
        secret = self.jwk["n"]
        token = jwt.encode(
            {"sub": USER_A, "iss": ISSUER, "aud": AUDIENCE, "iat": self.now, "exp": self.now + 900},
            key=secret,
            algorithm="HS256",
            headers={"kid": "kid-provider-1"},
        )
        self.assertIsInstance(self.authorize(token), Denied)

    def test_hmac_token_denied_even_if_jwks_carries_a_symmetric_key(self) -> None:
        """This is the case that makes the RS256 pin load-bearing.

        With an RSA-only JWKS an HS256 forgery is already rejected because the
        key type cannot match, so the pin is unobservable and a mutation that
        removes it survives. If the key set ever contains an `oct` key - a
        misconfigured provider, or a poisoned JWKS cache - the shared secret is
        published and anyone can mint an admin token. `ALLOWED_ALGORITHMS` is
        the only thing standing there, so it is tested here explicitly.
        """
        shared = base64.urlsafe_b64encode(b"a-symmetric-key-that-should-never-be-here").rstrip(b"=").decode()
        oct_key = {"kty": "oct", "kid": "kid-oct-1", "k": shared, "alg": "HS256"}
        forged = jwt.encode(
            {"sub": USER_A, "iss": ISSUER, "aud": AUDIENCE, "iat": self.now, "exp": self.now + 900},
            key={"kty": "oct", "k": shared},
            algorithm="HS256",
            headers={"kid": "kid-oct-1"},
        )
        # Both orderings. python-jose 3.5.0 walks the key set in order and
        # ignores `kid`, so with the `oct` key first it accepts this forgery
        # outright - the ordering is the whole bug, hence both cases here.
        for label, keys in (("oct first", [oct_key, self.jwk]), ("oct second", [self.jwk, oct_key])):
            with self.subTest(order=label):
                poisoned = OIDCConfig(issuer=ISSUER, audience=AUDIENCE, jwks={"keys": keys})
                outcome = verify_token(forged, poisoned, now=self.now)
                assert isinstance(outcome, Denied), f"HS256 forgery accepted ({label})"
                self.assertEqual(outcome.status, 401)

    def test_key_is_selected_by_kid_not_by_position(self) -> None:
        """Provider key rotation publishes several keys at once. Verification
        must follow `kid`, not key-set order, or a rotation locks every user
        out. python-jose does not do this for us."""
        rotated_key, rotated_jwk = _keypair("kid-provider-2")
        config = OIDCConfig(issuer=ISSUER, audience=AUDIENCE, jwks={"keys": [self.jwk, rotated_jwk]})
        for kid, key in (("kid-provider-1", self.signing_key), ("kid-provider-2", rotated_key)):
            with self.subTest(kid=kid):
                token = self.token(USER_A, key=key, kid=kid)
                self.assertIsInstance(verify_token(token, config, now=self.now), VerifiedToken)

    def test_unknown_kid_denied(self) -> None:
        self.assertIsInstance(self.authorize(self.token(USER_A, kid="kid-does-not-exist")), Denied)

    def test_ambiguous_key_without_kid_denied(self) -> None:
        """No `kid` plus a multi-key set has no unambiguous answer: fail closed
        rather than trying keys until one happens to work."""
        _, second_jwk = _keypair("kid-provider-2")
        config = OIDCConfig(issuer=ISSUER, audience=AUDIENCE, jwks={"keys": [self.jwk, second_jwk]})
        claims = {"sub": USER_A, "iss": ISSUER, "aud": AUDIENCE, "iat": self.now, "exp": self.now + 900}
        token = jwt.encode(claims, self.signing_key, algorithm="RS256")  # no kid header
        self.assertIsInstance(verify_token(token, config, now=self.now), Denied)

    def test_tampered_payload_denied(self) -> None:
        header, payload, signature = self.token(USER_A).split(".")
        other_payload = self.token(USER_B).split(".")[1]
        self.assertIsInstance(self.authorize(f"{header}.{other_payload}.{signature}"), Denied)

    def test_garbage_and_empty_tokens_denied(self) -> None:
        for bad in ("", "   ", "not-a-jwt", "a.b.c", "Bearer x.y.z", "." * 10):
            with self.subTest(token=bad):
                outcome = verify_token(bad, self.config, now=self.now)
                assert isinstance(outcome, Denied)
                self.assertEqual(outcome.status, 401)


class TestTenantMembership(AuthTestBase):
    def test_authenticated_user_with_no_membership_forbidden(self) -> None:
        outcome = self.authorize(self.token("user-with-no-tenant"))
        assert isinstance(outcome, Denied)
        self.assertEqual((outcome.code, outcome.status), ("FORBIDDEN", 403))

    def test_revoked_membership_forbidden(self) -> None:
        """A still-valid token plus a deactivated membership must be denied:
        membership is re-read per request, not baked into the token."""
        outcome = self.authorize(self.token("user-revoked"))
        assert isinstance(outcome, Denied)
        self.assertEqual(outcome.code, "FORBIDDEN")

    def test_ambiguous_multi_tenant_membership_denied_not_guessed(self) -> None:
        outcome = self.authorize(self.token("user-two-tenants"))
        assert isinstance(outcome, Denied)
        self.assertEqual(outcome.code, "FORBIDDEN")


class TestTwoUserTwoTenantObjectAccess(AuthTestBase):
    """The core AC-017 negative: user A must never reach tenant B's objects."""

    def test_cross_tenant_object_access_is_404_not_403(self) -> None:
        session_a = self.session_for(USER_A)
        denial = require_tenant(session_a, TENANT_B)
        assert isinstance(denial, Denied)
        self.assertEqual((denial.code, denial.status), ("NOT_FOUND", 404))
        self.assertNotIn(TENANT_B, denial.detail)

    def test_cross_tenant_denied_in_both_directions(self) -> None:
        self.assertIsInstance(require_tenant(self.session_for(USER_B), TENANT_A), Denied)
        self.assertIsInstance(require_tenant(self.session_for(USER_A), TENANT_B), Denied)

    def test_own_tenant_object_allowed(self) -> None:
        self.assertIsNone(require_tenant(self.session_for(USER_A), TENANT_A))
        self.assertIsNone(require_tenant(self.session_for(USER_B), TENANT_B))

    def test_higher_role_in_other_tenant_does_not_cross_the_boundary(self) -> None:
        """B is a supervisor, but only of tenant B. Role never widens tenancy."""
        session_b = self.session_for(USER_B)
        self.assertIsNone(require_role(session_b, ["supervisor", "admin"]))
        self.assertIsInstance(require_tenant(session_b, TENANT_A), Denied)


class TestRoleMatrix(AuthTestBase):
    """Spot-checks of docs/architecture/authorization-matrix.md. The full
    per-cell matrix test is T31's scope, not T06's."""

    def test_worker_cannot_reach_supervisor_only_endpoint(self) -> None:
        # GET /v1/cases is supervisor / lab_reviewer / admin only.
        denial = require_role(self.session_for(USER_A), ["supervisor", "lab_reviewer", "admin"])
        assert isinstance(denial, Denied)
        self.assertEqual((denial.code, denial.status), ("FORBIDDEN", 403))

    def test_supervisor_cannot_reach_admin_plane(self) -> None:
        self.assertIsInstance(require_role(self.session_for(USER_B), ["admin"]), Denied)

    def test_worker_allowed_on_push(self) -> None:
        # POST /v1/sync/push is worker + supervisor.
        self.assertIsNone(require_role(self.session_for(USER_A), ["worker", "supervisor"]))


class TestNoSecretMaterial(AuthTestBase):
    def test_no_secret_material_in_config(self) -> None:
        """Acceptance criterion 3: no client or admin secret anywhere in the
        auth configuration surface. The API verifies with public JWKS only."""
        fields = set(OIDCConfig.__dataclass_fields__)
        self.assertEqual(fields, {"issuer", "audience", "jwks", "leeway_seconds"})
        for field in fields:
            for banned in ("secret", "password", "private", "credential"):
                self.assertNotIn(banned, field.lower())

    def test_jwks_carries_no_private_rsa_parameters(self) -> None:
        for key in self.config.jwks["keys"]:
            for private_param in ("d", "p", "q", "dp", "dq", "qi", "k"):
                self.assertNotIn(private_param, key, f"private JWK parameter {private_param!r} published")

    def test_denials_never_echo_token_material(self) -> None:
        token = self.token(USER_A, exp_delta=-3600)
        outcome = self.authorize(token)
        assert isinstance(outcome, Denied)
        self.assertNotIn(token, outcome.detail)
        self.assertNotIn(token.split(".")[2], outcome.detail)


class TestBearerHeaderParsing(AuthTestBase):
    def test_well_formed_header(self) -> None:
        self.assertEqual(bearer_token("Bearer abc.def.ghi"), "abc.def.ghi")
        self.assertEqual(bearer_token("bearer abc.def.ghi"), "abc.def.ghi")

    def test_malformed_headers_yield_no_token(self) -> None:
        for header in (None, "", "abc.def.ghi", "Basic dXNlcjpwYXNz", "Bearer", "Token abc"):
            with self.subTest(header=header):
                self.assertEqual(bearer_token(header), "")


class TestApiSurface(AuthTestBase):
    """Two-user / two-tenant negatives through a real HTTP surface.

    Builds its own FastAPI app rather than importing services/api/app/main.py:
    that file is T05's declared file and wiring auth into it is not in T06's
    scope. What is exercised here is the real ASGI request path, real header
    parsing and the real status codes a client would see - not the helper
    functions called directly.
    """

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        from fastapi import Depends, FastAPI, Header, HTTPException
        from fastapi.testclient import TestClient

        # Stand-in for tenant-owned rows: sample-a belongs to tenant A only.
        SAMPLES = {"sample-a": TENANT_A, "sample-b": TENANT_B}

        def current_session(authorization: str | None = Header(default=None)) -> Session:
            outcome = authenticate(bearer_token(authorization), cls.config, lookup, now=cls.now)
            if isinstance(outcome, Denied):
                raise HTTPException(status_code=outcome.status, detail=outcome.detail)
            return outcome.session

        app = FastAPI()

        @app.get("/v1/samples/{sample_id}")
        def get_sample(sample_id: str, session: Session = Depends(current_session)) -> dict[str, str]:
            owner = SAMPLES.get(sample_id)
            # Unknown ID and other-tenant ID must be indistinguishable.
            denial = require_tenant(session, owner) if owner else Denied("NOT_FOUND", "Resource not found.")
            if denial is not None:
                raise HTTPException(status_code=denial.status, detail=denial.detail)
            return {"sample_id": sample_id, "tenant_id": session.tenant_id}

        @app.get("/v1/cases")
        def list_cases(session: Session = Depends(current_session)) -> dict[str, str]:
            denial = require_role(session, ["supervisor", "lab_reviewer", "admin"])
            if denial is not None:
                raise HTTPException(status_code=denial.status, detail=denial.detail)
            return {"tenant_id": session.tenant_id}

        cls.client = TestClient(app)

    def auth_header(self, user_id: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token(user_id)}"}

    def test_no_header_is_401(self) -> None:
        self.assertEqual(self.client.get("/v1/samples/sample-a").status_code, 401)

    def test_own_tenant_sample_is_200(self) -> None:
        response = self.client.get("/v1/samples/sample-a", headers=self.auth_header(USER_A))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["tenant_id"], TENANT_A)

    def test_cross_tenant_sample_is_404_both_directions(self) -> None:
        self.assertEqual(self.client.get("/v1/samples/sample-b", headers=self.auth_header(USER_A)).status_code, 404)
        self.assertEqual(self.client.get("/v1/samples/sample-a", headers=self.auth_header(USER_B)).status_code, 404)

    def test_cross_tenant_is_indistinguishable_from_nonexistent(self) -> None:
        """If these two differed, user A could enumerate tenant B's sample IDs."""
        other_tenant = self.client.get("/v1/samples/sample-b", headers=self.auth_header(USER_A))
        nonexistent = self.client.get("/v1/samples/sample-zzz", headers=self.auth_header(USER_A))
        self.assertEqual(other_tenant.status_code, nonexistent.status_code)
        self.assertEqual(other_tenant.json(), nonexistent.json())

    def test_expired_token_is_401_at_the_api(self) -> None:
        headers = {"Authorization": f"Bearer {self.token(USER_A, exp_delta=-3600)}"}
        self.assertEqual(self.client.get("/v1/samples/sample-a", headers=headers).status_code, 401)

    def test_foreign_issuer_token_is_401_at_the_api(self) -> None:
        headers = {"Authorization": f"Bearer {self.token(USER_A, issuer='https://evil.invalid')}"}
        self.assertEqual(self.client.get("/v1/samples/sample-a", headers=headers).status_code, 401)

    def test_worker_role_denied_on_cases_but_supervisor_allowed(self) -> None:
        self.assertEqual(self.client.get("/v1/cases", headers=self.auth_header(USER_A)).status_code, 403)
        supervisor = self.client.get("/v1/cases", headers=self.auth_header(USER_B))
        self.assertEqual(supervisor.status_code, 200)
        self.assertEqual(supervisor.json()["tenant_id"], TENANT_B)

    def test_no_response_ever_echoes_the_token(self) -> None:
        token = self.token(USER_A, exp_delta=-3600)
        response = self.client.get("/v1/samples/sample-a", headers={"Authorization": f"Bearer {token}"})
        self.assertNotIn(token, response.text)


if __name__ == "__main__":
    unittest.main()
