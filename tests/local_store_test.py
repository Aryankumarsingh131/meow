"""Internal fallback database (services/api/app/local_store.py), fully offline.

Runs the v2 routes on a throwaway SQLite copy of the committed seed: the same
rules as the Postgres functions (team scope, versions, lab verification,
closure evidence, complaint lifecycle, points), and the main.py switch that
sends requests here when the cloud database is unreachable.

    python -m unittest tests.local_store_test -v
"""

from __future__ import annotations

import base64
import io
import shutil
import tempfile
import time
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from services.api.app import local_store

SEED = Path(__file__).resolve().parents[1] / "services/api/local_db/seed.json"
EAST_TEAM = "6fa4a23b-18d6-52ec-a072-13cb9fce5d50"


def jpeg() -> dict:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (20, 90, 160)).save(buf, "JPEG")
    return {"content_type": "image/jpeg", "data_base64": base64.b64encode(buf.getvalue()).decode()}


class LocalStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copy(SEED, self.tmp / "seed.json")
        self.saved = (local_store.DB_DIR, local_store.SEED)
        local_store.DB_DIR, local_store.SEED = self.tmp, self.tmp / "seed.json"
        self.http = TestClient(local_store.build_local_app())

    def tearDown(self) -> None:
        local_store.DB_DIR, local_store.SEED = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- helpers ---------------------------------------------------------------

    def login(self, email: str, password: str = "1234") -> dict:
        r = self.http.post("/v1/auth/login", json={"email": email, "password": password})
        self.assertEqual(r.status_code, 200, r.text)
        return {"Authorization": f"Bearer {r.json()['token']}"}

    def ok(self, r, status: int = 200) -> dict:
        self.assertEqual(r.status_code, status, r.text)
        return r.json()

    def code(self, r) -> tuple[int, str]:
        return r.status_code, r.json().get("code")

    def east_source(self, worker: dict) -> str:
        return self.ok(self.http.get("/v1/staff/sources", headers=worker))["items"][0]["source_id"]

    def screen(self, worker: dict, source: str, tds: float, waited: float = 30, local_id: str | None = None):
        kit = next(k for k in self.ok(self.http.get("/v1/staff/kits", headers=worker))["items"] if k["strip_type"] == "TDS")
        read = datetime.now(timezone.utc)
        return self.http.post("/v1/staff/test-records", headers=worker, json={
            "source_id": source, "local_record_id": local_id or str(uuid.uuid4()), "kit_id": kit["kit_id"], "method": "manual",
            "readings": {"tds": tds}, "dip_started_at": (read - timedelta(seconds=waited)).isoformat(),
            "read_at": read.isoformat(), "photo": jpeg()})

    # --- tests -----------------------------------------------------------------

    def test_demo_logins_and_refusals(self) -> None:
        for email, role in (("1@demo.org", "field_worker"), ("2@demo.org", "supervisor"), ("3@demo.org", "resident")):
            r = self.ok(self.http.post("/v1/auth/login", json={"email": email, "password": "1234"}))
            self.assertEqual((r["role"], r["token_type"]), (role, "local"))
            self.assertTrue(r["token"].startswith("local1."))
        wrong = self.http.post("/v1/auth/login", json={"email": "1@demo.org", "password": "nope"})
        nobody = self.http.post("/v1/auth/login", json={"email": "nobody@example.org", "password": "1234"})
        self.assertEqual(self.code(wrong), (401, "AUTH_REQUIRED"))
        self.assertEqual(wrong.json()["detail"], nobody.json()["detail"])
        self.assertEqual(self.http.get("/v1/staff/me", headers={"Authorization": "Bearer local1.forged.sig"}).status_code, 401)

    def test_screening_bands_points_report_and_idempotency(self) -> None:
        worker = self.login("1@demo.org")
        source = self.east_source(worker)
        start = self.ok(self.http.get("/v1/staff/me", headers=worker))["points"]["points_balance"]
        low = self.ok(self.screen(worker, source, 320), 201)
        self.assertEqual((low["risk_level"], low["points_awarded"], low["report_id"]), ("low", 10, None))
        high = self.ok(self.screen(worker, source, 2500, local_id="11111111-0000-0000-0000-000000000000"), 201)
        self.assertEqual(high["risk_level"], "high")
        self.assertIsNotNone(high["report_id"])
        replay = self.ok(self.screen(worker, source, 2500, local_id="11111111-0000-0000-0000-000000000000"), 200)
        self.assertEqual((replay["outcome"], replay["points_awarded"]), ("duplicate", 10))
        self.assertEqual(self.code(self.screen(worker, source, 100, local_id="11111111-0000-0000-0000-000000000000")),
                         (409, "IDEMPOTENCY_MISMATCH"))
        self.assertEqual(self.ok(self.screen(worker, source, 320, waited=5), 201)["points_awarded"], 0)   # read too early
        self.assertEqual(self.ok(self.http.get("/v1/staff/me", headers=worker))["points"]["points_balance"], start + 20)
        self.assertEqual(self.code(self.screen(worker, source, 99999)), (422, "VALIDATION_FAILED"))

    def test_resident_complaint_to_closed_case_end_to_end(self) -> None:
        worker, sup, resident = self.login("1@demo.org"), self.login("2@demo.org"), self.login("3@demo.org")
        source = self.east_source(worker)
        report = self.ok(self.screen(worker, source, 2500), 201)["report_id"]
        filed = self.ok(self.http.post("/v1/public/complaints", headers=resident,
                                       json={"complaint_type": "smell", "source_id": source, "photo": jpeg()}), 201)
        queue = self.ok(self.http.get("/v1/staff/complaints?status=new", headers=sup))["items"]
        cid = next(c["complaint_id"] for c in queue if c["reference_number"] == filed["reference_number"])
        version = self.ok(self.http.get(f"/v1/staff/reports/{report}", headers=sup))["version"]
        review = f"/v1/staff/complaints/{cid}/review"
        self.assertEqual(self.code(self.http.post(review, headers=sup, json={"action": "link", "report_id": report,
                                                                              "version": version - 1})), (409, "CASE_VERSION_CONFLICT"))
        self.assertEqual(self.http.post(review, headers=worker, json={"action": "dismiss"}).status_code, 403)
        self.ok(self.http.post(review, headers=sup, json={"action": "link", "report_id": report, "version": version}))
        mine = self.ok(self.http.get("/v1/public/complaints", headers=resident))["items"]
        self.assertEqual(next(c for c in mine if c["reference_number"] == filed["reference_number"])["status"], "linked")

        version = self.ok(self.http.get(f"/v1/staff/reports/{report}", headers=sup))["version"]
        referral = self.ok(self.http.post(f"/v1/staff/reports/{report}/lab-referrals", headers=sup,
                                          json={"lab_name": "District Lab", "version": version}), 201)["lab_referral_id"]
        self.ok(self.http.post(f"/v1/staff/lab-referrals/{referral}/result", headers=worker, json=jpeg()))
        self.ok(self.http.post(f"/v1/staff/lab-referrals/{referral}/verify", headers=sup, json={"decision": "verified"}))
        version = self.ok(self.http.get(f"/v1/staff/reports/{report}", headers=sup))["version"]
        version = self.ok(self.http.post(f"/v1/staff/reports/{report}/transition", headers=sup,
                                         json={"to": "action_taken", "version": version}))["version"]
        close = {"version": version, "closure_reason": "Pump flushed and chlorinated; lab verified."}
        self.assertEqual(self.code(self.http.post(f"/v1/staff/reports/{report}/close", headers=sup, json=close)),
                         (409, "ACTION_EVIDENCE_MISSING"))
        self.ok(self.http.post(f"/v1/staff/reports/{report}/photos", headers=worker,
                               json={**jpeg(), "process_stage": "corrective_action"}), 201)
        self.assertEqual(self.ok(self.http.post(f"/v1/staff/reports/{report}/close", headers=sup, json=close))["status"], "closed")
        mine = self.ok(self.http.get("/v1/public/complaints", headers=resident))["items"]
        self.assertEqual(next(c for c in mine if c["reference_number"] == filed["reference_number"])["status"], "resolved")
        history = [h["action"] for h in self.ok(self.http.get(f"/v1/staff/reports/{report}", headers=sup))["history"]]
        self.assertIn("closed", history)

    def test_self_review_and_team_scope(self) -> None:
        sup, worker = self.login("2@demo.org"), self.login("1@demo.org")
        report = self.ok(self.screen(worker, self.east_source(worker), 2500), 201)["report_id"]
        version = self.ok(self.http.get(f"/v1/staff/reports/{report}", headers=sup))["version"]
        referral = self.ok(self.http.post(f"/v1/staff/reports/{report}/lab-referrals", headers=sup,
                                          json={"lab_name": "District Lab", "version": version}), 201)["lab_referral_id"]
        self.ok(self.http.post(f"/v1/staff/lab-referrals/{referral}/result", headers=sup, json=jpeg()))
        self.assertEqual(self.code(self.http.post(f"/v1/staff/lab-referrals/{referral}/verify", headers=sup,
                                                  json={"decision": "verified"})), (409, "VERIFICATION_SELF_REVIEW"))
        north = self.login("supervisor.north.valley.demo@example.org")
        self.assertEqual(self.http.get(f"/v1/staff/reports/{report}", headers=north).status_code, 404)

    def test_supervisor_board_routes(self) -> None:
        sup, worker = self.login("2@demo.org"), self.login("1@demo.org")
        source = self.east_source(worker)
        report = self.ok(self.screen(worker, source, 2500), 201)["report_id"]
        team = self.ok(self.http.get("/v1/staff/team", headers=sup))["items"]
        self.assertIn("1@demo.org", [m["email"] for m in team])
        self.ok(self.http.post(f"/v1/staff/reports/{report}/notes", headers=sup, json={"text": "Called the ward office."}), 201)
        self.ok(self.http.post(f"/v1/staff/reports/{report}/communications", headers=sup,
                               json={"channel": "sms", "message": "Testing underway", "delivery_status": "sent",
                                     "sent_at": datetime.now(timezone.utc).isoformat()}), 201)
        version = self.ok(self.http.get(f"/v1/staff/reports/{report}", headers=sup))["version"]
        child = self.ok(self.http.post(f"/v1/staff/reports/{report}/re-report", headers=sup, json={"version": version}), 201)
        detail = self.ok(self.http.get(f"/v1/staff/reports/{report}", headers=sup))
        self.assertEqual(detail["re_report"]["report_id"], child["re_report_id"])
        self.assertEqual([c["message"] for c in detail["communications"]], ["Testing underway"])
        self.assertIn("note", [h["action"] for h in detail["history"]])
        self.ok(self.http.patch(f"/v1/staff/sources/{source}", headers=sup, json={"name": "Renamed Pump"}))
        self.assertIn("Renamed Pump", [s["name"] for s in self.ok(self.http.get("/v1/staff/sources", headers=worker))["items"]])
        self.assertEqual(self.http.get("/v1/staff/team", headers=worker).status_code, 403)

    def test_recent_photos_feed_shows_new_uploads_first(self) -> None:
        sup, worker, resident = self.login("2@demo.org"), self.login("1@demo.org"), self.login("3@demo.org")
        source = self.east_source(worker)
        self.ok(self.screen(worker, source, 320), 201)
        filed = self.ok(self.http.post("/v1/public/complaints", headers=resident, json={
            "complaint_type": "smell", "source_id": source, "photo": jpeg(), "extra_photos": [jpeg()]}), 201)
        feed = self.ok(self.http.get("/v1/staff/photos/recent?limit=5", headers=sup))["items"]
        self.assertEqual([(p["kind"], p["position"]) for p in feed[:3]], [("complaint", 1), ("complaint", 2), ("screening", 1)])
        self.assertTrue(feed[0]["title"].startswith(filed["reference_number"]))
        self.assertEqual(self.http.get(f"/v1/staff/blobs/{feed[1]['blob_id']}", headers=sup).status_code, 200)
        # Field workers see their team's screening photos, never residents' complaint photos.
        self.assertNotIn("complaint", {p["kind"] for p in self.ok(self.http.get("/v1/staff/photos/recent", headers=worker))["items"]})
        north = self.ok(self.http.get("/v1/staff/photos/recent", headers=self.login("supervisor.north.valley.demo@example.org")))["items"]
        self.assertNotIn(source, {p["source_id"] for p in north})

    def test_residents_are_isolated_and_can_register(self) -> None:
        other = self.ok(self.http.post("/v1/public/accounts", json={"email": "new.resident@example.org",
                                                                    "password": "correct horse"}), 201)
        other_auth = {"Authorization": f"Bearer {other['token']}"}
        resident = self.login("3@demo.org")
        self.ok(self.http.post("/v1/public/complaints", headers=resident, json={"complaint_type": "taste"}), 201)
        self.assertEqual(self.ok(self.http.get("/v1/public/complaints", headers=other_auth))["items"], [])
        self.assertEqual(self.http.get("/v1/staff/me", headers=resident).status_code, 403)
        self.assertEqual(self.code(self.http.post("/v1/public/accounts", json={"email": "3@demo.org", "password": "long enough"})),
                         (409, "EMAIL_ALREADY_REGISTERED"))
        self.assertTrue(self.ok(self.http.get("/v1/public/map"))["items"])

    def test_field_judgement_protocols_new_source_and_public_data(self) -> None:
        worker = self.login("1@demo.org")
        kits = self.ok(self.http.get("/v1/staff/kits", headers=worker))
        self.assertTrue(all(k["protocol"] for k in kits["items"]))
        multi = next(k for k in kits["items"] if k["strip_type"] == "multi")
        self.assertEqual(len(multi["parameters"]), 6)
        keys = {c["key"]: c["category"] for c in kits["inspection_criteria"]}
        self.assertEqual(sum(1 for c in keys.values() if c == "sanitary"), 8)

        made = self.ok(self.http.post("/v1/staff/sources", headers=worker, json={
            "name": "New Village Well", "source_type": "well", "latitude": 22.74, "longitude": 76.04,
            "location_accuracy_m": 6, "village": "East Plains"}), 201)
        self.assertEqual(self.http.post("/v1/staff/sources", headers=worker, json={
            "name": "Guessed", "source_type": "well", "latitude": 22.7, "longitude": 76.0,
            "location_source": "manual_override", "override_reason": "No GPS fix inside"}).status_code, 403)

        read = datetime.now(timezone.utc)
        tds = next(k for k in kits["items"] if k["strip_type"] == "TDS")
        answers = {k: k in ("latrine_nearby", "standing_water", "damaged_platform", "drainage_broken", "garbage_nearby")
                   for k, c in keys.items() if c == "sanitary"}
        r = self.ok(self.http.post("/v1/staff/test-records", headers=worker, json={
            "source_id": made["source_id"], "local_record_id": str(uuid.uuid4()), "kit_id": tds["kit_id"], "method": "manual",
            "readings": {"tds": 300}, "inspection": {**answers, "odour": True},
            "dip_started_at": (read - timedelta(seconds=30)).isoformat(), "read_at": read.isoformat(), "photo": jpeg()}), 201)
        self.assertEqual(r["risk_level"], "high")                 # readings low, but 5 sanitary risks
        self.assertEqual(r["assessment"]["readings_risk"], "low")
        self.assertEqual((r["assessment"]["inspection"]["sanitary_score"], r["assessment"]["inspection"]["observation_level"]), (5, "medium"))
        self.assertIsNotNone(r["report_id"])
        bad = self.http.post("/v1/staff/test-records", headers=worker, json={
            "source_id": made["source_id"], "local_record_id": str(uuid.uuid4()), "kit_id": tds["kit_id"], "method": "manual",
            "readings": {"tds": 300}, "inspection": {"made_up_question": True}})
        self.assertEqual(self.code(bad), (422, "VALIDATION_FAILED"))

        pub = self.ok(self.http.get("/v1/public/map"))["items"]
        new = next(s for s in pub if s["source_id"] == made["source_id"])
        self.assertEqual((new["screenings_30d"], new["open_issues"], new["village"]), (1, 1, "East Plains"))
        board = self.ok(self.http.get("/v1/public/leaderboard"))
        self.assertTrue(board["field_workers"] and board["areas"])
        self.assertRegex(board["field_workers"][0]["display_name"], r"^\S+( \S\.)?$")   # no full names in public
        self.assertIn("say nothing about whether", board["disclaimer"])

    def test_the_switch_routes_to_the_internal_database_when_the_cloud_is_down(self) -> None:
        from services.api.app.main import LocalFallback

        async def cloud_app(scope, receive, send):   # stands in for the Postgres-backed API
            await send({"type": "http.response.start", "status": 418, "headers": []})
            await send({"type": "http.response.body", "body": b"cloud"})

        switch = LocalFallback(cloud_app)
        switch.checked, switch.up = time.monotonic(), True
        client = TestClient(switch)
        self.assertEqual(client.post("/v1/auth/login", json={"email": "1@demo.org", "password": "1234"}).status_code, 418)
        switch.up = False
        r = client.post("/v1/auth/login", json={"email": "1@demo.org", "password": "1234"})
        self.assertEqual((r.status_code, r.json()["token_type"]), (200, "local"))
        switch.up = True   # cloud back: an internal-database session keeps using the internal database
        self.assertEqual(client.get("/v1/staff/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code, 200)
        self.assertEqual(client.get("/health/live").status_code, 418)   # other routes always go to the cloud app


if __name__ == "__main__":
    unittest.main()
