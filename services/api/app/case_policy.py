"""Case transition table and guards — jalsakshi-blueprint/docs/architecture/case-state-machine.md.

The table below IS the state machine: a (state, command) pair that is not in
`TRANSITIONS` is illegal (CASE_TRANSITION_ILLEGAL). Guards return a failure
code or None; they never mutate anything. Effects live in cases.py.

Guards whose evidence arrives in later tasks (lab reports T19, actions T20,
retests/closure T21, communications T22) FAIL CLOSED until that data exists:
a missing table or module can never let a case advance.

Closure policy is DEMO policy v1 and is NOT domain-approved (T46).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

OPEN_STATES = ("review_needed", "awaiting_lab", "action_required", "retest_due", "closure_review")
CASE_ROLES = frozenset({"supervisor", "admin"})
FLAGS_THAT_OPEN_A_CASE = frozenset({"review", "uncertain", "invalid"})
DISMISS_REASONS = frozenset({"invalid_capture", "duplicate", "not_a_water_source", "resolved_before_referral"})
MIN_DISPOSITION = 20

#: The closure policy in force. Recorded on every closure so a case closed
#: under a weaker policy stays auditable (case-state-machine.md). NOT approved:
#: T46 needs a domain reviewer's sign-off before operational use.
POLICY_VERSION = 1

_PROTOCOLS = Path(__file__).resolve().parents[3] / "protocols"


@lru_cache(maxsize=None)
def protocol_policy(protocol_id: str, version: int) -> dict[str, Any] | None:
    """The protocol's quality_policy, or None when unknown (callers fail closed)."""
    if not _PROTOCOLS.is_dir():
        return None
    for path in _PROTOCOLS.glob("*.json"):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if doc.get("id") == protocol_id and doc.get("version") == version:
            return doc.get("quality_policy")
    return None


@dataclass
class Context:
    """Everything a guard may read. Built by cases.py inside the transaction."""

    connection: Any
    tenant_id: str
    case: dict[str, Any]
    command: Any
    trigger_sample: dict[str, Any]
    is_active_member: Callable[[str], bool]
    now: str
    checklist: dict[str, str] = field(default_factory=dict)


Guard = Callable[[Context], "str | None"]


def g_owner(ctx: Context) -> str | None:
    return None if ctx.case["owner_id"] and ctx.case["due_at"] else "CASE_OWNER_REQUIRED"


def g_assign(ctx: Context) -> str | None:
    due = ctx.command.payload.due_at
    if due is not None and due.tzinfo is None:
        return "VALIDATION_FAILED"  # a due date without a zone cannot be compared honestly
    owner = str(ctx.command.payload.owner_id)
    return None if ctx.is_active_member(owner) else "CASE_OWNER_REQUIRED"


def g_policy_direct_action(ctx: Context) -> str | None:
    sample = ctx.trigger_sample
    policy = protocol_policy(sample["protocol_id"], sample["protocol_version"])
    return None if policy and policy.get("allow_direct_action") is True else "CASE_POLICY_FORBIDS"


def _disposition_ok(text: str | None) -> bool:
    return bool(text) and len(text.strip()) >= MIN_DISPOSITION


def g_dismiss(ctx: Context) -> str | None:
    payload = ctx.command.payload
    if payload.dismiss_reason not in DISMISS_REASONS or not _disposition_ok(payload.disposition):
        return "DISPOSITION_REQUIRED"
    return None


def g_disposition(ctx: Context) -> str | None:
    return None if _disposition_ok(ctx.command.payload.disposition) else "DISPOSITION_REQUIRED"


def g_no_retest_sample(ctx: Context) -> str | None:
    # Row 7 REQUESTS a retest; linking a sample is row 10's job.
    return None if ctx.command.payload.retest_sample_id is None else "RETEST_INVALID"


def not_yet_available(code: str) -> Guard:
    """Fail closed until the task that supplies this evidence lands."""

    def guard(_ctx: Context) -> str | None:
        return code

    return guard


# Replaced by T19/T20/T21 with guards that read real evidence.
g_verified: Guard = not_yet_available("LAB_REPORT_NOT_VERIFIED")
g_action: Guard = not_yet_available("ACTION_EVIDENCE_MISSING")
g_retest: Guard = not_yet_available("RETEST_INVALID")
g_close: Guard = not_yet_available("CLOSURE_EVIDENCE_INCOMPLETE")


@dataclass(frozen=True)
class Transition:
    to: str | None  # None = state unchanged
    guards: tuple[Guard, ...]


# (from_state, command) -> Transition. "*" = any open state.
TRANSITIONS: dict[tuple[str, str], Transition] = {
    ("*", "assign"): Transition(None, (g_assign,)),                                          # row 2
    ("review_needed", "refer_to_lab"): Transition("awaiting_lab", (g_owner,)),               # row 3
    ("review_needed", "record_action"): Transition("action_required", (g_policy_direct_action,)),  # row 4
    ("review_needed", "dismiss"): Transition("closed", (g_dismiss,)),                        # row 5
    ("awaiting_lab", "record_action"): Transition("action_required", (g_verified,)),         # row 6
    ("awaiting_lab", "link_retest"): Transition("retest_due", (g_verified, g_no_retest_sample)),  # row 7
    ("awaiting_lab", "request_closure"): Transition("closure_review", (g_verified, g_disposition)),  # row 8
    ("action_required", "accept_action"): Transition("retest_due", (g_action,)),            # row 9
    ("retest_due", "link_retest"): Transition("closure_review", (g_retest,)),               # row 10
    ("closure_review", "close"): Transition("closed", (g_close,)),                          # row 11
    ("closure_review", "record_action"): Transition("action_required", ()),                   # row 12
    ("*", "record_communication"): Transition(None, ()),                                       # row 13
    ("closed", "reopen"): Transition("review_needed", ()),                                     # row 14
}


def transition_for(status: str, command_type: str) -> Transition | None:
    exact = TRANSITIONS.get((status, command_type))
    if exact:
        return exact
    return TRANSITIONS.get(("*", command_type)) if status in OPEN_STATES else None


def run_guards(transition: Transition, ctx: Context) -> str | None:
    for guard in transition.guards:
        failure = guard(ctx)
        if failure:
            return failure
    return None
