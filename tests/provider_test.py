"""Hosted identity provider (Supabase Auth): signing-key cache, DB memberships,
ES256 verification and the HTTP wiring.

Run: python -m unittest tests.provider_test -v
"""

from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from jose import jwk, jwt

from services.api.app.auth import Authorized, Denied, authenticate
from services.api.app.db import connector, migrate
from services.api.app.main import app
from services.api.app.provider import HostedAuth, JwksCache, db_membership_lookup, http_get_json

ISSUER = "https://example-ref.supabase.co/auth/v1"
AUDIENCE = "authenticated"
TENANT = str(uuid4())


def ec_key(kid: str):
    private = ec.generate_private_key(ec.SECP256R1())
    pem = private.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = jwk.construct(private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo), "ES256").to_dict()
    return pem, {**public, "kid": kid, "use": "sig", "alg": "ES256"}


def token(pem: bytes, kid: str, sub: str, *, alg: str = "ES256", **over) -> str:
    now = int(time.time())
    claims = {"sub": sub, "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 3600, "role": "authenticated", **over}
    return jwt.encode(claims, pem, algorithm=alg, headers={"kid": kid})


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class JwksCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self.calls, self.clock = 0, FakeClock()
        self.published = {"keys": [{"kid": "a", "kty": "EC"}]}

    def fetch(self, _url):
        self.calls += 1
        if isinstance(self.published, Exception):
            raise self.published
        return self.published

    def cache(self) -> JwksCache:
        return JwksCache("https://x", fetch=self.fetch, ttl=600, min_refresh=60, clock=self.clock)

    def test_fetches_once_then_serves_from_cache_until_the_ttl(self) -> None:
        c = self.cache()
        c.keys_for("a"), c.keys_for("a")
        self.assertEqual(self.calls, 1)
        self.clock.now = 601
        c.keys_for("a")
        self.assertEqual(self.calls, 2)

    def test_an_unknown_key_id_refetches_early_but_rate_limited(self) -> None:
        c = self.cache()
        c.keys_for("a")
        self.clock.now = 30
        c.keys_for("rotated")
        self.assertEqual(self.calls, 1, "no refetch storm from junk kids")
        self.clock.now = 61
        self.published = {"keys": [{"kid": "rotated", "kty": "EC"}]}
        self.assertEqual(c.keys_for("rotated")["keys"][0]["kid"], "rotated")
        self.assertEqual(self.calls, 2)

    def test_an_outage_keeps_the_last_good_key_set(self) -> None:
        c = self.cache()
        c.keys_for("a")
        self.published, self.clock.now = OSError("down"), 700
        self.assertEqual(c.keys_for("a")["keys"][0]["kid"], "a")

    def test_never_fetched_fails_closed(self) -> None:
        self.published = OSError("down")
        self.assertIsNone(self.cache().keys_for("a"))
        self.published = {"not": "a key set"}
        self.clock.now = 1000
        self.assertIsNone(self.cache().keys_for("a"))

    def test_only_https_is_fetched(self) -> None:
        with self.assertRaises(ValueError):
            http_get_json("http://example-ref.supabase.co/auth/v1/.well-known/jwks.json")


class HostedAuthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.connect = connector("", Path(self.tmp.name) / "api.sqlite3")
        conn = self.connect()
        migrate(conn)
        self.worker = str(uuid4())
        conn.execute("INSERT INTO memberships (tenant_id, user_id, role, active) VALUES (?, ?, 'worker', 1)", (TENANT, self.worker))
        conn.commit()
        conn.close()
        self.pem, public = ec_key("k1")
        self.jwks = {"keys": [public]}
        self.auth = HostedAuth(ISSUER + "/", AUDIENCE, db_membership_lookup(self.connect),
                               JwksCache("https://x", fetch=lambda _u: self.jwks))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def check(self, tok: str):
        return authenticate(tok, self.auth.resolve(tok), self.auth.lookup)

    def test_an_es256_supabase_token_resolves_tenant_and_role_from_the_table(self) -> None:
        outcome = self.check(token(self.pem, "k1", self.worker))
        self.assertIsInstance(outcome, Authorized)
        self.assertEqual((outcome.session.tenant_id, outcome.session.role), (TENANT, "worker"))

    def test_a_signed_in_user_without_a_membership_is_forbidden(self) -> None:
        for sub in (str(uuid4()), "not-a-uuid"):
            self.assertEqual(self.check(token(self.pem, "k1", sub)).code, "FORBIDDEN")

    def test_wrong_issuer_audience_key_or_algorithm_is_denied(self) -> None:
        other_pem, _ = ec_key("k1")
        rsa_pem = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        for bad in (token(self.pem, "k1", self.worker, iss="https://evil.supabase.co/auth/v1"),
                    token(self.pem, "k1", self.worker, aud="anon"),
                    token(other_pem, "k1", self.worker),
                    token(rsa_pem, "k1", self.worker, alg="RS256"),  # RS256 cannot use an EC key
                    jwt.encode({"sub": self.worker, "iss": ISSUER, "aud": AUDIENCE, "iat": 0, "exp": 9999999999},
                               "secret", algorithm="HS256", headers={"kid": "k1"})):
            outcome = self.check(bad)
            self.assertIsInstance(outcome, Denied)
            self.assertEqual(outcome.code, "AUTH_REQUIRED")

    def test_a_deactivated_membership_is_forbidden(self) -> None:
        conn = self.connect()
        conn.execute("UPDATE memberships SET active = 0")
        conn.commit()
        conn.close()
        self.assertEqual(self.check(token(self.pem, "k1", self.worker)).code, "FORBIDDEN")


class HttpWiringTests(HostedAuthTests):
    def setUp(self) -> None:
        super().setUp()
        self.saved = (getattr(app.state, "auth", None), getattr(app.state, "connect", None))
        app.state.auth, app.state.connect = self.auth, self.connect

    def tearDown(self) -> None:
        app.state.auth, app.state.connect = self.saved
        super().tearDown()

    def test_me_over_http_with_a_hosted_token(self) -> None:
        with TestClient(app) as client:
            ok = client.get("/v1/me", headers={"Authorization": f"Bearer {token(self.pem, 'k1', self.worker)}"})
            self.assertEqual(ok.status_code, 200)
            self.assertEqual(ok.json(), {"user_id": self.worker, "tenant_id": TENANT, "role": "worker"})
            self.assertEqual(client.get("/v1/me").status_code, 401)

    def test_unavailable_signing_keys_are_503_not_open(self) -> None:
        app.state.auth = HostedAuth(ISSUER, AUDIENCE, self.auth.lookup, JwksCache("https://x", fetch=lambda _u: 1 / 0))
        with TestClient(app) as client:
            response = client.get("/v1/me", headers={"Authorization": f"Bearer {token(self.pem, 'k1', self.worker)}"})
            self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()


class AuthConfigTests(unittest.TestCase):
    """GET /auth/config is public, so it must only ever serve a publishable key."""

    def test_only_publishable_keys_are_served(self) -> None:
        import base64
        import json as _json

        from services.api.app.main import _is_publishable

        def legacy(role: str) -> str:
            body = base64.urlsafe_b64encode(_json.dumps({"role": role}).encode()).decode().rstrip("=")
            return f"eyJhbGciOiJIUzI1NiJ9.{body}.sig"

        self.assertTrue(_is_publishable("sb_publishable_abc"))
        self.assertTrue(_is_publishable(legacy("anon")))
        for secret in ("sb_secret_abc", legacy("service_role"), "", "random-string", "a.b.c"):
            self.assertFalse(_is_publishable(secret), secret)
