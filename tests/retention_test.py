"""T47: retention with a fake clock, interrupted purge, and restore.

Run: python -m unittest tests.retention_test -v
"""

from __future__ import annotations

import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import tests.sync_push_test as t13
from services.api.app import retention
from services.api.app.db import migrate
from services.api.app.sync_push import push_events

CREATED = datetime(2026, 8, 1, tzinfo=timezone.utc)


class RetentionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.db_path, self.store, self.ledger = self.tmp / "api.sqlite3", self.tmp / "store", self.tmp / "ledger" / "deletions.jsonl"
        self.store.mkdir()
        self.db = sqlite3.connect(self.db_path)
        migrate(self.db)
        t13.seed_sources(self.db)
        self.closed_photo = self.asset(self.case("closed-case", "closed"), "sample_photo")
        self.open_photo = self.asset(self.case("open-case", "awaiting_lab"), "sample_photo")

    def tearDown(self) -> None:
        self.db.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def case(self, name: str, status: str) -> str:
        push_events(self.db, t13.session(), t13.request((f"ev-{name}", "sample.create", t13.sample(name))),
                    server_data_mode="synthetic", server_time="2026-08-01T00:00:00Z")
        self.db.execute("UPDATE cases SET status = ? WHERE trigger_sample_id = ?", (status, t13.uid(name)))
        self.db.commit()
        return t13.uid(name)

    def asset(self, sample_id: str, context: str) -> str:
        asset_id, key = str(uuid4()), f"key-{uuid4()}"
        (self.store / key).write_bytes(b"photo bytes")
        self.db.execute(
            "INSERT INTO evidence_assets (tenant_id,id,context,target_id,sha256,media_type,bytes,storage_key,state,"
            "uploaded_by,permission_version,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (t13.TENANT_A, asset_id, context, sample_id, "0" * 64, "image/jpeg", 11, key, "available",
             t13.uid("worker"), 1, "2026-08-01T00:00:00Z", "2026-08-01T00:05:00Z"))
        self.db.commit()
        return asset_id

    def state(self, asset_id: str) -> tuple[str, bool]:
        state, key = self.db.execute("SELECT state, storage_key FROM evidence_assets WHERE id = ?", (asset_id,)).fetchone()
        return state, (self.store / key).exists()

    def test_nothing_is_purged_inside_the_retention_period(self) -> None:
        report = retention.purge(self.db, self.store, self.ledger, now=CREATED + timedelta(days=29))
        self.assertEqual((report.purged, report.held), ([], []))
        self.assertEqual(self.state(self.closed_photo), ("available", True))

    def test_old_evidence_of_a_closed_case_is_purged_but_an_open_case_holds_it(self) -> None:
        report = retention.purge(self.db, self.store, self.ledger, now=CREATED + timedelta(days=31))
        self.assertEqual(report.purged, [self.closed_photo])
        self.assertEqual(report.held, [self.open_photo], "unresolved evidence is reported, never silently kept or deleted")
        self.assertEqual(self.state(self.closed_photo), ("deleted", False), "row stays with a truthful state")
        self.assertEqual(self.state(self.open_photo), ("available", True))
        self.assertIn(self.closed_photo, self.ledger.read_text(), "the external ledger records it")

    def test_a_purge_interrupted_after_its_intent_is_finished_by_the_next_run(self) -> None:
        key = self.db.execute("SELECT storage_key FROM evidence_assets WHERE id = ?", (self.closed_photo,)).fetchone()[0]
        self.db.execute("INSERT INTO deletion_ledger (tenant_id, asset_id, storage_key, sha256, reason, requested_at) "
                        "VALUES (?,?,?,?,?,?)", (t13.TENANT_A, self.closed_photo, key, "0" * 64, "x", "2026-09-01T00:00:00Z"))
        self.db.commit()  # the process "died" here: intent recorded, bytes still present
        report = retention.purge(self.db, self.store, self.ledger, now=CREATED + timedelta(days=1))
        self.assertEqual(report.resumed, [self.closed_photo])
        self.assertEqual(self.state(self.closed_photo), ("deleted", False))

    def test_restoring_an_older_backup_reapplies_the_deletion(self) -> None:
        backup_db, backup_store = self.tmp / "backup.sqlite3", self.tmp / "backup-store"
        self.db.commit()
        shutil.copy(self.db_path, backup_db)
        shutil.copytree(self.store, backup_store)
        retention.purge(self.db, self.store, self.ledger, now=CREATED + timedelta(days=31))
        self.db.close()
        shutil.copy(backup_db, self.db_path)  # restore both database and files
        shutil.rmtree(self.store)
        shutil.copytree(backup_store, self.store)
        self.db = sqlite3.connect(self.db_path)
        self.assertEqual(self.state(self.closed_photo), ("available", True), "the restore brought it back")
        self.assertEqual(retention.reapply_deletions(self.db, self.store, self.ledger), [self.closed_photo])
        self.assertEqual(self.state(self.closed_photo), ("deleted", False))
        self.assertEqual(self.state(self.open_photo), ("available", True))
        self.assertEqual(retention.reapply_deletions(self.db, self.store, self.ledger), [], "idempotent")


if __name__ == "__main__":
    unittest.main()
