"""Public v2 database contracts against the REAL Supabase PostgreSQL.

Covers 002 + 006: Data API lockdown (grants, RLS, real anon and
authenticated roles), resident accounts and row-level isolation, the
rule-based reading assessment, the field-worker points rule, retention purge,
map fuzzing.

Every test runs inside a transaction that is rolled back. Skips cleanly
without JALSAKSHI_DATABASE_URL (env or .env).

    python -m unittest tests.public_v2_postgres_test -v
"""

from __future__ import annotations

import json
import os
import unittest
import uuid

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]


def _database_url() -> str | None:
    url = os.environ.get("JALSAKSHI_DATABASE_URL")
    if url:
        return url
    try:
        with open(".env", encoding="utf-8") as handle:
            for line in handle:
                if line.startswith("JALSAKSHI_DATABASE_URL="):
                    return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        return None
    return None


URL = _database_url()
STAFF_PROFILE = "da8334ff-a77a-5e9a-9083-4354340dbe97"   # demo supervisor (North Valley)
EAST_WORKER = "2d9cf24d-1775-5653-93bb-6bda813c9741"
EAST_SUP = "b1dd56bc-fe96-5352-99e6-0f1b5ff5d2ca"
EAST_PUMP = "b6e646c2-45e0-504e-9f12-44c1ac18bb15"
CHLORINE_KIT = "6ecff65c-ff32-5141-83dd-9b51f9953ba2"   # 30 s wait, 60 s grace, measures chlorine


def connect():
    conn = psycopg.connect(URL, connect_timeout=45)
    conn.execute("set statement_timeout = '30s'")
    return conn


def new_resident(conn, suffix: str, phone: str | None = None) -> tuple[str, str]:
    """(resident id, auth user id) - the same uuid, as create_resident_login makes it."""
    rid = conn.execute("select public.create_resident_login(%s, 'correct horse', 'Test Resident', %s)",
                       (f"test.resident.{suffix}@example.org", phone)).fetchone()[0]
    return str(rid), str(rid)


def as_authenticated(conn, auth_uid: str) -> None:
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claims', %s, true)",
                 (json.dumps({"sub": auth_uid, "role": "authenticated"}),))


def screening(conn, elapsed: float | None, *, photo: bool = True, reading: bool = True,
              performer: str = EAST_WORKER) -> str:
    """A chlorine-kit test record read `elapsed` seconds after the dip; fires
    the deferred points trigger before returning."""
    tid = str(conn.execute(
        "insert into public.test_records (source_id, performed_by, kit_id, method, raw_input, computed_risk_level,"
        " local_record_id, photo_url, dip_started_at, read_at) values (%s, %s, %s, 'manual', '{}', 'low',"
        " gen_random_uuid(), %s, now() - make_interval(secs => %s), now()) returning id",
        (EAST_PUMP, performer, CHLORINE_KIT, "blob:test" if photo else None, elapsed or 0)).fetchone()[0])
    if elapsed is None:
        conn.execute("update public.test_records set dip_started_at = null, read_at = null where id = %s", (tid,))
    if reading:
        conn.execute("insert into public.test_readings (test_record_id, parameter, value) values (%s, 'chlorine', 0.5)",
                     (tid,))
    conn.execute("set constraints all immediate")
    conn.execute("set constraints all deferred")
    return tid


