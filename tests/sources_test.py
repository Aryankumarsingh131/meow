"""T07 verification: tenant-scoped source catalogue, QR resolution, history.

Runs against a real SQLite database created by the real T07 migration - the
DDL under test is the DDL that is applied, not a hand-written test schema.

**PostgreSQL has never been run against**: no server and no psycopg driver
exist in this environment. See the limitation note in
services/api/app/sources.py and docs/agent-workflow/handoff-T07.md.

The `samples` fixture table here is a stand-in for T13's migration, which does
not exist yet. It is a test fixture, not a schema claim by T07.

Run:  python -m unittest tests.sources_test -v
"""

from __future__ import annotations

import sqlite3
import unittest
import uuid

from services.api.app.auth import Denied, Membership, Session, VerifiedToken
from services.api.app.sources import (
    MAX_LIMIT,
    InvalidCursor,
    MAX_SEARCH_LENGTH,
    QrMalformed,
    QrMatched,
    QrUnknown,
    list_sources,
    parse_qr_payload,
    resolve_qr,
    source_history,
)
from services.api.migrations.source import apply_sqlite, statements

def uid(name: str) -> str:
    """Stable uuid for a readable fixture name.

    The PostgreSQL schema declares ids as `uuid`; SQLite stores them as text
    and would accept anything. Fixtures use real uuids so this suite cannot
    pass on ids the target database rejects (see sources_postgres_test.py,
    which derives ids the same way).
    """
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, "jalsakshi-t07-" + name))


TENANT_A = uid("tenant-a")
TENANT_B = uid("tenant-b")

# Stand-in for T13's `samples` migration. Columns match
# sources.SAMPLES_COLUMNS_EXPECTED.
_SAMPLES_FIXTURE = """
CREATE TABLE samples (
    tenant_id text NOT NULL,
    id text NOT NULL,
    source_id text NOT NULL,
    received_at_server text NOT NULL,
    status text NOT NULL,
    method text NOT NULL,
    indicative_flag text NOT NULL,
    PRIMARY KEY (tenant_id, id)
)
"""


def session_for(tenant_id: str, user_id: str = "user-1", role: str = "worker") -> Session:
    token = VerifiedToken(
        subject=user_id,
        issuer="https://idp.test.jalsakshi.invalid/realms/jalsakshi",
        audience="jalsakshi-api",
        expires_at=0,
        claims={},
    )
    return Session(token=token, membership=Membership(user_id, tenant_id, role, active=True))


class SourcesTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        apply_sqlite(self.db)
        self.db.execute(_SAMPLES_FIXTURE)
        self.session_a = session_for(TENANT_A)
        self.session_b = session_for(TENANT_B)
        self._seed()

    def tearDown(self) -> None:
        self.db.close()

    def add_source(
        self,
        tenant_id: str,
        source_id: str,
        qr_code: str,
        label: str,
        locality: str = "Sundarpur",
        active: bool = True,
        latitude: float | None = None,
        longitude: float | None = None,
    ) -> None:
        self.db.execute(
            "INSERT INTO sources (tenant_id, id, qr_code, label, locality, latitude, longitude,"
            " accuracy_m, active, version) VALUES (?,?,?,?,?,?,?,?,?,1)",
            (tenant_id, source_id, qr_code, label, locality, latitude, longitude, None, active),
        )
        self.db.commit()

    def _seed(self) -> None:
        self.add_source(TENANT_A, uid("src-a1"), "JS-A-0001", "Handpump 1", "Sundarpur")
        self.add_source(TENANT_A, uid("src-a2"), "JS-A-0002", "Handpump 2", "Sundarpur")
        self.add_source(TENANT_A, uid("src-a3"), "JS-A-0003", "Well North", "Rampur")
        self.add_source(TENANT_A, uid("src-a4"), "JS-A-0004", "Retired pump", "Rampur", active=False)
        # Tenant B deliberately reuses a label and shares nothing with A.
        self.add_source(TENANT_B, uid("src-b1"), "JS-B-0001", "Handpump 1", "Otherville")


