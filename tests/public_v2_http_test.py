"""Resident HTTP routes through the real FastAPI app and the REAL database.

Requires the synthetic dev stack (.env: development + synthetic + a PostgreSQL
JALSAKSHI_DATABASE_URL); the dev issuer mints the tokens. Creates throwaway
residents (emails test.http.<n>.*@example.org) and removes them, their auth
users and everything they filed in tearDown.

    python -m unittest tests.public_v2_http_test -v
"""

from __future__ import annotations

import hashlib
import random
import unittest

from tests.public_v2_postgres_test import URL, connect, psycopg

SOURCE_EAST_PUMP = "b6e646c2-45e0-504e-9f12-44c1ac18bb15"  # East Plains team, 1 supervisor
STAFF_EMAIL = "supervisor.east.plains.demo@example.org"     # demo supervisor, password 1234
STAFF_AUTH_ID = "b1dd56bc-fe96-5352-99e6-0f1b5ff5d2ca"
EMAIL_PREFIX = "test.http."

try:
    from fastapi.testclient import TestClient

    from services.api.app import main

    ENABLED = bool(URL) and main.SYNTHETIC_DEV and main.settings.database_url.startswith("postgres")
except Exception:  # pragma: no cover - import failure means skip, not error
    ENABLED = False


def purge_residents(c, email_like: str) -> None:
    """Delete throwaway residents, everything they filed, and their auth users."""
    residents = [str(r[0]) for r in c.execute("select id from public.residents where email like %s", (email_like,)).fetchall()]
    complaints = c.execute("select id, reference_number, photo_url, extra_photo_urls from public.complaints"
                           " where resident_id = any(%s::uuid[])", (residents,)).fetchall()
    ids = [str(r[0]) for r in complaints]
    c.execute("delete from public.notifications where message like any(%s)", ([f"%{r[1]}%" for r in complaints],))
    c.execute("delete from public.audit_log where entity_id = any(%s::uuid[])", (ids,))
    c.execute("delete from public.complaints where id = any(%s::uuid[])", (ids,))
    c.execute("delete from public.photo_blobs where 'blob:' || id = any(%s::text[])",
              ([r[2] for r in complaints if r[2]] + [u for r in complaints for u in r[3]],))
    c.execute("delete from auth.users where id in (select auth_user_id from public.residents where email like %s)",
              (email_like,))   # cascades to the identity and the residents row


