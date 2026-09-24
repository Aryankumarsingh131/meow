"""T20: action records keep owner, work and due date without closing a case."""

from tests.case_policy_test import Harness, NOW, SUPERVISOR, DUE, command
from services.api.app.case_reads import case_detail
from services.api.app.cases import Refused


class ActionTests(Harness):
    def test_record_action_retains_who_what_when_and_does_not_close(self) -> None:
        self.push("action", "review")
        case_id = self.case_id("action")
        self.force(case_id, "closure_review")
        result = self.run_cmd(case_id, command("record_action", 1, {
            "description": "Synthetic pipe repair", "owner_id": SUPERVISOR.user_id, "due_at": DUE,
        }))
        self.assertNotIsInstance(result, Refused)
        detail = case_detail(self.db, SUPERVISOR, case_id, now=NOW)
        self.assertEqual(detail["status"], "action_required")
        self.assertEqual(detail["actions"][0]["description"], "Synthetic pipe repair")
        self.assertEqual(detail["actions"][0]["owner_id"], SUPERVISOR.user_id)
        self.assertEqual(detail["actions"][0]["due_at"], "2026-10-01T00:00:00Z")
        self.assertIsNone(detail["actions"][0]["completed_at"])

    def test_unassigned_action_is_refused(self) -> None:
        self.push("action-bad", "review")
        case_id = self.case_id("action-bad")
        self.force(case_id, "closure_review")
        result = self.run_cmd(case_id, command("record_action", 1, {
            "description": "Synthetic repair", "owner_id": "00000000-0000-0000-0000-000000000001", "due_at": DUE,
        }))
        self.assertEqual(result.code, "CASE_OWNER_REQUIRED")
        self.assertEqual(self.db.execute("SELECT count(*) FROM actions").fetchone()[0], 0)

    def test_blank_action_description_is_refused(self) -> None:
        self.push("blank-action", "review")
        case_id = self.case_id("blank-action")
        self.force(case_id, "closure_review")
        result = self.run_cmd(case_id, command("record_action", 1, {
            "description": "   ", "owner_id": SUPERVISOR.user_id, "due_at": DUE,
        }))
        self.assertEqual(result.code, "VALIDATION_FAILED")

    def test_completion_note_is_retained_and_does_not_close(self) -> None:
        self.push("complete-action", "review")
        case_id = self.case_id("complete-action")
        self.force(case_id, "closure_review")
        recorded = self.run_cmd(case_id, command("record_action", 1, {
            "description": "Synthetic pipe repair", "owner_id": SUPERVISOR.user_id, "due_at": DUE,
        }))
        self.assertNotIsInstance(recorded, Refused)
        accepted = self.run_cmd(case_id, command("accept_action", recorded.version, {
            "action_id": recorded.command_id, "completed_at": NOW,
            "evidence_note": "Operator observed the synthetic repair complete.",
        }))
        self.assertEqual(accepted.status, "retest_due")
        detail = case_detail(self.db, SUPERVISOR, case_id, now=NOW)
        self.assertEqual(detail["status"], "retest_due")
        self.assertEqual(detail["actions"][0]["completed_at"], NOW)
        self.assertEqual(detail["actions"][0]["evidence"][0]["kind"], "operator_note")
        self.assertEqual(detail["actions"][0]["evidence"][0]["note"],
                         "Operator observed the synthetic repair complete.")

    def test_lost_response_replay_does_not_duplicate_action_or_note(self) -> None:
        self.push("replay-action", "review")
        case_id = self.case_id("replay-action")
        self.force(case_id, "closure_review")
        record = command("record_action", 1, {
            "description": "Synthetic repair", "owner_id": SUPERVISOR.user_id, "due_at": DUE,
        })
        first = self.run_cmd(case_id, record)
        self.assertEqual(self.run_cmd(case_id, record), first)
        accept = command("accept_action", first.version, {
            "action_id": first.command_id, "completed_at": NOW,
            "evidence_note": "Operator observed the synthetic repair complete.",
        })
        second = self.run_cmd(case_id, accept)
        self.assertEqual(self.run_cmd(case_id, accept), second)
        self.assertEqual(self.db.execute("SELECT count(*) FROM actions").fetchone()[0], 1)
        self.assertEqual(self.db.execute("SELECT count(*) FROM action_evidence").fetchone()[0], 1)
        self.assertEqual(self.version(case_id), 3)

    def test_another_case_action_cannot_be_accepted(self) -> None:
        self.push("other-a", "review")
        self.push("other-b", "review")
        a, b = self.case_id("other-a"), self.case_id("other-b")
        self.force(a, "closure_review")
        self.force(b, "action_required")
        recorded = self.run_cmd(a, command("record_action", 1, {
            "description": "Synthetic pipe repair", "owner_id": SUPERVISOR.user_id, "due_at": DUE,
        }))
        rejected = self.run_cmd(b, command("accept_action", 1, {
            "action_id": recorded.command_id, "completed_at": NOW,
            "evidence_note": "Wrong case must not inherit this note.",
        }))
        self.assertEqual(rejected.code, "ACTION_EVIDENCE_MISSING")

    def test_blank_evidence_note_is_not_completion(self) -> None:
        self.push("blank-note", "review")
        case_id = self.case_id("blank-note")
        self.force(case_id, "closure_review")
        recorded = self.run_cmd(case_id, command("record_action", 1, {
            "description": "Synthetic repair", "owner_id": SUPERVISOR.user_id, "due_at": DUE,
        }))
        rejected = self.run_cmd(case_id, command("accept_action", recorded.version, {
            "action_id": recorded.command_id, "completed_at": NOW,
            "evidence_note": "           ",
        }))
        self.assertEqual(rejected.code, "ACTION_EVIDENCE_MISSING")