class TestTenantScoping(SourcesTestBase):
    """Acceptance criterion 2: tenant-scoped sources."""

    def test_list_returns_only_own_tenant(self) -> None:
        page = list_sources(self.db, self.session_a)
        self.assertTrue(page.items)
        for item in page.items:
            self.assertEqual(item.tenant_id, TENANT_A)

    def test_tenant_b_sees_only_its_own_single_source(self) -> None:
        page = list_sources(self.db, self.session_b)
        self.assertEqual([s.id for s in page.items], [uid("src-b1")])

    def test_identical_labels_across_tenants_do_not_bleed(self) -> None:
        a = list_sources(self.db, self.session_a, q="Handpump 1")
        b = list_sources(self.db, self.session_b, q="Handpump 1")
        self.assertEqual([s.id for s in a.items], [uid("src-a1")])
        self.assertEqual([s.id for s in b.items], [uid("src-b1")])

    def test_qr_of_other_tenant_is_unknown_not_matched(self) -> None:
        """Tenant A scanning tenant B's QR must learn nothing about it."""
        result = resolve_qr(self.db, self.session_a, "JS-B-0001")
        self.assertIsInstance(result, QrUnknown)

    def test_other_tenant_qr_is_indistinguishable_from_nonexistent(self) -> None:
        """Both outcomes must be the same shape carrying the same fields.

        The echoed `token` is the worker's own scan (already allowlisted to
        alphanumerics, so it cannot be a URL or script) and is needed to show
        "JS-B-0001 is not in your catalogue". What must NOT differ is anything
        derived from the database - otherwise scanning becomes an oracle for
        which QR codes exist in other tenants.
        """
        other = resolve_qr(self.db, self.session_a, "JS-B-0001")
        nothing = resolve_qr(self.db, self.session_a, "JS-Z-9999")
        self.assertIs(type(other), type(nothing))
        assert isinstance(other, QrUnknown) and isinstance(nothing, QrUnknown)
        # The only field is the caller's own input, echoed verbatim.
        self.assertEqual(other.token, "JS-B-0001")
        self.assertEqual(nothing.token, "JS-Z-9999")
        self.assertEqual(set(vars(other)), set(vars(nothing)))
        self.assertEqual(set(vars(other)), {"token"})

    def test_history_of_other_tenant_source_is_not_found(self) -> None:
        outcome = source_history(self.db, self.session_a, uid("src-b1"), served_at="2026-09-22T00:00:00Z")
        assert isinstance(outcome, Denied)
        self.assertEqual((outcome.code, outcome.status), ("NOT_FOUND", 404))

    def test_history_cross_tenant_matches_nonexistent_exactly(self) -> None:
        other = source_history(self.db, self.session_a, uid("src-b1"), served_at="2026-09-22T00:00:00Z")
        nothing = source_history(self.db, self.session_a, uid("src-zzz"), served_at="2026-09-22T00:00:00Z")
        self.assertEqual(other, nothing)

    def test_inactive_source_hidden_from_field_catalogue(self) -> None:
        ids = [s.id for s in list_sources(self.db, self.session_a).items]
        self.assertNotIn(uid("src-a4"), ids)

    def test_deactivated_qr_resolves_unknown_not_matched(self) -> None:
        self.assertIsInstance(resolve_qr(self.db, self.session_a, "JS-A-0004"), QrUnknown)


class TestUnknownQrIsSafe(SourcesTestBase):
    """Acceptance criterion 1: unknown QR safe (AC-001 - never navigates)."""

    def test_url_payloads_are_malformed_never_matched(self) -> None:
        hostile = [
            "https://evil.example/pwn",
            "http://10.0.0.1/admin",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "jalsakshi://auth?code=stolen",
            "intent://scan/#Intent;scheme=http;end",
            "data:text/html;base64,PHNjcmlwdD4=",
            "//evil.example",
        ]
        for payload in hostile:
            with self.subTest(payload=payload):
                result = parse_qr_payload(payload)
                assert isinstance(result, QrMalformed), f"{payload!r} was accepted as a token"
                self.assertEqual(result.reason, "illegal_characters")

    def test_malformed_result_never_carries_the_payload(self) -> None:
        """A hostile payload must not be echoed anywhere it could be rendered
        or logged."""
        payload = "https://evil.example/<script>alert(1)</script>"
        result = parse_qr_payload(payload)
        assert isinstance(result, QrMalformed)
        self.assertNotIn("evil.example", repr(result))
        self.assertNotIn("script", repr(result))

    def test_empty_and_whitespace_payloads(self) -> None:
        for payload in (None, "", "   ", "\n\t"):
            with self.subTest(payload=payload):
                result = parse_qr_payload(payload)
                assert isinstance(result, QrMalformed)
                self.assertEqual(result.reason, "empty")

    def test_oversized_payload_rejected_by_length_first(self) -> None:
        result = parse_qr_payload("A" * 5000)
        assert isinstance(result, QrMalformed)
        self.assertEqual(result.reason, "too_long")

    def test_sql_injection_in_qr_payload_is_rejected_and_harmless(self) -> None:
        result = resolve_qr(self.db, self.session_a, "JS-A-0001'; DROP TABLE sources; --")
        self.assertIsInstance(result, QrMalformed)
        # The table is still there and still populated.
        remaining = self.db.execute("SELECT count(*) FROM sources").fetchone()[0]
        self.assertEqual(remaining, 5)

    def test_valid_qr_matches_within_tenant(self) -> None:
        result = resolve_qr(self.db, self.session_a, "JS-A-0001")
        assert isinstance(result, QrMatched)
        self.assertEqual(result.source.id, uid("src-a1"))

    def test_surrounding_whitespace_is_tolerated(self) -> None:
        self.assertIsInstance(resolve_qr(self.db, self.session_a, "  JS-A-0001\n"), QrMatched)

    def test_unknown_token_is_typed_not_none(self) -> None:
        """`None` would let a caller fall through to a generic error path and
        lose the difference between 'not ours' and 'not a code'."""
        result = resolve_qr(self.db, self.session_a, "JS-A-9999")
        assert isinstance(result, QrUnknown)
        self.assertEqual(result.token, "JS-A-9999")


