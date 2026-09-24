"""M1 synthetic dev token issuer (ADR-M1-002).

The central property: tokens from the dev issuer pass **T06's real, unmodified
`authenticate()`**. The issuer is synthetic; the verification is not. If that
ever stopped being true, M1's "auth enforced, not bypassed" requirement would
silently fail, so it is asserted directly rather than assumed.

Run:  python -m unittest tests.dev_issuer_test -v
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from services.api.app.auth import Authorized, Denied, OIDCConfig, authenticate, require_tenant
from services.api.app.dev_issuer import (
    DEV_AUDIENCE,
    DEV_ISSUER,
    DEFAULT_KEY_PATH,
    DEMO_USERS,
    SYNTHETIC_OTHER_TENANT_ID,
    SYNTHETIC_TENANT_ID,
    DevIssuer,
    MembershipStore,
    check_credentials,
    load_or_create_key,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def _user(name: str) -> str:
    return next(u.user_id for u in DEMO_USERS if u.username == name)


class DevIssuerTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.key_path = Path(cls.tmp.name) / "key.pem"
        cls.key = load_or_create_key(cls.key_path)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def setUp(self) -> None:
        self.store = MembershipStore()
        self.issuer = DevIssuer(self.key, self.store)
        self.now = int(time.time())

    def auth(self, token: str, *, now: int | None = None):
        return authenticate(token, self.issuer.oidc_config(), self.store.lookup,
                            now=self.now if now is None else now)


class TestRealVerificationPath(DevIssuerTestBase):
    """Dev tokens must pass T06's REAL verifier, not a stand-in."""

    def test_minted_token_passes_t06_authenticate(self):
        outcome = self.auth(self.issuer.mint(_user("worker"), now=self.now))
        self.assertIsInstance(outcome, Authorized, outcome)
        self.assertEqual(outcome.session.role, "worker")
        self.assertEqual(outcome.session.tenant_id, SYNTHETIC_TENANT_ID)

    def test_tenant_comes_from_membership_not_the_token(self):
        # T06's rule. The token carries no tenant claim at all.
        from jose import jwt
        claims = jwt.get_unverified_claims(self.issuer.mint(_user("worker"), now=self.now))
        self.assertNotIn("tenant_id", claims)
        self.assertNotIn("role", claims)

    def test_expired_dev_token_is_rejected_by_t06(self):
        token = self.issuer.mint(_user("worker"), now=self.now - 10_000, ttl_seconds=60)
        outcome = self.auth(token)
        self.assertIsInstance(outcome, Denied)
        self.assertEqual(outcome.status, 401)

    def test_dev_token_rejected_by_a_config_with_a_real_issuer(self):
        # The .invalid issuer can never satisfy a real deployment's OIDCConfig,
        # even with the right key: issuer is checked.
        real = OIDCConfig(issuer="https://login.example.org/realms/jalsakshi",
                          audience=DEV_AUDIENCE, jwks=self.issuer.jwks)
        outcome = authenticate(self.issuer.mint(_user("worker"), now=self.now), real,
                               self.store.lookup, now=self.now)
        self.assertIsInstance(outcome, Denied)

    def test_dev_token_rejected_for_the_wrong_audience(self):
        wrong = OIDCConfig(issuer=DEV_ISSUER, audience="some-other-api", jwks=self.issuer.jwks)
        outcome = authenticate(self.issuer.mint(_user("worker"), now=self.now), wrong,
                               self.store.lookup, now=self.now)
        self.assertIsInstance(outcome, Denied)

    def test_token_signed_by_a_different_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            other = DevIssuer(load_or_create_key(Path(d) / "k.pem"), self.store)
            outcome = self.auth(other.mint(_user("worker"), now=self.now))
        self.assertIsInstance(outcome, Denied)

    def test_the_issuer_uses_an_unresolvable_reserved_tld(self):
        self.assertIn(".invalid/", DEV_ISSUER)