@unittest.skipIf(psycopg is None or not URL, "JALSAKSHI_DATABASE_URL not configured")
class PublicV2Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.conn = connect()

    def tearDown(self) -> None:
        self.conn.rollback()
        self.conn.close()

    def one(self, sql: str, *args):
        return self.conn.execute(sql, args).fetchone()

    def refused(self, error, sql: str, *args) -> None:
        self.conn.execute("savepoint s")
        try:
            with self.assertRaises(error):
                self.conn.execute(sql, args)
        finally:
            self.conn.execute("rollback to savepoint s")

    # --- Data API lockdown ---------------------------------------------------

    def test_only_resident_safe_columns_are_granted(self) -> None:
        # PostGIS's own catalogue objects are owned by supabase_admin and are
        # the only other exception (recorded as a blocker in current-state).
        tables = self.conn.execute(
            "select distinct table_name, grantee from information_schema.role_table_grants"
            " where table_schema = 'public' and grantee in ('anon', 'authenticated')"
            " and table_name not in ('spatial_ref_sys', 'geometry_columns', 'geography_columns')").fetchall()
        self.assertEqual(tables, [])   # no table-wide grant at all
        columns = self.conn.execute(
            "select table_name, grantee, privilege_type, string_agg(column_name, ',' order by column_name)"
            " from information_schema.column_privileges where table_schema = 'public'"
            " and grantee in ('anon', 'authenticated')"
            " and table_name not in ('spatial_ref_sys', 'geometry_columns', 'geography_columns')"
            " group by 1, 2, 3 order by 1").fetchall()
        self.assertEqual(columns, [
            ("complaints", "authenticated", "SELECT",
             "complaint_type,details,id,linked_at,reference_number,resolution,source_id,status,submitted_at"),
            ("residents", "authenticated", "SELECT", "created_at,email,full_name,id,phone"),
        ])

    def test_real_anon_role_cannot_read_tables_views_or_call_functions(self) -> None:
        for sql in ("select * from residents", "select * from profiles", "select id from complaints",
                    "select * from public_map_view", "select * from test_readings",
                    "select create_resident_login('x@example.org', 'long enough', null, null)",
                    "select assess_readings('{}')", "select purge_old_data()"):
            with self.subTest(sql=sql):
                self.conn.execute("savepoint s")
                self.conn.execute("set local role anon")
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.conn.execute(sql)
                self.conn.execute("rollback to savepoint s")

    def test_rls_enabled_on_every_table(self) -> None:
        missing = self.conn.execute(
            "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'"
            " and not relrowsecurity and relname <> 'spatial_ref_sys'").fetchall()
        self.assertEqual(missing, [])

    def test_every_jalsakshi_function_pins_search_path(self) -> None:
        # Definer functions for safety; trigger functions because they run with
        # the caller's path, and the API connects with search_path=jalsakshi.
        unpinned = self.conn.execute(
            "select proname from pg_proc p where pronamespace = 'public'::regnamespace"
            " and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')"  # not PostGIS's own
            " and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')").fetchall()
        self.assertEqual(unpinned, [])

    def test_profiles_are_staff_only(self) -> None:
        self.refused(psycopg.errors.CheckViolation,
                     "insert into profiles (auth_user_id, role, email) values (%s, 'public', 'x@example.org')",
                     STAFF_PROFILE)
        self.assertEqual(self.one("select count(*) from profiles where role not in ('supervisor', 'field_worker')")[0], 0)
        self.assertIsNone(self.one("select to_regclass('public.public_accounts')")[0])

    # --- residents -------------------------------------------------------------

    def test_create_resident_login_makes_an_auth_user_and_a_residents_row(self) -> None:
        rid, auth_uid = new_resident(self.conn, "0001", "+919999900001")
        self.assertEqual(self.one("select email, phone, active from residents where id = %s", rid),
                         ("test.resident.0001@example.org", "+919999900001", True))
        self.assertEqual(self.one("select count(*) from auth.identities where user_id = %s and provider = 'email'",
                                  auth_uid)[0], 1)
        self.assertIsNone(self.one("select 1 from profiles where auth_user_id = %s", auth_uid))
        self.refused(psycopg.errors.RaiseException,
                     "select create_resident_login('TEST.resident.0001@example.org', 'another one', null, null)")
        self.refused(psycopg.errors.RaiseException, "select create_resident_login('short@example.org', 'short', null, null)")
        self.refused(psycopg.errors.CheckViolation,
                     "select create_resident_login('badphone@example.org', 'long enough', null, '98123')")

    def test_a_resident_sees_only_their_own_rows_and_columns(self) -> None:
        a, a_uid = new_resident(self.conn, "0002")
        b, _ = new_resident(self.conn, "0003")
        for who in (a, a, b):
            self.conn.execute("insert into complaints (resident_id, source_id, complaint_type) values (%s, %s, 'smell')",
                              (who, EAST_PUMP))
        as_authenticated(self.conn, a_uid)
        self.assertEqual(self.one("select count(*), count(*) filter (where status = 'new') from complaints"), (2, 2))
        self.assertEqual(self.one("select count(*), min(email) from residents"), (1, "test.resident.0002@example.org"))
        for sql in ("select linked_report_id from complaints", "select resident_id from complaints",
                    "select photo_url from complaints", "select auth_user_id from residents",
                    "select * from reports", "select * from lab_referrals", "select * from test_records",
                    "select * from audit_log", "select * from profiles"):
            with self.subTest(sql=sql):
                self.refused(psycopg.errors.InsufficientPrivilege, sql)

    def test_staff_tokens_see_no_resident_rows(self) -> None:
        new_resident(self.conn, "0004")
        as_authenticated(self.conn, STAFF_PROFILE)   # staff auth id = profile id in the demo data
        self.assertEqual(self.one("select count(*) from complaints")[0], 0)
        self.assertEqual(self.one("select count(*) from residents")[0], 0)

    def test_inactive_resident_sees_nothing(self) -> None:
        rid, uid = new_resident(self.conn, "0005")
        self.conn.execute("insert into complaints (resident_id, complaint_type) values (%s, 'taste')", (rid,))
        self.conn.execute("update residents set active = false where id = %s", (rid,))
        as_authenticated(self.conn, uid)
        self.assertEqual(self.one("select count(*) from complaints")[0], 0)

    def test_complaint_status_rules(self) -> None:
        rid, _ = new_resident(self.conn, "0006")
        cid = self.one("insert into complaints (resident_id, complaint_type) values (%s, 'taste') returning id", rid)[0]
        self.assertRegex(self.one("select reference_number from complaints where id = %s", cid)[0], r"^JS-[0-9A-F]{10}$")
        for sql in ("update complaints set status = 'linked' where id = %s",            # linked without a report
                    "update complaints set status = 'resolved' where id = %s",          # resolved without a resolution
                    "update complaints set resolution = 'dismissed' where id = %s",     # resolution while new
                    "update complaints set status = 'escalated' where id = %s"):
            with self.subTest(sql=sql):
                self.refused(psycopg.errors.CheckViolation, sql, cid)
        self.conn.execute("update complaints set status = 'resolved', resolution = 'dismissed' where id = %s", (cid,))
        self.assertEqual(self.one("select version from complaints where id = %s", cid)[0], 2)
        self.refused(psycopg.errors.NotNullViolation, "insert into complaints (complaint_type) values ('taste')")

    # --- rule-based assessment ---------------------------------------------------

    def test_assess_readings_bands(self) -> None:
        cases = {'{"ph": 7.2}': "low", '{"ph": 6.0}': "medium", '{"ph": 4.0}': "high",
                 '{"chlorine": 0.5, "tds": 300}': "low", '{"chlorine": 0.0}': "medium", '{"chlorine": 5}': "high",
                 '{"tds": 1200}': "medium", '{"coliform": 0}': "low", '{"coliform": 1}': "high",
                 '{"iron": 0.3, "ph": 7}': "low", '{"iron": 0.31}': "medium", '{}': "unknown"}
        for readings, level in cases.items():
            with self.subTest(readings=readings):
                self.assertEqual(self.one("select assess_readings(%s)->>'risk_level'", readings)[0], level)
        findings = self.one("select assess_readings('{\"ph\": 6.0, \"tds\": 100, \"unknown_key\": 3}')->'findings'")[0]
        self.assertEqual(findings, [{"parameter": "ph", "value": 6.0, "level": "medium"},
                                    {"parameter": "tds", "value": 100, "level": "low"}])

    def test_every_active_kit_has_parameters(self) -> None:
        self.assertEqual(self.one("select count(*) from test_kits k where k.active and not exists"
                                  " (select 1 from kit_parameters kp where kp.kit_id = k.id)")[0], 0)

    # --- points: field workers, one ledger ----------------------------------------

    def ledger_for(self, record: str) -> int:
        return self.one("select count(*) from points_ledger where related_test_record_id = %s", record)[0]

    def test_on_time_complete_screening_pays_once(self) -> None:
        before = self.one("select points_balance from profiles where id = %s", EAST_WORKER)[0]
        record = screening(self.conn, 45)
        self.assertEqual(self.one("select points, reason from points_ledger where related_test_record_id = %s", record),
                         (10, "screening_on_time"))
        self.assertEqual(self.one("select points_balance from profiles where id = %s", EAST_WORKER)[0], before + 10)
        self.refused(psycopg.errors.UniqueViolation,
                     "insert into points_ledger (profile_id, points, reason, related_test_record_id)"
                     " values (%s, 10, 'screening_on_time', %s)", EAST_WORKER, record)

    def test_screenings_that_do_not_qualify(self) -> None:
        for label, record in (("read too early", screening(self.conn, 20)),
                              ("read after the grace period", screening(self.conn, 95)),
                              ("no photo", screening(self.conn, 45, photo=False)),
                              ("a kit reading missing", screening(self.conn, 45, reading=False)),
                              ("no dip timing", screening(self.conn, None)),
                              ("a supervisor, not a field worker", screening(self.conn, 45, performer=EAST_SUP))):
            with self.subTest(case=label):
                self.assertEqual(self.ledger_for(record), 0)

    def test_window_edges_are_inclusive(self) -> None:
        self.assertEqual(self.ledger_for(screening(self.conn, 30)), 1)
        self.assertEqual(self.ledger_for(screening(self.conn, 89.5)), 1)

    def test_only_worker_reasons_and_no_negative_balance(self) -> None:
        self.refused(psycopg.errors.CheckViolation,
                     "insert into points_ledger (profile_id, points, reason) values (%s, 10, 'complaint_submitted')",
                     EAST_WORKER)
        self.refused(psycopg.errors.CheckViolation,
                     "insert into points_ledger (profile_id, points, reason) values (%s, -100000, 'manual_adjustment')",
                     EAST_WORKER)
        for gone in ("sponsors", "sponsor_rewards", "reward_redemptions"):
            self.assertIsNone(self.one("select to_regclass(%s)", f"public.{gone}")[0])

    # --- retention -------------------------------------------------------------

    def test_purge_skips_evidence_chain_and_completes(self) -> None:
        old = "now() - interval '4 years'"
        referenced, loose, earned = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        for tid in (referenced, loose, earned):
            self.conn.execute(
                f"insert into test_records (id, source_id, performed_by, kit_id, method, local_record_id, synced_at, created_at)"
                f" values (%s, %s, %s, %s, 'manual', %s, {old}, {old})", (tid, EAST_PUMP, EAST_WORKER, CHLORINE_KIT, uuid.uuid4()))
        self.conn.execute("insert into reports (source_id, test_record_id, risk_level) values (%s, %s, 'low')",
                          (EAST_PUMP, referenced))
        self.conn.execute("insert into points_ledger (profile_id, points, reason, related_test_record_id)"
                          " values (%s, 10, 'screening_on_time', %s)", (EAST_WORKER, earned))
        self.conn.execute(f"insert into notifications (channel, message, sent_at) values ('sms', 'old', {old})")
        counts = "select (select count(*) from reports), (select count(*) from lab_referrals), (select count(*) from complaints)"
        before = self.one(counts)

        self.conn.execute("select purge_old_data()")

        self.assertIsNotNone(self.one("select 1 from test_records where id = %s", referenced))
        self.assertIsNotNone(self.one("select 1 from test_records where id = %s", earned))
        self.assertIsNone(self.one("select 1 from test_records where id = %s", loose))
        self.assertEqual(self.one("select count(*) from notifications where message = 'old'")[0], 0)
        self.assertEqual(self.one(counts), before)

    def test_no_retention_policy_for_evidence_chain_tables(self) -> None:
        self.assertEqual(self.conn.execute(
            "select entity_table from retention_policies"
            " where entity_table in ('reports', 'lab_referrals', 'complaints')").fetchall(), [])

    def test_cron_jobs_scheduled(self) -> None:
        jobs = dict(self.conn.execute("select jobname, schedule from cron.job").fetchall())
        self.assertEqual(jobs.get("nightly-data-purge"), "0 2 * * *")
        self.assertEqual(jobs.get("refresh-public-map"), "*/15 * * * *")

    # --- map -------------------------------------------------------------------

    def test_map_fuzzes_everything_not_lab_verified(self) -> None:
        rows = self.conn.execute(
            "select v.status_label, st_x(v.public_location::geometry), st_y(v.public_location::geometry),"
            " st_x(ws.location::geometry), st_y(ws.location::geometry)"
            " from public_map_view v join water_sources ws on ws.id = v.source_id").fetchall()
        self.assertTrue(rows)
        for status, px, py, x, y in rows:
            if status == "lab_verified_safe":
                self.assertEqual((px, py), (x, y))
            else:
                self.assertAlmostEqual(px / 0.005, round(px / 0.005), places=6)
                self.assertAlmostEqual(py / 0.005, round(py / 0.005), places=6)


if __name__ == "__main__":
    unittest.main()
