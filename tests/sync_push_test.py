"""T13: idempotent, tenant-scoped sample ingestion.

Run locally: python -m unittest tests.sync_push_test -v
Run PostgreSQL: set TEST_DATABASE_URL, then run the same command.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import unittest
from uuid import UUID, uuid5

from services.api.app.auth import Denied, Membership, Session, VerifiedToken
from services.api.app.schemas import PushRequest
from services.api.app.sync_push import push_events
from services.api.migrations.cases import statements as case_statements
from services.api.migrations.changefeed import apply_sqlite as apply_changefeed_sqlite
from services.api.migrations.changefeed import statements as changefeed_statements
from services.api.migrations.samples import apply_sqlite as apply_samples_sqlite
from services.api.migrations.samples import statements as sample_statements
from services.api.migrations.source import apply_sqlite as apply_sources_sqlite
from services.api.migrations.source import statements as source_statements


def uid(name: str) -> str:
    return str(uuid5(UUID("8bd78f99-b3d9-4c21-9208-efcd75f16c41"), name))


TENANT_A = uid("tenant-a")
TENANT_B = uid("tenant-b")
SOURCE_A = uid("source-a")
SOURCE_B = uid("source-b")
DEVICE = uid("device")


def session(tenant: str = TENANT_A, role: str = "worker") -> Session:
    token = VerifiedToken("subject", "issuer", "audience", 0, {})
    return Session(token, Membership(uid(f"user-{tenant}-{role}"), tenant, role, True))


def sample(name: str, source_id: str = SOURCE_A, **overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schema_version": 1,
        "sample_id": uid(name),
        "source_id": source_id,
        "protocol": {"id": uid("protocol"), "version": 1},
        "kit_lot_id": uid("lot"),
        "captured_at_device": "2026-09-24T12:00:00Z",
        "timing": {"state": "in_window", "elapsed_ms": 60000, "valid": True},
        "method": "manual",
        "observation": {
            "machine_bin": "bin_b",
            "manual_bin": "bin_a",
            "selected_bin": "bin_a",
            "indicative_flag": "review",
            "quality_reasons": ["GLARE_EXCESSIVE"],
            "model_version": "research-1",
            "calibration_version": None,
            "confidence": None,
            "override_reason": "Worker read the comparison chart directly",
        },
        "evidence_ids": [],
        "client_build": "test-build",
        "data_mode": "operational",
    }
    value.update(overrides)
    return value


def request(*events: tuple[str, str, dict[str, object]]) -> PushRequest:
    return PushRequest.model_validate(
        {
            "device_id": DEVICE,
            "events": [
                {"event_id": uid(event_id), "kind": kind, "schema_version": 1, "payload": payload}
                for event_id, kind, payload in events
            ],
        }
    )


def seed_sources(connection: object) -> None:
    cursor = connection.cursor()
    placeholder = "%s" if "psycopg" in type(connection).__module__ else "?"
    statement = (
        "INSERT INTO sources (tenant_id,id,qr_code,label,locality,active,version) "
        f"VALUES ({','.join([placeholder] * 7)})"
    )
    cursor.execute(statement, (TENANT_A, SOURCE_A, "JS-A", "Pump A", "Locality A", True, 1))
    cursor.execute(statement, (TENANT_B, SOURCE_B, "JS-B", "Pump B", "Locality B", True, 1))
    connection.commit()


def counts(connection: object) -> tuple[int, int, int]:
    cursor = connection.cursor()
    return tuple(
        cursor.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for table in ("samples", "observations", "idempotency_receipts")
    )


class SqliteSyncPushTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        apply_sources_sqlite(self.db)
        apply_samples_sqlite(self.db)
        apply_changefeed_sqlite(self.db)
        for statement in case_statements("sqlite"):
            self.db.execute(statement)
        seed_sources(self.db)

    def tearDown(self) -> None:
        self.db.close()

    def push(self, body: PushRequest, *, actor: Session | None = None):
        return push_events(
            self.db,
            actor or session(),
            body,
            server_data_mode="synthetic",
            server_time="2026-09-24T12:05:00Z",
        )

    def test_accepts_once_and_keeps_observation_provenance(self) -> None:
        result = self.push(request(("event-one", "sample.create", sample("sample-one"))))
        self.assertEqual(result.results[0].status, "accepted")
        self.assertEqual(counts(self.db), (1, 1, 1))

        stored = self.db.execute(
            "SELECT data_mode, method, indicative_flag, payload_hash FROM samples"
        ).fetchone()
        self.assertEqual(stored[:3], ("synthetic", "manual", "review"))
        self.assertEqual(len(stored[3]), 64)
        observation = self.db.execute(
            "SELECT machine_bin, manual_bin, selected_bin, override_reason FROM observations"
        ).fetchone()
        self.assertEqual(
            observation,
            ("bin_b", "bin_a", "bin_a", "Worker read the comparison chart directly"),
        )

    def test_exact_replay_is_duplicate_with_one_effect(self) -> None:
        body = request(("event-replay", "sample.create", sample("sample-replay")))
        first = self.push(body).results[0]
        replay = self.push(body).results[0]
        self.assertEqual((first.status, replay.status), ("accepted", "duplicate"))
        self.assertEqual((replay.resource_id, replay.server_time), (first.resource_id, first.server_time))
        self.assertEqual(counts(self.db), (1, 1, 1))

    def test_same_event_with_changed_payload_is_an_explicit_conflict(self) -> None:
        event = "event-mismatch"
        self.push(request((event, "sample.create", sample("sample-mismatch"))))
        changed = sample("sample-mismatch", client_build="changed-build")
        receipt = self.push(request((event, "sample.create", changed))).results[0]
        self.assertEqual(receipt.status, "conflict")
        self.assertEqual(receipt.error.code, "IDEMPOTENCY_MISMATCH")
        self.assertEqual(counts(self.db), (1, 1, 1))

    def test_partial_batch_reports_each_outcome_and_commits_valid_events(self) -> None:
        body = request(
            ("event-good-a", "sample.create", sample("sample-good-a")),
            ("event-missing", "sample.create", sample("sample-missing", uid("missing-source"))),
            ("event-good-b", "sample.create", sample("sample-good-b")),
        )
        results = self.push(body).results
        self.assertEqual([item.status for item in results], ["accepted", "rejected", "accepted"])
        self.assertEqual(results[1].error.code, "SOURCE_NOT_FOUND")
        self.assertEqual(counts(self.db), (2, 2, 3))

    def test_reordered_duplicate_sample_ids_create_one_immutable_sample(self) -> None:
        payload = sample("sample-reordered")
        body = request(
            ("event-second", "sample.create", payload),
            ("event-first", "sample.create", payload),
        )
        results = self.push(body).results
        self.assertEqual([item.status for item in results], ["accepted", "conflict"])
        self.assertEqual(results[1].error.code, "SAMPLE_ID_CONFLICT")
        self.assertEqual(counts(self.db), (1, 1, 2))

    def test_correction_is_an_append_only_row(self) -> None:
        original = sample("sample-original")
        correction = sample("sample-correction", supersedes_id=original["sample_id"])
        self.push(request(("event-original", "sample.create", original)))
        result = self.push(request(("event-correction", "sample.correct", correction)))
        self.assertEqual(result.results[0].status, "accepted")
        rows = self.db.execute("SELECT id, supersedes_id FROM samples ORDER BY received_at_server, id").fetchall()
        self.assertEqual(len(rows), 2)
        self.assertIn((correction["sample_id"], original["sample_id"]), rows)

    def test_correction_before_original_can_be_retried_after_dependency_arrives(self) -> None:
        original = sample("sample-late-original")
        correction = sample("sample-early-correction", supersedes_id=original["sample_id"])
        correction_body = request(("event-early-correction", "sample.correct", correction))
        first = self.push(correction_body).results[0]
        self.assertEqual((first.status, first.error.code, first.error.retryable), ("rejected", "SUPERSEDED_SAMPLE_NOT_FOUND", True))
        self.assertEqual(counts(self.db), (0, 0, 0))

        self.push(request(("event-late-original", "sample.create", original)))
        retried = self.push(correction_body).results[0]
        self.assertEqual(retried.status, "accepted")
        self.assertEqual(counts(self.db), (2, 2, 2))

    def test_cross_tenant_source_and_disallowed_role_do_not_write(self) -> None:
        hidden = self.push(request(("event-hidden", "sample.create", sample("hidden", SOURCE_B))))
        self.assertEqual(hidden.results[0].error.code, "SOURCE_NOT_FOUND")
        denied = self.push(
            request(("event-role", "sample.create", sample("role"))),
            actor=session(role="lab_reviewer"),
        )
        self.assertIsInstance(denied, Denied)
        self.assertEqual(counts(self.db), (0, 0, 1))


try:
    import psycopg
except ImportError:  # pragma: no cover - skip path for contributors without the driver
    psycopg = None


@unittest.skipIf(psycopg is None, "psycopg not installed")
@unittest.skipIf(not os.environ.get("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class PostgresSyncPushTests(unittest.TestCase):
    schema = "jalsakshi_test_t13"

    @classmethod
    def setUpClass(cls) -> None:
        cls.url = os.environ["TEST_DATABASE_URL"]
        cls.db = psycopg.connect(cls.url)
        cls.db.execute(f"DROP SCHEMA IF EXISTS {cls.schema} CASCADE")
        cls.db.execute(f"CREATE SCHEMA {cls.schema}")
        cls.db.execute(f"SET search_path TO {cls.schema}")
        for statement in source_statements("postgresql") + sample_statements("postgresql") + changefeed_statements("postgresql") + case_statements("postgresql"):
            cls.db.execute(statement)
        cls.db.commit()
        seed_sources(cls.db)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.db.rollback()
        cls.db.execute(f"DROP SCHEMA IF EXISTS {cls.schema} CASCADE")
        cls.db.commit()
        cls.db.close()

    def setUp(self) -> None:
        self.db.execute(f"SET search_path TO {self.schema}")
        self.db.execute("DELETE FROM case_events")
        self.db.execute("DELETE FROM cases")
        self.db.execute("DELETE FROM idempotency_receipts")
        self.db.execute("DELETE FROM observations")
        self.db.execute("DELETE FROM samples")
        self.db.commit()

    def push(self, body: PushRequest, connection: object | None = None):
        return push_events(
            connection or self.db,
            session(),
            body,
            server_data_mode="research",
            server_time="2026-09-24T12:05:00Z",
        )

    def test_postgres_replay_mismatch_and_partial_batch(self) -> None:
        body = request(("pg-event", "sample.create", sample("pg-sample")))
        self.assertEqual(self.push(body).results[0].status, "accepted")
        self.assertEqual(self.push(body).results[0].status, "duplicate")
        changed = request(("pg-event", "sample.create", sample("pg-sample", client_build="other")))
        self.assertEqual(self.push(changed).results[0].status, "conflict")
        partial = request(
            ("pg-good", "sample.create", sample("pg-good")),
            ("pg-bad", "sample.create", sample("pg-bad", uid("unknown"))),
        )
        self.assertEqual([r.status for r in self.push(partial).results], ["accepted", "rejected"])
        self.assertEqual(counts(self.db), (2, 2, 3))

    def test_postgres_unique_constraint_serializes_concurrent_replay(self) -> None:
        body = request(("pg-race-event", "sample.create", sample("pg-race-sample")))
        barrier = threading.Barrier(2)
        statuses: list[str] = []
        failures: list[BaseException] = []

        def worker() -> None:
            connection = psycopg.connect(self.url)
            try:
                connection.execute(f"SET search_path TO {self.schema}")
                connection.commit()
                barrier.wait()
                statuses.append(self.push(body, connection).results[0].status)
            except BaseException as error:  # captured for assertion in the main thread
                failures.append(error)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)

        self.assertEqual(failures, [])
        self.assertEqual(sorted(statuses), ["accepted", "duplicate"])
        self.assertEqual(counts(self.db), (1, 1, 1))


if __name__ == "__main__":
    unittest.main()