class TestTenancy(DevIssuerTestBase):
    def test_other_tenant_worker_resolves_to_the_other_tenant(self):
        outcome = self.auth(self.issuer.mint(_user("other-worker"), now=self.now))
        self.assertIsInstance(outcome, Authorized)
        self.assertEqual(outcome.session.tenant_id, SYNTHETIC_OTHER_TENANT_ID)

    def test_cross_tenant_object_is_not_found(self):
        a = self.auth(self.issuer.mint(_user("worker"), now=self.now))
        assert isinstance(a, Authorized)
        denial = require_tenant(a.session, SYNTHETIC_OTHER_TENANT_ID)
        self.assertEqual(denial.status, 404)

    def test_revoking_a_membership_takes_effect_on_the_next_request(self):
        # The token is still perfectly valid; the membership is what changed.
        token = self.issuer.mint(_user("worker"), now=self.now)
        self.assertIsInstance(self.auth(token), Authorized)
        self.store.set_active(_user("worker"), SYNTHETIC_TENANT_ID, False)
        outcome = self.auth(token)
        self.assertIsInstance(outcome, Denied)
        self.assertEqual(outcome.code, "FORBIDDEN")


class TestCredentials(unittest.TestCase):
    def test_valid_demo_credentials(self):
        self.assertEqual(check_credentials("worker", "jalsakshi"), _user("worker"))
        self.assertEqual(check_credentials("  WORKER ", "jalsakshi"), _user("worker"))

    def test_wrong_password_and_unknown_user_are_indistinguishable(self):
        self.assertIsNone(check_credentials("worker", "nope"))
        self.assertIsNone(check_credentials("nobody", "nope"))
        self.assertIsNone(check_credentials("nobody", "jalsakshi"))

    def test_password_is_case_sensitive(self):
        self.assertIsNone(check_credentials("worker", "JALSAKSHI"))

    def test_empty_inputs_are_rejected(self):
        self.assertIsNone(check_credentials("", ""))
        self.assertIsNone(check_credentials("worker", ""))


class TestKeyCustody(DevIssuerTestBase):
    def test_key_persists_so_tokens_survive_an_api_restart(self):
        token = self.issuer.mint(_user("worker"), now=self.now)
        reloaded = DevIssuer(load_or_create_key(self.key_path), self.store)
        outcome = authenticate(token, reloaded.oidc_config(), self.store.lookup, now=self.now)
        self.assertIsInstance(outcome, Authorized)

    def test_jwks_publishes_no_private_rsa_parameters(self):
        for key in self.issuer.jwks["keys"]:
            for private in ("d", "p", "q", "dp", "dq", "qi"):
                self.assertNotIn(private, key, f"private JWK parameter {private!r} published")

    def test_the_default_key_path_is_gitignored(self):
        # Regression guard: if .gitignore ever stops covering this, the
        # private key would become committable.
        r = subprocess.run(["git", "check-ignore", "-q", str(DEFAULT_KEY_PATH)],
                           cwd=REPO_ROOT, capture_output=True)
        self.assertEqual(r.returncode, 0, f"{DEFAULT_KEY_PATH} is NOT gitignored")

    def test_no_private_key_is_tracked_by_git(self):
        r = subprocess.run(["git", "ls-files"], cwd=REPO_ROOT, capture_output=True, text=True)
        tracked = [f for f in r.stdout.splitlines() if f.endswith((".pem", ".key"))]
        self.assertEqual(tracked, [], f"key material tracked by git: {tracked}")


