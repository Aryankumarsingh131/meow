"""T18 backend: case board/detail reads and the web cookie session.

Run: python -m unittest tests.case_reads_test -v
All data synthetic.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

import tests.sync_push_test as t13
from services.api.app import dev_seed
from services.api.app.case_reads import case_detail, list_cases
from services.api.app.cases import Refused
from services.api.app.db import connector, migrate
from services.api.app.dev_issuer import _uid
from services.api.app.main import app
from services.api.app.sync_push import push_events

NOW = "2026-09-24T12:00:00Z"
SUP = t13.session(role="supervisor")


class ReadTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        migrate(self.db)
        t13.seed_sources(self.db)
        self.ids = {}
        for name, due in (("a", "2026-09-20T00:00:00Z"), ("b", "2026-09-30T00:00:00Z"), ("c", None), ("d", "2026-09-23T17:30:00Z"), ("e", None)):
            push_events(self.db, t13.session(), t13.request((f"ev-{name}", "sample.create", t13.sample(name))),
                        server_data_mode="synthetic", server_time=NOW)
            cid = self.db.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (t13.uid(name),)).fetchone()[0]
            self.ids[name] = cid
            if due:
                self.db.execute("UPDATE cases SET due_at = ?, owner_id = ? WHERE id = ?", (due, SUP.user_id, cid))
        self.db.execute("UPDATE cases SET status = 'closed' WHERE id = ?", (self.ids["a"],))
        self.db.commit()

    def page(self, **kw):
        args = {"status": None, "owner_id": None, "overdue": None, "source_id": None, "cursor": None, "limit": 50, "now": NOW}
        args.update(kw)
        return list_cases(self.db, SUP, **args)

    def all_pages(self, **kw) -> list:
        items, cursor = [], None
        while True:
            page = self.page(cursor=cursor, **kw)
            items += page.items
            cursor = page.next_cursor
            if cursor is None:
                return items

    def test_workers_cannot_see_the_queue(self) -> None:
        worker = t13.session()
        self.assertEqual(list_cases(self.db, worker, status=None, owner_id=None, overdue=None, source_id=None,
                                    cursor=None, limit=10, now=NOW).code, "FORBIDDEN")
        self.assertEqual(case_detail(self.db, worker, self.ids["b"], now=NOW).code, "FORBIDDEN")

    def test_stable_order_nulls_last_and_paging_matches_totals(self) -> None:
        full = self.page()
        self.assertEqual(full.total, 5)
        paged = self.all_pages(limit=2)
        self.assertEqual([i.id for i in paged], [i.id for i in full.items])
        self.assertEqual(len(paged), full.total)
        dues = [i.due_at for i in full.items]
        self.assertEqual(dues[-2:], [None, None], "unassigned due dates sort last")

    def test_overdue_uses_the_server_clock_and_ignores_closed_cases(self) -> None:
        overdue = {i.id for i in self.page(overdue=True).items}
        # a: past but closed (not overdue); d: 17:30Z on the 23rd, before NOW -> overdue.
        self.assertEqual(overdue, {self.ids["d"]})
        self.assertEqual(self.page(overdue=True, now="2026-09-23T17:00:00Z").total, 0, "a different server time changes it")
        not_overdue = self.page(overdue=False)
        self.assertEqual(not_overdue.total + self.page(overdue=True).total, 5)

    def test_filters_and_counts_agree(self) -> None:
        for kw in ({"status": "review_needed"}, {"status": "closed"}, {"owner_id": SUP.user_id},
                   {"source_id": t13.SOURCE_A}, {"owner_id": str(uuid4())}):
            with self.subTest(**kw):
                items = self.all_pages(limit=1, **kw)
                self.assertEqual(len(items), self.page(**kw).total)
        self.assertEqual(self.page(status="closed").total, 1)
        self.assertEqual(self.page(status="bogus").code, "VALIDATION_FAILED")

    def test_cursor_is_bound_to_its_filters_and_tenant(self) -> None:
        cursor = self.page(limit=1).next_cursor
        self.assertEqual(self.page(cursor=cursor, status="review_needed").code, "VALIDATION_FAILED")
        self.assertEqual(self.page(cursor="garbage").code, "VALIDATION_FAILED")
        other = t13.session(t13.TENANT_B, role="supervisor")
        self.assertEqual(list_cases(self.db, other, status=None, owner_id=None, overdue=None, source_id=None,
                                    cursor=cursor, limit=1, now=NOW).code, "VALIDATION_FAILED")
        self.assertEqual(list_cases(self.db, other, status=None, owner_id=None, overdue=None, source_id=None,
                                    cursor=None, limit=50, now=NOW).total, 0, "other tenant sees none of these")

    def test_detail_keeps_provenance_separate_and_exposes_no_urls(self) -> None:
        detail = case_detail(self.db, SUP, self.ids["b"], now=NOW)
        sample = detail["trigger_sample"]
        self.assertEqual(sample["machine_suggestion"], {"bin": "bin_b"})
        self.assertEqual(sample["human_observation"]["manual_bin"], "bin_a")
        self.assertEqual(sample["human_observation"]["selected_bin"], "bin_a")
        self.assertEqual([e["event_type"] for e in detail["timeline"]], ["case.opened"])
        self.assertNotIn("url", json.dumps(detail).lower())
        self.assertEqual(case_detail(self.db, t13.session(t13.TENANT_B, role="supervisor"), self.ids["b"], now=NOW),
                         Refused("NOT_FOUND", "Case was not found."))


class BoardApiTests(unittest.TestCase):
    """The API exactly as the separate supervisor board calls it: bearer token,
    JSON over HTTP, through the real app and T06 authenticate()."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved = app.state.connect
        app.state.connect = connector("", Path(cls.tmp.name) / "api.sqlite3")
        cls.client = TestClient(app)
        cls.client.__enter__()
        for _ in range(3):
            payload = t13.sample("board", dev_seed.source_id("src.1"))
            payload["sample_id"] = str(uuid4())
            pushed = cls.client.post("/v1/sync/push", headers=cls.auth("user.worker"), json={
                "device_id": str(uuid4()),
                "events": [{"event_id": str(uuid4()), "kind": "sample.create", "schema_version": 1, "payload": payload}]})
            assert pushed.json()["results"][0]["status"] == "accepted", pushed.text

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect = cls.saved
        cls.tmp.cleanup()

    @staticmethod
    def auth(name: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {app.state.dev_issuer.mint(_uid(name))}"}

    def test_me_reports_only_the_callers_own_membership(self) -> None:
        me = self.client.get("/v1/me", headers=self.auth("user.supervisor")).json()
        self.assertEqual((me["user_id"], me["role"]), (_uid("user.supervisor"), "supervisor"))
        self.assertEqual(self.client.get("/v1/me").status_code, 401)

    def test_board_list_detail_and_command_over_http(self) -> None:
        sup = self.auth("user.supervisor")
        page = self.client.get("/v1/cases", headers=sup, params={"status": "review_needed", "limit": 2})
        self.assertEqual(page.status_code, 200, page.text)
        body = page.json()
        self.assertEqual((body["total"], len(body["items"])), (3, 2))
        self.assertIsNotNone(body["next_cursor"])
        rest = self.client.get("/v1/cases", headers=sup, params={"status": "review_needed", "limit": 2, "cursor": body["next_cursor"]}).json()
        self.assertEqual(len(rest["items"]), 1)
        self.assertEqual(len({i["id"] for i in body["items"] + rest["items"]}), 3, "no row repeated or skipped")
        wrong_filter = self.client.get("/v1/cases", headers=sup, params={"status": "closed", "cursor": body["next_cursor"]})
        self.assertEqual((wrong_filter.status_code, wrong_filter.json()["code"]), (422, "VALIDATION_FAILED"))

        case_id = body["items"][0]["id"]
        detail = self.client.get(f"/v1/cases/{case_id}", headers=sup).json()
        self.assertEqual(detail["trigger_sample"]["machine_suggestion"], {"bin": "bin_b"})
        self.assertEqual(detail["trigger_sample"]["human_observation"]["manual_bin"], "bin_a")
        self.assertNotIn("url", json.dumps(detail).lower())

        command = {"type": "assign", "command_id": str(uuid4()), "expected_version": detail["version"],
                   "payload": {"owner_id": _uid("user.supervisor"), "due_at": "2026-10-01T23:59:59+05:30"}}
        ok = self.client.post(f"/v1/cases/{case_id}/commands", headers=sup, json=command)
        self.assertEqual(ok.status_code, 200, ok.text)
        stale = self.client.post(f"/v1/cases/{case_id}/commands", headers=sup, json={**command, "command_id": str(uuid4())})
        self.assertEqual((stale.status_code, stale.json()["current_version"]), (409, detail["version"] + 1))
        mine = self.client.get("/v1/cases", headers=sup, params={"owner_id": _uid("user.supervisor")}).json()
        self.assertEqual([i["id"] for i in mine["items"]], [case_id])
        self.assertEqual(mine["items"][0]["due_at"], "2026-10-01T18:29:59Z", "stored in UTC")

    def test_workers_and_other_tenants_get_nothing(self) -> None:
        self.assertEqual(self.client.get("/v1/cases", headers=self.auth("user.worker")).status_code, 403)
        other = self.client.get("/v1/cases", headers=self.auth("user.other-worker"))
        self.assertEqual(other.status_code, 403)
        self.assertEqual(self.client.get("/v1/cases").status_code, 401)


class CorsTests(unittest.TestCase):
    """CORS for the separately hosted board, checked on the REAL main.py (settings
    are read at import, so each case runs in a fresh interpreter)."""

    PROBE = """
import json
from fastapi.testclient import TestClient
from services.api.app.main import app
c = TestClient(app)
out = {}
for origin in ("https://board.example", "https://evil.example"):
    r = c.options("/v1/cases", headers={"Origin": origin, "Access-Control-Request-Method": "GET",
                                       "Access-Control-Request-Headers": "authorization"})
    out[origin] = [r.status_code, r.headers.get("access-control-allow-origin"),
                   r.headers.get("access-control-allow-credentials")]
print(json.dumps(out))
"""

    def probe(self, allowed: str) -> dict:
        import os
        import subprocess
        import sys

        env = {k: v for k, v in os.environ.items() if not k.startswith("JALSAKSHI_")}
        env.update({"JALSAKSHI_ENVIRONMENT": "development", "JALSAKSHI_TENANT_DATA_MODE": "synthetic",
                    "JALSAKSHI_CORS_ALLOWED_ORIGINS": allowed})
        with tempfile.TemporaryDirectory() as cwd:  # no .env there
            run = subprocess.run([sys.executable, "-c", self.PROBE], env={**env, "PYTHONPATH": str(Path(__file__).resolve().parents[1])},
                                 cwd=cwd, capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stderr)
        return json.loads(run.stdout.strip().splitlines()[-1])

    def test_only_listed_origins_and_never_credentials(self) -> None:
        result = self.probe("https://board.example")
        self.assertEqual(result["https://board.example"][:2], [200, "https://board.example"])
        self.assertIsNone(result["https://board.example"][2], "no credentialed CORS")
        self.assertIsNone(result["https://evil.example"][1], "unlisted origin gets no CORS header")

    def test_no_origins_configured_means_no_cors(self) -> None:
        result = self.probe("")
        self.assertIsNone(result["https://board.example"][1])


if __name__ == "__main__":
    unittest.main()
