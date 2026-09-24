"""T14: commit-ordered pull, bootstrap snapshot, reset recovery.

Run locally:     python -m unittest tests.sync_order_test -v
Run PostgreSQL:  set TEST_DATABASE_URL, then the same command. The late-commit
                 test needs real row locks and two connections, so it only runs
                 there; SQLite serialises writers globally and cannot show it.

All data here is synthetic fixture data.
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import tests.sync_push_test as t13
from services.api.app import dev_seed
from services.api.app.changefeed import compact
from services.api.app.db import connector
from services.api.app.dev_issuer import SYNTHETIC_TENANT_ID, _uid
from services.api.app.main import app
from services.api.app.samples import insert_sample
from services.api.app.sources import InvalidCursor
from services.api.app.sync_pull import PullPage, ResetRequired, bootstrap, pull, pull_cursor
from services.api.app.sync_push import canonical_event_hash, push_events
from services.api.migrations.changefeed import apply_sqlite as apply_changefeed_sqlite
from services.api.migrations.changefeed import statements as changefeed_statements

NOW = "2026-09-24T12:05:00Z"
A = t13.session(t13.TENANT_A)
B = t13.session(t13.TENANT_B)


def create(name: str, source: str = t13.SOURCE_A):
    return t13.request((f"event-{name}", "sample.create", t13.sample(name, source)))


def feed_rows(connection) -> list[tuple]:
    cursor = connection.cursor()
    cursor.execute("SELECT tenant_id, seq, entity_id FROM changefeed ORDER BY tenant_id, seq")
    return [(str(t), int(s), str(e)) for t, s, e in cursor.fetchall()]


def apply_page(client, page: PullPage, *, fail_at: int | None = None) -> None:
    """Reference device apply: every change of a page plus the cursor in ONE
    transaction (api-contracts.md). T15's sync.ts implements the same rule."""
    try:
        for index, change in enumerate(page.changes):
            if index == fail_at:
                raise OSError("injected disk failure mid-page")
            client.execute("INSERT OR REPLACE INTO local_samples VALUES (?,?)", (change.entity_id, change.version))
        client.execute("UPDATE sync_cursor SET cursor = ?", (page.next_cursor,))
        client.commit()
    except Exception:
        client.rollback()
        raise


class SqliteOrderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        t13.apply_sources_sqlite(self.db)
        t13.apply_samples_sqlite(self.db)
        apply_changefeed_sqlite(self.db)
        for statement in t13.case_statements("sqlite"):
            self.db.execute(statement)
        t13.seed_sources(self.db)
        self.start = pull_cursor(t13.TENANT_A, 0)

    def push(self, body, actor=A):
        return push_events(self.db, actor, body, server_data_mode="synthetic", server_time=NOW)

    def pull(self, cursor, actor=A, limit=50):
        return pull(self.db, actor, cursor, limit=limit, server_time=NOW)

    def test_only_accepted_effects_enter_the_feed(self) -> None:
        self.assertEqual(self.push(create("one")).results[0].status, "accepted")
        self.assertEqual(self.push(create("one")).results[0].status, "duplicate")
        changed = t13.request(("event-one", "sample.create", t13.sample("one", client_build="other")))
        self.assertEqual(self.push(changed).results[0].status, "conflict")
        self.assertEqual(self.push(create("bad", t13.uid("unknown"))).results[0].status, "rejected")
        orphan = t13.request(("event-fix", "sample.correct", {**t13.sample("fix"), "supersedes_id": t13.uid("nope")}))
        self.assertEqual(self.push(orphan).results[0].error.code, "SUPERSEDED_SAMPLE_NOT_FOUND")
        # One accepted sample -> exactly one change; rejected/duplicate/conflict/
        # retryable events roll their sequence allocation back with them.
        self.assertEqual(feed_rows(self.db), [(t13.TENANT_A, 1, t13.uid("one"))])
        self.assertEqual(self.push(create("two")).results[0].status, "accepted")
        self.assertEqual([r[1] for r in feed_rows(self.db)], [1, 2])

    def test_pages_are_ordered_bounded_and_carry_the_accepted_hash(self) -> None:
        for name in ("p1", "p2", "p3"):
            self.push(create(name))
        first = self.pull(self.start, limit=2)
        self.assertEqual([c.seq for c in first.changes], [1, 2])
        self.assertTrue(first.has_more)
        second = self.pull(first.next_cursor, limit=2)
        self.assertEqual([c.seq for c in second.changes], [3])
        self.assertFalse(second.has_more)
        # An empty page keeps the cursor where it was instead of resetting it.
        self.assertEqual(self.pull(second.next_cursor).next_cursor, second.next_cursor)
        stored = self.db.execute("SELECT payload_hash FROM samples WHERE id = ?", (t13.uid("p1"),)).fetchone()[0]
        self.assertEqual(first.changes[0].sample.payload_hash, stored)
        self.assertEqual(first.changes[0].sample.status, "accepted")
        self.assertEqual(stored, canonical_event_hash(create("p1").events[0]))
        self.assertEqual(self.pull(self.start, limit=10**6).changes[-1].seq, 3)  # clamped, not an error

    def test_correction_arrives_as_a_new_entity_with_its_lineage(self) -> None:
        self.push(create("orig"))
        fix = t13.request(("event-fix", "sample.correct", {**t13.sample("fix"), "supersedes_id": t13.uid("orig")}))
        self.assertEqual(self.push(fix).results[0].status, "accepted")
        changes = self.pull(self.start).changes
        self.assertEqual([c.entity_id for c in changes], [t13.uid("orig"), t13.uid("fix")])
        self.assertEqual(changes[1].sample.supersedes_id, t13.uid("orig"))

    def test_partial_page_apply_rolls_back_and_the_same_cursor_replays_the_same_page(self) -> None:
        for name in ("r1", "r2", "r3"):
            self.push(create(name))
        device = sqlite3.connect(":memory:")
        device.execute("CREATE TABLE local_samples (id text PRIMARY KEY, version integer)")
        device.execute("CREATE TABLE sync_cursor (cursor text)")
        device.execute("INSERT INTO sync_cursor VALUES (?)", (self.start,))
        device.commit()

        page = self.pull(self.start)
        with self.assertRaises(OSError):
            apply_page(device, page, fail_at=1)
        self.assertEqual(device.execute("SELECT count(*) FROM local_samples").fetchone()[0], 0)
        self.assertEqual(device.execute("SELECT cursor FROM sync_cursor").fetchone()[0], self.start)

        retry = self.pull(self.start)
        self.assertEqual(retry.model_dump(), page.model_dump())
        apply_page(device, retry)
        self.assertEqual(device.execute("SELECT count(*) FROM local_samples").fetchone()[0], 3)
        self.assertEqual(device.execute("SELECT cursor FROM sync_cursor").fetchone()[0], retry.next_cursor)

    def test_cursor_is_bound_to_tenant_and_issuer(self) -> None:
        self.push(create("mine"))
        self.push(create("theirs", t13.SOURCE_B), actor=B)
        self.assertEqual([c.entity_id for c in self.pull(self.start).changes], [t13.uid("mine")])
        self.assertEqual([c.entity_id for c in self.pull(pull_cursor(t13.TENANT_B, 0), actor=B).changes],
                         [t13.uid("theirs")])
        # Sequences are per tenant: B's first change is also seq 1.
        self.assertEqual(sorted(r[1] for r in feed_rows(self.db)), [1, 1])

        def forge(value: object) -> str:
            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode()

        hostile = [
            pull_cursor(t13.TENANT_B, 0),  # another tenant's cursor
            "not-base64!",
            forge([1, 2]),
            forge({"v": 1, "k": "pull", "t": t13.TENANT_A, "s": True}),
            forge({"v": 1, "k": "pull", "t": t13.TENANT_A, "s": -1}),
            forge({"v": 1, "k": "pull", "t": t13.TENANT_A, "s": "0"}),
            forge({"v": 2, "k": "pull", "t": t13.TENANT_A, "s": 0}),
            forge({"v": 1, "k": "boot", "t": t13.TENANT_A, "s": 0}),
        ]
        for cursor in hostile:
            with self.subTest(cursor=cursor):
                self.assertIsInstance(self.pull(cursor), InvalidCursor)

    def test_compaction_and_restore_force_reset_and_bootstrap_recovers(self) -> None:
        for name in ("c1", "c2", "c3"):
            self.push(create(name))
        at1, at2 = pull_cursor(t13.TENANT_A, 1), pull_cursor(t13.TENANT_A, 2)
        compact(self.db, t13.TENANT_A, 2)
        self.assertIsInstance(self.pull(at1), ResetRequired)
        self.assertEqual([c.seq for c in self.pull(at2).changes], [3])  # at the floor is still servable
        # A floor move past the head is refused and deletes nothing.
        compact(self.db, t13.TENANT_A, 99)
        self.assertEqual([c.seq for c in self.pull(at2).changes], [3])
        # Cursor from the future = server restored from an older backup.
        self.assertIsInstance(self.pull(pull_cursor(t13.TENANT_A, 7)), ResetRequired)

        # Recovery: re-bootstrap, then pull from the snapshot.
        boot = bootstrap(self.db, A, None)
        self.assertEqual([s.id for s in boot.sources], [t13.SOURCE_A])
        self.assertIsNone(boot.next_cursor)
        self.push(create("after-reset"))
        self.assertEqual([c.entity_id for c in self.pull(boot.snapshot_cursor).changes], [t13.uid("after-reset")])

    def test_bootstrap_snapshot_is_taken_before_page_one(self) -> None:
        for index in range(3):
            self.db.execute(
                "INSERT INTO sources (tenant_id,id,qr_code,label,locality,active,version) VALUES (?,?,?,?,?,?,?)",
                (t13.TENANT_A, t13.uid(f"extra-{index}"), f"JS-X{index}", f"Pump X{index}", "L", True, 1),
            )
        self.db.commit()
        self.push(create("before"))
        page = bootstrap(self.db, A, None, limit=2)
        self.assertIsNone(page.snapshot_cursor)
        self.push(create("during"))  # committed between pages
        pages = [page]
        while pages[-1].next_cursor:
            pages.append(bootstrap(self.db, A, pages[-1].next_cursor, limit=2))
        self.assertEqual(sum(len(p.sources) for p in pages), 4)
        pulled = self.pull(pages[-1].snapshot_cursor).changes
        self.assertEqual([c.entity_id for c in pulled], [t13.uid("during")])
        self.assertIsInstance(bootstrap(self.db, B, page.next_cursor), InvalidCursor)


