"""T07 over HTTP: GET /v1/sources and /v1/sources/{id}/history.

Runs the real app (development + synthetic), the real T06 `authenticate()` and
the real startup migration + synthetic seed, against a throwaway SQLite file.
The PostgreSQL behaviour of the same queries is covered by
tests/sources_postgres_test.py.

Run:  python -m unittest tests.sources_http_test -v
"""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from services.api.app import dev_seed
from services.api.app.db import connector
from services.api.app.dev_issuer import SYNTHETIC_TENANT_ID, _uid
from services.api.app.main import app

WORKER = _uid("user.worker")
OTHER_WORKER = _uid("user.other-worker")

_SAMPLES_FIXTURE = """
CREATE TABLE IF NOT EXISTS samples (
    tenant_id text NOT NULL, id text NOT NULL, source_id text NOT NULL,
    received_at_server text NOT NULL, status text NOT NULL, method text NOT NULL,
    indicative_flag text NOT NULL, PRIMARY KEY (tenant_id, id)
)
"""


@unittest.skipUnless(hasattr(app.state, "dev_issuer"), "needs development+synthetic")
class SourcesHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.db_path = Path(cls.tmp.name) / "api.sqlite3"
        cls.saved_connect = app.state.connect
        app.state.connect = connector("", cls.db_path)
        cls.client = TestClient(app)
        cls.client.__enter__()  # runs lifespan: migrate + seed
        conn = sqlite3.connect(cls.db_path)
        conn.execute(_SAMPLES_FIXTURE)  # T13's table, stand-in until T13
        for i, (sid, status) in enumerate([("s1", "accepted"), ("s2", "accepted"), ("s3", "pending")]):
            conn.execute(
                "INSERT INTO samples VALUES (?,?,?,?,?,?,?)",
                (SYNTHETIC_TENANT_ID, _uid(f"sample.{sid}"), dev_seed.source_id("src.1"),
                 f"2026-09-2{i}T10:00:00Z", status, "manual", "no_flag"),
            )
        conn.commit()
        conn.close()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect = cls.saved_connect
        cls.tmp.cleanup()

    def get(self, path: str, user: str | None = WORKER, **params):
        headers = {"Authorization": f"Bearer {app.state.dev_issuer.mint(user)}"} if user else {}
        return self.client.get(path, headers=headers, params=params)

    # --- authentication is enforced ---------------------------------------

    def test_no_token_is_401_problem_json(self):
        r = self.get("/v1/sources", user=None)
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.headers["content-type"], "application/problem+json")
        self.assertEqual(r.json()["code"], "AUTH_REQUIRED")

    def test_garbage_and_non_bearer_tokens_are_401(self):
        for header in ("Bearer not.a.jwt", "Basic d29ya2VyOmphbHNha3NoaQ==", "Bearer "):
            with self.subTest(header=header):
                r = self.client.get("/v1/sources", headers={"Authorization": header})
                self.assertEqual(r.status_code, 401)

    def test_expired_token_is_401(self):
        token = app.state.dev_issuer.mint(WORKER, now=1_000_000, ttl_seconds=60)
        r = self.client.get("/v1/sources", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(r.status_code, 401)

    def test_revoked_membership_is_403_on_the_next_request(self):
        store = app.state.dev_issuer.memberships
        self.assertEqual(self.get("/v1/sources").status_code, 200)
        store.set_active(WORKER, SYNTHETIC_TENANT_ID, False)
        try:
            r = self.get("/v1/sources")
            self.assertEqual((r.status_code, r.json()["code"]), (403, "FORBIDDEN"))
        finally:
            store.set_active(WORKER, SYNTHETIC_TENANT_ID, True)

    def test_without_an_identity_provider_routes_refuse_not_bypass(self):
        saved = app.state.auth
        app.state.auth = None
        try:
            r = self.get("/v1/sources")
            self.assertEqual((r.status_code, r.json()["code"]), (503, "TEMPORARILY_UNAVAILABLE"))
        finally:
            app.state.auth = saved

    # --- catalogue ----------------------------------------------------------

    def test_worker_sees_own_tenant_active_synthetic_sources(self):
        r = self.get("/v1/sources")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        labels = [i["label"] for i in body["items"]]
        self.assertEqual(labels, ["Synthetic handpump 1", "Synthetic handpump 2", "Synthetic well north"])
        self.assertTrue(body["served_at"].endswith("Z"))
        # Tenant is never echoed to the client; it is the server's business.
        self.assertNotIn("tenant_id", body["items"][0])

    def test_other_tenant_worker_sees_only_their_tenant(self):
        labels = [i["label"] for i in self.get("/v1/sources", user=OTHER_WORKER).json()["items"]]
        self.assertEqual(labels, ["Other-tenant pump"])

    def test_every_seeded_label_is_marked_synthetic(self):
        for _, _, _, label, locality, _ in dev_seed.SYNTHETIC_SOURCES:
            self.assertTrue("synthetic" in label.lower() or "synthetic" in locality.lower())

    def test_search(self):
        r = self.get("/v1/sources", q="well")
        self.assertEqual([i["label"] for i in r.json()["items"]], ["Synthetic well north"])

    def test_limit_bounds_are_422(self):
        for bad in (0, 101, -1):
            with self.subTest(limit=bad):
                r = self.get("/v1/sources", limit=bad)
                self.assertEqual((r.status_code, r.json()["code"]), (422, "VALIDATION_FAILED"))

    def test_invalid_cursor_is_422(self):
        r = self.get("/v1/sources", cursor="YWJj")
        self.assertEqual((r.status_code, r.json()["code"]), (422, "VALIDATION_FAILED"))

    def test_paging_covers_every_row_once(self):
        seen, cursor = [], None
        for _ in range(10):
            params = {"limit": 1} | ({"cursor": cursor} if cursor else {})
            body = self.get("/v1/sources", **params).json()
            seen += [i["id"] for i in body["items"]]
            cursor = body["next_cursor"]
            if not cursor:
                break
        self.assertEqual(len(seen), 3)
        self.assertEqual(len(set(seen)), 3)

    def test_startup_seed_is_idempotent(self):
        with TestClient(app):  # a second startup: migrate + seed again
            pass
        self.assertEqual(len(self.get("/v1/sources").json()["items"]), 3)

    # --- history ------------------------------------------------------------

    def test_history_returns_accepted_only_newest_first(self):
        r = self.get(f"/v1/sources/{dev_seed.source_id('src.1')}/history")
        self.assertEqual(r.status_code, 200, r.text)
        ids = [i["sample_id"] for i in r.json()["items"]]
        self.assertEqual(ids, [_uid("sample.s2"), _uid("sample.s1")])

    def test_cross_tenant_and_malformed_history_are_identical_404s(self):
        other = self.get(f"/v1/sources/{dev_seed.source_id('src.other.1')}/history")
        missing = self.get(f"/v1/sources/{_uid('nope')}/history")
        malformed = self.get("/v1/sources/not-a-uuid/history")
        for r in (other, missing, malformed):
            self.assertEqual((r.status_code, r.json()["code"]), (404, "NOT_FOUND"))
        self.assertEqual(other.json()["detail"], missing.json()["detail"])
        self.assertEqual(other.json()["detail"], malformed.json()["detail"])


if __name__ == "__main__":
    unittest.main()
