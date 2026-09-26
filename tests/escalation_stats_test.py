"""010 escalation emails and the public stats graphs (pure parts; no database, no SMTP).

Run:  python -m unittest tests.escalation_stats_test
"""

import unittest
from datetime import datetime, timedelta, timezone

from services.api.app import escalation
from services.api.app.config import Settings
from services.api.app.public_v2 import build_stats


class FakeConn:
    """Enough of a psycopg connection for send_queued."""

    def __init__(self, rows):
        self.rows, self.updates, self.committed = rows, [], False

    def execute(self, sql, params=()):
        if sql.lstrip().startswith("select"):
            return type("C", (), {"fetchall": lambda _self: self.rows})()
        self.updates.append((sql, params))
        return None

    def commit(self):
        self.committed = True


class EscalationTests(unittest.TestCase):
    def test_no_smtp_means_nothing_is_sent_and_emails_stay_queued(self):
        self.assertIsNone(escalation.smtp_settings(Settings(_env_file=None)))
        conn = FakeConn([("n1", "office@example.org", "Subject\nbody")])
        self.assertEqual(escalation.send_queued(conn, None), (0, 0))
        self.assertEqual(conn.updates, [])

    def test_smtp_settings_come_from_the_environment(self):
        s = escalation.smtp_settings(Settings(_env_file=None, smtp_host="smtp.example.org", smtp_user="bot@example.org", smtp_password="x"))
        self.assertEqual((s.host, s.port, s.sender, s.starttls), ("smtp.example.org", 587, "bot@example.org", True))

    def test_queued_emails_are_sent_and_marked(self):
        sent = []
        conn = FakeConn([("n1", "office@example.org", "JalSakshi escalation: x\nbody"), ("n2", "b@example.org", "s\nb")])
        self.assertEqual(escalation.send_queued(conn, None, send=sent.append), (2, 0))
        self.assertEqual([m["To"] for m in sent], ["office@example.org", "b@example.org"])
        self.assertEqual(sent[0]["Subject"], "JalSakshi escalation: x")
        self.assertTrue(all("'sent'" in sql for sql, _ in conn.updates))
        self.assertTrue(conn.committed)

    def test_a_failed_send_is_marked_failed_not_sent(self):
        def boom(_msg):
            raise OSError("down")
        conn = FakeConn([("n1", "office@example.org", "s\nb")])
        self.assertEqual(escalation.send_queued(conn, None, send=boom), (0, 1))
        self.assertIn("'failed'", conn.updates[0][0])

    def test_email_states_the_record_not_a_verdict(self):
        body = escalation.compose("Pump #3", "East Plains", "high", "sent_to_lab", "screening", 48, "r-1")
        self.assertIn("open for more than 48 hours", body)
        self.assertIn("sent to lab", body)
        self.assertIn("not a laboratory result", body)
        for word in ("unsafe", "contaminated", "potable", "boil"):
            self.assertNotIn(word, body.lower())


class StatsTests(unittest.TestCase):
    def test_weekly_buckets_and_mixes(self):
        now = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)   # a Saturday
        stats = build_stats(
            now,
            records=[(now - timedelta(days=1), "low"), (now - timedelta(days=2), "high"), (now - timedelta(days=9), "medium"),
                     (now - timedelta(days=200), "low")],
            reports=[(now - timedelta(days=2), None, 1), (now - timedelta(days=9), now - timedelta(days=1), 0)],
            complaints=[(now - timedelta(days=3), "smell"), (now - timedelta(days=4), "smell"), (now, "taste")],
            sources=[("well", "under_review"), ("well", "not_tested"), ("tap", "not_tested")])
        weeks = stats["weeks"]
        self.assertEqual(len(weeks), 12)
        self.assertEqual(weeks[-1]["week_start"], "2026-09-21")
        self.assertEqual((weeks[-1]["screenings"], weeks[-1]["flagged"], weeks[-2]["flagged"]), (2, 1, 1))
        self.assertEqual((weeks[-1]["reports_opened"], weeks[-1]["reports_closed"], weeks[-2]["reports_opened"]), (1, 1, 1))
        self.assertEqual(weeks[-1]["complaints"], 3)
        self.assertEqual(stats["risk_30d"], {"low": 1, "medium": 1, "high": 1, "unknown": 0})
        self.assertEqual(stats["sources_by_type"], {"well": 2, "tap": 1})
        self.assertEqual(stats["complaints_by_type"], {"smell": 2, "taste": 1})
        self.assertEqual(stats["totals"]["open_reports"], 1)
        self.assertEqual(stats["totals"]["escalated_to_authority"], 1)
        self.assertIn("not a laboratory result", stats["disclaimer"])


if __name__ == "__main__":
    unittest.main()