class TestSearch(SourcesTestBase):
    def test_search_matches_label_and_locality(self) -> None:
        by_label = list_sources(self.db, self.session_a, q="Well")
        self.assertEqual([s.id for s in by_label.items], [uid("src-a3")])
        by_locality = list_sources(self.db, self.session_a, q="Rampur")
        self.assertEqual([s.id for s in by_locality.items], [uid("src-a3")])

    def test_like_wildcards_are_escaped_not_honoured(self) -> None:
        """A worker typing `%` searches for a literal percent sign. Unescaped,
        it would match the entire tenant catalogue."""
        self.assertEqual(list_sources(self.db, self.session_a, q="%").items, ())
        self.assertEqual(list_sources(self.db, self.session_a, q="_").items, ())

    def test_underscore_does_not_act_as_single_character_wildcard(self) -> None:
        self.add_source(TENANT_A, uid("src-a5"), "JS-A-0005", "Tank_1", "Sundarpur")
        hits = [s.id for s in list_sources(self.db, self.session_a, q="Tank_1").items]
        self.assertEqual(hits, [uid("src-a5")])
        self.assertEqual(list_sources(self.db, self.session_a, q="TankX1").items, ())

    def test_sql_injection_in_search_is_inert(self) -> None:
        for payload in ("'; DROP TABLE sources; --", "' OR '1'='1", "\\"):
            with self.subTest(payload=payload):
                page = list_sources(self.db, self.session_a, q=payload)
                self.assertEqual(page.items, ())
        self.assertEqual(self.db.execute("SELECT count(*) FROM sources").fetchone()[0], 5)

    def test_search_term_is_length_bounded(self) -> None:
        """Assert the truncation is *observable*, not just that a silly query
        returns nothing - which would be true with or without the bound.

        A 60-character label with a 70-character query matches only if the
        term was actually cut to MAX_SEARCH_LENGTH (60) before hitting the
        database. Unbounded, the 70-character pattern cannot fit inside a
        60-character label and would return nothing.
        """
        label = "A" * MAX_SEARCH_LENGTH
        self.add_source(TENANT_A, uid("src-long-label"), "JS-A-0100", label, "Sundarpur")
        page = list_sources(self.db, self.session_a, q="A" * (MAX_SEARCH_LENGTH + 10))
        self.assertEqual([s.id for s in page.items], [uid("src-long-label")])

    def test_oversized_search_cannot_exhaust_the_database(self) -> None:
        page = list_sources(self.db, self.session_a, q="x" * 10_000)
        self.assertEqual(page.items, ())

    def test_blank_search_is_treated_as_no_filter(self) -> None:
        self.assertEqual(len(list_sources(self.db, self.session_a, q="   ").items), 3)


