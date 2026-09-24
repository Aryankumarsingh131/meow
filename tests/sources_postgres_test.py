"""T07 against a REAL PostgreSQL server (Supabase).

Closes the blocker recorded in docs/agent-workflow/handoff-T07.md: the
`sources` migration and query layer had only ever been exercised on SQLite, so
the PostgreSQL dialect and the `?`->`%s` paramstyle adaptation were unverified.

This runs the SAME assertions as tests/sources_test.py's tenant-scoping and
search cases, against the real server.

**Skips cleanly when no database is configured.** It reads
`JALSAKSHI_DATABASE_URL` from the environment or `.env`; without it the test
is skipped rather than failed, so it never blocks a contributor who has no
database. It never prints the credential.

Everything it writes lives in a schema named `jalsakshi_test_t07` which is
dropped at the end, so it cannot touch real data.

Run:  python -m unittest tests.sources_postgres_test -v
"""

from __future__ import annotations

import os
import unittest
import uuid

from services.api.app.auth import Denied
from services.api.app.sources import InvalidCursor, QrMatched, QrUnknown, list_sources, resolve_qr, source_history
from services.api.migrations.source import statements
from tests.sources_test import session_for

TEST_SCHEMA = "jalsakshi_test_t07"

# The PostgreSQL schema declares `tenant_id` and `id` as real `uuid` columns
# (data-model.md). The SQLite suite gets away with friendly strings like
# "src-a1" only because the sqlite dialect maps uuid -> text, which accepts
# anything. Against the real server those values are rejected outright:
#
#     invalid input syntax for type uuid: "tenant-a-block-01"
#
# That divergence is invisible to a SQLite-only test run and is exactly why
# this suite exists. Stable uuid5 values are derived from the friendly names
# so the intent stays readable and the ids stay deterministic.
def uid(name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, "jalsakshi-t07-" + name))


TENANT_A = uid("tenant-a")
TENANT_B = uid("tenant-b")


def _database_url() -> str | None:
    url = os.environ.get("JALSAKSHI_DATABASE_URL")
    if url:
        return url
    try:
        with open(".env", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line.startswith("JALSAKSHI_DATABASE_URL="):
                    return line.split("=", 1)[1]
    except FileNotFoundError:
        return None
    return None


try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]

URL = _database_url()


