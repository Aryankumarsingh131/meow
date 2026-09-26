"""T31: tenant-isolation regression across EVERY /v1 route.

Tenant A creates real data (sample, case, lab report, evidence photo, export
job). Tenant B then attacks each A resource with a user of the SAME role, so a
role check can never mask a missing tenant check. A cross-tenant id must look
exactly like a missing one (same status, same body): no existence oracle.

`test_every_v1_route_is_in_the_matrix` fails when a new /v1 route is added
without a row here, so coverage cannot silently rot.

Run: python -m unittest tests.security.tenant_test -v
"""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

import tests.sync_push_test as t13
from services.api.app import dev_seed
from services.api.app.auth import Membership
from services.api.app.db import connector
from services.api.app.dev_issuer import SYNTHETIC_OTHER_TENANT_ID, _uid
from services.api.app.main import app
from tests.upload_test import jpeg

A_WORKER, A_SUP, A_LAB = _uid("user.worker"), _uid("user.supervisor"), _uid("user.lab-reviewer")
B_WORKER = _uid("user.other-worker")
B_SUP, B_LAB, B_ADMIN = _uid("user.b-supervisor"), _uid("user.b-lab"), _uid("user.b-admin")
SYN = {"id": "f96bdca3-5020-5313-b65a-072967c46292", "version": 1}

#: route -> how this file checks it. Adding a /v1 route without a row fails.
MATRIX = {
    ("POST", "/v1/sync/push"): "B cannot write a sample onto A's source",
    ("GET", "/v1/sources"): "B's catalogue excludes A's sources",
    ("GET", "/v1/sources/{source_id}/history"): "A source history is 404 to B",
    ("GET", "/v1/sync/pull"): "B's feed excludes A's samples",
    ("GET", "/v1/bootstrap"): "B's snapshot excludes A's data",
    ("POST", "/v1/session/offline-grant"): "a grant names only the caller's own tenant",
    ("POST", "/v1/evidence/intents"): "B cannot attach evidence to A's sample or case",
    ("PUT", "/v1/evidence/{asset_id}/content"): "no upload into A's asset without A's signed URL",
    ("POST", "/v1/evidence/{asset_id}/complete"): "B cannot complete A's upload",
    ("GET", "/v1/evidence/{asset_id}/access"): "A's asset is 404 to B",
    ("GET", "/v1/evidence/{asset_id}/content"): "a forged read token is refused",
    ("POST", "/v1/cases/{case_id}/commands"): "commands on A's case are 404 to B",
    ("GET", "/v1/me"): "reports only the caller's own membership",
    ("GET", "/v1/cases"): "B's board excludes A's cases",
    ("GET", "/v1/cases/{case_id}"): "A's case is 404 to B",
    ("POST", "/v1/lab-reports"): "B cannot record a report on A's case",
    ("POST", "/v1/lab-reports/{report_id}/verify"): "A's report is 404 to B's lab reviewer",
    ("GET", "/v1/reports/metrics"): "B's metrics do not count A's cases",
    ("POST", "/v1/reports/export"): "B's export excludes A's cases",
    ("GET", "/v1/reports/export/{job_id}"): "A's export job is 404 to B",
    ("POST", "/v1/reports/export/{job_id}/cancel"): "B cannot cancel A's job",
    ("GET", "/v1/reports/export/{job_id}/content"): "A's export file is 404 to B",
    ("POST", "/v1/auth/login"): "a token names only the profile whose email and password were verified",
    # Residents (no tenant: account isolation, enforced by RLS in 006). Checked in
    # tests/public_v2_http_test.py and tests/public_v2_postgres_test.py.
    ("POST", "/v1/public/accounts"): "one account per email; a second registration is 409, never a takeover",
    ("GET", "/v1/public/me"): "RLS: resident B's token reads B's residents row only",
    ("POST", "/v1/public/complaints"): "the complaint is filed as the token's own resident only",
    ("GET", "/v1/public/complaints"): "RLS: B's list excludes A's complaints and every staff-only column",
    ("GET", "/v1/public/map"): "public by design: fuzzed locations, no screening results",
    ("GET", "/v1/public/leaderboard"): "public by design: first name + initial, points and counts only",
    ("GET", "/v1/public/stats"): "public by design: aggregate weekly counts, no per-person or per-record data",
    # Staff v2 (team isolation; another team's object is 404). Checked in tests/staff_v2_http_test.py.
    ("GET", "/v1/staff/me"): "reports only the caller's own staff profile and points",
    ("GET", "/v1/staff/kits"): "shared kit configuration; no team or person data",
    ("GET", "/v1/staff/team"): "supervisors only; lists only the caller's own team",
    ("PATCH", "/v1/staff/sources/{source_id}"): "A's source is 404 to B's supervisor",
    ("POST", "/v1/staff/reports/{report_id}/notes"): "A's report is 404 to B",
    ("POST", "/v1/staff/reports/{report_id}/communications"): "A's report is 404 to B's supervisor",
    ("POST", "/v1/staff/reports/{report_id}/re-report"): "A's report is 404 to B's supervisor (guarded function)",
    ("POST", "/v1/staff/sources"): "a source is created in the caller's own team only",
    ("GET", "/v1/staff/sources"): "B's sources exclude A's",
    ("POST", "/v1/staff/sources/{source_id}/lab-verified"): "A's source is 404 to B's supervisor",
    ("POST", "/v1/staff/test-records"): "B cannot record a test on A's source (404)",
    ("GET", "/v1/staff/reports"): "B's reports exclude A's",
    ("GET", "/v1/staff/reports/{report_id}"): "A's report is 404 to B",
    ("GET", "/v1/staff/reports/details"): "team-scoped list: only the caller's team reports",
    ("POST", "/v1/staff/reports/{report_id}/transition"): "A's report is 404 to B's supervisor",
    ("POST", "/v1/staff/reports/{report_id}/close"): "A's report is 404 to B's supervisor",
    ("POST", "/v1/staff/reports/{report_id}/lab-referrals"): "A's report is 404 to B's supervisor",
    ("POST", "/v1/staff/reports/{report_id}/photos"): "B cannot attach a photo to A's report (404)",
    ("POST", "/v1/staff/lab-referrals/{referral_id}/result"): "B cannot record a result on A's referral (404)",
    ("POST", "/v1/staff/lab-referrals/{referral_id}/verify"): "A's referral is 404 to B's supervisor",
    ("GET", "/v1/staff/blobs/{blob_id}"): "A's photos and lab files are 404 to B",
    ("GET", "/v1/staff/complaints"): "B's supervisor sees B's sources' complaints and unsourced ones only",
    ("GET", "/v1/staff/photos/recent"): "B's feed holds only B's team photos; complaint photos for supervisors only",
    ("POST", "/v1/staff/complaints/{complaint_id}/review"): "A's complaint is 404 to B's supervisor",
    ("GET", "/v1/staff/notifications"): "only the caller's own notifications",
    ("POST", "/v1/staff/notifications/{notification_id}/ack"): "another user's notification is 404",
}