class TestPaging(SourcesTestBase):
    def test_limit_is_clamped_to_maximum(self) -> None:
        page = list_sources(self.db, self.session_a, limit=10_000)
        self.assertLessEqual(len(page.items), MAX_LIMIT)

    def test_limit_below_one_still_returns_a_page(self) -> None:
        self.assertEqual(len(list_sources(self.db, self.session_a, limit=0).items), 1)
        self.assertEqual(len(list_sources(self.db, self.session_a, limit=-5).items), 1)

    def test_keyset_paging_covers_every_row_exactly_once(self) -> None:
        seen: list[str] = []
        cursor = None
        for _ in range(10):
            page = list_sources(self.db, self.session_a, limit=1, cursor=cursor)
            seen.extend(s.id for s in page.items)
            cursor = page.next_cursor
            if cursor is None:
                break
        self.assertEqual(sorted(seen), sorted(uid(n) for n in ["src-a1", "src-a2", "src-a3"]))
        self.assertEqual(len(seen), len(set(seen)), "a row was returned twice")

    def test_last_page_has_no_next_cursor(self) -> None:
        self.assertIsNone(list_sources(self.db, self.session_a, limit=50).next_cursor)

    def test_malformed_cursor_is_a_validation_error(self) -> None:
        # api-contracts.md: "Invalid filters/cursors return 422". Silently
        # restarting at page one would make a paging client loop forever.
        for bad in ("not-base64!!", "", "eyJhIjoxfQ==", "YWJj"):
            with self.subTest(cursor=bad):
                self.assertIsInstance(list_sources(self.db, self.session_a, cursor=bad), InvalidCursor)

    def test_malformed_history_cursor_is_a_validation_error(self) -> None:
        outcome = source_history(self.db, self.session_a, uid("src-a1"),
                                 served_at="2026-09-22T00:00:00Z", cursor="YWJj")
        self.assertIsInstance(outcome, InvalidCursor)

    def test_history_checks_the_source_before_the_cursor(self) -> None:
        # Another tenant's id with a junk cursor must still be NOT_FOUND:
        # a 422 would confirm the id passed the ownership check.
        outcome = source_history(self.db, self.session_a, uid("src-b1"),
                                 served_at="2026-09-22T00:00:00Z", cursor="YWJj")
        self.assertIsInstance(outcome, Denied)

    def test_cursor_cannot_smuggle_sql(self) -> None:
        import base64
        import json

        payload = base64.urlsafe_b64encode(
            json.dumps(["' OR '1'='1", "x"], separators=(",", ":")).encode()
        ).decode()
        # Not a uuid id, so rejected before it reaches SQL at all.
        self.assertIsInstance(list_sources(self.db, self.session_a, cursor=payload), InvalidCursor)
        self.assertEqual(self.db.execute("SELECT count(*) FROM sources").fetchone()[0], 5)


class TestHistory(SourcesTestBase):
    """Acceptance criterion 3 (server half): history carries the server clock
    so the client can label staleness against something trustworthy."""

    def add_sample(
        self,
        tenant_id: str,
        sample_id: str,
        source_id: str,
        received_at: str,
        status: str = "accepted",
        flag: str = "no_flag",
    ) -> None:
        self.db.execute(
            "INSERT INTO samples (tenant_id, id, source_id, received_at_server, status, method,"
            " indicative_flag) VALUES (?,?,?,?,?,?,?)",
            (tenant_id, sample_id, source_id, received_at, status, "assisted", flag),
        )
        self.db.commit()

    def test_history_is_newest_first(self) -> None:
        self.add_sample(TENANT_A, uid("smp-1"), uid("src-a1"), "2026-09-01T10:00:00Z")
        self.add_sample(TENANT_A, uid("smp-2"), uid("src-a1"), "2026-09-15T10:00:00Z")
        self.add_sample(TENANT_A, uid("smp-3"), uid("src-a1"), "2026-09-10T10:00:00Z")
        page = source_history(self.db, self.session_a, uid("src-a1"), served_at="2026-09-22T00:00:00Z")
        assert not isinstance(page, Denied)
        self.assertEqual([e.sample_id for e in page.items], [uid("smp-2"), uid("smp-3"), uid("smp-1")])

    def test_history_reports_server_time_for_staleness(self) -> None:
        page = source_history(self.db, self.session_a, uid("src-a1"), served_at="2026-09-22T00:00:00Z")
        assert not isinstance(page, Denied)
        self.assertEqual(page.served_at, "2026-09-22T00:00:00Z")

    def test_only_accepted_samples_appear(self) -> None:
        """A pending or rejected sample is not a result and must not be shown
        as the source's last known test."""
        self.add_sample(TENANT_A, uid("smp-ok"), uid("src-a1"), "2026-09-01T10:00:00Z", status="accepted")
        self.add_sample(TENANT_A, uid("smp-pending"), uid("src-a1"), "2026-09-20T10:00:00Z", status="pending")
        self.add_sample(TENANT_A, uid("smp-rejected"), uid("src-a1"), "2026-09-21T10:00:00Z", status="rejected")
        page = source_history(self.db, self.session_a, uid("src-a1"), served_at="2026-09-22T00:00:00Z")
        assert not isinstance(page, Denied)
        self.assertEqual([e.sample_id for e in page.items], [uid("smp-ok")])

    def test_history_does_not_leak_other_tenant_samples(self) -> None:
        """Same source id string in both tenants - the tenant filter, not the
        source id, is what keeps these apart."""
        self.add_source(TENANT_B, uid("shared-id"), "JS-B-0002", "Shared", "Otherville")
        self.add_source(TENANT_A, uid("shared-id"), "JS-A-0009", "Shared", "Sundarpur")
        self.add_sample(TENANT_B, uid("smp-b"), uid("shared-id"), "2026-09-20T10:00:00Z")
        self.add_sample(TENANT_A, uid("smp-a"), uid("shared-id"), "2026-09-19T10:00:00Z")
        page = source_history(self.db, self.session_a, uid("shared-id"), served_at="2026-09-22T00:00:00Z")
        assert not isinstance(page, Denied)
        self.assertEqual([e.sample_id for e in page.items], [uid("smp-a")])

    def test_empty_history_is_a_page_not_an_error(self) -> None:
        page = source_history(self.db, self.session_a, uid("src-a2"), served_at="2026-09-22T00:00:00Z")
        assert not isinstance(page, Denied)
        self.assertEqual(page.items, ())
        self.assertIsNone(page.next_cursor)

    def test_history_paging_covers_every_row_once(self) -> None:
        for index in range(5):
            self.add_sample(TENANT_A, uid(f"smp-{index}"), uid("src-a1"), f"2026-09-0{index + 1}T10:00:00Z")
        seen: list[str] = []
        cursor = None
        for _ in range(10):
            page = source_history(
                self.db, self.session_a, uid("src-a1"), served_at="2026-09-22T00:00:00Z",
                limit=2, cursor=cursor,
            )
            assert not isinstance(page, Denied)
            seen.extend(e.sample_id for e in page.items)
            cursor = page.next_cursor
            if cursor is None:
                break
        self.assertEqual(len(seen), 5)
        self.assertEqual(len(set(seen)), 5, "a sample was returned twice")

    def test_provenance_fields_stay_separate(self) -> None:
        """AGENTS.md: machine suggestion, human observation and lab result are
        three fields. `indicative_flag` must not be collapsed into a verdict."""
        self.add_sample(TENANT_A, uid("smp-1"), uid("src-a1"), "2026-09-01T10:00:00Z", flag="review")
        page = source_history(self.db, self.session_a, uid("src-a1"), served_at="2026-09-22T00:00:00Z")
        assert not isinstance(page, Denied)
        entry = page.items[0]
        self.assertEqual(entry.indicative_flag, "review")
        self.assertEqual(entry.method, "assisted")
        self.assertFalse(hasattr(entry, "result"))
        self.assertFalse(hasattr(entry, "safe"))


