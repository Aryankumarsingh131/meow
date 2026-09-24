"""T19: lab report entry and verification.

Run: python -m unittest tests.lab_test -v
Run PostgreSQL races: set TEST_DATABASE_URL, same command.
All reports here are SYNTHETIC mock reports; none is real laboratory evidence.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

import tests.sync_push_test as t13
from services.api.app import case_policy as policy
from services.api.app import dev_seed
from services.api.app.cases import CommandReceipt, Refused, apply_command, load_case
from services.api.app.case_reads import case_detail
from services.api.app.db import connector, migrate
from services.api.app.dev_issuer import _uid
from services.api.app.lab_reports import LabReportCreate, VerifyRequest, decide_report, record_report
from services.api.app.main import app
from services.api.app.sync_push import push_events
from tests.case_policy_test import command

NOW = "2026-09-24T12:05:00Z"
SYN = {"id": "f96bdca3-5020-5313-b65a-072967c46292", "version": 1}  # SYN-COLOR-001 (synthetic)
SUP, REVIEWER, ADMIN, WORKER = (t13.session(role=r) for r in ("supervisor", "lab_reviewer", "admin", "worker"))
SOURCE_A2 = t13.uid("source-a2")


def trigger_payload(name: str, source: str = t13.SOURCE_A) -> dict:
    payload = t13.sample(name, source)
    payload["protocol"] = SYN
    payload["captured_at_device"] = "2026-09-24T10:00:00Z"
    return payload


def report(case_id: str, **over) -> LabReportCreate:
    body = {
        "report_id": str(uuid4()), "case_id": case_id, "source_id": t13.SOURCE_A, "lab_name": "Synthetic District Lab",
        "external_ref": "SYN-LAB-001", "collected_at": "2026-09-24T11:00:00Z", "method": "synthetic colour comparison",
        "parameter": "synthetic_colour_class", "result": "SYN-C", "unit": None, "lab_interpretation": "exceeds_limit",
    }
    body.update(over)
    return LabReportCreate.model_validate(body)


def decision(version: int, choice: str = "verify", reason: str = "Checked against the synthetic report sheet.", cid: str | None = None):
    return VerifyRequest(command_id=cid or str(uuid4()), expected_version=version, decision=choice, reason=reason)


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        migrate(self.db)
        t13.seed_sources(self.db)
        self.db.execute("INSERT INTO sources (tenant_id,id,qr_code,label,locality,active,version) VALUES (?,?,?,?,?,?,?)",
                        (t13.TENANT_A, SOURCE_A2, "JS-A2", "Pump A2", "Locality A", True, 1))
        self.db.commit()
        self.case = self.open_case("trigger")

    def tearDown(self) -> None:
        self.db.close()

    def open_case(self, name: str, source: str = t13.SOURCE_A) -> str:
        result = push_events(self.db, WORKER, t13.request((f"ev-{name}", "sample.create", trigger_payload(name, source))),
                             server_data_mode="synthetic", server_time=NOW)
        self.assertEqual(result.results[0].status, "accepted", result.results[0])
        return self.db.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (t13.uid(name),)).fetchone()[0]

    def version(self, case_id: str | None = None) -> int:
        return load_case(self.db, t13.TENANT_A, case_id or self.case)["version"]

    def status(self) -> str:
        return load_case(self.db, t13.TENANT_A, self.case)["status"]

    def record(self, actor=SUP, **over):
        return record_report(self.db, actor, report(self.case, **over), now=NOW)

    def decide(self, report_id: str, actor=REVIEWER, choice: str = "verify", **kw):
        return decide_report(self.db, actor, report_id, decision(self.version(), choice, **kw), now=NOW)

    def cmd(self, kind: str, payload: dict | None = None):
        return apply_command(self.db, SUP, self.case, command(kind, self.version(), payload),
                             is_active_member=lambda u: True, now=NOW)

    def to_awaiting_lab(self) -> None:
        self.cmd("assign", {"owner_id": SUP.user_id, "due_at": "2026-10-01T00:00:00Z"})
        self.assertEqual(self.cmd("refer_to_lab").status, "awaiting_lab")


class RecordingIsNotVerificationTests(Harness):
    def test_a_recorded_report_is_unverified_and_satisfies_nothing(self) -> None:
        self.to_awaiting_lab()
        before = self.version()
        view = self.record()
        self.assertEqual((view.verification_state, view.mismatches, view.superseded), ("unverified", [], False))
        self.assertEqual((self.status(), self.version()), ("awaiting_lab", before + 1), "evidence changed; state did not")
        self.assertEqual(self.cmd("record_action", {"description": "x", "owner_id": SUP.user_id, "due_at": "2026-10-01T00:00:00Z"}).code,
                         "LAB_REPORT_NOT_VERIFIED")
        self.assertEqual(self.cmd("link_retest", {}).code, "LAB_REPORT_NOT_VERIFIED")
        detail = case_detail(self.db, SUP, self.case, now=NOW)
        self.assertEqual([r["verification_state"] for r in detail["lab_reports"]], ["unverified"])
        # Lab result is its own provenance, beside - never merged into - the screening.
        self.assertEqual(detail["trigger_sample"]["machine_suggestion"], {"bin": "bin_b"})
        self.assertEqual(detail["lab_reports"][0]["result"], "SYN-C")

    def test_recording_is_idempotent_on_the_report_id(self) -> None:
        body = report(self.case)
        first = record_report(self.db, SUP, body, now=NOW)
        again = record_report(self.db, SUP, body, now=NOW)
        self.assertEqual(first, again)
        self.assertEqual(self.db.execute("SELECT count(*) FROM lab_reports").fetchone()[0], 1)
        changed = body.model_copy(update={"result": "SYN-A"})
        self.assertEqual(record_report(self.db, SUP, changed, now=NOW).code, "IDEMPOTENCY_MISMATCH")


class MismatchTests(Harness):
    def test_every_mismatch_is_listed_and_blocks_verification(self) -> None:
        foreign_sample = t13.uid("s-other-source")
        push_events(self.db, WORKER, t13.request(("ev-oth", "sample.create", trigger_payload("s-other-source", SOURCE_A2))),
                    server_data_mode="synthetic", server_time=NOW)
        cases = {
            "wrong source (the lab tested a different pump)": ({"source_id": SOURCE_A2}, ["source_mismatch"]),
            "sample from another source": ({"sample_id": foreign_sample}, ["sample_mismatch"]),
            "sample that does not exist": ({"sample_id": str(uuid4())}, ["sample_mismatch"]),
            "wrong parameter": ({"parameter": "nitrate"}, ["parameter_mismatch"]),
            "unit where the protocol has none": ({"unit": "mg/L"}, ["unit_mismatch"]),
            "collected before the screening": ({"collected_at": "2026-09-23T09:00:00Z"}, ["collected_before_screening"]),
            "collected in the future": ({"collected_at": "2026-09-25T09:00:00Z"}, ["collected_in_future"]),
        }
        for name, (over, expected) in cases.items():
            with self.subTest(name):
                view = self.record(**over)
                self.assertEqual(view.mismatches, expected)
                refused = self.decide(view.id)
                self.assertEqual(refused.code, "LAB_REPORT_MISMATCH")
                self.assertEqual(refused.field_errors, {m: "mismatch" for m in expected})
                self.assertEqual(self.decide(view.id, choice="reject").verification_state, "rejected")

    def test_a_wrong_source_report_never_satisfies_the_case(self) -> None:
        self.to_awaiting_lab()
        wrong = self.record(source_id=SOURCE_A2)
        self.assertEqual(self.decide(wrong.id).code, "LAB_REPORT_MISMATCH")
        # Even if the row were forced to verified, a mismatched report does not count.
        self.db.execute("UPDATE lab_reports SET verification_state = 'verified', verified_by = ? WHERE id = ?",
                        (REVIEWER.user_id, wrong.id))
        self.db.commit()
        self.assertEqual(self.cmd("link_retest", {}).code, "LAB_REPORT_NOT_VERIFIED")

    def test_unknown_protocol_is_a_mismatch_not_a_pass(self) -> None:
        payload = t13.sample("unknown-protocol")  # t13 fixtures use an unregistered protocol id
        push_events(self.db, WORKER, t13.request(("ev-unk", "sample.create", payload)), server_data_mode="synthetic", server_time=NOW)
        case = self.db.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (t13.uid("unknown-protocol"),)).fetchone()[0]
        view = record_report(self.db, SUP, report(case, collected_at="2026-09-24T12:01:00Z"), now=NOW)
        self.assertIn("protocol_unknown", view.mismatches)


class RoleAndSeparationTests(Harness):
    def test_who_may_record_and_who_may_decide(self) -> None:
        self.assertEqual(self.record(actor=WORKER).code, "FORBIDDEN")
        view = self.record()
        self.assertEqual(self.decide(view.id, actor=SUP).code, "FORBIDDEN", "a supervisor cannot verify")
        self.assertEqual(self.decide(view.id, actor=WORKER).code, "FORBIDDEN")
        self.assertEqual(self.decide(view.id, actor=ADMIN).verification_state, "verified", "admin may verify another's report")

    def test_nobody_verifies_their_own_report(self) -> None:
        for actor in (REVIEWER, ADMIN):
            with self.subTest(role=actor.role):
                own = self.record(actor=actor)
                self.assertEqual(self.decide(own.id, actor=actor).code, "VERIFICATION_SELF_REVIEW")
                self.assertEqual(self.decide(own.id, actor=actor, choice="reject").code, "VERIFICATION_SELF_REVIEW")

    def test_the_database_itself_refuses_self_verification(self) -> None:
        view = self.record()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE lab_reports SET verification_state = 'verified', verified_by = uploaded_by WHERE id = ?", (view.id,))

    def test_reject_needs_a_real_reason(self) -> None:
        with self.assertRaises(Exception):
            decision(1, "reject", reason="no")


class DecisionTests(Harness):
    def test_verification_never_moves_the_case(self) -> None:
        self.to_awaiting_lab()
        view = self.record()
        before = self.version()
        receipt = self.decide(view.id)
        self.assertEqual((receipt.verification_state, receipt.case_version), ("verified", before + 1))
        self.assertEqual(self.status(), "awaiting_lab", "only a supervisor command moves the case")
        event = self.db.execute("SELECT event_type, actor_id FROM case_events WHERE command_id = ?", (receipt.command_id,)).fetchone()
        self.assertEqual(event, ("lab_report.verified", REVIEWER.user_id))
        self.assertEqual(self.decide(view.id).code, "LAB_REPORT_DECIDED")

    def test_stale_version_replay_and_mismatched_replay(self) -> None:
        view = self.record()
        stale = decide_report(self.db, REVIEWER, view.id, decision(self.version() - 1), now=NOW)
        self.assertEqual(stale.code, "CASE_VERSION_CONFLICT")
        body = decision(self.version())
        first = decide_report(self.db, REVIEWER, view.id, body, now=NOW)
        self.assertEqual(decide_report(self.db, REVIEWER, view.id, body, now=NOW), first)
        other = decision(self.version(), "reject", cid=str(body.command_id))
        self.assertEqual(decide_report(self.db, REVIEWER, view.id, other, now=NOW).code, "IDEMPOTENCY_MISMATCH")

    def test_a_decision_bumps_the_version_so_a_racing_case_command_conflicts(self) -> None:
        self.to_awaiting_lab()
        seen = self.version()
        self.decide(self.record().id)
        late = apply_command(self.db, SUP, self.case, command("link_retest", seen, {}), is_active_member=lambda u: True, now=NOW)
        self.assertEqual(late.code, "CASE_VERSION_CONFLICT", "decided on evidence the supervisor had not seen")

    def test_other_tenant_and_malformed_ids(self) -> None:
        view = self.record()
        other = t13.session(t13.TENANT_B, role="lab_reviewer")
        self.assertEqual(decide_report(self.db, other, view.id, decision(1), now=NOW).code, "NOT_FOUND")
        self.assertEqual(record_report(self.db, t13.session(t13.TENANT_B, role="supervisor"), report(self.case), now=NOW).code, "NOT_FOUND")
        self.assertEqual(decide_report(self.db, REVIEWER, "not-a-uuid", decision(1), now=NOW).code, "NOT_FOUND")


class InterpretationGuardTests(Harness):
    def verified(self, interpretation: str) -> str:
        view = self.record(lab_interpretation=interpretation)
        self.assertEqual(self.decide(view.id).verification_state, "verified")
        return view.id

    def test_action_path_needs_a_verified_exceeds_limit_report(self) -> None:
        self.to_awaiting_lab()
        self.verified("within_limit")
        action = {"description": "Synthetic action", "owner_id": SUP.user_id, "due_at": "2026-10-01T00:00:00Z"}
        self.assertEqual(self.cmd("record_action", action).code, "LAB_RESULT_NOT_ADVERSE")
        self.verified("exceeds_limit")
        self.assertNotEqual(self.cmd("record_action", action).code, "LAB_RESULT_NOT_ADVERSE", "guard now passes")

    def test_no_remediation_path_needs_every_current_report_within_limit(self) -> None:
        self.to_awaiting_lab()
        close = {"disposition": "Synthetic: lab states within limit; no action needed."}
        self.verified("within_limit")
        self.verified("not_stated")
        self.assertEqual(self.cmd("request_closure", close).code, "LAB_RESULT_NOT_WITHIN_LIMIT")

    def test_guards_read_only_current_verified_reports(self) -> None:
        self.to_awaiting_lab()
        ctx = policy.Context(connection=self.db, tenant_id=t13.TENANT_A, case=load_case(self.db, t13.TENANT_A, self.case),
                             command=None, trigger_sample={}, is_active_member=lambda u: True, now=NOW)
        self.record(lab_interpretation="exceeds_limit")  # unverified
        self.assertEqual(policy.g_lab_adverse(ctx), "LAB_RESULT_NOT_ADVERSE")
        rejected = self.record(lab_interpretation="exceeds_limit")
        self.decide(rejected.id, choice="reject")
        self.assertEqual(policy.g_lab_adverse(ctx), "LAB_RESULT_NOT_ADVERSE", "rejected never counts")
        good = self.verified("exceeds_limit")
        self.assertIsNone(policy.g_lab_adverse(ctx))
        self.record(supersedes_id=good, lab_interpretation="within_limit")  # correction, not yet verified
        self.assertEqual(policy.g_lab_adverse(ctx), "LAB_RESULT_NOT_ADVERSE", "superseded never counts")
        self.assertEqual(policy.g_verified(ctx), "LAB_REPORT_NOT_VERIFIED")


class SupersessionTests(Harness):
    def test_correction_supersedes_once_and_is_decided_on_its_own(self) -> None:
        old = self.record()
        self.decide(old.id)
        fix = self.record(supersedes_id=old.id, result="SYN-B")
        self.assertEqual(fix.supersedes_id, old.id)
        views = {r["id"]: r for r in case_detail(self.db, SUP, self.case, now=NOW)["lab_reports"]}
        self.assertTrue(views[old.id]["superseded"])
        self.assertEqual(views[old.id]["verification_state"], "verified", "history is not rewritten")
        self.assertEqual(self.record(supersedes_id=old.id).code, "LAB_REPORT_SUPERSEDED", "no forked corrections")
        pending = self.record()
        self.record(supersedes_id=pending.id)
        self.assertEqual(self.decide(pending.id).code, "LAB_REPORT_SUPERSEDED")
        other_case = self.open_case("other")
        foreign = record_report(self.db, SUP, report(other_case), now=NOW)
        self.assertEqual(self.record(supersedes_id=foreign.id).code, "VALIDATION_FAILED")

    def test_correction_after_closure_review_flags_rereview_without_moving_state(self) -> None:
        old = self.record()
        self.decide(old.id)
        self.db.execute("UPDATE cases SET status = 'closure_review' WHERE id = ?", (self.case,))
        self.db.commit()
        self.record(supersedes_id=old.id)
        case = load_case(self.db, t13.TENANT_A, self.case)
        self.assertEqual((case["status"], bool(case["requires_rereview"])), ("closure_review", True))


@unittest.skipUnless(hasattr(app.state, "dev_issuer"), "needs development+synthetic")
class LabHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved = (app.state.connect, app.state.evidence_dir)
        app.state.connect = connector("", Path(cls.tmp.name) / "api.sqlite3")
        app.state.evidence_dir = Path(cls.tmp.name) / "evidence"
        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect, app.state.evidence_dir = cls.saved
        cls.tmp.cleanup()

    def auth(self, name: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {app.state.dev_issuer.mint(_uid(name))}"}

    def test_record_attach_verify_over_http(self) -> None:
        payload = trigger_payload("http-lab", dev_seed.source_id("src.1"))
        payload["sample_id"] = str(uuid4())
        self.client.post("/v1/sync/push", headers=self.auth("user.worker"), json={"device_id": str(uuid4()), "events": [
            {"event_id": str(uuid4()), "kind": "sample.create", "schema_version": 1, "payload": payload}]})
        conn = app.state.connect()
        try:
            case_id = conn.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (payload["sample_id"],)).fetchone()[0]
        finally:
            conn.close()
        pdf = b"%PDF-1.4\n1 0 obj<</Type /Page>>endobj\ntrailer<<>>\n%%EOF\n"
        import hashlib
        intent = self.client.post("/v1/evidence/intents", headers=self.auth("user.supervisor"), json={
            "asset_id": str(uuid4()), "context": "lab_report", "target_id": case_id, "bytes": len(pdf),
            "media_type": "application/pdf", "sha256": hashlib.sha256(pdf).hexdigest()}).json()
        self.client.put(intent["upload_url"], content=pdf)
        done = self.client.post(f"/v1/evidence/{intent['asset_id']}/complete", headers=self.auth("user.supervisor"),
                                json={"sha256": hashlib.sha256(pdf).hexdigest()}).json()
        self.assertEqual((done["state"], done["reason"]), ("quarantined", "malware_scan_unavailable"),
                         "an uploaded report file is not released, let alone verified")
        worker_attach = self.client.post("/v1/evidence/intents", headers=self.auth("user.worker"), json={
            "asset_id": str(uuid4()), "context": "lab_report", "target_id": case_id, "bytes": len(pdf),
            "media_type": "application/pdf", "sha256": hashlib.sha256(pdf).hexdigest()})
        self.assertEqual(worker_attach.status_code, 403)

        body = report(case_id, source_id=dev_seed.source_id("src.1"), report_asset_id=intent["asset_id"]).model_dump(mode="json")
        created = self.client.post("/v1/lab-reports", headers=self.auth("user.supervisor"), json=body)
        self.assertEqual((created.status_code, created.json()["verification_state"]), (200, "unverified"), created.text)
        version = self.client.get(f"/v1/cases/{case_id}", headers=self.auth("user.supervisor")).json()["version"]
        verify = {"command_id": str(uuid4()), "expected_version": version, "decision": "verify", "reason": "Checked against the synthetic sheet."}
        by_supervisor = self.client.post(f"/v1/lab-reports/{body['report_id']}/verify", headers=self.auth("user.supervisor"), json=verify)
        self.assertEqual((by_supervisor.status_code, by_supervisor.json()["code"]), (403, "FORBIDDEN"))
        ok = self.client.post(f"/v1/lab-reports/{body['report_id']}/verify", headers=self.auth("user.lab-reviewer"), json=verify)
        self.assertEqual((ok.status_code, ok.json()["verification_state"]), (200, "verified"), ok.text)
        detail = self.client.get(f"/v1/cases/{case_id}", headers=self.auth("user.lab-reviewer")).json()
        self.assertEqual(detail["status"], "review_needed", "verification did not move the case")
        self.assertEqual(detail["lab_reports"][0]["verification_state"], "verified")
        wrong = self.client.post("/v1/lab-reports", headers=self.auth("user.supervisor"),
                                 json=report(case_id, source_id=dev_seed.source_id("src.2")).model_dump(mode="json")).json()
        self.assertEqual(wrong["mismatches"], ["source_mismatch"])


try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


@unittest.skipIf(psycopg is None, "psycopg not installed")
@unittest.skipIf(not os.environ.get("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class PostgresReviewerRaceTests(unittest.TestCase):
    schema = "jalsakshi_test_t19"

    def connect(self):
        conn = psycopg.connect(os.environ["TEST_DATABASE_URL"])
        conn.execute(f"SET search_path TO {self.schema}")
        conn.commit()
        return conn

    def setUp(self) -> None:
        from services.api.migrations import cases, changefeed, evidence, lab
        self.db = psycopg.connect(os.environ["TEST_DATABASE_URL"])
        self.db.execute(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE")
        self.db.execute(f"CREATE SCHEMA {self.schema}")
        self.db.execute(f"SET search_path TO {self.schema}")
        for statement in (t13.source_statements("postgresql") + t13.sample_statements("postgresql") + changefeed.statements("postgresql")
                          + evidence.statements("postgresql") + cases.statements("postgresql") + lab.statements("postgresql")):
            self.db.execute(statement)
        self.db.commit()
        t13.seed_sources(self.db)
        push_events(self.db, WORKER, t13.request(("pg-lab", "sample.create", trigger_payload("pg-lab"))),
                    server_data_mode="synthetic", server_time=NOW)
        self.case = str(self.db.execute("SELECT id FROM cases").fetchone()[0])
        self.report = record_report(self.db, SUP, report(self.case), now=NOW)
        self.version = int(self.db.execute("SELECT version FROM cases").fetchone()[0])
        self.db.commit()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.execute(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE")
        self.db.commit()
        self.db.close()

    def race(self, jobs):
        barrier, results, errors = threading.Barrier(len(jobs)), [], []

        def run(job):
            conn = self.connect()
            try:
                barrier.wait()
                results.append(job(conn))
            except BaseException as error:
                errors.append(error)
            finally:
                conn.close()

        threads = [threading.Thread(target=run, args=(j,)) for j in jobs]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(15)
        self.assertEqual(errors, [])
        return results

    def test_two_reviewers_decide_the_same_report_at_once(self) -> None:
        reviewer_b = t13.session(role="admin")
        results = self.race([
            lambda c: decide_report(c, REVIEWER, self.report.id, decision(self.version, "verify"), now=NOW),
            lambda c: decide_report(c, reviewer_b, self.report.id, decision(self.version, "reject"), now=NOW),
        ])
        winners = [r for r in results if not isinstance(r, Refused)]
        self.assertEqual(len(winners), 1, results)
        losers = [r for r in results if isinstance(r, Refused)]
        self.assertIn(losers[0].code, ("LAB_REPORT_DECIDED", "CASE_VERSION_CONFLICT"))
        state = self.db.execute("SELECT verification_state FROM lab_reports WHERE id = %s", (self.report.id,)).fetchone()[0]
        self.assertEqual(state, winners[0].verification_state)
        self.assertEqual(int(self.db.execute("SELECT version FROM cases").fetchone()[0]), self.version + 1)

    def test_verification_racing_a_case_command_on_the_same_version(self) -> None:
        results = self.race([
            lambda c: decide_report(c, REVIEWER, self.report.id, decision(self.version), now=NOW),
            lambda c: apply_command(c, SUP, self.case, command("assign", self.version, {"owner_id": SUP.user_id, "due_at": "2026-10-01T00:00:00Z"}),
                                    is_active_member=lambda u: True, now=NOW),
        ])
        self.assertEqual(sum(1 for r in results if not isinstance(r, Refused)), 1, results)
        self.assertEqual([r.code for r in results if isinstance(r, Refused)], ["CASE_VERSION_CONFLICT"])
        self.assertEqual(int(self.db.execute("SELECT version FROM cases").fetchone()[0]), self.version + 1)


if __name__ == "__main__":
    unittest.main()
