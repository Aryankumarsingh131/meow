"""T46: closure-policy regression tests for DRAFT policy v1.

The policy these tests pin down is docs/closure-policy-approval.md, which is
PENDING domain sign-off. Passing these tests means the code does what the
draft says; it does not mean a domain reviewer has approved the draft.

Run: python -m unittest tests.closure_policy_test -v
"""

from __future__ import annotations

import unittest

import tests.sync_push_test as t13
from services.api.app import case_policy as policy
from services.api.app.cases import load_case
from services.api.app.lab_reports import record_report
from tests.communication_test import SUPERVISOR, ClosureHarness
from tests.lab_test import report


class ExemptionsMustBeExplicitTests(ClosureHarness):
    """Draft rule E1: an exemption reason shorter than MIN_DISPOSITION, or
    only whitespace, is not an exemption."""

    def test_a_trivial_exemption_reason_is_not_accepted_for_any_field(self) -> None:
        self._to_closure_review()
        for field, real_key in (("verified_report_exemption_reason", "verified_report_id"),
                                ("retest_exemption_reason", "retest_sample_id"),
                                ("action_exemption_reason", None)):
            for weak in ("x", " " * 40, "n/a"):
                with self.subTest(field=field, reason=weak):
                    over = {field: weak}
                    if real_key:
                        over[real_key] = None  # force the exemption path for this field
                    outcome = self.run_cmd(self.cid, "close", self._close_payload(**over), self.version)
                    self.assertEqual(outcome.code, "CLOSURE_EVIDENCE_INCOMPLETE")
                    self.assertIn(real_key or "action_ids", outcome.field_errors)

    def test_a_substantive_exemption_reason_is_accepted_and_recorded_on_the_closure_event(self) -> None:
        self._to_closure_review()
        reason = "Retest not possible: source decommissioned by the water authority on 2026-09-23."
        close = self.run_cmd(self.cid, "close", self._close_payload(retest_sample_id=None, retest_exemption_reason=reason),
                             self.version)
        self.assertEqual(close.status, "closed")
        payload = self.db.execute("SELECT payload_json FROM case_events WHERE command_id = ?", (close.command_id,)).fetchone()[0]
        self.assertIn(reason, payload, "the exemption is on the permanent record, not just accepted")


class NoBlanketSafeLabelTests(ClosureHarness):
    """Draft rule E2: closing records a disposition and a policy version, never
    a safety/potability verdict. There is no column for one."""

    def test_the_case_row_has_no_safety_verdict_column(self) -> None:
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(cases)")}
        self.assertFalse(columns & {"safe", "is_safe", "potable", "safety", "verdict"}, columns)

    def test_closure_records_the_policy_version_in_force(self) -> None:
        self._to_closure_review()
        self.run_cmd(self.cid, "close", self._close_payload(), self.version)
        self.assertEqual(load_case(self.db, t13.TENANT_A, self.cid)["policy_version"], policy.POLICY_VERSION)


class DisputedReportTriggersReviewTests(ClosureHarness):
    """Draft rule E3: if the report a closure relied on is later corrected, the
    closed case is flagged for re-review - it is neither silently left closed
    nor silently reopened."""

    def test_correcting_the_relied_on_report_flags_the_closed_case(self) -> None:
        self._to_closure_review()
        close = self.run_cmd(self.cid, "close", self._close_payload(), self.version)
        self.assertEqual(close.status, "closed")
        correction = record_report(self.db, SUPERVISOR, report(self.cid, supersedes_id=self.report_id,
                                                              lab_interpretation="exceeds_limit"), now="2026-09-26T00:00:00Z")
        self.assertEqual(correction.supersedes_id, self.report_id)
        case = load_case(self.db, t13.TENANT_A, self.cid)
        self.assertEqual(case["status"], "closed", "not silently reopened")
        self.assertTrue(case["requires_rereview"], "not silently left as-is")

    def test_the_superseded_report_no_longer_counts_as_current_evidence(self) -> None:
        self._to_closure_review()
        record_report(self.db, SUPERVISOR, report(self.cid, supersedes_id=self.report_id), now="2026-09-26T00:00:00Z")
        outcome = self.run_cmd(self.cid, "close", self._close_payload(),
                               load_case(self.db, t13.TENANT_A, self.cid)["version"])
        self.assertEqual(outcome.code, "CLOSURE_EVIDENCE_INCOMPLETE")
        self.assertIn("verified_report_id", outcome.field_errors)


class PolicyIsDraftTests(unittest.TestCase):
    def test_the_policy_document_still_says_pending(self) -> None:
        """A guard against quietly treating the draft as approved: this test
        must be deliberately updated in the same change that records a real
        reviewer's sign-off."""
        from pathlib import Path

        doc = (Path(__file__).resolve().parents[1] / "docs" / "closure-policy-approval.md").read_text(encoding="utf-8")
        self.assertIn("Status: **PENDING", doc)
        self.assertIn(f"POLICY_VERSION = {policy.POLICY_VERSION}", doc)


if __name__ == "__main__":
    unittest.main()
