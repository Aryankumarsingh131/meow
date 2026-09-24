"""T22: resident communication record (case-state-machine.md row 13).

Recording a communication is the operator's OWN record of what was told to
whom, on which channel, using which template version - never a claim that
delivery happened. It never moves the case. `close` (row 11) reads this table
for real evidence: case_policy.g_close and case_policy_test's exhaustive table
cover the guard side; this file covers recording itself and the full
"real evidence closes the case" path (T19 lab verify + T21 retest + T22
communication all present).

Run: python -m unittest tests.communication_test -v
"""

from __future__ import annotations

import sqlite3
import unittest
from uuid import uuid4

import tests.sync_push_test as t13
from services.api.app import case_policy as policy
from services.api.app.cases import CommandReceipt, apply_command, load_case
from services.api.app.db import migrate
from services.api.app.lab_reports import decide_report, record_report
from services.api.app.sync_push import push_events
from tests.case_policy_test import command
from tests.lab_test import decision, report, trigger_payload

NOW = "2026-09-24T12:05:00Z"
SUPERVISOR = t13.session(role="supervisor")
LAB_REVIEWER = t13.session(role="lab_reviewer")
WORKER = t13.session(role="worker")
MEMBERS = {SUPERVISOR.user_id, LAB_REVIEWER.user_id, WORKER.user_id}


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        migrate(self.db)
        t13.seed_sources(self.db)

    def tearDown(self) -> None:
        self.db.close()

    def case_id(self, name: str) -> str:
        return self.db.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (t13.uid(name),)).fetchone()[0]

    def run_cmd(self, case_id: str, kind: str, payload: dict, version: int, command_id: str | None = None,
               actor=SUPERVISOR):
        return apply_command(self.db, actor, case_id, command(kind, version, payload, command_id),
                             is_active_member=lambda u: u in MEMBERS, now=NOW)


class RecordCommunicationTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        result = push_events(self.db, t13.session(), t13.request(("ev-trigger", "sample.create", trigger_payload("trigger"))),
                             server_data_mode="synthetic", server_time=NOW)
        self.assertEqual(result.results[0].status, "accepted")
        self.cid = self.case_id("trigger")

    def test_recording_never_moves_the_case(self) -> None:
        before = load_case(self.db, t13.TENANT_A, self.cid)
        outcome = self.run_cmd(self.cid, "record_communication", {
            "channel": "notice_board", "template_version": 1, "audience_description": "Ward residents near Pump A",
        }, before["version"])
        self.assertIsInstance(outcome, CommandReceipt)
        after = load_case(self.db, t13.TENANT_A, self.cid)
        self.assertEqual(after["status"], before["status"])
        self.assertEqual(after["version"], before["version"] + 1)

    def test_recording_is_idempotent_on_command_id(self) -> None:
        cid = str(uuid4())
        payload = {"channel": "sms", "template_version": 1, "audience_description": "Registered residents"}
        first = self.run_cmd(self.cid, "record_communication", payload, 1, command_id=cid)
        second = self.run_cmd(self.cid, "record_communication", payload, 1, command_id=cid)
        self.assertEqual((first.event_id, first.version), (second.event_id, second.version))
        rows = self.db.execute("SELECT count(*) FROM communications WHERE id = ?", (cid,)).fetchone()[0]
        self.assertEqual(rows, 1)

    def test_only_supervisor_and_admin_may_record(self) -> None:
        outcome = self.run_cmd(self.cid, "record_communication", {
            "channel": "sms", "template_version": 1, "audience_description": "x",
        }, 1, actor=WORKER)
        self.assertEqual(outcome.code, "FORBIDDEN")

    def test_a_communication_recorded_on_another_case_is_not_accepted(self) -> None:
        comm_id = str(uuid4())
        self.run_cmd(self.cid, "record_communication", {
            "channel": "sms", "template_version": 1, "audience_description": "x",
        }, 1, command_id=comm_id)
        result = push_events(self.db, t13.session(), t13.request(("ev-other", "sample.create", trigger_payload("other"))),
                             server_data_mode="synthetic", server_time=NOW)
        self.assertEqual(result.results[0].status, "accepted")
        other_cid = self.case_id("other")
        close_payload = {
            "verified_report_exemption_reason": "x", "retest_exemption_reason": "x",
            "action_exemption_reason": "x", "communication_id": str(uuid4()),
            "disposition": "x" * 20, "policy_version": 1,
        }
        ctx = policy.Context(
            connection=self.db, tenant_id=t13.TENANT_A, case=load_case(self.db, t13.TENANT_A, other_cid),
            command=command("close", 1, close_payload), trigger_sample={}, is_active_member=lambda u: True, now=NOW,
        )
        self.assertFalse(policy._communication_recorded(ctx, comm_id))


