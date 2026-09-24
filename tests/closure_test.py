"""T21: retest linking (case-state-machine.md row 10, retest_due -> link_retest -> closure_review).

A retest is only proof when it is a REAL sample, on the SAME source as the
case, captured AFTER the trigger sample - never the trigger sample itself and
never invented. `close` (row 11) still fails closed pending T22's
communication record; see case_policy.py's g_close.

Run: python -m unittest tests.closure_test -v
"""

from __future__ import annotations

import sqlite3
import unittest
from uuid import uuid4

import tests.sync_push_test as t13
from services.api.app.cases import apply_command, load_case
from services.api.app.db import migrate
from services.api.app.schemas import CaseCommandRequest
from pydantic import TypeAdapter

NOW = "2026-09-24T12:05:00Z"
COMMAND = TypeAdapter(CaseCommandRequest)
SUPERVISOR = t13.session(role="supervisor")
MEMBERS = {SUPERVISOR.user_id, t13.session(role="worker").user_id}


def command(kind: str, version: int, payload: dict | None = None):
    return COMMAND.validate_python({
        "type": kind, "command_id": str(uuid4()), "expected_version": version, "payload": payload or {},
    })


class RetestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        migrate(self.db)
        t13.seed_sources(self.db)
        self.push("trigger", "review")
        self.cid = self.case_id("trigger")
        self.db.execute("UPDATE cases SET status = 'retest_due', owner_id = ?, due_at = ? WHERE id = ?",
                        (SUPERVISOR.user_id, "2026-10-01T00:00:00Z", self.cid))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()

    def push(self, name: str, flag: str = "no_flag", **overrides) -> None:
        payload = t13.sample(name, **overrides)
        payload["observation"] = {**payload["observation"], "indicative_flag": flag}
        from services.api.app.sync_push import push_events
        result = push_events(self.db, t13.session(), t13.request((f"ev-{name}", "sample.create", payload)),
                             server_data_mode="synthetic", server_time=NOW)
        self.assertEqual(result.results[0].status, "accepted", result.results[0])

    def case_id(self, name: str) -> str:
        return self.db.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (t13.uid(name),)).fetchone()[0]

    def run_cmd(self, retest_sample_id: str | None):
        case = load_case(self.db, t13.TENANT_A, self.cid)
        payload = {"retest_sample_id": retest_sample_id} if retest_sample_id else {}
        return apply_command(self.db, SUPERVISOR, self.cid, command("link_retest", case["version"], payload),
                             is_active_member=lambda u: u in MEMBERS, now=NOW)

    def test_missing_proof_is_refused(self) -> None:
        self.assertEqual(self.run_cmd(None).code, "RETEST_INVALID")

    def test_a_nonexistent_sample_is_refused(self) -> None:
        self.assertEqual(self.run_cmd(str(uuid4())).code, "RETEST_INVALID")

    def test_the_trigger_sample_itself_is_not_its_own_retest(self) -> None:
        self.assertEqual(self.run_cmd(t13.uid("trigger")).code, "RETEST_INVALID")

    def test_a_different_source_is_refused(self) -> None:
        # SOURCE_B belongs to TENANT_B in seed_sources, so a same-tenant second source is used instead.
        self.db.execute(
            "INSERT INTO sources (tenant_id,id,qr_code,label,locality,active,version) VALUES (?,?,?,?,?,?,?)",
            (t13.TENANT_A, t13.uid("source-a2"), "JS-A2", "Pump A2", "Locality A2", True, 1),
        )
        self.db.commit()
        self.push("wrong-source", source_id=t13.uid("source-a2"), captured_at_device="2026-09-25T12:00:00Z")
        self.assertEqual(self.run_cmd(t13.uid("wrong-source")).code, "RETEST_INVALID")

    def test_a_retest_captured_before_the_trigger_is_refused(self) -> None:
        self.push("earlier", captured_at_device="2026-09-20T00:00:00Z")
        self.assertEqual(self.run_cmd(t13.uid("earlier")).code, "RETEST_INVALID")

    def test_a_same_source_later_retest_is_accepted_and_moves_to_closure_review(self) -> None:
        self.push("later", captured_at_device="2026-09-25T00:00:00Z")
        outcome = self.run_cmd(t13.uid("later"))
        self.assertEqual(outcome.status, "closure_review")
        case = load_case(self.db, t13.TENANT_A, self.cid)
        self.assertEqual(case["retest_sample_id"], t13.uid("later"))

    def test_concurrent_link_retest_commands_race_safely(self) -> None:
        """One wins, the other sees a version conflict; nothing is double-applied."""
        self.push("racer", captured_at_device="2026-09-25T00:00:00Z")
        case = load_case(self.db, t13.TENANT_A, self.cid)
        first = apply_command(self.db, SUPERVISOR, self.cid,
                              command("link_retest", case["version"], {"retest_sample_id": t13.uid("racer")}),
                              is_active_member=lambda u: u in MEMBERS, now=NOW)
        second = apply_command(self.db, SUPERVISOR, self.cid,
                               command("link_retest", case["version"], {"retest_sample_id": t13.uid("racer")}),
                               is_active_member=lambda u: u in MEMBERS, now=NOW)
        self.assertEqual(first.status, "closure_review")
        self.assertEqual(second.code, "CASE_VERSION_CONFLICT")


if __name__ == "__main__":
    unittest.main()
