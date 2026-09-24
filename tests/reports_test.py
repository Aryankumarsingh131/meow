"""T43: metrics and safe export slice.

Run: python -m unittest tests.reports_test -v
"""

from __future__ import annotations

import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import tests.sync_push_test as t13
from services.api.app import jobs
from services.api.app import reports
from services.api.app.db import connector, migrate
from services.api.app.dev_issuer import _uid
from services.api.app.main import app
from services.api.app.sync_push import push_events

NOW = "2026-09-24T12:05:00Z"
SUPERVISOR = t13.session(role="supervisor")
WORKER = t13.session(role="worker")


def push(db, name: str, flag: str = "review", **overrides) -> None:
    payload = t13.sample(name, **overrides)
    payload["observation"] = {**payload["observation"], "indicative_flag": flag}
    result = push_events(db, t13.session(), t13.request((f"ev-{name}", "sample.create", payload)),
                         server_data_mode=overrides.get("data_mode", "operational"), server_time=NOW)
    assert result.results[0].status == "accepted", result.results[0]


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        migrate(self.db)
        t13.seed_sources(self.db)

    def tearDown(self) -> None:
        self.db.close()


class MetricsTests(Harness):
    def test_synthetic_cases_are_excluded_from_every_count(self) -> None:
        push(self.db, "real", "review", data_mode="operational")
        push(self.db, "demo", "review", data_mode="synthetic")
        summary = reports.metrics(self.db, SUPERVISOR, reports.ReportFilters(), now=NOW)
        self.assertEqual(summary.total, 1)
        self.assertEqual(summary.by_status["review_needed"], 1)

    def test_role_and_tenant_scope(self) -> None:
        push(self.db, "real", "review")
        self.assertEqual(reports.metrics(self.db, WORKER, reports.ReportFilters(), now=NOW).code, "FORBIDDEN")
        other_tenant = t13.session(tenant=t13.TENANT_B, role="supervisor")
        summary = reports.metrics(self.db, other_tenant, reports.ReportFilters(), now=NOW)
        self.assertEqual(summary.total, 0)

    def test_status_filter_counts_match_exported_rows(self) -> None:
        push(self.db, "a", "review")
        push(self.db, "b", "invalid")
        self.db.execute("UPDATE cases SET status = 'awaiting_lab' WHERE trigger_sample_id = ?", (t13.uid("b"),))
        self.db.commit()
        for status, expected in (("review_needed", 1), ("awaiting_lab", 1), ("closed", 0), (None, 2)):
            with self.subTest(status=status):
                filters = reports.ReportFilters(status=status)
                summary = reports.metrics(self.db, SUPERVISOR, filters, now=NOW)
                rows = list(reports._export_rows(self.db, t13.TENANT_A, filters))
                self.assertEqual((summary.total, len(rows)), (expected, expected))

    def test_overdue_uses_the_server_clock_and_ignores_closed_cases(self) -> None:
        push(self.db, "late", "review")
        push(self.db, "done", "review")
        self.db.execute("UPDATE cases SET due_at = '2026-09-01T00:00:00Z'")
        self.db.execute("UPDATE cases SET status = 'closed' WHERE trigger_sample_id = ?", (t13.uid("done"),))
        self.db.commit()
        self.assertEqual(reports.metrics(self.db, SUPERVISOR, reports.ReportFilters(), now=NOW).overdue, 1)


class ExportRowsTests(Harness):
    def test_csv_neutralizes_formula_prefixes(self) -> None:
        self.assertEqual(reports.neutralize("=SUM(A1:A9)"), "'=SUM(A1:A9)")
        self.assertEqual(reports.neutralize("+1"), "'+1")
        self.assertEqual(reports.neutralize("-1"), "'-1")
        self.assertEqual(reports.neutralize("@cmd"), "'@cmd")
        self.assertEqual(reports.neutralize("ordinary"), "ordinary")

    def test_synthetic_rows_never_appear_in_the_export(self) -> None:
        push(self.db, "real", "review", data_mode="operational")
        push(self.db, "demo", "review", data_mode="synthetic")
        rows = list(reports._export_rows(self.db, t13.TENANT_A, reports.ReportFilters()))
        self.assertEqual(len(rows), 1)

    def test_a_hostile_disposition_is_neutralized_in_the_exported_row(self) -> None:
        push(self.db, "real", "review")
        self.db.execute("UPDATE cases SET disposition = ?", ("=cmd|'/bin/sh'!A1",))
        self.db.commit()
        rows = list(reports._export_rows(self.db, t13.TENANT_A, reports.ReportFilters()))
        disposition_cell = rows[0][reports._EXPORT_HEADER.index("disposition")]
        self.assertTrue(disposition_cell.startswith("'="))