@unittest.skipUnless(hasattr(app.state, "dev_issuer"), "needs development+synthetic")
class TenantMatrixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved = (app.state.connect, app.state.evidence_dir, app.state.auth)
        app.state.connect = connector("", Path(cls.tmp.name) / "api.sqlite3")
        app.state.evidence_dir = Path(cls.tmp.name) / "evidence"
        config, base = app.state.auth
        extra = {B_SUP: "supervisor", B_LAB: "lab_reviewer", B_ADMIN: "admin"}
        app.state.auth = (config, lambda u: list(base(u)) + (
            [Membership(u, SYNTHETIC_OTHER_TENANT_ID, extra[u], True)] if u in extra else []))
        cls.client = TestClient(app)
        cls.client.__enter__()
        cls.a = cls._seed_tenant_a()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect, app.state.evidence_dir, app.state.auth = cls.saved
        cls.tmp.cleanup()

    @staticmethod
    def auth(user: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {app.state.dev_issuer.mint(user)}"}

    @classmethod
    def _seed_tenant_a(cls) -> dict[str, str]:
        c, a = cls.client, {}
        payload = t13.sample(f"a-{uuid4()}", dev_seed.source_id("src.1"))
        payload.update(sample_id=str(uuid4()), protocol=SYN)
        pushed = c.post("/v1/sync/push", headers=cls.auth(A_WORKER), json={"device_id": str(uuid4()), "events": [
            {"event_id": str(uuid4()), "kind": "sample.create", "schema_version": 1, "payload": payload}]})
        assert pushed.json()["results"][0]["status"] == "accepted", pushed.text
        a["sample"], a["source"] = payload["sample_id"], dev_seed.source_id("src.1")
        cases = c.get("/v1/cases", headers=cls.auth(A_SUP)).json()["items"]
        a["case"] = cases[0]["id"]
        report = c.post("/v1/lab-reports", headers=cls.auth(A_SUP), json={
            "report_id": str(uuid4()), "case_id": a["case"], "source_id": a["source"], "lab_name": "Synthetic lab",
            "collected_at": "2026-09-24T11:00:00Z", "method": "synthetic", "parameter": "synthetic_colour_class",
            "result": "SYN-A", "unit": None, "lab_interpretation": "within_limit"})
        assert report.status_code == 200, report.text
        a["report"] = report.json()["id"]
        data = jpeg()
        intent = c.post("/v1/evidence/intents", headers=cls.auth(A_WORKER), json={
            "asset_id": str(uuid4()), "context": "sample_photo", "target_id": a["sample"], "bytes": len(data),
            "media_type": "image/jpeg", "sha256": hashlib.sha256(data).hexdigest()}).json()
        c.put(intent["upload_url"], content=data)
        done = c.post(f"/v1/evidence/{intent['asset_id']}/complete", headers=cls.auth(A_WORKER),
                      json={"sha256": hashlib.sha256(data).hexdigest()})
        assert done.status_code == 200, done.text
        a["asset"] = intent["asset_id"]
        a["job"] = c.post("/v1/reports/export", headers=cls.auth(A_SUP), json={}).json()["job_id"]
        return a

    def assertLooksMissing(self, response, missing) -> None:
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.status_code, missing.status_code)
        body, reference = response.json(), missing.json()
        for noisy in ("instance", "request_id", "detail"):  # per-request fields
            body.pop(noisy, None), reference.pop(noisy, None)
        self.assertEqual(body, reference, "a cross-tenant id must look exactly like a missing one")

    def test_every_v1_route_is_in_the_matrix(self) -> None:
        routes = {(m, r.path) for r in app.routes if getattr(r, "path", "").startswith("/v1")
                  for m in r.methods - {"HEAD", "OPTIONS"}}
        self.assertEqual(routes - MATRIX.keys(), set(), "new /v1 route without a tenant-isolation check")
        self.assertEqual(MATRIX.keys() - routes, set(), "matrix row for a route that no longer exists")

    def test_reads_of_a_resources_look_missing_to_b(self) -> None:
        c, a = self.client, self.a
        for path, secret in ((f"/v1/cases/{a['case']}", a["case"]), (f"/v1/sources/{a['source']}/history", a["source"]),
                             (f"/v1/evidence/{a['asset']}/access", a["asset"]), (f"/v1/reports/export/{a['job']}", a["job"]),
                             (f"/v1/reports/export/{a['job']}/content", a["job"])):
            user = B_SUP
            with self.subTest(path=path):
                missing = c.get(path.replace(secret, str(uuid4())), headers=self.auth(user))
                self.assertLooksMissing(c.get(path, headers=self.auth(user)), missing)

    def test_writes_to_a_resources_look_missing_to_b(self) -> None:
        c, a = self.client, self.a
        command = {"type": "assign", "command_id": str(uuid4()), "expected_version": 1,
                   "payload": {"owner_id": B_SUP, "due_at": "2026-10-01T00:00:00Z"}}
        self.assertEqual(c.post(f"/v1/cases/{a['case']}/commands", headers=self.auth(B_SUP), json=command).status_code, 404)
        verify = {"command_id": str(uuid4()), "expected_version": 1, "decision": "verify", "reason": "cross-tenant attempt"}
        self.assertEqual(c.post(f"/v1/lab-reports/{a['report']}/verify", headers=self.auth(B_LAB), json=verify).status_code, 404)
        report = {"report_id": str(uuid4()), "case_id": a["case"], "source_id": a["source"], "lab_name": "x",
                  "collected_at": "2026-09-24T11:00:00Z", "method": "x", "parameter": "x", "result": "x",
                  "lab_interpretation": "not_stated"}
        self.assertEqual(c.post("/v1/lab-reports", headers=self.auth(B_SUP), json=report).status_code, 404)
        self.assertEqual(c.post(f"/v1/evidence/{a['asset']}/complete", headers=self.auth(B_WORKER),
                                json={"sha256": "0" * 64}).status_code, 404)
        for context, target in (("sample_photo", a["sample"]), ("lab_report", a["case"])):
            intent = c.post("/v1/evidence/intents", headers=self.auth(B_SUP), json={
                "asset_id": str(uuid4()), "context": context, "target_id": target, "bytes": 10,
                "media_type": "image/jpeg", "sha256": "0" * 64})
            self.assertEqual(intent.status_code, 404, (context, intent.text))
        self.assertEqual(c.post(f"/v1/reports/export/{a['job']}/cancel", headers=self.auth(B_SUP)).json(), {"cancelled": False})

    def test_signed_evidence_urls_cannot_be_forged(self) -> None:
        a = self.a
        self.assertEqual(self.client.put(f"/v1/evidence/{a['asset']}/content?token=forged", content=b"x").status_code, 403)
        self.assertEqual(self.client.get(f"/v1/evidence/{a['asset']}/content?token=forged").status_code, 403)

    def test_b_cannot_write_a_sample_onto_a_source(self) -> None:
        payload = t13.sample(f"b-{uuid4()}", self.a["source"])
        payload.update(sample_id=str(uuid4()), protocol=SYN)
        pushed = self.client.post("/v1/sync/push", headers=self.auth(B_WORKER), json={"device_id": str(uuid4()), "events": [
            {"event_id": str(uuid4()), "kind": "sample.create", "schema_version": 1, "payload": payload}]})
        self.assertNotEqual(pushed.json()["results"][0]["status"], "accepted", pushed.text)

    def test_b_lists_and_feeds_never_contain_a_ids(self) -> None:
        c, a = self.client, self.a
        secret_ids = [a["sample"], a["case"], a["report"], a["asset"], a["source"]]
        cursor = c.get("/v1/bootstrap", headers=self.auth(B_WORKER)).json()["snapshot_cursor"]
        for path, user in (("/v1/sources", B_WORKER), (f"/v1/sync/pull?cursor={cursor}", B_WORKER), ("/v1/bootstrap", B_WORKER),
                           ("/v1/cases", B_SUP), ("/v1/reports/metrics", B_SUP)):
            with self.subTest(path=path):
                response = c.get(path, headers=self.auth(user))
                self.assertIn(response.status_code, (200,), response.text)
                self.assertFalse([i for i in secret_ids if i in response.text], f"{path} leaked a tenant-A id")
        self.assertEqual(c.get("/v1/reports/metrics", headers=self.auth(B_SUP)).json()["total"], 0)
        job = c.post("/v1/reports/export", headers=self.auth(B_SUP), json={}).json()["job_id"]
        content = c.get(f"/v1/reports/export/{job}/content", headers=self.auth(B_SUP))
        self.assertEqual(content.status_code, 200)
        self.assertNotIn(a["case"], content.text)

    def test_identity_endpoints_describe_only_the_caller(self) -> None:
        me = self.client.get("/v1/me", headers=self.auth(B_SUP)).json()
        self.assertEqual((me["user_id"], me["tenant_id"]), (B_SUP, SYNTHETIC_OTHER_TENANT_ID))
        grant = self.client.post("/v1/session/offline-grant", headers=self.auth(B_WORKER),
                                 json={"device_id": str(uuid4()), "client_build": "t31"})
        self.assertEqual(grant.status_code, 200, grant.text)
        self.assertNotIn(self.a["source"], grant.text)

    def test_workers_cannot_reach_supervisor_surfaces(self) -> None:
        c, a = self.client, self.a
        for method, path, body in (("GET", "/v1/cases", None), ("GET", "/v1/reports/metrics", None),
                                   ("POST", "/v1/reports/export", {}), ("POST", "/v1/lab-reports", {
                                       "report_id": str(uuid4()), "case_id": a["case"], "source_id": a["source"],
                                       "lab_name": "x", "collected_at": "2026-09-24T11:00:00Z", "method": "x",
                                       "parameter": "x", "result": "x", "lab_interpretation": "not_stated"})):
            with self.subTest(path=path):
                response = c.request(method, path, headers=self.auth(A_WORKER), json=body)
                self.assertEqual(response.status_code, 403, response.text)


if __name__ == "__main__":
    unittest.main()
