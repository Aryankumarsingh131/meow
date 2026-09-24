"""T17: review cases — creation from flagged samples, and the ONE writer of
`cases.status` (case-state-machine.md "One writer for cases.status").

Command order (case-state-machine.md "Concurrency"):
  1. dedupe on command_id  — a replayed accepted command returns its receipt
  2. expected_version      — mismatch: CASE_VERSION_CONFLICT + current_version
  3. role, legal transition, guards
  4. transition + event, in ONE transaction

The version check is enforced by the UPDATE itself (`... WHERE version = ?`),
not only by the earlier read, so two reviewers racing on the same version
cannot both win on SQLite or PostgreSQL: the loser's UPDATE matches no row.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import timezone
from typing import Any, Callable
from uuid import uuid4

from pydantic import BaseModel

from . import case_policy as policy
from .auth import Session
from .samples import sql


class CommandReceipt(BaseModel):
    command_id: str
    case_id: str
    status: str
    version: int
    event_id: str


@dataclass(frozen=True)
class Refused:
    code: str
    detail: str
    extra: dict[str, Any] | None = None
    field_errors: dict[str, str] | None = None


NOT_FOUND = Refused("NOT_FOUND", "Case was not found.")

_CASE_COLUMNS = (
    "id, source_id, trigger_sample_id, trigger_flag, status, owner_id, due_at, version, "
    "policy_version, requires_rereview, disposition, retest_sample_id, communication_id"
)


def _plain(value: Any) -> Any:
    return str(value) if value is not None and type(value).__name__ in {"UUID", "datetime"} else value


def load_case(connection: Any, tenant_id: str, case_id: str) -> dict[str, Any] | None:
    cursor = connection.cursor()
    try:
        cursor.execute(sql(f"SELECT {_CASE_COLUMNS} FROM cases WHERE tenant_id = ? AND id = ?", connection), (tenant_id, case_id))
    except Exception:
        connection.rollback()  # malformed uuid on PostgreSQL: not found, not 500
        return None
    row = cursor.fetchone()
    if not row:
        return None
    return {k.strip(): _plain(v) for k, v in zip(_CASE_COLUMNS.split(","), row)}


def _event(
    connection: Any, tenant_id: str, case_id: str, event_type: str, payload: dict[str, Any], *,
    now: str, to_version: int, from_version: int | None = None, actor_id: str | None = None,
    command_id: str | None = None, payload_hash: str | None = None, result_json: str | None = None,
    event_id: str | None = None,
) -> str:
    event_id = event_id or str(uuid4())
    connection.cursor().execute(
        sql(
            "INSERT INTO case_events (tenant_id,id,case_id,command_id,event_type,payload_json,payload_hash,"
            "result_json,actor_id,occurred_at,from_version,to_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            connection,
        ),
        (tenant_id, event_id, case_id, command_id, event_type, json.dumps(payload, sort_keys=True),
         payload_hash, result_json, actor_id, now, from_version, to_version),
    )
    return event_id


# --- row 1: the system opens cases -------------------------------------------


def open_case_for_sample(
    connection: Any, tenant_id: str, *, sample_id: str, source_id: str, flag: str,
    supersedes_id: str | None, now: str,
) -> str | None:
    """Run inside the push transaction that accepted the sample.

    A correction never opens a second case for the same test: if any sample
    it supersedes already triggered a case, that case is marked for re-review
    (data-model.md: invalidating a sample flags dependent cases) — whatever the
    corrected flag is — and nothing else changes.
    """
    cursor = connection.cursor()
    ancestor, hops = supersedes_id, 0
    while ancestor and hops < 100:
        cursor.execute(sql("SELECT id, version FROM cases WHERE tenant_id = ? AND trigger_sample_id = ?", connection),
                       (tenant_id, ancestor))
        existing = cursor.fetchone()
        if existing:
            case_id, version = str(existing[0]), int(existing[1])
            cursor.execute(
                sql("UPDATE cases SET requires_rereview = true, version = version + 1, updated_at = ? "
                    "WHERE tenant_id = ? AND id = ?", connection),
                (now, tenant_id, case_id),
            )
            _event(connection, tenant_id, case_id, "case.trigger_corrected",
                   {"correcting_sample_id": sample_id, "new_flag": flag}, now=now,
                   from_version=version, to_version=version + 1)
            return case_id
        cursor.execute(sql("SELECT supersedes_id FROM samples WHERE tenant_id = ? AND id = ?", connection),
                       (tenant_id, ancestor))
        parent = cursor.fetchone()
        ancestor, hops = (str(parent[0]) if parent and parent[0] else None), hops + 1

    if flag not in policy.FLAGS_THAT_OPEN_A_CASE:
        return None
    case_id = str(uuid4())
    cursor.execute(
        sql("INSERT INTO cases (tenant_id,id,source_id,trigger_sample_id,trigger_flag,status,version,"
            "requires_rereview,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", connection),
        (tenant_id, case_id, source_id, sample_id, flag, "review_needed", 1, False, now, now),
    )
    _event(connection, tenant_id, case_id, "case.opened", {"trigger_sample_id": sample_id, "flag": flag},
           now=now, to_version=1)
    return case_id


# --- commands -----------------------------------------------------------------


def _command_hash(case_id: str, command: Any) -> str:
    body = json.dumps({"case_id": case_id, **command.model_dump(mode="json")}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def _prior(connection: Any, tenant_id: str, command_id: str) -> tuple[str, str] | None:
    cursor = connection.cursor()
    cursor.execute(sql("SELECT payload_hash, result_json FROM case_events WHERE tenant_id = ? AND command_id = ?", connection),
                   (tenant_id, command_id))
    row = cursor.fetchone()
    return (row[0], row[1]) if row else None


def _replay(prior: tuple[str, str], digest: str) -> CommandReceipt | Refused:
    if prior[0] != digest:
        return Refused("IDEMPOTENCY_MISMATCH", "This command id was already used with a different command.")
    return CommandReceipt.model_validate_json(prior[1])


def _trigger_sample(connection: Any, tenant_id: str, sample_id: str) -> dict[str, Any]:
    cursor = connection.cursor()
    cursor.execute(sql("SELECT protocol_id, protocol_version, source_id, captured_at_device FROM samples "
                       "WHERE tenant_id = ? AND id = ?", connection), (tenant_id, sample_id))
    row = cursor.fetchone()
    return {"protocol_id": str(row[0]), "protocol_version": int(row[1]), "source_id": str(row[2]),
            "captured_at_device": _plain(row[3])}


# Effects: the columns a command changes besides status/version. A command
# whose effect needs a later task's table (actions T20, communications T22,
# retest/closure T21) is refused until that task registers it here.
Effect = Callable[[Any, "policy.Context"], dict[str, Any]]


def _assign(_conn: Any, ctx: policy.Context) -> dict[str, Any]:
    payload = ctx.command.payload
    changes = {"owner_id": str(payload.owner_id)}
    if payload.due_at is not None:
        # Stored as UTC "Z" text: overdue is compared in SQL, and on SQLite that
        # is a text comparison, so every stored instant must share one format.
        changes["due_at"] = payload.due_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return changes


def _dismiss(_conn: Any, ctx: policy.Context) -> dict[str, Any]:
    return {"disposition": ctx.command.payload.disposition.strip(), "policy_version": policy.POLICY_VERSION}


def _reopen(_conn: Any, _ctx: policy.Context) -> dict[str, Any]:
    # The closure event stays in case_events; only the live fields clear.
    return {"disposition": None, "policy_version": None}


def _request_closure(_conn: Any, ctx: policy.Context) -> dict[str, Any]:
    disposition = ctx.command.payload.disposition
    return {"disposition": disposition.strip() if disposition else None}


def _close(_conn: Any, ctx: policy.Context) -> dict[str, Any]:
    payload = ctx.command.payload
    return {
        "disposition": payload.disposition.strip(),
        "policy_version": policy.POLICY_VERSION,
        "communication_id": str(payload.communication_id),
    }


def _no_columns(_conn: Any, _ctx: policy.Context) -> dict[str, Any]:
    return {}


def _link_retest(_conn: Any, ctx: policy.Context) -> dict[str, Any]:
    retest_id = ctx.command.payload.retest_sample_id
    return {"retest_sample_id": str(retest_id) if retest_id is not None else None}


def _record_communication(_conn: Any, ctx: policy.Context) -> dict[str, Any]:
    # T22: the record's id is the command's own idempotency key, so a client
    # can pass it straight back as close()'s communication_id.
    payload = ctx.command.payload
    ctx.connection.cursor().execute(
        sql(
            "INSERT INTO communications (tenant_id,id,case_id,channel,template_version,audience_description,"
            "actor_id,occurred_at) VALUES (?,?,?,?,?,?,?,?)", ctx.connection,
        ),
        (ctx.tenant_id, str(ctx.command.command_id), ctx.case["id"], payload.channel.strip(),
         payload.template_version, payload.audience_description.strip(), ctx.actor_id, ctx.now),
    )
    return {}


def _record_action(conn: Any, ctx: policy.Context) -> dict[str, Any]:
    payload = ctx.command.payload
    conn.cursor().execute(sql(
        "INSERT INTO actions (tenant_id,id,case_id,description,owner_id,due_at,created_at) "
        "VALUES (?,?,?,?,?,?,?) ON CONFLICT (tenant_id,id) DO NOTHING", conn), (
        ctx.tenant_id, str(ctx.command.command_id), ctx.case["id"], payload.description.strip(),
        str(payload.owner_id), payload.due_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        ctx.now,
    ))
    return {}


def _accept_action(conn: Any, ctx: policy.Context) -> dict[str, Any]:
    payload = ctx.command.payload
    evidence_id = str(ctx.command.command_id)
    conn.cursor().execute(sql(
        "INSERT INTO action_evidence (tenant_id,id,action_id,kind,note,recorded_by,recorded_at) "
        "VALUES (?,?,?,?,?,?,?) ON CONFLICT (tenant_id,id) DO NOTHING", conn), (
        ctx.tenant_id, evidence_id, str(payload.action_id), "operator_note", payload.evidence_note.strip(),
        ctx.actor_id, ctx.now,
    ))
    conn.cursor().execute(sql(
        "UPDATE actions SET completed_at = ?, evidence_ids = ?, accepted_by = ?, accepted_at = ? "
        "WHERE tenant_id = ? AND case_id = ? AND id = ? AND completed_at IS NULL", conn), (
        payload.completed_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        json.dumps([evidence_id]), ctx.actor_id, ctx.now, ctx.tenant_id, ctx.case["id"], str(payload.action_id),
    ))
    return {}


EFFECTS: dict[str, Effect] = {
    "assign": _assign,
    "refer_to_lab": _no_columns,
    "record_action": _record_action,
    "accept_action": _accept_action,
    "dismiss": _dismiss,
    "reopen": _reopen,
    "link_retest": _link_retest,
    "record_communication": _record_communication,
    "request_closure": _request_closure,
    "close": _close,
}

_EVENT_TYPE = {"dismiss": "case.dismissed", "reopen": "case.reopened"}


def apply_command(
    connection: Any, session: Session, case_id: str, command: Any, *,
    is_active_member: Callable[[str], bool], now: str,
) -> CommandReceipt | Refused:
    command_id, digest = str(command.command_id), _command_hash(case_id, command)

    prior = _prior(connection, session.tenant_id, command_id)            # 1. dedupe
    if prior:
        return _replay(prior, digest)
    case = load_case(connection, session.tenant_id, case_id)
    if case is None:
        return NOT_FOUND
    if command.expected_version != case["version"]:                      # 2. version
        return _conflict(case)
    if session.role not in policy.CASE_ROLES:                             # 3. role
        return Refused("FORBIDDEN", "This role cannot issue case commands.")
    transition = policy.transition_for(case["status"], command.type)
    if transition is None:
        return Refused("CASE_TRANSITION_ILLEGAL", f"'{command.type}' is not allowed from '{case['status']}'.")
    ctx = policy.Context(
        connection=connection, tenant_id=session.tenant_id, case=case, command=command,
        trigger_sample=_trigger_sample(connection, session.tenant_id, case["trigger_sample_id"]),
        is_active_member=is_active_member, now=now, actor_id=session.user_id,
    )
    failure = policy.run_guards(transition, ctx)
    if failure:
        return Refused(failure, f"Guard failed: {failure}.", field_errors=ctx.checklist or None)
    effect = EFFECTS.get(command.type)
    if effect is None:
        return Refused("CASE_POLICY_FORBIDS", f"'{command.type}' is not available yet in this build.")

    changes = effect(connection, ctx)                                     # 4. transition
    status = transition.to or case["status"]
    new_version = case["version"] + 1
    assignments = ", ".join(f"{column} = ?" for column in changes)
    cursor = connection.cursor()
    cursor.execute(
        sql(f"UPDATE cases SET status = ?, version = ?, updated_at = ?{', ' + assignments if assignments else ''} "
            "WHERE tenant_id = ? AND id = ? AND version = ?", connection),
        (status, new_version, now, *changes.values(), session.tenant_id, case_id, case["version"]),
    )
    if cursor.rowcount != 1:
        # Lost the race: another decision committed first. Nothing written.
        connection.rollback()
        prior = _prior(connection, session.tenant_id, command_id)
        if prior:
            return _replay(prior, digest)
        current = load_case(connection, session.tenant_id, case_id)
        return _conflict(current or case)
    receipt = CommandReceipt(command_id=command_id, case_id=case_id, status=status, version=new_version, event_id=str(uuid4()))
    try:
        _event(
            connection, session.tenant_id, case_id, _EVENT_TYPE.get(command.type, f"case.{command.type}"),
            command.payload.model_dump(mode="json"), now=now, from_version=case["version"],
            to_version=new_version, actor_id=session.user_id, command_id=command_id, payload_hash=digest,
            result_json=receipt.model_dump_json(), event_id=receipt.event_id,
        )
        connection.commit()
    except Exception as error:
        connection.rollback()
        if not any(p.__name__ == "IntegrityError" for p in type(error).__mro__):
            raise
        prior = _prior(connection, session.tenant_id, command_id)  # same command raced itself
        if prior:
            return _replay(prior, digest)
        raise
    return receipt


def _conflict(case: dict[str, Any]) -> Refused:
    return Refused(
        "CASE_VERSION_CONFLICT",
        "The case changed since you loaded it. Reload and decide again.",
        extra={"current_version": case["version"], "current_status": case["status"]},
    )
