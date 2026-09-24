"""T31: case state-machine invariants under long random command sequences.

case_policy_test.py checks every (state, command) pair once. This walks many
random sequences, including real evidence (lab report, retest, communication)
mixed with junk commands, and checks after EVERY step:

  1. a refused command changes nothing (row identical before and after);
  2. status only moves along case_policy.TRANSITIONS;
  3. version rises by exactly 1 on success;
  4. `closed` via `close` only with a communication recorded on that case.

Run: python -m unittest tests.security.state_test -v
"""

from __future__ import annotations

import random
import sqlite3
import unittest
from uuid import uuid4

import tests.sync_push_test as t13
from services.api.app import case_policy as policy
from services.api.app.cases import CommandReceipt, apply_command, load_case
from services.api.app.db import migrate
from services.api.app.lab_reports import decide_report, record_report
from services.api.app.sync_push import push_events
from tests.case_policy_test import command, valid_payload
from tests.lab_test import decision, report, trigger_payload

NOW = "2026-09-24T12:05:00Z"
SUP, LAB = t13.session(role="supervisor"), t13.session(role="lab_reviewer")
MEMBERS = {SUP.user_id, LAB.user_id}
COMMANDS = ("assign", "refer_to_lab", "record_action", "accept_action", "link_retest", "record_communication",
            "request_closure", "close", "reopen", "dismiss")


class StateWalkTests(unittest.TestCase):
    def walk(self, seed: int, steps: int = 60) -> int:
        rng = random.Random(seed)
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        migrate(db)
        t13.seed_sources(db)
        name = f"walk-{seed}"
        push_events(db, t13.session(), t13.request((f"ev-{name}", "sample.create", trigger_payload(name))),
                    server_data_mode="synthetic", server_time=NOW)
        cid = db.execute("SELECT id FROM cases").fetchone()[0]
        comm_ids: list[str] = []
        successes = 0
        for step in range(steps):
            before = load_case(db, t13.TENANT_A, cid)
            roll = rng.random()
            if roll < 0.1:  # real evidence arrives out of band
                r = record_report(db, SUP, report(cid, lab_interpretation=rng.choice(["within_limit", "exceeds_limit"])), now=NOW)
                v = load_case(db, t13.TENANT_A, cid)["version"]
                if hasattr(r, "id"):
                    decide_report(db, LAB, r.id, decision(v), now=NOW)
                continue
            kind = rng.choice(COMMANDS)
            payload = valid_payload(kind)
            if kind == "assign":
                payload = {"owner_id": SUP.user_id, "due_at": "2026-10-01T00:00:00Z"}
            if kind == "link_retest" and rng.random() < 0.5:
                retest = trigger_payload(f"{name}-r{step}")
                retest["captured_at_device"] = "2026-09-25T00:00:00Z"
                push_events(db, t13.session(), t13.request((f"ev-{name}-r{step}", "sample.create", retest)),
                            server_data_mode="synthetic", server_time=NOW)
                payload = {"retest_sample_id": t13.uid(f"{name}-r{step}")}
            if kind == "close" and comm_ids and rng.random() < 0.7:
                payload = {**payload, "communication_id": rng.choice(comm_ids), "verified_report_id": None,
                           "verified_report_exemption_reason": "Walk exemption reason, long enough to pass.",
                           "retest_sample_id": None, "retest_exemption_reason": "Walk exemption reason, long enough.",
                           "action_ids": [], "action_exemption_reason": "Walk exemption reason, long enough."}
            cmd_id = str(uuid4())
            version = before["version"] if rng.random() < 0.9 else before["version"] + 1  # some stale
            outcome = apply_command(db, SUP, cid, command(kind, version, payload, cmd_id),
                                    is_active_member=lambda u: u in MEMBERS, now=NOW)
            after = load_case(db, t13.TENANT_A, cid)
            if not isinstance(outcome, CommandReceipt):
                self.assertEqual(after, before, f"seed {seed} step {step}: refused {kind} changed the case")
                continue
            successes += 1
            if kind == "record_communication":
                comm_ids.append(cmd_id)
            self.assertEqual(after["version"], before["version"] + 1, f"seed {seed} step {step}")
            t = policy.transition_for(before["status"], kind)
            self.assertIsNotNone(t, f"seed {seed}: {kind} succeeded from {before['status']}")
            self.assertEqual(after["status"], t.to or before["status"], f"seed {seed} step {step}: {kind}")
            if kind == "close":
                recorded = db.execute("SELECT 1 FROM communications WHERE case_id = ? AND id = ?",
                                      (cid, after["communication_id"])).fetchone()
                self.assertIsNotNone(recorded, f"seed {seed}: closed without a recorded communication")
        db.close()
        return successes

    def test_invariants_hold_over_many_random_walks(self) -> None:
        total = sum(self.walk(seed) for seed in range(40))
        self.assertGreater(total, 100, "the walks must actually move cases, not just collect refusals")


if __name__ == "__main__":
    unittest.main()
