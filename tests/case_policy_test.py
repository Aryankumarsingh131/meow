"""T17: case transition engine.

Exhaustive (state x command) table, every guard's negative, one case per
trigger, correction handling, dedupe-before-version, stale version, tenant
isolation, and a real two-reviewer race on PostgreSQL.

Run: python -m unittest tests.case_policy_test -v
Run PostgreSQL race: set TEST_DATABASE_URL, same command.
All data synthetic.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import TypeAdapter

import tests.sync_push_test as t13
from services.api.app import case_policy as policy
from services.api.app import dev_seed
from services.api.app.cases import CommandReceipt, Refused, apply_command, load_case
from services.api.app.db import connector, migrate
from services.api.app.dev_issuer import SYNTHETIC_TENANT_ID, _uid
from services.api.app.main import app
from services.api.app.schemas import CaseCommandRequest
from services.api.app.sync_push import push_events

NOW = "2026-09-24T12:05:00Z"
COMMAND = TypeAdapter(CaseCommandRequest)
SUPERVISOR = t13.session(role="supervisor")
MEMBERS = {SUPERVISOR.user_id, t13.session(role="worker").user_id}
DUE = (datetime(2026, 10, 1, tzinfo=timezone.utc)).isoformat()


def command(kind: str, version: int, payload: dict | None = None, command_id: str | None = None):
    return COMMAND.validate_python({
        "type": kind, "command_id": command_id or str(uuid4()), "expected_version": version, "payload": payload or {},
    })


def valid_payload(kind: str) -> dict:
    """A payload that passes schema validation for each command type."""
    return {
        "assign": {"owner_id": SUPERVISOR.user_id, "due_at": DUE},
        "refer_to_lab": {"lab_name": "Synthetic lab"},
        "record_action": {"description": "Synthetic chlorination", "owner_id": SUPERVISOR.user_id, "due_at": DUE},
        "accept_action": {"action_id": str(uuid4())},
        "link_retest": {},
        "record_communication": {"channel": "notice_board", "template_version": 1, "audience_description": "Synthetic ward"},
        "request_closure": {"disposition": "Synthetic disposition long enough to pass."},
        "close": {"verified_report_id": str(uuid4()), "retest_sample_id": str(uuid4()), "action_ids": [str(uuid4())],
                  "communication_id": str(uuid4()), "disposition": "Synthetic disposition long enough.", "policy_version": 1},
        "reopen": {"reason": "Synthetic reopen reason"},
        "dismiss": {"reason": "x", "dismiss_reason": "invalid_capture", "disposition": "Blurred synthetic capture; not readable."},
    }[kind]


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        migrate(self.db)
        t13.seed_sources(self.db)

    def tearDown(self) -> None:
        self.db.close()

    def push(self, name: str, flag: str = "review", expect: str = "accepted", **extra):
        payload = t13.sample(name)
        payload["observation"] = {**payload["observation"], "indicative_flag": flag}
        payload.update(extra)
        kind = "sample.correct" if "supersedes_id" in extra else "sample.create"
        result = push_events(self.db, t13.session(), t13.request((f"ev-{name}", kind, payload)),
                             server_data_mode="synthetic", server_time=NOW)
        self.assertEqual(result.results[0].status, expect, result.results[0])

    def cases(self) -> list[tuple]:
        return self.db.execute("SELECT id, trigger_sample_id, status, version, requires_rereview FROM cases ORDER BY created_at, id").fetchall()

    def case_id(self, name: str) -> str:
        return self.db.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (t13.uid(name),)).fetchone()[0]

    def run_cmd(self, case_id: str, cmd, actor=SUPERVISOR) -> CommandReceipt | Refused:
        return apply_command(self.db, actor, case_id, cmd, is_active_member=lambda u: u in MEMBERS, now=NOW)

    def force(self, case_id: str, status: str, owner: bool = True) -> None:
        self.db.execute("UPDATE cases SET status = ?, owner_id = ?, due_at = ? WHERE id = ?",
                        (status, SUPERVISOR.user_id if owner else None, DUE if owner else None, case_id))
        self.db.commit()

    def version(self, case_id: str) -> int:
        return load_case(self.db, t13.TENANT_A, case_id)["version"]


class CaseCreationTests(Harness):
    def test_each_flag_that_needs_a_human_opens_exactly_one_case(self) -> None:
        for flag in ("review", "uncertain", "invalid", "no_flag"):
            self.push(f"s-{flag}", flag)
        flags = sorted(r[0] for r in self.db.execute("SELECT trigger_flag FROM cases"))
        self.assertEqual(flags, ["invalid", "review", "uncertain"], "no_flag opens nothing")
        self.push("s-review", "review", expect="duplicate")  # replay of the same event
        self.assertEqual(len(self.cases()), 3)
        opened = self.db.execute("SELECT count(*) FROM case_events WHERE event_type = 'case.opened'").fetchone()[0]
        self.assertEqual(opened, 3)
        self.assertTrue(all(r[2] == "review_needed" and r[3] == 1 for r in self.cases()))

    def test_a_correction_marks_the_existing_case_for_rereview_instead_of_opening_another(self) -> None:
        self.push("orig", "review")
        self.push("fix1", "no_flag", supersedes_id=t13.uid("orig"))
        self.push("fix2", "invalid", supersedes_id=t13.uid("fix1"))  # correction of a correction
        rows = self.cases()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0][1], rows[0][3], bool(rows[0][4])), (t13.uid("orig"), 3, True))
        corrected = self.db.execute("SELECT count(*) FROM case_events WHERE event_type = 'case.trigger_corrected'").fetchone()[0]
        self.assertEqual(corrected, 2)

    def test_a_flagged_correction_of_an_unflagged_sample_opens_its_case(self) -> None:
        self.push("clean", "no_flag")
        self.push("fixed", "uncertain", supersedes_id=t13.uid("clean"))
        self.assertEqual([r[1] for r in self.cases()], [t13.uid("fixed")])

    def test_case_and_sample_commit_together(self) -> None:
        # Break the case insert: the sample must roll back with it.
        self.db.execute("DROP TABLE case_events")
        payload = t13.sample("atomic")
        with self.assertRaises(sqlite3.OperationalError):
            push_events(self.db, t13.session(), t13.request(("ev-atomic", "sample.create", payload)),
                        server_data_mode="synthetic", server_time=NOW)
        self.db.rollback()
        self.assertEqual(self.db.execute("SELECT count(*) FROM samples").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT count(*) FROM cases").fetchone()[0], 0)


class TransitionTableTests(Harness):
    STATES = ("review_needed", "awaiting_lab", "action_required", "retest_due", "closure_review", "closed")
    COMMANDS = ("assign", "refer_to_lab", "record_action", "accept_action", "link_retest",
                "record_communication", "request_closure", "close", "reopen", "dismiss")

    #: Expected outcome of a well-formed command from each state, per
    #: case-state-machine.md. A code means refused with that code; a state
    #: means it succeeded. Guards needing T20 evidence still fail closed;
    #: T19 (lab)/T21 (retest)/T22 (communication) now read real evidence.
    EXPECTED = {
        ("review_needed", "assign"): "review_needed",
        ("review_needed", "refer_to_lab"): "awaiting_lab",
        ("review_needed", "record_action"): "CASE_POLICY_FORBIDS",       # SYN-COLOR-001: allow_direct_action=false
        ("review_needed", "dismiss"): "closed",
        ("awaiting_lab", "record_action"): "LAB_REPORT_NOT_VERIFIED",
        ("awaiting_lab", "link_retest"): "LAB_REPORT_NOT_VERIFIED",
        ("awaiting_lab", "request_closure"): "LAB_REPORT_NOT_VERIFIED",
        ("action_required", "accept_action"): "ACTION_EVIDENCE_MISSING",
        ("retest_due", "link_retest"): "RETEST_INVALID",
        ("closure_review", "close"): "CLOSURE_EVIDENCE_INCOMPLETE",      # real evidence still missing
        ("closure_review", "record_action"): "action_required",          # T20
        ("closed", "reopen"): "review_needed",
        **{(s, "assign"): s for s in ("awaiting_lab", "action_required", "retest_due", "closure_review")},
        # T22: recording a communication never moves the case (row 13).
        **{(s, "record_communication"): s
           for s in ("review_needed", "awaiting_lab", "action_required", "retest_due", "closure_review")},
    }

    def test_every_state_command_pair(self) -> None:
        checked = 0
        for state in self.STATES:
            for kind in self.COMMANDS:
                with self.subTest(state=state, command=kind):
                    self.setUp()
                    self.push("t")
                    cid = self.case_id("t")
                    self.force(cid, state)
                    before = load_case(self.db, t13.TENANT_A, cid)
                    outcome = self.run_cmd(cid, command(kind, before["version"], valid_payload(kind)))
                    expected = self.EXPECTED.get((state, kind), "CASE_TRANSITION_ILLEGAL")
                    after = load_case(self.db, t13.TENANT_A, cid)
                    if isinstance(outcome, Refused):
                        self.assertEqual(outcome.code, expected)
                        self.assertEqual(after, before, "a refused command changes nothing")
                    else:
                        self.assertEqual(outcome.status, expected)
                        self.assertEqual((after["status"], after["version"]), (expected, before["version"] + 1))
                    self.db.close()
                    checked += 1
        self.assertEqual(checked, 60)


class GuardTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.push("g")
        self.cid = self.case_id("g")

    def test_only_supervisor_and_admin_decide(self) -> None:
        for role in ("worker", "lab_reviewer"):
            outcome = self.run_cmd(self.cid, command("assign", 1, valid_payload("assign")), actor=t13.session(role=role))
            self.assertEqual(outcome.code, "FORBIDDEN")
        admin = self.run_cmd(self.cid, command("assign", 1, valid_payload("assign")), actor=t13.session(role="admin"))
        self.assertIsInstance(admin, CommandReceipt)

    def test_assign_requires_an_active_member_of_this_tenant(self) -> None:
        for owner in (str(uuid4()), t13.session(t13.TENANT_B).user_id):
            outcome = self.run_cmd(self.cid, command("assign", 1, {"owner_id": owner, "due_at": DUE}))
            self.assertEqual(outcome.code, "CASE_OWNER_REQUIRED")
        ok = self.run_cmd(self.cid, command("assign", 1, valid_payload("assign")))
        case = load_case(self.db, t13.TENANT_A, self.cid)
        self.assertEqual((ok.status, case["owner_id"], case["version"]), ("review_needed", SUPERVISOR.user_id, 2))
        self.assertTrue(case["due_at"].startswith("2026-10-01"))

    def test_due_dates_are_stored_in_utc_and_zone_less_ones_refused(self) -> None:
        """Overdue is compared in SQL; on SQLite that is text, so a stored
        '+05:30' value would sort wrongly against a 'Z' one."""
        ok = self.run_cmd(self.cid, command("assign", 1, {"owner_id": SUPERVISOR.user_id, "due_at": "2026-09-24T02:00:00+05:30"}))
        self.assertEqual(ok.version, 2)
        self.assertEqual(load_case(self.db, t13.TENANT_A, self.cid)["due_at"], "2026-09-23T20:30:00Z")
        naive = self.run_cmd(self.cid, command("assign", 2, {"owner_id": SUPERVISOR.user_id, "due_at": "2026-10-01T00:00:00"}))
        self.assertEqual(naive.code, "VALIDATION_FAILED")

    def test_referral_needs_owner_and_due_date(self) -> None:
        self.assertEqual(self.run_cmd(self.cid, command("refer_to_lab", 1)).code, "CASE_OWNER_REQUIRED")
        self.run_cmd(self.cid, command("assign", 1, {"owner_id": SUPERVISOR.user_id}))  # owner, no due date
        self.assertEqual(self.run_cmd(self.cid, command("refer_to_lab", 2)).code, "CASE_OWNER_REQUIRED")
        self.run_cmd(self.cid, command("assign", 2, valid_payload("assign")))
        self.assertEqual(self.run_cmd(self.cid, command("refer_to_lab", 3)).status, "awaiting_lab")

    def test_direct_action_follows_protocol_policy_and_fails_closed_on_unknown_protocol(self) -> None:
        self.assertEqual(self.run_cmd(self.cid, command("record_action", 1, valid_payload("record_action"))).code,
                         "CASE_POLICY_FORBIDS")
        self.assertIsNone(policy.protocol_policy(str(uuid4()), 1))
        self.assertFalse(policy.protocol_policy("f96bdca3-5020-5313-b65a-072967c46292", 1)["allow_direct_action"])

    def test_direct_action_guard_reads_the_protocol_policy(self) -> None:
        """Tested at the guard: at command level the missing T20 effect gives the
        same code and would mask a guard that let everything through."""
        from unittest import mock

        case = load_case(self.db, t13.TENANT_A, self.cid)
        ctx = policy.Context(connection=self.db, tenant_id=t13.TENANT_A, case=case,
                             command=command("record_action", 1, valid_payload("record_action")),
                             trigger_sample={"protocol_id": "f96bdca3-5020-5313-b65a-072967c46292", "protocol_version": 1},
                             is_active_member=lambda u: True, now=NOW)
        self.assertEqual(policy.g_policy_direct_action(ctx), "CASE_POLICY_FORBIDS")  # real SYN-COLOR-001 file
        with mock.patch.object(policy, "protocol_policy", return_value={"allow_direct_action": True}):
            self.assertIsNone(policy.g_policy_direct_action(ctx))
        with mock.patch.object(policy, "protocol_policy", return_value={"allow_direct_action": "yes"}):
            self.assertEqual(policy.g_policy_direct_action(ctx), "CASE_POLICY_FORBIDS", "only literal true permits")

    def test_dismissal_needs_an_allowed_reason_and_a_real_disposition(self) -> None:
        bad = [
            {"reason": "x", "disposition": "Long enough disposition text here."},                    # no dismiss_reason
            {"reason": "x", "dismiss_reason": "invalid_capture", "disposition": "too short"},       # < 20 chars
            {"reason": "x", "dismiss_reason": "invalid_capture", "disposition": "   " + " " * 30},  # whitespace
        ]
        for payload in bad:
            self.assertEqual(self.run_cmd(self.cid, command("dismiss", 1, payload)).code, "DISPOSITION_REQUIRED")
        with self.assertRaises(Exception):
            command("dismiss", 1, {"reason": "x", "dismiss_reason": "looked_fine", "disposition": "x" * 30})
        ok = self.run_cmd(self.cid, command("dismiss", 1, valid_payload("dismiss")))
        case = load_case(self.db, t13.TENANT_A, self.cid)
        self.assertEqual((ok.status, case["policy_version"]), ("closed", policy.POLICY_VERSION))
        event = self.db.execute("SELECT event_type, actor_id FROM case_events WHERE command_id = ?", (ok.command_id,)).fetchone()
        self.assertEqual(event, ("case.dismissed", SUPERVISOR.user_id))

    def test_reopen_preserves_the_prior_closure_event(self) -> None:
        self.run_cmd(self.cid, command("dismiss", 1, valid_payload("dismiss")))
        reopened = self.run_cmd(self.cid, command("reopen", 2, valid_payload("reopen")))
        case = load_case(self.db, t13.TENANT_A, self.cid)
        self.assertEqual((reopened.status, case["disposition"], case["policy_version"]), ("review_needed", None, None))
        types = [r[0] for r in self.db.execute("SELECT event_type FROM case_events WHERE case_id = ? ORDER BY to_version", (self.cid,))]
        self.assertEqual(types, ["case.opened", "case.dismissed", "case.reopened"])


class ConcurrencyAndIdempotencyTests(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.push("c")
        self.cid = self.case_id("c")

    def test_stale_version_is_a_structured_conflict(self) -> None:
        self.run_cmd(self.cid, command("assign", 1, valid_payload("assign")))
        stale = self.run_cmd(self.cid, command("assign", 1, valid_payload("assign")))
        self.assertEqual(stale.code, "CASE_VERSION_CONFLICT")
        self.assertEqual(stale.extra, {"current_version": 2, "current_status": "review_needed"})
        self.assertEqual(self.version(self.cid), 2)

    def test_dedupe_precedes_the_version_check(self) -> None:
        first = command("assign", 1, valid_payload("assign"))
        receipt = self.run_cmd(self.cid, first)
        self.run_cmd(self.cid, command("refer_to_lab", 2))  # case moves on
        replay = self.run_cmd(self.cid, first)               # lost-response retry
        self.assertEqual(replay, receipt)
        self.assertEqual(self.version(self.cid), 3, "a replay writes nothing")
        changed = command("assign", 1, {"owner_id": SUPERVISOR.user_id}, command_id=str(first.command_id))
        self.assertEqual(self.run_cmd(self.cid, changed).code, "IDEMPOTENCY_MISMATCH")
        other_case_same_id = command("assign", 1, valid_payload("assign"), command_id=str(first.command_id))
        self.push("c2")
        self.assertEqual(self.run_cmd(self.case_id("c2"), other_case_same_id).code, "IDEMPOTENCY_MISMATCH")

    def test_other_tenant_and_malformed_ids_are_not_found(self) -> None:
        other = t13.session(t13.TENANT_B, role="supervisor")
        self.assertEqual(apply_command(self.db, other, self.cid, command("assign", 1, valid_payload("assign")),
                                       is_active_member=lambda u: True, now=NOW), Refused("NOT_FOUND", "Case was not found."))
        self.assertEqual(self.run_cmd("not-a-uuid", command("assign", 1, valid_payload("assign"))).code, "NOT_FOUND")


@unittest.skipUnless(hasattr(app.state, "dev_issuer"), "needs development+synthetic")
class CaseHttpTests(unittest.TestCase):
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

    def test_command_route_enforces_role_version_and_membership(self) -> None:
        payload = t13.sample("http-case", dev_seed.source_id("src.1"))
        payload["sample_id"] = str(uuid4())
        pushed = self.client.post("/v1/sync/push", headers=self.auth("user.worker"), json={
            "device_id": str(uuid4()),
            "events": [{"event_id": str(uuid4()), "kind": "sample.create", "schema_version": 1, "payload": payload}]})
        self.assertEqual(pushed.json()["results"][0]["status"], "accepted")
        conn = app.state.connect()
        try:
            case_id = conn.execute("SELECT id FROM cases WHERE trigger_sample_id = ?", (payload["sample_id"],)).fetchone()[0]
        finally:
            conn.close()
        url = f"/v1/cases/{case_id}/commands"
        assign = {"type": "assign", "command_id": str(uuid4()), "expected_version": 1,
                  "payload": {"owner_id": _uid("user.supervisor"), "due_at": DUE}}
        denied = self.client.post(url, headers=self.auth("user.worker"), json=assign)
        self.assertEqual((denied.status_code, denied.json()["code"]), (403, "FORBIDDEN"))
        other_tenant_owner = {**assign, "command_id": str(uuid4()), "payload": {"owner_id": _uid("user.other-worker"), "due_at": DUE}}
        self.assertEqual(self.client.post(url, headers=self.auth("user.supervisor"), json=other_tenant_owner).json()["code"],
                         "CASE_OWNER_REQUIRED")
        ok = self.client.post(url, headers=self.auth("user.supervisor"), json=assign)
        self.assertEqual((ok.status_code, ok.json()["version"]), (200, 2))
        stale = self.client.post(url, headers=self.auth("user.supervisor"), json={**assign, "command_id": str(uuid4())})
        body = stale.json()
        self.assertEqual((stale.status_code, body["code"], body["current_version"]), (409, "CASE_VERSION_CONFLICT", 2))
        self.assertEqual(stale.headers["content-type"], "application/problem+json")
        unknown = self.client.post(url, headers=self.auth("user.supervisor"), json={**assign, "type": "approve"})
        self.assertEqual(unknown.status_code, 422)
        # Another tenant cannot tell this case exists: same 404 body as a missing case.
        other = self.client.post(url, headers=self.auth("user.other-worker"), json={**assign, "command_id": str(uuid4())})
        missing = self.client.post(f"/v1/cases/{uuid4()}/commands", headers=self.auth("user.other-worker"),
                                   json={**assign, "command_id": str(uuid4())})
        self.assertEqual((other.status_code, other.json()["detail"]), (404, missing.json()["detail"]))


try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


@unittest.skipIf(psycopg is None, "psycopg not installed")
@unittest.skipIf(not os.environ.get("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class PostgresRaceTests(unittest.TestCase):
    """Two reviewers act on the same case version at the same moment."""

    schema = "jalsakshi_test_t17"

    def connect(self):
        conn = psycopg.connect(os.environ["TEST_DATABASE_URL"])
        conn.execute(f"SET search_path TO {self.schema}")
        conn.commit()
        return conn

    def setUp(self) -> None:
        self.db = psycopg.connect(os.environ["TEST_DATABASE_URL"])
        self.db.execute(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE")
        self.db.execute(f"CREATE SCHEMA {self.schema}")
        self.db.execute(f"SET search_path TO {self.schema}")
        from services.api.migrations import cases, changefeed, evidence
        for statement in (t13.source_statements("postgresql") + t13.sample_statements("postgresql")
                          + changefeed.statements("postgresql") + evidence.statements("postgresql")
                          + cases.statements("postgresql")):
            self.db.execute(statement)
        self.db.commit()
        t13.seed_sources(self.db)
        push_events(self.db, t13.session(), t13.request(("pg-case", "sample.create", t13.sample("pg-case"))),
                    server_data_mode="synthetic", server_time=NOW)
        self.cid = str(self.db.execute("SELECT id FROM cases").fetchone()[0])
        self.db.execute("UPDATE cases SET owner_id = %s, due_at = %s WHERE id = %s", (SUPERVISOR.user_id, DUE, self.cid))
        self.db.commit()

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.execute(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE")
        self.db.commit()
        self.db.close()

    def race(self, commands):
        barrier, results, errors = threading.Barrier(len(commands)), [], []

        def reviewer(cmd):
            conn = self.connect()
            try:
                barrier.wait()
                results.append(apply_command(conn, SUPERVISOR, self.cid, cmd, is_active_member=lambda u: True, now=NOW))
            except BaseException as error:
                errors.append(error)
            finally:
                conn.close()

        threads = [threading.Thread(target=reviewer, args=(c,)) for c in commands]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(15)
        self.assertEqual(errors, [])
        return results

    def test_two_different_decisions_on_one_version_exactly_one_wins(self) -> None:
        for _ in range(5):  # repeat: a race that passes once proves little
            version = int(self.db.execute("SELECT version FROM cases WHERE id = %s", (self.cid,)).fetchone()[0])
            self.db.commit()
            results = self.race([
                command("assign", version, {"owner_id": SUPERVISOR.user_id, "due_at": DUE}),
                command("assign", version, {"owner_id": SUPERVISOR.user_id, "due_at": (datetime(2026, 11, 1, tzinfo=timezone.utc)).isoformat()}),
            ])
            winners = [r for r in results if isinstance(r, CommandReceipt)]
            losers = [r for r in results if isinstance(r, Refused)]
            self.assertEqual((len(winners), len(losers)), (1, 1))
            self.assertEqual(losers[0].code, "CASE_VERSION_CONFLICT")
            after = int(self.db.execute("SELECT version FROM cases WHERE id = %s", (self.cid,)).fetchone()[0])
            self.db.commit()
            self.assertEqual(after, version + 1, "exactly one decision applied")
        events = self.db.execute("SELECT count(*) FROM case_events WHERE case_id = %s AND command_id IS NOT NULL", (self.cid,)).fetchone()[0]
        self.assertEqual(events, 5)

    def test_refer_versus_dismiss_race_leaves_one_coherent_state(self) -> None:
        results = self.race([command("refer_to_lab", 1), command("dismiss", 1, valid_payload("dismiss"))])
        winners = [r for r in results if isinstance(r, CommandReceipt)]
        self.assertEqual(len(winners), 1)
        row = self.db.execute("SELECT status, version FROM cases WHERE id = %s", (self.cid,)).fetchone()
        self.assertEqual((row[0], row[1]), (winners[0].status, 2))

    def test_the_same_command_racing_itself_applies_once(self) -> None:
        cmd = command("refer_to_lab", 1)
        results = self.race([cmd, cmd])
        self.assertTrue(all(isinstance(r, CommandReceipt) for r in results), results)
        self.assertEqual(results[0], results[1])
        count = self.db.execute("SELECT count(*) FROM case_events WHERE command_id = %s", (str(cmd.command_id),)).fetchone()[0]
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
