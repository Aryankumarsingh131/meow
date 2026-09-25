"""Staff v2 routes end to end: the whole erd.md lifecycle over HTTP, on the real
app and the REAL database, with the synthetic dev issuer minting staff tokens
for the demo staff (sub = profiles.auth_user_id). Plus the Pluccy screening:
kit config, readings -> rule-based risk, photo proof, points.

Works on a throwaway water source created through the API in the East Plains
team; tearDown deletes everything hanging off it (points included), plus the
throwaway resident and their auth user.

    python -m unittest tests.staff_v2_http_test -v
"""

from __future__ import annotations

import base64
import io
import random
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from tests.public_v2_http_test import ENABLED, EMAIL_PREFIX, _client_key, _Req, main, purge_residents
from tests.public_v2_postgres_test import connect, psycopg

EAST_SUP = "b1dd56bc-fe96-5352-99e6-0f1b5ff5d2ca"
EAST_WORKER = "2d9cf24d-1775-5653-93bb-6bda813c9741"
NORTH_SUP = "da8334ff-a77a-5e9a-9083-4354340dbe97"
CHLORINE_KIT = "6ecff65c-ff32-5141-83dd-9b51f9953ba2"   # 30 s wait, 60 s grace, measures chlorine
PDF = b"%PDF-1.4\n1 0 obj << /Type /Page >> endobj\ntrailer << >>\n%%EOF\n"


def purge_source(c, src: str) -> None:
    """Delete a throwaway source and everything hanging off it (ids as text[])."""
    ids = lambda sql, *a: [str(r[0]) for r in c.execute(sql, a).fetchall()]  # noqa: E731
    reports = ids("select id from public.reports where source_id = %s", src)
    complaints = ids("select id from public.complaints where source_id = %s", src)
    referrals = ids("select id from public.lab_referrals where report_id = any(%s::uuid[])", reports)
    records = ids("select id from public.test_records where source_id = %s", src)
    blobs = [b for b in ids(
        "select photo_url from public.process_photos where report_id = any(%s::uuid[]) or source_id = %s"
        " union select result_file_url from public.lab_referrals where report_id = any(%s::uuid[])"
        " union select photo_url from public.complaints where id = any(%s::uuid[])"
        " union select photo_url from public.test_records where source_id = %s",
        reports, src, reports, complaints, src) if b != "None"]
    c.execute("delete from public.notifications where related_report_id = any(%s::uuid[])", (reports,))
    c.execute("delete from public.notifications where message like any(select '%%' || reference_number || '%%'"
              " from public.complaints where id = any(%s::uuid[]))", (complaints,))
    # Points go with their screenings; the balance trigger only adds, so undo it too.
    for profile, points in c.execute("select profile_id, sum(points) from public.points_ledger"
                                     " where related_test_record_id = any(%s::uuid[]) group by 1", (records,)).fetchall():
        c.execute("update public.profiles set points_balance = points_balance - %s where id = %s", (points, profile))
    c.execute("delete from public.points_ledger where related_test_record_id = any(%s::uuid[])", (records,))
    c.execute("delete from public.audit_log where entity_id = any(%s::uuid[])", (reports + complaints + referrals + [src],))
    c.execute("delete from public.process_photos where report_id = any(%s::uuid[]) or source_id = %s", (reports, src))
    c.execute("delete from public.lab_referrals where report_id = any(%s::uuid[])", (reports,))
    c.execute("delete from public.complaints where id = any(%s::uuid[])", (complaints,))
    c.execute("delete from public.reports where id = any(%s::uuid[])", (reports,))
    c.execute("delete from public.test_records where source_id = %s", (src,))   # test_readings cascade
    c.execute("delete from public.photo_blobs where 'blob:' || id = any(%s::text[])", (blobs,))
    c.execute("delete from public.water_sources where id = %s", (src,))


def jpeg() -> dict:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (90, 60, 30)).save(buf, "JPEG")
    return {"content_type": "image/jpeg", "data_base64": base64.b64encode(buf.getvalue()).decode()}