@unittest.skipUnless(psycopg is not None and ENABLED, "needs the synthetic dev stack on PostgreSQL")
class ResidentHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ip = f"198.51.{random.randint(0, 255)}.{random.randint(1, 254)}"
        self.http = TestClient(main.app, client=(self.ip, 50000), raise_server_exceptions=True)
        self.db = connect()
        self.n = random.randint(0, 999999)

    def tearDown(self) -> None:
        c = self.db
        c.rollback()
        purge_residents(c, f"{EMAIL_PREFIX}{self.n}.%")
        c.commit()
        c.close()

    # --- helpers ---------------------------------------------------------------

    def email(self, k: int) -> str:
        return f"{EMAIL_PREFIX}{self.n}.{k}@example.org"

    def register(self, k: int = 1, **extra) -> dict:
        r = self.http.post("/v1/public/accounts", json={"email": self.email(k), "password": "correct horse",
                                                         "full_name": "Test Resident", **extra})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    def auth(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}

    def code(self, response) -> tuple[int, str]:
        return response.status_code, response.json().get("code")

    def file(self, token: str, **body) -> dict:
        r = self.http.post("/v1/public/complaints", headers=self.auth(token), json={"complaint_type": "smell", **body})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()

    # --- accounts --------------------------------------------------------------

    def test_register_returns_a_resident_session(self) -> None:
        session = self.register(1, phone="+91 99999 12345")
        self.assertEqual((session["role"], session["token_type"]), ("resident", "dev"))
        me = self.http.get("/v1/public/me", headers=self.auth(session["token"])).json()
        self.assertEqual((me["email"], me["full_name"]), (self.email(1), "Test Resident"))
        self.assertEqual(me["phone"], "+91*******345")   # masked
        self.assertIsNone(self.db.execute("select 1 from public.profiles where email = %s", (self.email(1),)).fetchone())

        dup = self.http.post("/v1/public/accounts", json={"email": self.email(1).upper(), "password": "another pass"})
        self.assertEqual(self.code(dup), (409, "EMAIL_ALREADY_REGISTERED"))
        for bad in ({"email": self.email(2), "password": "short"},
                    {"email": "not-an-email", "password": "long enough"},
                    {"email": self.email(2), "password": "12345678"},
                    {"email": self.email(2), "password": "long enough", "phone": "98123"},
                    {"password": "long enough"}):
            with self.subTest(body=bad):
                self.assertEqual(self.http.post("/v1/public/accounts", json=bad).status_code, 422)

    def test_email_login_for_residents(self) -> None:
        self.register(1)
        ok = self.http.post("/v1/auth/login", json={"email": "  " + self.email(1).upper(), "password": "correct horse"})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual(ok.json()["role"], "resident")
        self.assertEqual(self.http.get("/v1/public/me", headers=self.auth(ok.json()["token"])).json()["email"],
                         self.email(1))
        wrong = self.http.post("/v1/auth/login", json={"email": self.email(1), "password": "nope"})
        nobody = self.http.post("/v1/auth/login", json={"email": "nobody.here@example.org", "password": "nope"})
        self.assertEqual(self.code(wrong), (401, "AUTH_REQUIRED"))
        self.assertEqual(wrong.json()["detail"], nobody.json()["detail"])   # no account enumeration
        self.assertEqual(self.http.post("/v1/auth/login", json={"email": "not-an-email", "password": "x"}).status_code, 422)

    def test_email_login_for_staff_on_the_dev_stack(self) -> None:
        r = self.http.post("/v1/auth/login", json={"email": STAFF_EMAIL, "password": "1234"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual((body["role"], body["token_type"]), ("supervisor", "dev"))
        me = self.http.get("/v1/staff/me", headers=self.auth(body["token"])).json()
        self.assertEqual((me["role"], me["team_id"]), ("supervisor", "6fa4a23b-18d6-52ec-a072-13cb9fce5d50"))
        self.assertEqual(self.code(self.http.get("/v1/public/me", headers=self.auth(body["token"]))), (403, "FORBIDDEN"))
        wrong = self.http.post("/v1/auth/login", json={"email": STAFF_EMAIL, "password": "12345"})
        self.assertEqual(self.code(wrong), (401, "AUTH_REQUIRED"))

    def test_bad_identities_are_refused(self) -> None:
        resident = self.register(1)["token"]
        for bad in ("a.b.c", "pub1.e30.xx", "", resident[:-4] + "AAAA"):
            with self.subTest(token=bad[:20]):
                self.assertEqual(self.http.get("/v1/public/me", headers=self.auth(bad)).status_code, 401)
        self.assertEqual(self.http.get("/v1/public/me").status_code, 401)
        self.assertEqual(self.code(self.http.get("/v1/staff/me", headers=self.auth(resident))), (403, "FORBIDDEN"))
        self.db.execute("update public.residents set active = false where email = %s", (self.email(1),))
        self.db.commit()
        self.assertEqual(self.code(self.http.get("/v1/public/me", headers=self.auth(resident))), (403, "FORBIDDEN"))

    # --- complaints --------------------------------------------------------------

    def test_residents_see_only_their_own_complaints(self) -> None:
        a = self.register(1)["token"]
        b = self.register(2)["token"]
        mine = self.file(a, source_id=SOURCE_EAST_PUMP, description="Brown water since Monday")
        self.assertRegex(mine["reference_number"], r"^JS-[0-9A-F]{10}$")
        self.assertEqual((mine["status"], mine["status_label"]), ("new", "Received - not yet reviewed"))

        a_list = self.http.get("/v1/public/complaints", headers=self.auth(a)).json()["items"]
        self.assertEqual([c["reference_number"] for c in a_list], [mine["reference_number"]])
        self.assertEqual(a_list[0]["description"], "Brown water since Monday")
        self.assertEqual(a_list[0]["source_name"], self.db.execute(
            "select name from public.water_sources where id = %s", (SOURCE_EAST_PUMP,)).fetchone()[0])
        self.assertEqual(set(a_list[0]), {"reference_number", "complaint_type", "status", "status_label",
                                          "resolution_label", "source_name", "submitted_at", "linked_at", "description", "also"})
        self.assertEqual(self.http.get("/v1/public/complaints", headers=self.auth(b)).json()["items"], [])

    def test_symptom_report_queues_a_supervisor_notification(self) -> None:
        token = self.register(1)["token"]
        body = self.file(token, complaint_type="illness", source_id=SOURCE_EAST_PUMP)
        east_sups = self.db.execute("select count(*) from public.profiles where role = 'supervisor' and active"
                                    " and team_id = '6fa4a23b-18d6-52ec-a072-13cb9fce5d50'").fetchone()[0]
        self.assertEqual(body["supervisors_notified"], east_sups)
        rows = self.db.execute(
            "select p.role, p.team_id::text, n.channel, n.delivery_status from public.notifications n"
            " join public.profiles p on p.id = n.user_id where n.message like %s",
            (f"%{body['reference_number']}%",)).fetchall()
        self.assertEqual(rows, [("supervisor", "6fa4a23b-18d6-52ec-a072-13cb9fce5d50", "in_app", "queued")] * east_sups)

    def test_complaints_need_a_resident_and_are_not_rate_limited(self) -> None:
        self.assertEqual(self.http.post("/v1/public/complaints", json={"complaint_type": "taste"}).status_code, 401)
        token = self.register(1)["token"]
        for _ in range(7):   # past the old limit of 5 an hour
            self.file(token)

    def test_complaint_validation(self) -> None:
        token = self.register(1)["token"]
        for body in ({"complaint_type": "poison"}, {"complaint_type": "smell", "source_id": "not-a-uuid"},
                     {"complaint_type": "smell", "source_id": "00000000-0000-0000-0000-000000000000"},
                     {"complaint_type": "smell", "description": "x" * 1001},
                     {"complaint_type": "smell", "photo": {"content_type": "image/jpeg", "data_base64": "PGh0bWw+"}}):
            with self.subTest(body=str(body)[:60]):
                self.assertEqual(self.http.post("/v1/public/complaints", headers=self.auth(token), json=body).status_code, 422)

    # --- map, portal ---------------------------------------------------------------

    def test_map_is_fuzzed_and_honestly_labelled(self) -> None:
        body = self.http.get("/v1/public/map").json()
        self.assertTrue(body["items"])
        self.assertIn("not a guarantee", body["disclaimer"])
        labels = {"not_tested": "Not yet tested", "under_review": "Under review", "action_pending": "Action pending",
                  "no_open_issues": "No open issues (not a safety guarantee)",
                  "lab_verified_safe": "Lab-verified at last test"}
        for item in body["items"]:
            self.assertEqual(item["status_label"], labels[item["status"]])
            if item["status"] != "lab_verified_safe":
                self.assertEqual(item["location_precision"], "approximate (about 500 m)")
                self.assertAlmostEqual(item["latitude"] / 0.005, round(item["latitude"] / 0.005), places=6)

    def test_removed_routes_are_gone(self) -> None:
        for method, path in (("post", "/v1/public/session"), ("post", "/v1/public/password"),
                             ("get", "/v1/public/rewards"),
                             ("get", "/v1/public/complaints/JS-0000000000"), ("get", "/v1/staff/redemptions")):
            with self.subTest(path=path):
                self.assertIn(getattr(self.http, method)(path).status_code, (404, 405))

    def test_public_leaderboard_is_workers_only_and_anonymised(self) -> None:
        # 009: the leaderboard is back, but for field workers' on-time screening, not residents.
        r = self.http.get("/v1/public/leaderboard")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("say nothing about whether", body["disclaimer"])
        for w in body["field_workers"]:
            self.assertEqual(set(w), {"rank", "display_name", "area", "points", "on_time_screenings", "screenings"})
            self.assertRegex(w["display_name"], r"^\S+( \S\.)?$")   # first name + initial only
            self.assertNotIn("@", w["display_name"])

    def test_portal_page_is_served(self) -> None:
        r = self.http.get("/portal")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["content-type"].startswith("text/html"))
        self.assertIn("Report a problem", r.text)
        self.assertNotIn("innerHTML", r.text)   # everything is rendered through textContent


def _supabase() -> tuple[str, str] | None:
    try:
        env = dict(line.strip().split("=", 1) for line in open(".env", encoding="utf-8")
                   if "=" in line and not line.startswith("#"))
    except FileNotFoundError:
        return None
    url, key = env.get("JALSAKSHI_SUPABASE_URL", ""), env.get("JALSAKSHI_SUPABASE_PUBLISHABLE_KEY", "")
    return (url, key) if url.startswith("https://") and key else None


@unittest.skipUnless(psycopg is not None and ENABLED and _supabase(), "needs Supabase URL + publishable key in .env")
class SupabaseLoginTests(unittest.TestCase):
    """The hosted path against the REAL Supabase Auth of this project: email +
    password -> Supabase session -> a token the routes accept."""

    def setUp(self) -> None:
        self.ip = f"192.0.2.{random.randint(1, 254)}"
        self.http = TestClient(main.app, client=(self.ip, 50000))
        self.email = f"{EMAIL_PREFIX}{random.randint(0, 999999)}.hosted@example.org"

    def tearDown(self) -> None:
        c = connect()
        purge_residents(c, self.email)
        c.commit()
        c.close()

    def hosted(self, email: str, password: str):
        state = main.app.state
        issuer = state.dev_issuer
        del state.dev_issuer                      # behave like a hosted deployment for this request
        state.supabase_auth = _supabase()
        try:
            return self.http.post("/v1/auth/login", json={"email": email, "password": password})
        finally:
            state.dev_issuer = issuer
            del state.supabase_auth

    def test_supabase_password_grant_and_token_verification(self) -> None:
        from services.api.app.auth import VerifiedToken, verify_token
        from services.api.app.provider import HostedAuth
        from services.api.app.public_v2 import supabase_password_grant

        url, key = _supabase()
        session = supabase_password_grant(url, key, STAFF_EMAIL, "1234")
        self.assertIsNotNone(session)
        self.assertEqual(session["user"]["id"], STAFF_AUTH_ID)
        self.assertIsNone(supabase_password_grant(url, key, STAFF_EMAIL, "wrong-password"))

        hosted = HostedAuth(url.rstrip("/") + "/auth/v1", "authenticated", lambda _: [])
        config = hosted.resolve(session["access_token"])
        self.assertIsNotNone(config, "Supabase JWKS not available")
        verified = verify_token(session["access_token"], config)
        self.assertIsInstance(verified, VerifiedToken)
        self.assertEqual(verified.subject, STAFF_AUTH_ID)   # = profiles.auth_user_id, what /v1/staff maps

    def test_login_route_hosted_branch_for_staff(self) -> None:
        ok = self.hosted(STAFF_EMAIL, "1234")
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual((ok.json()["role"], ok.json()["token_type"]), ("supervisor", "supabase"))
        self.assertTrue(ok.json()["refresh_token"])
        self.assertEqual(self.hosted(STAFF_EMAIL, "nope").status_code, 401)

    def test_a_resident_made_by_create_resident_login_can_sign_in_to_supabase(self) -> None:
        c = connect()
        c.execute("select public.create_resident_login(%s, 'correct horse', 'Hosted Resident', null)", (self.email,))
        c.commit()
        c.close()
        ok = self.hosted(self.email, "correct horse")
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertEqual((ok.json()["role"], ok.json()["token_type"]), ("resident", "supabase"))
        self.assertEqual(self.hosted(self.email, "wrong horse").status_code, 401)


if __name__ == "__main__":
    unittest.main()
