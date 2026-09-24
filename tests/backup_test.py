"""T36: backup -> restore into a fresh database -> reconcile -> deletions re-applied -> authorization smoke.

    python -m unittest tests.backup_test

The PostgreSQL round trip runs only when TEST_DATABASE_URL is set (CI); it
uses its own throwaway database, created and dropped here.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import unittest
from datetime import timedelta
from urllib.parse import urlsplit, urlunsplit

import tests.retention_test as t47
import tests.sync_push_test as t13
from services.api.app import backup, retention


class BackupTests(unittest.TestCase):
    def setUp(self) -> None:
        # The T47 fixture: one photo of a closed case (purgeable), one of an open case (held).
        self.source = t47.RetentionTests("test_nothing_is_purged_inside_the_retention_period")
        self.source.setUp()
        self.tmp = self.source.tmp
        self.source.db.execute("INSERT INTO memberships (tenant_id, user_id, role) VALUES (?, ?, 'worker')",
                               (t13.TENANT_A, t13.uid("worker")))
        self.source.db.commit()
        self.dump = self.tmp / "dump"

    def tearDown(self) -> None:
        self.source.tearDown()

    def url(self, name: str) -> str:
        return f"sqlite:///{self.tmp / name}"

    def test_a_restored_copy_reconciles_row_for_row(self) -> None:
        manifest = backup.dump(self.url("api.sqlite3"), self.dump)
        self.assertGreater(manifest["tables"]["changefeed"]["rows"], 0)
        bad, redone = backup.restore(self.dump, self.url("restored.sqlite3"))
        self.assertEqual((bad, redone), ([], []))
        self.assertEqual(backup.smoke(self.url("restored.sqlite3")), [])

    def test_a_restore_refuses_a_database_that_already_has_data(self) -> None:
        backup.dump(self.url("api.sqlite3"), self.dump)
        with self.assertRaises(SystemExit):
            backup.restore(self.dump, self.url("api.sqlite3"))

    def test_a_changed_row_is_caught(self) -> None:
        backup.dump(self.url("api.sqlite3"), self.dump)
        backup.restore(self.dump, self.url("restored.sqlite3"))
        conn = sqlite3.connect(self.tmp / "restored.sqlite3")
        conn.execute("UPDATE cases SET status = 'closed'")
        conn.commit()
        conn.close()
        self.assertEqual(backup.verify(self.dump, self.url("restored.sqlite3")), ["cases"])

    def test_evidence_deleted_after_the_backup_stays_deleted_after_the_restore(self) -> None:
        backup.dump(self.url("api.sqlite3"), self.dump)
        files_backup = self.tmp / "store-backup"
        shutil.copytree(self.source.store, files_backup)
        retention.purge(self.source.db, self.source.store, self.source.ledger, now=t47.CREATED + timedelta(days=31))
        bad, redone = backup.restore(self.dump, self.url("restored.sqlite3"), evidence=files_backup, ledger=self.source.ledger)
        self.assertEqual((bad, redone), ([], [self.source.closed_photo]))
        state = sqlite3.connect(self.tmp / "restored.sqlite3").execute(
            "SELECT state FROM evidence_assets WHERE id = ?", (self.source.closed_photo,)).fetchone()[0]
        self.assertEqual(state, "deleted")
        self.assertEqual(len(list(files_backup.iterdir())), 1, "only the held (open case) photo's file remains")

    @unittest.skipIf(not os.environ.get("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
    def test_postgres_round_trip(self) -> None:
        import psycopg

        admin_url = os.environ["TEST_DATABASE_URL"]
        name = "jalsakshi_backup_test"
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(f"DROP DATABASE IF EXISTS {name}")
            admin.execute(f"CREATE DATABASE {name}")
        try:
            parts = urlsplit(admin_url)
            target = urlunsplit(parts._replace(path=f"/{name}"))
            backup.dump(self.url("api.sqlite3"), self.dump)
            self.assertEqual(backup.restore(self.dump, target), ([], []))
            # And back out of PostgreSQL: a second-generation dump must match the first.
            second = self.tmp / "dump2"
            self.assertEqual(backup.dump(target, second)["tables"],
                             backup.dump(self.url("api.sqlite3"), self.tmp / "dump3")["tables"])
            self.assertEqual(backup.smoke(target), [])
        finally:
            with psycopg.connect(admin_url, autocommit=True) as admin:
                admin.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


if __name__ == "__main__":
    unittest.main()
