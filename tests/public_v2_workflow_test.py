"""ERD workflow rules (004 + 006) against the REAL Supabase database.

Flow 2 test record -> exactly one report; flow 3 lab re-report loop; uploaded !=
verified; reports.version optimistic concurrency; guarded close with every
missing-prerequisite refusal; resident complaint review (link at the report's
version, open a resident-origin report, dismiss) and resolution on close;
flow 5 notifications; flow 8 supervisor-approved manual pins; public status
derivation. Every test is rolled back.

    python -m unittest tests.public_v2_workflow_test -v
"""

from __future__ import annotations

import unittest
import uuid

from tests.public_v2_postgres_test import URL, connect, new_resident, psycopg

EAST_SUP = "b1dd56bc-fe96-5352-99e6-0f1b5ff5d2ca"
EAST_WORKER = "2d9cf24d-1775-5653-93bb-6bda813c9741"
NORTH_SUP = "da8334ff-a77a-5e9a-9083-4354340dbe97"
EAST_PUMP = "b6e646c2-45e0-504e-9f12-44c1ac18bb15"      # East Plains, no reports in the demo data
CHLORINE_KIT = "6ecff65c-ff32-5141-83dd-9b51f9953ba2"
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffd9")


@unittest.skipIf(psycopg is None or not URL, "JALSAKSHI_DATABASE_URL not configured")
class WorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.c = connect()

    def tearDown(self) -> None:
        self.c.rollback()
        self.c.close()

    # --- helpers ---------------------------------------------------------------

    def q(self, sql: str, *args):
        return self.c.execute(sql, args).fetchone()

    def refused(self, message: str, sql: str, *args) -> None:
        self.c.execute("savepoint s")
        with self.assertRaisesRegex(psycopg.errors.RaiseException, message):
            self.c.execute(sql, args)
        self.c.execute("rollback to savepoint s")

    def add_test_record(self, risk: str, source: str = EAST_PUMP) -> str:
        return str(self.q(
            "insert into test_records (source_id, performed_by, kit_id, method, raw_input, computed_risk_level,"
            " local_record_id, synced_at) values (%s, %s, %s, 'manual', '{\"observed_color\": \"x\"}', %s, %s, now())"
            " returning id", source, EAST_WORKER, CHLORINE_KIT, risk, uuid.uuid4())[0])

    def report_for(self, test_record: str) -> tuple[str, int, str]:
        rid, version, status = self.q("select id, version, status from reports where test_record_id = %s"
                                      " and not is_re_report", test_record)
        return str(rid), version, status

    def version(self, report: str) -> int:
        return self.q("select version from reports where id = %s", report)[0]

    def blob(self, availability: str = "available") -> str:
        return "blob:" + str(self.q(
            "insert into photo_blobs (content_type, availability, byte_size, sha256, data)"
            " values ('image/jpeg', %s, %s, repeat('a', 64), %s) returning id", availability, len(JPEG), JPEG)[0])

    def ready_to_close(self) -> str:
        """A high-risk report taken to action_taken with a verified lab result and action photo."""
        report, _, _ = self.report_for(self.add_test_record("high"))
        referral = self.q("select refer_to_lab(%s, %s, %s, 'District Lab')", report, EAST_SUP, self.version(report))[0]
        self.c.execute("select record_lab_result(%s, %s, %s)", (referral, EAST_WORKER, self.blob()))
        self.c.execute("select verify_lab_referral(%s, %s, 'verified', false)", (referral, EAST_SUP))
        self.c.execute("select transition_report(%s, %s, %s, 'action_taken')", (report, EAST_SUP, self.version(report)))
        self.c.execute("insert into process_photos (report_id, source_id, photo_url, process_stage, inspection_level)"
                       " values (%s, %s, %s, 'corrective_action', 'supervisor')", (report, EAST_PUMP, self.blob()))
        return report

    def close(self, report: str, reason: str = "Chlorinated and resampled; lab confirmed.") -> int:
        return self.q("select close_report(%s, %s, %s, %s)", report, EAST_SUP, self.version(report), reason)[0]

    # --- flow 2: test record -> exactly one report -------------------------------

    def test_high_and_medium_tests_create_one_report_low_does_not(self) -> None:
        high = self.add_test_record("high")
        report, version, status = self.report_for(high)
        self.assertEqual((version, status), (1, "open"))
        self.assertEqual(str(self.q("select created_by from reports where id = %s", report)[0]), EAST_WORKER)
        self.assertEqual(self.q("select current_risk_level, current_public_status from water_sources where id = %s",
                                EAST_PUMP), ("high", "under_review"))
        self.report_for(self.add_test_record("medium"))
        low = self.add_test_record("low")
        self.assertIsNone(self.q("select 1 from reports where test_record_id = %s", low))
        self.assertEqual(self.q("select current_risk_level from water_sources where id = %s", EAST_PUMP)[0], "low")

    def test_second_original_report_for_one_test_is_refused(self) -> None:
        high = self.add_test_record("high")
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.c.execute("insert into reports (source_id, test_record_id, risk_level) values (%s, %s, 'high')",
                           (EAST_PUMP, high))

    def test_every_update_bumps_the_version(self) -> None:
        report, v1, _ = self.report_for(self.add_test_record("high"))
        self.c.execute("update reports set closure_reason = 'x' where id = %s", (report,))
        self.c.execute("update reports set closure_reason = 'y' where id = %s", (report,))
        self.assertEqual(self.version(report), v1 + 2)

    # --- labs: uploaded != verified, re-report loop ------------------------------

    def test_verified_needs_verifier_time_and_file(self) -> None:
        report, _, _ = self.report_for(self.add_test_record("high"))
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.c.execute("insert into lab_referrals (report_id, lab_name, verification_status) values (%s, 'L', 'verified')",
                           (report,))

    def test_lab_refusals(self) -> None:
        report, _, _ = self.report_for(self.add_test_record("high"))
        referral = self.q("select refer_to_lab(%s, %s, %s, 'District Lab')", report, EAST_SUP, self.version(report))[0]
        self.assertEqual(self.q("select status from reports where id = %s", report)[0], "sent_to_lab")
        self.refused("lab_result_missing", "select verify_lab_referral(%s, %s, 'verified', false)", referral, EAST_SUP)
        self.refused("forbidden", "select verify_lab_referral(%s, %s, 'verified', false)", referral, EAST_WORKER)
        self.refused("report_not_found", "select record_lab_result(%s, %s, %s)", referral, NORTH_SUP, "blob:x")

        self.c.execute("select record_lab_result(%s, %s, %s)", (referral, EAST_SUP, self.blob()))
        self.assertEqual(self.q("select status from reports where id = %s", report)[0], "under_review")
        self.refused("lab_result_already_recorded", "select record_lab_result(%s, %s, %s)", referral, EAST_WORKER, "blob:y")
        self.refused("self_review", "select verify_lab_referral(%s, %s, 'verified', false)", referral, EAST_SUP)

        quarantined = self.q("select refer_to_lab(%s, %s, %s, 'Other Lab')", report, EAST_SUP, self.version(report))[0]
        self.c.execute("select record_lab_result(%s, %s, %s)", (quarantined, EAST_WORKER, self.blob("quarantined")))
        self.refused("lab_result_quarantined", "select verify_lab_referral(%s, %s, 'verified', false)", quarantined, EAST_SUP)

    def test_lab_request_creates_one_re_report_pointing_back(self) -> None:
        report, _, _ = self.report_for(self.add_test_record("high"))
        referral = self.q("select refer_to_lab(%s, %s, %s, 'District Lab')", report, EAST_SUP, self.version(report))[0]
        self.c.execute("select record_lab_result(%s, %s, %s)", (referral, EAST_WORKER, self.blob()))
        self.c.execute("select verify_lab_referral(%s, %s, 'rejected', true)", (referral, EAST_SUP))
        child = self.q("select id, is_re_report, status, created_by from reports where previous_report_id = %s", report)
        self.assertEqual((child[1], child[2], str(child[3])), (True, "open", EAST_SUP))
        self.assertEqual(self.q("select status from reports where id = %s", report)[0], "under_review")  # original untouched
        self.refused("lab_referral_decided", "select verify_lab_referral(%s, %s, 'verified', false)", referral, EAST_SUP)
        # A second request on the same report does not fork the chain.
        self.c.execute("insert into lab_referrals (report_id, lab_name, re_report_requested) values (%s, 'L2', true)", (report,))
        self.assertEqual(self.q("select count(*) from reports where previous_report_id = %s", report)[0], 1)

    # --- guarded close --------------------------------------------------------------

    def test_close_refusals(self) -> None:
        report, _, _ = self.report_for(self.add_test_record("high"))
        self.refused("forbidden", "select close_report(%s, %s, %s, 'long enough reason')", report, EAST_WORKER, 1)
        self.refused("report_not_found", "select close_report(%s, %s, %s, 'long enough reason')", report, NORTH_SUP, 1)
        self.refused("version_conflict", "select close_report(%s, %s, %s, 'long enough reason')", report, EAST_SUP, 99)
        self.refused("transition_illegal", "select close_report(%s, %s, %s, 'long enough reason')", report, EAST_SUP, 1)
        self.refused("use_close_report", "select transition_report(%s, %s, %s, 'closed')", report, EAST_SUP, 1)
        self.refused("use_refer_to_lab", "select transition_report(%s, %s, %s, 'sent_to_lab')", report, EAST_SUP, 1)

        self.c.execute("select transition_report(%s, %s, %s, 'action_taken')", (report, EAST_SUP, 1))
        self.refused("closure_reason_required", "select close_report(%s, %s, %s, 'short')", report, EAST_SUP, 2)
        self.refused("lab_result_missing", "select close_report(%s, %s, %s, 'long enough reason')", report, EAST_SUP, 2)

    def test_close_needs_verified_lab_evidence_photo_and_closed_re_report(self) -> None:
        report, _, _ = self.report_for(self.add_test_record("high"))
        referral = self.q("select refer_to_lab(%s, %s, %s, 'District Lab')", report, EAST_SUP, self.version(report))[0]
        self.c.execute("select record_lab_result(%s, %s, %s)", (referral, EAST_WORKER, self.blob()))
        self.c.execute("select transition_report(%s, %s, %s, 'action_taken')", (report, EAST_SUP, self.version(report)))
        self.refused("lab_not_verified", "select close_report(%s, %s, %s, 'long enough reason')",
                     report, EAST_SUP, self.version(report))
        self.c.execute("select verify_lab_referral(%s, %s, 'verified', true)", (referral, EAST_SUP))
        self.refused("action_evidence_missing", "select close_report(%s, %s, %s, 'long enough reason')",
                     report, EAST_SUP, self.version(report))
        self.c.execute("insert into process_photos (report_id, source_id, photo_url, process_stage)"
                       " values (%s, %s, %s, 'closure')", (report, EAST_PUMP, self.blob()))
        self.refused("re_report_open", "select close_report(%s, %s, %s, 'long enough reason')",
                     report, EAST_SUP, self.version(report))

    def complaint(self, resident: str, source: str | None = EAST_PUMP) -> str:
        return str(self.q("insert into complaints (resident_id, source_id, complaint_type) values (%s, %s, 'smell')"
                          " returning id", resident, source)[0])

    def review(self, complaint: str, actor: str, action: str, report: str | None = None,
               version: int | None = None, risk: str | None = None) -> str:
        return self.q("select review_complaint(%s, %s, %s, %s, %s, %s)", complaint, actor, action, report, version, risk)[0]

    def test_close_resolves_complaints_notifies_and_updates_public_status(self) -> None:
        resident, _ = new_resident(self.c, "0201", "+919999900201")
        complaint = self.complaint(resident)
        report = self.ready_to_close()
        before = self.version(report)
        self.assertEqual(self.review(complaint, EAST_SUP, "link", report, before), "linked")
        self.assertEqual(self.version(report), before + 1)   # linking changes the case
        self.assertEqual(self.q("select linked_by, linked_at is not null from complaints where id = %s", complaint),
                         (uuid.UUID(EAST_SUP), True))
        self.assertEqual(self.q("select current_public_status from water_sources where id = %s", EAST_PUMP)[0],
                         "action_pending")

        self.close(report)

        self.assertEqual(self.q("select status, resolution from complaints where id = %s", complaint),
                         ("resolved", "case_closed"))
        self.assertEqual(self.q("select count(*) from points_ledger where profile_id = %s", resident)[0], 0)
        sms = self.c.execute("select channel, recipient_phone, delivery_status, message from notifications"
                             " where related_report_id = %s and channel = 'sms'", (report,)).fetchall()
        self.assertEqual([s[:3] for s in sms][-1], ("sms", "+919999900201", "queued"))
        self.assertIn("closed", sms[-1][3])
        self.assertNotIn("safe", sms[-1][3].lower())
        self.assertIsNotNone(self.q("select 1 from notifications where related_report_id = %s and channel = 'push'"
                                    " and user_id = %s", report, EAST_WORKER))
        self.assertEqual(self.q("select current_public_status from water_sources where id = %s", EAST_PUMP)[0],
                         "no_open_issues")
        self.assertEqual(self.q("select action from audit_log where entity_id = %s order by id desc limit 1", report)[0],
                         "closed")

        self.c.execute("select mark_source_lab_verified(%s, %s)", (EAST_PUMP, EAST_SUP))
        self.assertEqual(self.q("select current_public_status from water_sources where id = %s", EAST_PUMP)[0],
                         "lab_verified_safe")
        self.add_test_record("high")   # a new issue clears the lab-verified mark
        self.assertEqual(self.q("select current_public_status from water_sources where id = %s", EAST_PUMP)[0],
                         "under_review")
        self.refused("source_has_open_reports", "select mark_source_lab_verified(%s, %s)", EAST_PUMP, EAST_SUP)

    def test_stale_version_loses_to_a_concurrent_supervisor(self) -> None:
        report, v, _ = self.report_for(self.add_test_record("high"))
        self.c.execute("select transition_report(%s, %s, %s, 'under_review')", (report, EAST_SUP, v))
        self.refused("version_conflict", "select transition_report(%s, %s, %s, 'action_taken')", report, EAST_SUP, v)
        self.refused("transition_illegal", "select transition_report(%s, %s, %s, 'open')", report, EAST_SUP, v + 1)

    # --- complaint review --------------------------------------------------------------

    REVIEW = "select review_complaint(%s, %s, %s, %s, %s, %s)"

    def test_complaint_review_refusals(self) -> None:
        resident, _ = new_resident(self.c, "0202")
        complaint = self.complaint(resident)
        report, version, _ = self.report_for(self.add_test_record("high"))
        self.refused("complaint_not_found", self.REVIEW, complaint, NORTH_SUP, "dismiss", None, None, None)
        self.refused("forbidden", self.REVIEW, complaint, EAST_WORKER, "dismiss", None, None, None)
        north_report = self.q("select r.id from reports r join water_sources ws on ws.id = r.source_id"
                              " where ws.team_id = 'fc778e68-d6ae-52ff-ab8c-9a0333f915bd' and r.status <> 'closed' limit 1")[0]
        self.refused("report_not_found", self.REVIEW, complaint, EAST_SUP, "link", north_report, 1, None)
        self.refused("version_conflict", self.REVIEW, complaint, EAST_SUP, "link", report, version - 1, None)
        self.refused("version_conflict", self.REVIEW, complaint, EAST_SUP, "link", report, None, None)
        self.refused("action_invalid", self.REVIEW, complaint, EAST_SUP, "escalate", None, None, None)
        self.refused("risk_level_invalid", self.REVIEW, complaint, EAST_SUP, "open_report", None, None, "severe")

        other_source = self.q("select id from water_sources where team_id = '6fa4a23b-18d6-52ec-a072-13cb9fce5d50'"
                              " and id <> %s limit 1", EAST_PUMP)[0]
        other_report, other_version, _ = self.report_for(self.add_test_record("high", str(other_source)))
        self.refused("source_mismatch", self.REVIEW, complaint, EAST_SUP, "link", other_report, other_version, None)

        self.assertEqual(self.review(complaint, EAST_SUP, "link", report, version), "linked")
        self.refused("complaint_not_new", self.REVIEW, complaint, EAST_SUP, "dismiss", None, None, None)

        unsourced = self.complaint(resident, None)   # visible to every supervisor
        self.refused("complaint_needs_source", self.REVIEW, unsourced, NORTH_SUP, "open_report", None, None, "high")
        self.assertEqual(self.review(unsourced, NORTH_SUP, "dismiss"), "resolved")
        self.assertEqual(self.q("select resolution from complaints where id = %s", unsourced)[0], "dismissed")

    def test_open_report_from_a_complaint_makes_a_resident_origin_report(self) -> None:
        resident, _ = new_resident(self.c, "0203")
        complaint = self.complaint(resident)
        self.assertEqual(self.review(complaint, EAST_SUP, "open_report", risk="medium"), "linked")
        report = self.q("select linked_report_id from complaints where id = %s", complaint)[0]
        self.assertEqual(self.q("select origin, test_record_id, risk_level, status, created_by from reports where id = %s",
                                report), ("resident", None, "medium", "open", uuid.UUID(EAST_SUP)))
        self.assertEqual(self.q("select current_public_status from water_sources where id = %s", EAST_PUMP)[0],
                         "under_review")
        with self.assertRaises(psycopg.errors.CheckViolation):   # a screening report needs its test record
            self.c.execute("insert into reports (source_id, risk_level, origin) values (%s, 'low', 'screening')", (EAST_PUMP,))
        self.c.rollback()

    def test_a_resident_origin_report_keeps_its_origin_through_a_re_report(self) -> None:
        resident, _ = new_resident(self.c, "0204")
        complaint = self.complaint(resident)
        self.review(complaint, EAST_SUP, "open_report", risk="high")
        report = self.q("select linked_report_id from complaints where id = %s", complaint)[0]
        referral = self.q("select refer_to_lab(%s, %s, %s, 'District Lab')", report, EAST_SUP, self.version(report))[0]
        self.c.execute("select record_lab_result(%s, %s, %s)", (referral, EAST_WORKER, self.blob()))
        self.c.execute("select verify_lab_referral(%s, %s, 'rejected', true)", (referral, EAST_SUP))
        self.assertEqual(self.q("select origin, test_record_id from reports where previous_report_id = %s", report),
                         ("resident", None))

    # --- flow 8: pins -------------------------------------------------------------------

    def test_manual_pin_needs_a_supervisor_and_gps_pin_needs_accuracy(self) -> None:
        base = ("insert into water_sources (name, source_type, location, location_source, location_accuracy_m,"
                " location_overridden_by, location_override_reason, team_id)"
                " values ('T', 'well', st_setsrid(st_makepoint(76, 22.7), 4326)::geography, %s, %s, %s, %s,"
                " '6fa4a23b-18d6-52ec-a072-13cb9fce5d50') returning location_auto_pinned")
        self.refused("override_approver_must_be_supervisor", base, "manual_override", None, EAST_WORKER, "rooftop")
        self.assertFalse(self.q(base, "manual_override", None, EAST_SUP, "rooftop, no GPS fix")[0])
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.c.execute(base, ("gps_auto", None, None, None))
        self.c.rollback()
        self.assertTrue(self.q(base, "gps_auto", 4.5, None, None)[0])


if __name__ == "__main__":
    unittest.main()
