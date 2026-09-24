"""T33: request ids trace failures; logs carry no sensitive fields; alerts are
actionable. Verification per the card: inject a known failure and sensitive
markers, then inspect what was logged.

Run: python -m unittest tests.telemetry_test -v
"""

from __future__ import annotations

import json
import sqlite3
import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient

import tests.sync_push_test as t13
from services.api.app import telemetry
from services.api.app.db import migrate
from services.api.app.main import app
from services.api.app.sync_push import push_events

MARKERS = ("SECRET_QUERY_7f3a", "SECRET_BEARER_9c1d", "SECRET_BODY_2b8e", "SECRET_MESSAGE_5d4c")


@app.get("/__t33_crash")
def _crash() -> None:  # test-only route: an unexpected fault whose message holds a secret
    raise ValueError(MARKERS[3])


class TracingTests(unittest.TestCase):
    def logged(self, method: str, path: str, **kwargs) -> tuple[object, list[dict]]:
        with self.assertLogs("jalsakshi.requests", level="INFO") as captured:
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.request(method, path, **kwargs)
        return response, [json.loads(line.split(":", 2)[2]) for line in captured.output]

    def test_a_supplied_request_id_is_echoed_in_header_body_and_log(self) -> None:
        response, lines = self.logged("GET", "/v1/me", headers={"X-Request-Id": "trace-me-123"})
        self.assertEqual(response.headers["X-Request-Id"], "trace-me-123")
        self.assertEqual(response.json()["request_id"], "trace-me-123")
        self.assertEqual(lines[-1]["request_id"], "trace-me-123")

    def test_a_generated_request_id_is_one_value_everywhere(self) -> None:
        response, lines = self.logged("GET", "/v1/cases/not-a-case")
        rid = response.headers["X-Request-Id"]
        self.assertEqual(response.json()["request_id"], rid)
        self.assertEqual(lines[-1]["request_id"], rid)
        self.assertEqual(lines[-1]["route"], "/v1/cases/{case_id}", "the template, never the raw path")

    def test_sensitive_markers_never_reach_the_log(self) -> None:
        _, lines = self.logged(
            "PUT", f"/v1/evidence/00000000-0000-4000-8000-000000000000/content?token={MARKERS[0]}",
            headers={"Authorization": f"Bearer {MARKERS[1]}"}, content=MARKERS[2].encode())
        text = json.dumps(lines)
        for marker in MARKERS[:3]:
            self.assertNotIn(marker, text)
        self.assertEqual(set(lines[-1]), {"ts", "request_id", "method", "route", "status", "ms"})

    def test_an_unexpected_crash_is_a_traceable_500_without_its_message(self) -> None:
        response, lines = self.logged("GET", "/__t33_crash")
        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertEqual(body["code"], "INTERNAL_ERROR")
        self.assertEqual(body["request_id"], response.headers["X-Request-Id"])
        self.assertEqual((lines[-1]["status"], lines[-1]["error"]), (500, "ValueError"))
        self.assertNotIn(MARKERS[3], json.dumps(lines) + response.text)


class AlertTests(unittest.TestCase):
    def test_alerts_fire_with_an_action_and_only_counts(self) -> None:
        db = sqlite3.connect(":memory:")
        migrate(db)
        t13.seed_sources(db)
        now = datetime(2026, 9, 25, tzinfo=timezone.utc)
        self.assertEqual(telemetry.alerts(db, now), [], "an empty system raises nothing")
        payload = t13.sample("alert")
        push_events(db, t13.session(), t13.request(("ev-alert", "sample.create", payload)),
                    server_data_mode="synthetic", server_time="2026-09-20T00:00:00Z")
        db.execute("UPDATE cases SET due_at = '2026-09-22T00:00:00Z'")
        db.commit()
        fired = {a["alert"]: a for a in telemetry.alerts(db, now)}
        self.assertEqual(set(fired), {"overdue_open_cases", "unassigned_cases_older_than_1_day"})
        self.assertTrue(all(a["action"] and a["count"] == 1 for a in fired.values()))
        self.assertNotIn(t13.uid("alert"), json.dumps(list(fired.values())), "counts only, no ids")


if __name__ == "__main__":
    unittest.main()