@unittest.skipUnless(psycopg is not None and ENABLED, "needs the synthetic dev stack on PostgreSQL")
class StaffHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient

        self.ip = f"203.0.{random.randint(0, 255)}.{random.randint(1, 254)}"
        self.http = TestClient(main.app, client=(self.ip, 50000))
        self.db = connect()
        self.sources: list[str] = []
        self.email = f"{EMAIL_PREFIX}{random.randint(0, 999999)}.staff@example.org"

    def tearDown(self) -> None:
        c = self.db
        c.rollback()
        for src in self.sources:
            purge_source(c, src)
        purge_residents(c, self.email)
        c.execute("delete from public.complaint_rate_limits where bucket_key like %s",
                  (f"%:{_client_key(_Req(self.ip))}",))
        c.commit()
        c.close()

    # --- helpers ---------------------------------------------------------------

    def staff(self, who: str) -> dict:
        return {"Authorization": f"Bearer {main.app.state.dev_issuer.mint(who)}"}

    def ok(self, response, status: int = 200) -> dict:
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def code(self, response) -> tuple[int, str]:
        return response.status_code, response.json().get("code")

    def new_source(self) -> str:
        body = self.ok(self.http.post("/v1/staff/sources", headers=self.staff(EAST_WORKER), json={
            "name": "Throwaway Test Pump", "source_type": "hand_pump", "latitude": 22.731, "longitude": 76.051,
            "location_accuracy_m": 4.2, "village": "East Plains"}), 201)
        self.sources.append(body["source_id"])
        return body["source_id"]

    def push(self, source: str, risk: str, local_id: str | None = None) -> dict:
        return self.http.post("/v1/staff/test-records", headers=self.staff(EAST_WORKER), json={
            "source_id": source, "local_record_id": local_id or str(uuid.uuid4()), "kit_id": CHLORINE_KIT,
            "method": "manual", "dropdown_selection": "strip_selected",
            "raw_input": {"observed_color": f"band-{risk}"}, "computed_risk_level": risk})

    def screen(self, source: str, readings: dict, *, kit: str = CHLORINE_KIT, waited: float | None = 45,
               photo: bool = True, local_id: str | None = None):
        """A Pluccy screening: readings, the strip read `waited` seconds after the dip."""
        read = datetime.now(timezone.utc)
        body = {"source_id": source, "local_record_id": local_id or str(uuid.uuid4()), "kit_id": kit,
                "method": "manual", "readings": readings}
        if waited is not None:
            body |= {"dip_started_at": (read - timedelta(seconds=waited)).isoformat(), "read_at": read.isoformat()}
        if photo:
            body["photo"] = jpeg()
        return self.http.post("/v1/staff/test-records", headers=self.staff(EAST_WORKER), json=body)

    def report(self, report_id: str, who: str = EAST_SUP) -> dict:
        return self.ok(self.http.get(f"/v1/staff/reports/{report_id}", headers=self.staff(who)))

    def resident(self) -> dict:
        token = self.ok(self.http.post("/v1/public/accounts", json={"email": self.email, "password": "correct horse",
                                                                    "phone": f"+9199999{random.randint(0, 99999):05d}"}),
                        201)["token"]
        return {"Authorization": f"Bearer {token}"}

    # --- tests -----------------------------------------------------------------

    def test_sources_gps_by_default_manual_only_by_supervisor(self) -> None:
        self.new_source()
        base = {"name": "Manual Pin", "source_type": "tank", "latitude": 22.7, "longitude": 76.0,
                "location_source": "manual_override", "override_reason": "Rooftop tank, no GPS fix indoors"}
        self.assertEqual(self.code(self.http.post("/v1/staff/sources", headers=self.staff(EAST_WORKER), json=base)),
                         (403, "FORBIDDEN"))
        manual = self.ok(self.http.post("/v1/staff/sources", headers=self.staff(EAST_SUP), json=base), 201)
        self.sources.append(manual["source_id"])
        self.assertFalse(manual["location_auto_pinned"])
        for bad in ({**base, "location_source": "gps_auto"},                    # GPS pin without accuracy
                    {**base, "location_source": "gps_auto", "location_accuracy_m": 250},   # too inaccurate
                    {**base, "override_reason": None}):                         # manual without reason
            with self.subTest(bad=str(bad)[:60]):
                self.assertEqual(self.http.post("/v1/staff/sources", headers=self.staff(EAST_SUP), json=bad).status_code, 422)
        listed = [s["source_id"] for s in self.ok(self.http.get("/v1/staff/sources", headers=self.staff(EAST_SUP)))["items"]]
        self.assertIn(manual["source_id"], listed)
        north = [s["source_id"] for s in self.ok(self.http.get("/v1/staff/sources", headers=self.staff(NORTH_SUP)))["items"]]
        self.assertNotIn(manual["source_id"], north)

    def test_test_record_push_is_idempotent_and_creates_one_report(self) -> None:
        source = self.new_source()
        local_id = str(uuid.uuid4())
        first = self.ok(self.push(source, "high", local_id), 201)
        self.assertEqual(first["outcome"], "accepted")
        self.assertIsNotNone(first["report_id"])
        replay = self.ok(self.push(source, "high", local_id), 200)   # lost response replayed
        self.assertEqual((replay["outcome"], replay["test_record_id"], replay["report_id"]),
                         ("duplicate", first["test_record_id"], first["report_id"]))
        self.assertEqual(self.code(self.push(source, "low", local_id)), (409, "IDEMPOTENCY_MISMATCH"))
        self.assertIsNone(self.ok(self.push(source, "low"), 201)["report_id"])
        self.assertEqual(self.db.execute("select count(*) from public.reports where source_id = %s",
                                         (source,)).fetchone()[0], 1)
        # Another team's source is invisible.
        other = self.http.post("/v1/staff/test-records", headers=self.staff(EAST_WORKER), json={
            "source_id": "0970b397-9a14-5a52-b5b9-bdd37a956cfd", "local_record_id": str(uuid.uuid4()),
            "kit_id": CHLORINE_KIT, "method": "camera", "autofill_calculation": {"risk_band": "low"},
            "computed_risk_level": "low"})
        self.assertEqual(other.status_code, 404)
        bad = self.http.post("/v1/staff/test-records", headers=self.staff(EAST_WORKER), json={
            "source_id": source, "local_record_id": str(uuid.uuid4()), "kit_id": CHLORINE_KIT, "method": "manual",
            "autofill_calculation": {"risk_band": "high"}, "computed_risk_level": "high"})
        self.assertEqual(bad.status_code, 422)   # a manual test cannot carry a machine suggestion

    def test_full_erd_lifecycle(self) -> None:
        source = self.new_source()
        report_id = self.ok(self.push(source, "high"), 201)["report_id"]

        # Resident complaint with a photo.
        resident = self.resident()
        filed = self.ok(self.http.post("/v1/public/complaints", headers=resident, json={
            "complaint_type": "discoloration", "source_id": source, "description": "Brown water", "photo": jpeg()}), 201)
        self.assertTrue(filed["photo_attached"])
        bad_photo = self.http.post("/v1/public/complaints", headers=resident, json={
            "complaint_type": "smell", "photo": {"content_type": "image/jpeg", "data_base64": base64.b64encode(b"<html>").decode()}})
        self.assertEqual(bad_photo.status_code, 422)

        # Supervisor review: link at the report's current version; a stale version is refused.
        listed = self.ok(self.http.get("/v1/staff/complaints?status=new", headers=self.staff(EAST_SUP)))["items"]
        complaint = next(c for c in listed if c["reference_number"] == filed["reference_number"])
        self.assertNotIn(filed["reference_number"],
                         [c["reference_number"] for c in self.ok(self.http.get("/v1/staff/complaints", headers=self.staff(NORTH_SUP)))["items"]])
        self.assertEqual(self.http.get("/v1/staff/complaints", headers=self.staff(EAST_WORKER)).status_code, 403)
        photo_blob = complaint["photo"].removeprefix("blob:")
        self.assertEqual(self.http.get(f"/v1/staff/blobs/{photo_blob}", headers=self.staff(EAST_SUP)).status_code, 200)
        self.assertEqual(self.http.get(f"/v1/staff/blobs/{photo_blob}", headers=self.staff(EAST_WORKER)).status_code, 404)
        cid = complaint["complaint_id"]
        version = self.report(report_id)["version"]
        review = f"/v1/staff/complaints/{cid}/review"
        self.assertEqual(self.http.post(review, headers=self.staff(EAST_SUP), json={"action": "link", "report_id": report_id}
                                        ).status_code, 422)   # link must name the version
        self.assertEqual(self.code(self.http.post(review, headers=self.staff(EAST_SUP), json={
            "action": "link", "report_id": report_id, "version": version - 1})), (409, "CASE_VERSION_CONFLICT"))
        self.assertEqual(self.code(self.http.post(review, headers=self.staff(NORTH_SUP), json={"action": "dismiss"})),
                         (404, "NOT_FOUND"))
        self.assertEqual(self.http.post(review, headers=self.staff(EAST_WORKER), json={"action": "dismiss"}).status_code, 403)
        linked = self.ok(self.http.post(review, headers=self.staff(EAST_SUP),
                                        json={"action": "link", "report_id": report_id, "version": version}))
        self.assertEqual((linked["status"], linked["report_id"]), ("linked", report_id))
        self.assertEqual(self.code(self.http.post(review, headers=self.staff(EAST_SUP), json={"action": "dismiss"})),
                         (409, "COMPLAINT_ALREADY_REVIEWED"))
        mine = self.ok(self.http.get("/v1/public/complaints", headers=resident))["items"]
        self.assertEqual([(c["reference_number"], c["status"]) for c in mine], [(filed["reference_number"], "linked")])

        # Lab: refer, stale version refused, worker records, supervisor verifies.
        detail = self.report(report_id)
        self.assertEqual((detail["test"]["human_observation"], detail["test"]["machine_suggestion"]),
                         ({"observed_color": "band-high"}, None))
        self.assertEqual(self.http.get(f"/v1/staff/reports/{report_id}", headers=self.staff(NORTH_SUP)).status_code, 404)
        referral = self.ok(self.http.post(f"/v1/staff/reports/{report_id}/lab-referrals", headers=self.staff(EAST_SUP),
                                          json={"lab_name": "District Lab", "version": detail["version"]}), 201)["lab_referral_id"]
        stale = self.http.post(f"/v1/staff/reports/{report_id}/transition", headers=self.staff(EAST_SUP),
                               json={"to": "action_taken", "version": detail["version"]})
        self.assertEqual(self.code(stale), (409, "CASE_VERSION_CONFLICT"))
        self.assertEqual(self.code(self.http.post(f"/v1/staff/lab-referrals/{referral}/verify", headers=self.staff(EAST_SUP),
                                                  json={"decision": "verified"})), (409, "LAB_RESULT_MISSING"))
        result = self.ok(self.http.post(f"/v1/staff/lab-referrals/{referral}/result", headers=self.staff(EAST_WORKER),
                                        json=jpeg()))
        self.assertTrue(result["result_file_available"])
        self.assertEqual(self.http.post(f"/v1/staff/lab-referrals/{referral}/verify", headers=self.staff(EAST_WORKER),
                                        json={"decision": "verified"}).status_code, 403)
        self.ok(self.http.post(f"/v1/staff/lab-referrals/{referral}/verify", headers=self.staff(EAST_SUP),
                               json={"decision": "verified"}))

        # A PDF result is quarantined and cannot be verified or downloaded.
        second = self.ok(self.http.post(f"/v1/staff/reports/{report_id}/lab-referrals", headers=self.staff(EAST_SUP),
                                        json={"lab_name": "Second Lab", "version": self.report(report_id)["version"]}),
                         201)["lab_referral_id"]
        pdf = self.ok(self.http.post(f"/v1/staff/lab-referrals/{second}/result", headers=self.staff(EAST_WORKER),
                                     json={"content_type": "application/pdf", "data_base64": base64.b64encode(PDF).decode()}))
        self.assertFalse(pdf["result_file_available"])
        self.assertEqual(self.code(self.http.post(f"/v1/staff/lab-referrals/{second}/verify", headers=self.staff(EAST_SUP),
                                                  json={"decision": "verified"})), (409, "EVIDENCE_NOT_AVAILABLE"))
        self.assertEqual(self.code(self.http.get(f"/v1/staff/blobs/{pdf['result_file'].removeprefix('blob:')}",
                                                 headers=self.staff(EAST_SUP))), (409, "EVIDENCE_NOT_AVAILABLE"))

        # Action, evidence, guarded close.
        version = self.report(report_id)["version"]
        version = self.ok(self.http.post(f"/v1/staff/reports/{report_id}/transition", headers=self.staff(EAST_SUP),
                                         json={"to": "action_taken", "version": version}))["version"]
        close = {"version": version, "closure_reason": "Pump shock-chlorinated; lab confirmed after flushing."}
        self.assertEqual(self.code(self.http.post(f"/v1/staff/reports/{report_id}/close", headers=self.staff(EAST_SUP),
                                                  json=close)), (409, "ACTION_EVIDENCE_MISSING"))
        self.assertEqual(self.http.post(f"/v1/staff/reports/{report_id}/photos", headers=self.staff(EAST_WORKER),
                                        json={**jpeg(), "process_stage": "closure", "inspection_level": "lab"}).status_code, 403)
        photo = self.ok(self.http.post(f"/v1/staff/reports/{report_id}/photos", headers=self.staff(EAST_WORKER),
                                       json={**jpeg(), "process_stage": "corrective_action"}), 201)
        self.assertEqual(photo["inspection_level"], "field")
        self.assertEqual(self.http.post(f"/v1/staff/reports/{report_id}/close", headers=self.staff(EAST_WORKER),
                                        json=close).status_code, 403)
        self.assertEqual(self.http.post(f"/v1/staff/reports/{report_id}/close", headers=self.staff(NORTH_SUP),
                                        json=close).status_code, 404)
        closed = self.ok(self.http.post(f"/v1/staff/reports/{report_id}/close", headers=self.staff(EAST_SUP), json=close))
        self.assertEqual(closed["status"], "closed")

        # Effects: complaint resolved, SMS queued to the resident, push to the worker, source status.
        mine = self.ok(self.http.get("/v1/public/complaints", headers=resident))["items"][0]
        self.assertEqual((mine["status"], mine["resolution_label"]),
                         ("resolved", "The investigation it was linked to is closed."))
        phone = self.db.execute("select phone from public.residents where email = %s", (self.email,)).fetchone()[0]
        sms = self.db.execute("select recipient_phone, delivery_status from public.notifications"
                              " where related_report_id = %s and channel = 'sms'", (report_id,)).fetchall()
        self.assertIn((phone, "queued"), sms)
        pushes = self.ok(self.http.get("/v1/staff/notifications", headers=self.staff(EAST_WORKER)))["items"]
        mine = [n for n in pushes if n["related_report_id"] == report_id]
        self.assertTrue(mine)
        self.ok(self.http.post(f"/v1/staff/notifications/{mine[0]['notification_id']}/ack", headers=self.staff(EAST_WORKER)))
        self.assertEqual(self.http.post(f"/v1/staff/notifications/{mine[0]['notification_id']}/ack",
                                        headers=self.staff(EAST_SUP)).status_code, 404)
        self.assertEqual(self.db.execute("select current_public_status from public.water_sources where id = %s",
                                         (source,)).fetchone()[0], "no_open_issues")
        self.ok(self.http.post(f"/v1/staff/sources/{source}/lab-verified", headers=self.staff(EAST_SUP)))
        self.assertEqual(self.http.post(f"/v1/staff/sources/{source}/lab-verified",
                                        headers=self.staff(NORTH_SUP)).status_code, 404)

    def test_open_report_from_a_resident_complaint(self) -> None:
        source = self.new_source()
        resident = self.resident()
        filed = self.ok(self.http.post("/v1/public/complaints", headers=resident,
                                       json={"complaint_type": "smell", "source_id": source}), 201)
        cid = next(c["complaint_id"] for c in self.ok(self.http.get("/v1/staff/complaints", headers=self.staff(EAST_SUP)))["items"]
                   if c["reference_number"] == filed["reference_number"])
        opened = self.ok(self.http.post(f"/v1/staff/complaints/{cid}/review", headers=self.staff(EAST_SUP),
                                        json={"action": "open_report", "risk_level": "medium"}))
        detail = self.report(opened["report_id"])
        self.assertEqual((detail["origin"], detail["test"], detail["status"], detail["risk_level"]),
                         ("resident", None, "open", "medium"))
        self.assertEqual([c["reference_number"] for c in detail["linked_complaints"]], [filed["reference_number"]])

    # --- Pluccy screenings and points ---------------------------------------------

    def test_kits_config_drives_the_guided_flow(self) -> None:
        kits = self.ok(self.http.get("/v1/staff/kits", headers=self.staff(EAST_WORKER)))
        chlorine = next(k for k in kits["items"] if k["kit_id"] == CHLORINE_KIT)
        self.assertEqual((chlorine["wait_seconds"], chlorine["read_grace_seconds"]), (30, 60))
        self.assertTrue(chlorine["dip_instruction"])
        self.assertEqual([p["key"] for p in chlorine["parameters"]], ["chlorine"])
        self.assertTrue(chlorine["parameters"][0]["tip"])
        self.assertIn("not a laboratory result", kits["notice"])
        self.assertEqual(self.http.get("/v1/staff/kits").status_code, 401)

    def test_on_time_screening_earns_points_and_the_server_assesses_risk(self) -> None:
        source = self.new_source()
        before = self.ok(self.http.get("/v1/staff/me", headers=self.staff(EAST_WORKER)))["points"]
        low = self.ok(self.screen(source, {"chlorine": 0.5}), 201)
        self.assertEqual((low["risk_level"], low["points_awarded"], low["report_id"]), ("low", 10, None))
        self.assertEqual(low["assessment"]["findings"], [{"parameter": "chlorine", "value": 0.5, "level": "low"}])
        self.assertEqual(low["points"]["points_balance"], before["points_balance"] + 10)
        self.assertEqual(low["points"]["qualifying_screenings"], before["qualifying_screenings"] + 1)
        self.assertGreaterEqual(low["points"]["streak_days"], 1)

        high = self.ok(self.screen(source, {"chlorine": 6}), 201)   # the client never sets the risk
        self.assertEqual(high["risk_level"], "high")
        self.assertIsNotNone(high["report_id"])
        detail = self.report(high["report_id"])
        self.assertEqual(detail["test"]["readings"], {"chlorine": 6})
        self.assertEqual(detail["test"]["rule_assessment"]["risk_level"], "high")
        photo = detail["test"]["photo"].removeprefix("blob:")
        self.assertEqual(self.http.get(f"/v1/staff/blobs/{photo}", headers=self.staff(EAST_WORKER)).status_code, 200)
        self.assertEqual(self.http.get(f"/v1/staff/blobs/{photo}", headers=self.staff(NORTH_SUP)).status_code, 404)

    def test_screenings_that_earn_nothing(self) -> None:
        source = self.new_source()
        for label, response in (("read too early", self.screen(source, {"chlorine": 0.5}, waited=10)),
                                ("read too late", self.screen(source, {"chlorine": 0.5}, waited=200)),
                                ("no photo", self.screen(source, {"chlorine": 0.5}, photo=False)),
                                ("no timing", self.screen(source, {"chlorine": 0.5}, waited=None))):
            with self.subTest(case=label):
                self.assertEqual(self.ok(response, 201)["points_awarded"], 0)

    def test_screening_validation(self) -> None:
        source = self.new_source()
        for label, readings in (("out of range", {"chlorine": 11}), ("not this kit's", {"ph": 7}),
                                ("negative", {"chlorine": -1})):
            with self.subTest(case=label):
                self.assertEqual(self.code(self.screen(source, readings)), (422, "VALIDATION_FAILED"))
        read = datetime.now(timezone.utc)
        for label, extra in (("read before dip", {"dip_started_at": read.isoformat(),
                                                  "read_at": (read - timedelta(seconds=5)).isoformat()}),
                             ("half the timing", {"read_at": read.isoformat()}),
                             ("in the future", {"dip_started_at": read.isoformat(),
                                                "read_at": (read + timedelta(hours=1)).isoformat()})):
            with self.subTest(case=label):
                r = self.http.post("/v1/staff/test-records", headers=self.staff(EAST_WORKER), json={
                    "source_id": source, "local_record_id": str(uuid.uuid4()), "kit_id": CHLORINE_KIT,
                    "method": "manual", "readings": {"chlorine": 0.5}, **extra})
                self.assertEqual(r.status_code, 422)

    def test_screening_replay_is_idempotent_on_readings(self) -> None:
        source = self.new_source()
        local_id = str(uuid.uuid4())
        first = self.ok(self.screen(source, {"chlorine": 0.5}, local_id=local_id), 201)
        replay = self.ok(self.screen(source, {"chlorine": 0.5}, local_id=local_id), 200)
        self.assertEqual((replay["outcome"], replay["test_record_id"], replay["points_awarded"]),
                         ("duplicate", first["test_record_id"], 10))
        self.assertEqual(self.code(self.screen(source, {"chlorine": 0.9}, local_id=local_id)), (409, "IDEMPOTENCY_MISMATCH"))
        self.assertEqual(self.db.execute("select count(*) from public.points_ledger where related_test_record_id = %s",
                                         (first["test_record_id"],)).fetchone()[0], 1)

    def test_lab_re_report_loop_over_http(self) -> None:
        source = self.new_source()
        report_id = self.ok(self.push(source, "medium"), 201)["report_id"]
        referral = self.ok(self.http.post(f"/v1/staff/reports/{report_id}/lab-referrals", headers=self.staff(EAST_SUP),
                                          json={"lab_name": "District Lab", "version": 1}), 201)["lab_referral_id"]
        self.ok(self.http.post(f"/v1/staff/lab-referrals/{referral}/result", headers=self.staff(EAST_WORKER), json=jpeg()))
        verdict = self.ok(self.http.post(f"/v1/staff/lab-referrals/{referral}/verify", headers=self.staff(EAST_SUP),
                                         json={"decision": "rejected", "re_report_requested": True}))
        child = self.report(verdict["re_report_id"])
        self.assertEqual((child["is_re_report"], child["previous_report_id"], child["status"]), (True, report_id, "open"))
        self.assertEqual(self.report(report_id)["re_report"]["report_id"], verdict["re_report_id"])

    def test_staff_routes_refuse_bad_identities(self) -> None:
        self.assertEqual(self.http.get("/v1/staff/me").status_code, 401)
        self.assertEqual(self.http.get("/v1/staff/me", headers={"Authorization": "Bearer pub1.x.y"}).status_code, 401)
        # A valid token whose subject has no staff profile (a dev-issuer demo user, or a random id).
        self.assertEqual(self.http.get("/v1/staff/me", headers=self.staff(str(uuid.uuid4()))).status_code, 403)
        self.assertEqual(self.http.get("/v1/staff/me", headers=self.staff("not-a-uuid")).status_code, 403)
        me = self.ok(self.http.get("/v1/staff/me", headers=self.staff(EAST_SUP)))
        self.assertEqual((me["role"], me["team_id"]), ("supervisor", "6fa4a23b-18d6-52ec-a072-13cb9fce5d50"))


if __name__ == "__main__":
    unittest.main()