class ClosureHarness(Harness):
    """No tests of its own: builds a case in closure_review with real evidence
    (also reused by tests/closure_policy_test.py)."""

    def setUp(self) -> None:
        super().setUp()
        result = push_events(self.db, t13.session(), t13.request(("ev-trigger", "sample.create", trigger_payload("trigger"))),
                             server_data_mode="synthetic", server_time=NOW)
        self.assertEqual(result.results[0].status, "accepted")
        self.cid = self.case_id("trigger")

    def _to_closure_review(self) -> None:
        """assign -> refer_to_lab -> verified report -> row 7 (request retest,
        no sample) -> retest_due -> row 10 (link a real same-source, later
        retest) -> closure_review. Leaves self.report_id/self.comm_id/self.version set."""
        version = load_case(self.db, t13.TENANT_A, self.cid)["version"]
        assigned = self.run_cmd(self.cid, "assign", {"owner_id": SUPERVISOR.user_id, "due_at": "2026-10-01T00:00:00Z"}, version)
        self.run_cmd(self.cid, "refer_to_lab", {"lab_name": "Synthetic lab"}, assigned.version)
        rpt = record_report(self.db, SUPERVISOR, report(self.cid, lab_interpretation="exceeds_limit", result="SYN-C"), now=NOW)
        after_report = load_case(self.db, t13.TENANT_A, self.cid)["version"]
        decided = decide_report(self.db, LAB_REVIEWER, rpt.id, decision(after_report), now=NOW)
        requested = self.run_cmd(self.cid, "link_retest", {}, decided.case_version)
        self.assertEqual(requested.status, "retest_due")
        retest_payload = trigger_payload("retest")
        retest_payload["captured_at_device"] = "2026-09-25T00:00:00Z"
        result = push_events(self.db, t13.session(), t13.request(("ev-retest", "sample.create", retest_payload)),
                             server_data_mode="synthetic", server_time=NOW)
        self.assertEqual(result.results[0].status, "accepted")
        linked = self.run_cmd(self.cid, "link_retest", {"retest_sample_id": t13.uid("retest")}, requested.version)
        self.assertEqual(linked.status, "closure_review")
        comm_id = str(uuid4())
        communicated = self.run_cmd(self.cid, "record_communication", {
            "channel": "notice_board", "template_version": 1, "audience_description": "Ward residents near Pump A",
        }, linked.version, command_id=comm_id)
        self.report_id, self.comm_id, self.version = rpt.id, comm_id, communicated.version

    def _close_payload(self, **over) -> dict:
        payload = {
            "verified_report_id": self.report_id, "retest_sample_id": t13.uid("retest"),
            "action_exemption_reason": "SYN-COLOR-001 permits no direct action; T20 does not exist yet.",
            "communication_id": self.comm_id, "disposition": "Case closed: retested, residents informed.",
            "policy_version": policy.POLICY_VERSION,
        }
        payload.update(over)
        return payload


class FullClosureTests(ClosureHarness):
    """The whole "real evidence closes the case" path: refer to lab, a
    verified report (T19), a real same-source later retest linked via row
    7 -> row 10 (T21), and a recorded communication (T22) together satisfy
    close (row 11)."""

    def test_close_succeeds_with_real_report_retest_and_communication(self) -> None:
        self._to_closure_review()
        close = self.run_cmd(self.cid, "close", self._close_payload(), self.version)
        self.assertEqual(close.status, "closed")

    def test_close_refuses_an_unrecorded_communication(self) -> None:
        self._to_closure_review()
        outcome = self.run_cmd(self.cid, "close", self._close_payload(communication_id=str(uuid4())), self.version)
        self.assertEqual(outcome.code, "CLOSURE_EVIDENCE_INCOMPLETE")
        self.assertEqual(set(outcome.field_errors), {"communication_id"})

    def test_close_refuses_a_retest_sample_that_was_not_the_one_linked(self) -> None:
        self._to_closure_review()
        outcome = self.run_cmd(self.cid, "close", self._close_payload(retest_sample_id=str(uuid4())), self.version)
        self.assertEqual(outcome.code, "CLOSURE_EVIDENCE_INCOMPLETE")
        self.assertEqual(set(outcome.field_errors), {"retest_sample_id"})

    def test_close_refuses_a_report_id_that_is_not_a_current_verified_report(self) -> None:
        self._to_closure_review()
        outcome = self.run_cmd(self.cid, "close", self._close_payload(verified_report_id=str(uuid4())), self.version)
        self.assertEqual(outcome.code, "CLOSURE_EVIDENCE_INCOMPLETE")
        self.assertEqual(set(outcome.field_errors), {"verified_report_id"})

    def test_close_refuses_a_stale_policy_version(self) -> None:
        self._to_closure_review()
        outcome = self.run_cmd(self.cid, "close", self._close_payload(policy_version=999), self.version)
        self.assertEqual(outcome.code, "CLOSURE_EVIDENCE_INCOMPLETE")
        self.assertEqual(set(outcome.field_errors), {"policy_version"})

    def test_close_refuses_unverifiable_action_ids_even_with_a_real_uuid(self) -> None:
        self._to_closure_review()
        outcome = self.run_cmd(self.cid, "close", self._close_payload(
            action_exemption_reason=None, action_ids=[str(uuid4())]), self.version)
        self.assertEqual(outcome.code, "CLOSURE_EVIDENCE_INCOMPLETE")
        self.assertEqual(set(outcome.field_errors), {"action_ids"})


if __name__ == "__main__":
    unittest.main()