class JobCancelTests(unittest.TestCase):
    """jobs.py's core guarantee, tested directly: a cancelled run never
    publishes a partial file."""

    def test_cancelling_mid_export_leaves_no_result(self) -> None:
        job = jobs.create("tenant-x")

        def rows():
            yield ["1"]
            yield ["2"]
            jobs.cancel("tenant-x", job.id)  # simulates a client cancel request landing mid-run
            yield ["3"]  # must never be written

        jobs.run(job, ["col"], rows())
        self.assertEqual(job.status, "cancelled")
        self.assertIsNone(job.result)

    def test_a_completed_run_publishes_exactly_once(self) -> None:
        job = jobs.create("tenant-x")
        jobs.run(job, ["col"], [["a"], ["b"]])
        self.assertEqual(job.status, "done")
        self.assertIn(b"a", job.result)
        self.assertEqual(job.row_count, 2)

    def test_cancel_on_an_already_finished_job_is_a_no_op(self) -> None:
        job = jobs.create("tenant-x")
        jobs.run(job, ["col"], [["a"]])
        self.assertFalse(jobs.cancel("tenant-x", job.id))

    def test_a_job_is_scoped_to_its_own_tenant(self) -> None:
        job = jobs.create("tenant-x")
        self.assertIsNone(jobs.get("tenant-y", job.id))
        self.assertFalse(jobs.cancel("tenant-y", job.id))


class ExportHttpTests(unittest.TestCase):
    """Same harness as case_policy_test.CaseHttpTests: a file-backed SQLite
    connector (each request opens its own connection on its worker thread)
    and real RS256 tokens from the synthetic dev issuer."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved = app.state.connect
        app.state.connect = connector("", Path(cls.tmp.name) / "api.sqlite3")
        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect = cls.saved
        cls.tmp.cleanup()

    def auth(self, name: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {app.state.dev_issuer.mint(_uid(name))}"}

    def _wait(self, job_id: str) -> dict:
        for _ in range(100):
            status = self.client.get(f"/v1/reports/export/{job_id}", headers=self.auth("user.supervisor")).json()
            if status["status"] != "running":
                return status
            time.sleep(0.02)
        self.fail("export never finished")

    def test_workers_cannot_export_or_read_metrics(self) -> None:
        self.assertEqual(self.client.post("/v1/reports/export", json={}, headers=self.auth("user.worker")).status_code, 403)
        self.assertEqual(self.client.get("/v1/reports/metrics", headers=self.auth("user.worker")).status_code, 403)

    def test_supervisor_exports_and_downloads_a_complete_csv(self) -> None:
        started = self.client.post("/v1/reports/export", json={}, headers=self.auth("user.supervisor"))
        self.assertEqual(started.status_code, 200)
        job_id = started.json()["job_id"]
        self.assertEqual(self._wait(job_id)["status"], "done")
        content = self.client.get(f"/v1/reports/export/{job_id}/content", headers=self.auth("user.supervisor"))
        self.assertEqual(content.status_code, 200)
        self.assertTrue(content.text.startswith("case_id,status,"))
        self.assertEqual(content.headers["content-disposition"], "attachment; filename=cases.csv")
        self.assertEqual(content.headers["cache-control"], "private, no-store")

    def test_another_tenant_cannot_see_the_job(self) -> None:
        started = self.client.post("/v1/reports/export", json={}, headers=self.auth("user.supervisor"))
        job_id = started.json()["job_id"]
        self._wait(job_id)
        # other-worker is in the other synthetic tenant; the job is invisible, not forbidden.
        self.assertEqual(self.client.get(f"/v1/reports/export/{job_id}", headers=self.auth("user.other-worker")).status_code, 404)
        self.assertEqual(self.client.get(f"/v1/reports/export/{job_id}/content",
                                         headers=self.auth("user.other-worker")).status_code, 404)


if __name__ == "__main__":
    unittest.main()
