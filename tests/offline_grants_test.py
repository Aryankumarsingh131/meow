"""T45 server side: POST /v1/session/offline-grant and revocation on reconnect.

Real app (development + synthetic), real T06 authenticate(), throwaway SQLite.
Run: python -m unittest tests.offline_grants_test -v
"""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

import tests.sync_push_test as t13
from services.api.app import dev_seed
from services.api.app.db import connector
from services.api.app.dev_issuer import SYNTHETIC_OTHER_TENANT_ID, SYNTHETIC_TENANT_ID, _uid
from services.api.app.main import app
from services.api.app.offline_grants import LEASE_HOURS

WORKER = _uid("user.worker")
DEVICE = "5b0d7c1e-0000-4000-8000-0000000d0045"


@unittest.skipUnless(hasattr(app.state, "dev_issuer"), "needs development+synthetic")
class OfflineGrantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_connect = app.state.connect
        app.state.connect = connector("", Path(cls.tmp.name) / "api.sqlite3")
        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect = cls.saved_connect
        cls.tmp.cleanup()

    def tearDown(self) -> None:
        app.state.dev_issuer.memberships.set_active(WORKER, SYNTHETIC_TENANT_ID, True)

    def headers(self, user: str = WORKER) -> dict[str, str]:
        return {"Authorization": f"Bearer {app.state.dev_issuer.mint(user)}"}

    def grant(self, user: str = WORKER, **extra: object):
        return self.client.post(
            "/v1/session/offline-grant",
            headers=self.headers(user),
            json={"device_id": DEVICE, "client_build": "t45-test", **extra},
        )

    def test_scope_and_lease_come_from_the_server(self) -> None:
        # A client asking for another tenant, a role or a longer lease is ignored.
        response = self.grant(tenant_id=SYNTHETIC_OTHER_TENANT_ID, role="admin", expires_at="2099-01-01T00:00:00Z")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["subject"], body["tenant_id"], body["role"]), (WORKER, SYNTHETIC_TENANT_ID, "worker"))
        self.assertTrue(body["capture_offline"])
        self.assertEqual(body["device_id"], DEVICE)
        issued = datetime.fromisoformat(body["issued_at"].replace("Z", "+00:00"))
        expires = datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00"))
        self.assertEqual(expires - issued, timedelta(hours=LEASE_HOURS))
        self.assertEqual(body["server_time"], body["issued_at"])
        self.assertIn("Revocation cannot reach a phone", body["limitation"])

    def test_other_tenant_member_gets_their_own_scope(self) -> None:
        body = self.grant(_uid("user.other-worker")).json()
        self.assertEqual(body["tenant_id"], SYNTHETIC_OTHER_TENANT_ID)

    def test_first_provisioning_requires_an_online_authenticated_member(self) -> None:
        response = self.client.post("/v1/session/offline-grant", json={"device_id": DEVICE, "client_build": "x"})
        self.assertEqual((response.status_code, response.json()["code"]), (401, "AUTH_REQUIRED"))
        bad = self.client.post("/v1/session/offline-grant", headers=self.headers(),
                               json={"device_id": "not-a-uuid", "client_build": "x"})
        self.assertEqual(bad.status_code, 422)

    def test_revoked_member_gets_no_grant_and_cannot_push_what_it_recorded_offline(self) -> None:
        """A grant never overrides revocation: on reconnect the server refuses
        and writes nothing; the phone keeps the record (T45 device side)."""
        self.assertEqual(self.grant().status_code, 200)  # provisioned while a member
        app.state.dev_issuer.memberships.set_active(WORKER, SYNTHETIC_TENANT_ID, False)

        denied = self.grant()
        self.assertEqual((denied.status_code, denied.json()["code"]), (403, "FORBIDDEN"))

        payload = t13.sample("offline-after-revocation", dev_seed.source_id("src.1"))
        push = self.client.post("/v1/sync/push", headers=self.headers(), json={
            "device_id": DEVICE,
            "events": [{"event_id": t13.uid("t45-event"), "kind": "sample.create", "schema_version": 1, "payload": payload}],
        })
        self.assertEqual((push.status_code, push.json()["code"]), (403, "FORBIDDEN"))
        conn = app.state.connect()
        try:
            count = conn.execute("SELECT count(*) FROM samples WHERE id = ?", (payload["sample_id"],)).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 0)

        # Reinstated: the same record is accepted, once.
        app.state.dev_issuer.memberships.set_active(WORKER, SYNTHETIC_TENANT_ID, True)
        again = self.client.post("/v1/sync/push", headers=self.headers(), json={
            "device_id": DEVICE,
            "events": [{"event_id": t13.uid("t45-event"), "kind": "sample.create", "schema_version": 1, "payload": payload}],
        })
        self.assertEqual(again.json()["results"][0]["status"], "accepted")


if __name__ == "__main__":
    unittest.main()