@unittest.skipIf(psycopg is None, "psycopg not installed")
@unittest.skipIf(not URL, "JALSAKSHI_DATABASE_URL not configured")
class PostgresSourcesTests(unittest.TestCase):
    """Same behaviour as the SQLite suite, on the real server."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.conn = psycopg.connect(URL, connect_timeout=15)
        cls.conn.execute(f"DROP SCHEMA IF EXISTS {TEST_SCHEMA} CASCADE")
        cls.conn.execute(f"CREATE SCHEMA {TEST_SCHEMA}")
        cls.conn.execute(f"SET search_path TO {TEST_SCHEMA}")
        # The REAL migration, PostgreSQL dialect — not a hand-written schema.
        for statement in statements("postgresql"):
            cls.conn.execute(statement)
        cls.conn.commit()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.conn.rollback()
        cls.conn.execute(f"DROP SCHEMA IF EXISTS {TEST_SCHEMA} CASCADE")
        cls.conn.commit()
        cls.conn.close()

    def setUp(self) -> None:
        # PostgreSQL aborts the WHOLE transaction on any error, so a preceding
        # constraint-violation test leaves the connection unusable until it is
        # rolled back. SQLite does not behave this way - this is precisely the
        # class of difference only a real server exposes.
        self.conn.rollback()
        self.conn.execute(f"SET search_path TO {TEST_SCHEMA}")
        self.conn.execute("DELETE FROM sources")
        self.session_a = session_for(TENANT_A)
        self.session_b = session_for(TENANT_B)
        for tenant, sid, qr, label, locality, active in [
            (TENANT_A, uid("src-a1"), "JS-A-0001", "Handpump 1", "Sundarpur", True),
            (TENANT_A, uid("src-a2"), "JS-A-0002", "Handpump 2", "Sundarpur", True),
            (TENANT_A, uid("src-a3"), "JS-A-0003", "Well North", "Rampur", True),
            (TENANT_A, uid("src-a4"), "JS-A-0004", "Retired pump", "Rampur", False),
            (TENANT_B, uid("src-b1"), "JS-B-0001", "Handpump 1", "Otherville", True),
        ]:
            self.conn.execute(
                "INSERT INTO sources (tenant_id, id, qr_code, label, locality,"
                " latitude, longitude, accuracy_m, active, version)"
                " VALUES (%s,%s,%s,%s,%s,NULL,NULL,NULL,%s,1)",
                (tenant, sid, qr, label, locality, active),
            )
        self.conn.commit()

    # --- the migration itself -------------------------------------------

    def test_migration_created_the_table_on_postgres(self) -> None:
        row = self.conn.execute(
            "SELECT count(*) FROM information_schema.tables"
            " WHERE table_schema = %s AND table_name = 'sources'",
            (TEST_SCHEMA,),
        ).fetchone()
        self.assertEqual(row[0], 1)

    def test_check_constraints_are_enforced_by_postgres(self) -> None:
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.conn.execute(
                "INSERT INTO sources (tenant_id, id, qr_code, label, locality,"
                " latitude, longitude, accuracy_m, active, version)"
                " VALUES (%s,%s,'q','l','loc',999,0,NULL,true,1)", (TENANT_A, uid("bad1"))
            )
        self.conn.rollback()

    def test_paired_coordinate_constraint_on_postgres(self) -> None:
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.conn.execute(
                "INSERT INTO sources (tenant_id, id, qr_code, label, locality,"
                " latitude, longitude, accuracy_m, active, version)"
                " VALUES (%s,%s,'q2','l','loc',25.0,NULL,NULL,true,1)", (TENANT_A, uid("bad2"))
            )
        self.conn.rollback()

    def test_qr_unique_per_tenant_not_globally(self) -> None:
        # Same QR in another tenant is legal.
        self.conn.execute(
            "INSERT INTO sources (tenant_id, id, qr_code, label, locality,"
            " latitude, longitude, accuracy_m, active, version)"
            " VALUES (%s,%s,'JS-A-0001','Same QR','Otherville',NULL,NULL,NULL,true,1)",
            (TENANT_B, uid("src-b9")),
        )
        self.conn.commit()
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.conn.execute(
                "INSERT INTO sources (tenant_id, id, qr_code, label, locality,"
                " latitude, longitude, accuracy_m, active, version)"
                " VALUES (%s,%s,'JS-A-0001','Dup','Sundarpur',NULL,NULL,NULL,true,1)",
                (TENANT_A, uid("src-a9")),
            )
        self.conn.rollback()

    # --- the query layer, i.e. the paramstyle adaptation ------------------

    def test_list_is_tenant_scoped_on_postgres(self) -> None:
        # Ordering is by (label, id); compare as a set of the expected ids.
        page = list_sources(self.conn, self.session_a)
        self.assertEqual([s.id for s in page.items], [uid(n) for n in ["src-a1", "src-a2", "src-a3"]])
        for item in page.items:
            self.assertEqual(item.tenant_id, TENANT_A)

    def test_other_tenant_sees_only_its_own(self) -> None:
        page = list_sources(self.conn, self.session_b)
        self.assertEqual([s.id for s in page.items], [uid("src-b1")])

    def test_inactive_hidden_from_field_catalogue(self) -> None:
        # Proves `active = true` is valid PostgreSQL, not just SQLite.
        ids = [s.id for s in list_sources(self.conn, self.session_a).items]
        self.assertNotIn(uid("src-a4"), ids)

    def test_search_and_like_escaping_on_postgres(self) -> None:
        self.assertEqual(
            [s.id for s in list_sources(self.conn, self.session_a, q="Rampur").items],
            [uid("src-a3")],
        )
        # `%` must be a literal, not a wildcard matching the whole tenant.
        self.assertEqual(list_sources(self.conn, self.session_a, q="%").items, ())
        self.assertEqual(list_sources(self.conn, self.session_a, q="_").items, ())

    def test_sql_injection_is_inert_on_postgres(self) -> None:
        for payload in ("'; DROP TABLE sources; --", "' OR '1'='1"):
            with self.subTest(payload=payload):
                self.assertEqual(list_sources(self.conn, self.session_a, q=payload).items, ())
        # Table survived.
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM sources").fetchone()[0], 5
        )

    def test_keyset_paging_on_postgres(self) -> None:
        # Row-value comparison `(label, id) > (?, ?)` must work on PostgreSQL.
        seen: list[str] = []
        cursor = None
        for _ in range(10):
            page = list_sources(self.conn, self.session_a, limit=1, cursor=cursor)
            seen.extend(s.id for s in page.items)
            cursor = page.next_cursor
            if cursor is None:
                break
        self.assertEqual(sorted(seen), sorted(uid(n) for n in ["src-a1","src-a2","src-a3"]))
        self.assertEqual(len(seen), len(set(seen)))

    def test_qr_resolution_is_tenant_scoped_on_postgres(self) -> None:
        self.assertIsInstance(resolve_qr(self.conn, self.session_a, "JS-A-0001"), QrMatched)
        # Tenant B's QR must be unknown to tenant A.
        self.assertIsInstance(resolve_qr(self.conn, self.session_a, "JS-B-0001"), QrUnknown)
        # Deactivated source resolves unknown, not matched.
        self.assertIsInstance(resolve_qr(self.conn, self.session_a, "JS-A-0004"), QrUnknown)

    def test_cross_tenant_history_is_not_found_on_postgres(self) -> None:
        # `samples` is T13's table and does not exist; the parent-object check
        # must still refuse before any child read is attempted.
        outcome = source_history(
            self.conn, self.session_a, uid("src-b1"), served_at="2026-09-22T00:00:00Z"
        )
        assert isinstance(outcome, Denied)
        self.assertEqual((outcome.code, outcome.status), ("NOT_FOUND", 404))

    # --- client-controlled ids that are not uuids (M1 review, 2026-09-24) ---
    # A path id or a cursor comes from the caller. SQLite stores uuid as text
    # and accepts anything; PostgreSQL raises on `id = 'abc'`, which an HTTP
    # route would surface as a 500 and which aborts the transaction.

    def test_malformed_history_id_is_not_found_on_postgres(self) -> None:
        for bad in ("abc", "src-a1", "'; DROP TABLE sources; --", ""):
            with self.subTest(bad=bad):
                outcome = source_history(
                    self.conn, self.session_a, bad, served_at="2026-09-22T00:00:00Z"
                )
                assert isinstance(outcome, Denied), outcome
                self.assertEqual((outcome.code, outcome.status), ("NOT_FOUND", 404))

    def test_tampered_list_cursor_is_safe_on_postgres(self) -> None:
        from services.api.app.sources import _encode_cursor
        forged = _encode_cursor("Handpump 1", "not-a-uuid")
        # Rejected as a 422-class outcome, not a database error.
        self.assertIsInstance(list_sources(self.conn, self.session_a, cursor=forged), InvalidCursor)


if __name__ == "__main__":
    unittest.main()