def _routes_under(env: dict[str, str]) -> set[str]:
    """Import the real app in a clean subprocess under `env`; list its routes.

    A subprocess, because main.py decides what to mount at import time and a
    reload inside this process would leak state between cases.
    """
    code = ("import json,sys\n"
            "from services.api.app.main import app\n"
            "print(json.dumps(sorted({r.path for r in app.routes})))\n")
    full = {k: v for k, v in os.environ.items() if not k.startswith("JALSAKSHI_")}
    full.update(env)
    r = subprocess.run([sys.executable, "-c", code], cwd=REPO_ROOT, env=full,
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(f"app failed to import under {env}: {r.stderr[-400:]}")
    return set(json.loads(r.stdout.strip().splitlines()[-1]))


class TestGating(unittest.TestCase):
    """The issuer must exist ONLY in development + synthetic."""

    BASE = {"JALSAKSHI_DATABASE_URL": "postgresql://x:y@localhost/z",
            "JALSAKSHI_OIDC_ISSUER": "https://login.example.org/realms/j",
            "JALSAKSHI_OIDC_AUDIENCE": "jalsakshi-api"}

    def test_mounted_in_development_synthetic(self):
        routes = _routes_under({"JALSAKSHI_ENVIRONMENT": "development",
                                "JALSAKSHI_TENANT_DATA_MODE": "synthetic"})
        self.assertIn("/dev/v1/token", routes)
        self.assertIn("/dev/v1/jwks.json", routes)

    def test_absent_in_staging_even_with_synthetic_data(self):
        routes = _routes_under({**self.BASE, "JALSAKSHI_ENVIRONMENT": "staging",
                                "JALSAKSHI_TENANT_DATA_MODE": "synthetic"})
        self.assertNotIn("/dev/v1/token", routes)
        self.assertNotIn("/dev/v1/jwks.json", routes)

    def test_absent_in_development_with_research_data(self):
        routes = _routes_under({"JALSAKSHI_ENVIRONMENT": "development",
                                "JALSAKSHI_TENANT_DATA_MODE": "research"})
        self.assertNotIn("/dev/v1/token", routes)

    def test_absent_in_production(self):
        routes = _routes_under({**self.BASE, "JALSAKSHI_ENVIRONMENT": "production",
                                "JALSAKSHI_TENANT_DATA_MODE": "operational"})
        self.assertNotIn("/dev/v1/token", routes)


class TestHttpSurface(unittest.TestCase):
    """Through the real ASGI app, in development + synthetic."""

    @classmethod
    def setUpClass(cls) -> None:
        from fastapi.testclient import TestClient
        from services.api.app.main import app
        if not hasattr(app.state, "dev_issuer"):
            raise unittest.SkipTest("app not configured as development+synthetic")
        cls.app = app
        cls.client = TestClient(app)

    def test_token_endpoint_issues_a_token_t06_accepts(self):
        r = self.client.post("/dev/v1/token", json={"username": "worker", "password": "jalsakshi"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["synthetic"])
        self.assertEqual(body["issuer"], DEV_ISSUER)
        issuer = self.app.state.dev_issuer
        outcome = authenticate(body["access_token"], issuer.oidc_config(),
                               issuer.memberships.lookup)
        self.assertIsInstance(outcome, Authorized)
        self.assertEqual(outcome.session.tenant_id, SYNTHETIC_TENANT_ID)

    def test_bad_credentials_are_a_401_problem_with_one_message(self):
        a = self.client.post("/dev/v1/token", json={"username": "worker", "password": "nope"})
        b = self.client.post("/dev/v1/token", json={"username": "nobody", "password": "nope"})
        self.assertEqual((a.status_code, b.status_code), (401, 401))
        self.assertEqual(a.json()["code"], "AUTH_REQUIRED")
        self.assertEqual(a.json()["detail"], b.json()["detail"])

    def test_oversized_credentials_are_rejected_at_the_boundary(self):
        r = self.client.post("/dev/v1/token", json={"username": "x" * 500, "password": "y"})
        self.assertEqual(r.status_code, 422)

    def test_jwks_endpoint_serves_public_keys_only(self):
        r = self.client.get("/dev/v1/jwks.json")
        self.assertEqual(r.status_code, 200)
        for key in r.json()["keys"]:
            self.assertNotIn("d", key)


if __name__ == "__main__":
    unittest.main()