class TestMigration(SourcesTestBase):
    def test_both_dialects_declare_the_same_columns(self) -> None:
        import re

        def columns(dialect: str) -> list[str]:
            table = statements(dialect)[0]
            body = table[table.index("(") + 1 :]
            found = []
            for line in body.splitlines():
                line = line.strip()
                match = re.match(r"^([a-z_]+)\s+(uuid|text|boolean|integer|real|double)", line)
                if match:
                    found.append(match.group(1))
            return found

        self.assertEqual(columns("postgresql"), columns("sqlite"))
        self.assertIn("tenant_id", columns("postgresql"))

    def test_migration_is_idempotent(self) -> None:
        apply_sqlite(self.db)
        apply_sqlite(self.db)
        self.assertEqual(self.db.execute("SELECT count(*) FROM sources").fetchone()[0], 5)

    def test_qr_code_unique_per_tenant_but_reusable_across_tenants(self) -> None:
        self.add_source(TENANT_B, uid("src-b9"), "JS-A-0001", "Same QR other tenant", "Otherville")
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_source(TENANT_A, uid("src-a9"), "JS-A-0001", "Duplicate in tenant", "Sundarpur")

    def test_bounds_are_enforced_by_the_database(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_source(TENANT_A, uid("src-long"), "J" * 200, "Too long QR", "Sundarpur")
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_source(TENANT_A, uid("src-lbl"), "JS-A-1000", "L" * 500, "Sundarpur")

    def test_half_a_coordinate_is_rejected(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_source(
                TENANT_A, uid("src-half"), "JS-A-1001", "Half coord", "Sundarpur", latitude=25.0
            )

    def test_source_without_coordinates_is_still_usable(self) -> None:
        """data-model.md: missing coordinates never block identification."""
        result = resolve_qr(self.db, self.session_a, "JS-A-0001")
        assert isinstance(result, QrMatched)
        self.assertFalse(result.source.has_coordinates)
        self.assertEqual(result.source.label, "Handpump 1")


if __name__ == "__main__":
    unittest.main()