@unittest.skipIf(t13.psycopg is None, "psycopg not installed")
@unittest.skipIf(not os.environ.get("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class PostgresOrderTests(unittest.TestCase):
    schema = "jalsakshi_test_t14"

    @classmethod
    def setUpClass(cls) -> None:
        cls.url = os.environ["TEST_DATABASE_URL"]
        cls.db = t13.psycopg.connect(cls.url)
        cls.db.execute(f"DROP SCHEMA IF EXISTS {cls.schema} CASCADE")
        cls.db.execute(f"CREATE SCHEMA {cls.schema}")
        cls.db.execute(f"SET search_path TO {cls.schema}")
        for statement in (
            t13.source_statements("postgresql")
            + t13.sample_statements("postgresql")
            + changefeed_statements("postgresql")
            + t13.case_statements("postgresql")
        ):
            cls.db.execute(statement)
        cls.db.commit()
        t13.seed_sources(cls.db)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.db.rollback()
        cls.db.execute(f"DROP SCHEMA IF EXISTS {cls.schema} CASCADE")
        cls.db.commit()
        cls.db.close()

    def setUp(self) -> None:
        for table in ("case_events", "cases", "changefeed", "sync_heads", "idempotency_receipts", "observations", "samples"):
            self.db.execute(f"DELETE FROM {table}")
        self.db.commit()

    def connect(self):
        connection = t13.psycopg.connect(self.url)
        connection.execute(f"SET search_path TO {self.schema}")
        connection.commit()
        return connection

    def test_late_commit_is_never_skipped(self) -> None:
        """Writer 1 allocates first and commits LAST. Writer 2 must wait for it,
        so no reader can ever see seq 2 while seq 1 is still in flight."""
        slow, fast, reader = self.connect(), self.connect(), self.connect()
        try:
            event = create("slow").events[0]
            from services.api.app.changefeed import record_change

            record_change(slow, t13.TENANT_A, "sample", str(event.payload.sample_id), "upsert", 1, NOW)
            insert_sample(slow, A, event, device_id=t13.DEVICE, payload_hash=canonical_event_hash(event),
                          server_data_mode="synthetic", server_time=NOW)
            # `slow` now holds the tenant lock with seq 1 uncommitted.

            done: list[str] = []
            thread = threading.Thread(
                target=lambda: done.append(
                    push_events(fast, A, create("fast"), server_data_mode="synthetic", server_time=NOW)
                    .results[0].status
                )
            )
            thread.start()
            time.sleep(1.5)
            self.assertEqual(done, [], "second writer must block on the tenant lock")
            seen = pull(reader, A, pull_cursor(t13.TENANT_A, 0), server_time=NOW)
            reader.commit()
            self.assertEqual(seen.changes, [], "reader must see nothing past an uncommitted lower seq")

            slow.commit()
            thread.join(10)
            self.assertEqual(done, ["accepted"])
            page = pull(reader, A, pull_cursor(t13.TENANT_A, 0), server_time=NOW)
            self.assertEqual([(c.seq, c.entity_id) for c in page.changes],
                             [(1, t13.uid("slow")), (2, t13.uid("fast"))])
        finally:
            for connection in (slow, fast, reader):
                connection.close()

    def test_concurrent_replay_records_one_change(self) -> None:
        body = create("race")
        barrier = threading.Barrier(2)
        statuses: list[str] = []

        def worker() -> None:
            connection = self.connect()
            try:
                barrier.wait()
                statuses.append(
                    push_events(connection, A, body, server_data_mode="synthetic", server_time=NOW).results[0].status
                )
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual(sorted(statuses), ["accepted", "duplicate"])
        self.assertEqual([r[2] for r in feed_rows(self.db)], [t13.uid("race")])
        self.db.commit()

    def test_reset_and_bound_checks_hold_on_postgres(self) -> None:
        for name in ("g1", "g2"):
            push_events(self.db, A, create(name), server_data_mode="synthetic", server_time=NOW)
        compact(self.db, t13.TENANT_A, 1)
        self.assertIsInstance(pull(self.db, A, pull_cursor(t13.TENANT_A, 0), server_time=NOW), ResetRequired)
        page = pull(self.db, A, pull_cursor(t13.TENANT_A, 1), server_time=NOW)
        self.assertEqual([c.entity_id for c in page.changes], [t13.uid("g2")])
        self.assertIsInstance(pull(self.db, B, page.next_cursor, server_time=NOW), InvalidCursor)
        self.db.commit()


@unittest.skipUnless(hasattr(app.state, "dev_issuer"), "needs development+synthetic")
class HttpOrderTests(unittest.TestCase):
    """Real app, real T06 authenticate(), real startup migration + seed."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_connect = app.state.connect
        app.state.connect = connector("", Path(cls.tmp.name) / "api.sqlite3")
        cls.client = TestClient(app)
        cls.client.__enter__()
        cls.headers = {"Authorization": f"Bearer {app.state.dev_issuer.mint(_uid('user.worker'))}"}

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect = cls.saved_connect
        cls.tmp.cleanup()

    def get(self, path: str, **params):
        return self.client.get(path, headers=self.headers, params=params)

    def test_bootstrap_then_pull_sees_the_pushed_record_and_errors_are_problems(self) -> None:
        cursor, sources = None, []
        while True:
            body = self.get("/v1/bootstrap", **({"cursor": cursor} if cursor else {}), limit=2).json()
            sources += body["sources"]
            cursor = body["next_cursor"]
            if cursor is None:
                break
        self.assertTrue(sources)
        snapshot = body["snapshot_cursor"]

        payload = t13.sample("http", dev_seed.source_id("src.1"))
        payload["protocol"] = {"id": _uid("protocol.synthetic"), "version": 1}
        push = self.client.post("/v1/sync/push", headers=self.headers, json={
            "device_id": _uid("device.t14"),
            "events": [{"event_id": _uid("event.t14"), "kind": "sample.create", "schema_version": 1,
                        "payload": payload}],
        })
        self.assertEqual(push.json()["results"][0]["status"], "accepted")

        page = self.get("/v1/sync/pull", cursor=snapshot).json()
        self.assertEqual([c["entity_id"] for c in page["changes"]], [payload["sample_id"]])
        self.assertEqual(page["changes"][0]["sample"]["status"], "accepted")

        bad = self.get("/v1/sync/pull", cursor="forged")
        self.assertEqual((bad.status_code, bad.json()["code"]), (422, "VALIDATION_FAILED"))
        ahead = self.get("/v1/sync/pull", cursor=pull_cursor(SYNTHETIC_TENANT_ID, 10**9))
        self.assertEqual((ahead.status_code, ahead.json()["code"]), (410, "RESET_REQUIRED"))
        self.assertEqual(ahead.headers["content-type"], "application/problem+json")
        self.assertEqual(self.client.get("/v1/sync/pull", params={"cursor": snapshot}).status_code, 401)

    def test_long_non_ascii_labels_do_not_strand_paging(self) -> None:
        """T07 regression found in T14: a max-length non-ASCII label, written as
        JSON unicode escapes, made a cursor longer than the route accepted, so
        the next page was unreachable. Worst case mixes Devanagari with 4-byte
        characters."""
        conn = app.state.connect()
        try:
            for index in range(3):
                conn.execute(
                    "INSERT INTO sources (tenant_id,id,qr_code,label,locality,active,version) VALUES (?,?,?,?,?,?,?)",
                    (SYNTHETIC_TENANT_ID, _uid(f"src.long.{index}"), f"JS-LONG-{index}",
                     "ह" * 60 + "💧" * 59 + str(index), "L", True, 1),
                )
            conn.commit()
        finally:
            conn.close()
        for path, key in (("/v1/sources", "items"), ("/v1/bootstrap", "sources")):
            with self.subTest(path=path):
                seen, cursor = [], None
                while True:
                    response = self.get(path, **({"cursor": cursor} if cursor else {}), limit=1)
                    self.assertEqual(response.status_code, 200, response.text)
                    body = response.json()
                    seen += [s["id"] for s in body[key]]
                    cursor = body["next_cursor"]
                    if cursor is None:
                        break
                self.assertTrue({_uid(f"src.long.{i}") for i in range(3)} <= set(seen))
                self.assertEqual(len(seen), len(set(seen)))


if __name__ == "__main__":
    unittest.main()
