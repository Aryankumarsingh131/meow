"""T18: case read side — S08 board (`GET /v1/cases`) and S09 detail.

Read-only by construction: nothing here writes, so the single-writer rule for
`cases.status` (cases.py) is untouched.

- Stable order: due_at ascending with NULLS LAST, then id (api-contracts.md).
- Keyset cursor bound to tenant AND filters: a cursor from another filter set
  or tenant is refused, never silently reinterpreted.
- Overdue is decided by the SERVER clock (AC-010), never the browser's.
- Machine suggestion, human observation and lab result stay separate fields.
- Evidence appears as a STATE only; reading an image goes through
  GET /v1/evidence/{id}/access (T16), so no URL leaks via the case view.
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel

from . import case_policy as policy
from .auth import Session
from .cases import NOT_FOUND, Refused, _plain, load_case
from .samples import sql

CASE_READ_ROLES = frozenset({"supervisor", "lab_reviewer", "admin"})  # authorization-matrix.md
MAX_PAGE = 100


class CaseSummary(BaseModel):
    id: str
    status: str
    source_id: str
    source_label: str
    trigger_flag: str
    owner_id: str | None
    due_at: str | None
    overdue: bool
    version: int
    requires_rereview: bool
    updated_at: str


class CasePage(BaseModel):
    items: list[CaseSummary]
    next_cursor: str | None
    total: int
    as_of: str


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def is_overdue(due_at: str | None, status: str, now: str) -> bool:
    return bool(due_at) and status in policy.OPEN_STATES and _utc(due_at) < _utc(now)


def _filters_key(tenant_id: str, filters: dict[str, Any]) -> str:
    body = json.dumps({"t": tenant_id, **filters}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()[:16]


def _encode_cursor(key: str, row: CaseSummary) -> str:
    raw = json.dumps({"k": key, "n": row.due_at is None, "d": row.due_at, "i": row.id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str, key: str) -> dict[str, Any] | None:
    try:
        value = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except Exception:
        return None
    if not isinstance(value, dict) or value.get("k") != key or not isinstance(value.get("i"), str):
        return None
    if not value.get("n") and not isinstance(value.get("d"), str):
        return None
    return value


def list_cases(
    connection: Any, session: Session, *, status: str | None, owner_id: str | None, overdue: bool | None,
    source_id: str | None, cursor: str | None, limit: int, now: str,
) -> CasePage | Refused:
    if session.role not in CASE_READ_ROLES:
        return Refused("FORBIDDEN", "This role cannot view the case queue.")
    if status is not None and status not in (*policy.OPEN_STATES, "closed"):
        return Refused("VALIDATION_FAILED", "Unknown status filter.", field_errors={"status": "unknown"})
    filters = {"status": status, "owner_id": owner_id, "overdue": overdue, "source_id": source_id}
    key = _filters_key(session.tenant_id, filters)
    where, params = ["c.tenant_id = ?"], [session.tenant_id]
    if status:
        where.append("c.status = ?")
        params.append(status)
    if owner_id:
        where.append("c.owner_id = ?")
        params.append(owner_id)
    if source_id:
        where.append("c.source_id = ?")
        params.append(source_id)
    open_list = ", ".join(f"'{s}'" for s in policy.OPEN_STATES)
    overdue_sql = f"(c.due_at IS NOT NULL AND c.due_at < ? AND c.status IN ({open_list}))"
    if overdue is not None:
        where.append(overdue_sql if overdue else f"NOT {overdue_sql}")
        params.append(now)

    page_where, page_params = list(where), list(params)
    if cursor is not None:
        position = _decode_cursor(cursor, key)
        if position is None:
            return Refused("VALIDATION_FAILED", "Unrecognised paging cursor.", field_errors={"cursor": "invalid"})
        if position["n"]:
            page_where.append("c.due_at IS NULL AND c.id > ?")
            page_params.append(position["i"])
        else:
            page_where.append("(c.due_at IS NULL OR c.due_at > ? OR (c.due_at = ? AND c.id > ?))")
            page_params += [position["d"], position["d"], position["i"]]
    size = max(1, min(int(limit), MAX_PAGE))
    db = connection.cursor()
    try:
        db.execute(sql(f"SELECT count(*) FROM cases c WHERE {' AND '.join(where)}", connection), params)
        total = int(db.fetchone()[0])
        db.execute(
            sql(
                "SELECT c.id, c.status, c.source_id, s.label, c.trigger_flag, c.owner_id, c.due_at, c.version, "
                "c.requires_rereview, c.updated_at FROM cases c "
                "JOIN sources s ON s.tenant_id = c.tenant_id AND s.id = c.source_id "
                f"WHERE {' AND '.join(page_where)} "
                "ORDER BY CASE WHEN c.due_at IS NULL THEN 1 ELSE 0 END, c.due_at, c.id LIMIT ?",
                connection,
            ),
            [*page_params, size + 1],
        )
        rows = db.fetchall()
    except Exception:
        connection.rollback()  # e.g. a malformed uuid filter on PostgreSQL
        return Refused("VALIDATION_FAILED", "Invalid filter.", field_errors={"filter": "invalid"})
    items = [
        CaseSummary(
            id=str(r[0]), status=r[1], source_id=str(r[2]), source_label=r[3], trigger_flag=r[4],
            owner_id=_plain(r[5]), due_at=_plain(r[6]), version=int(r[7]), requires_rereview=bool(r[8]),
            updated_at=str(_plain(r[9])), overdue=is_overdue(_plain(r[6]), r[1], now),
        )
        for r in rows[:size]
    ]
    next_cursor = _encode_cursor(key, items[-1]) if len(rows) > size and items else None
    return CasePage(items=items, next_cursor=next_cursor, total=total, as_of=now)


def case_detail(connection: Any, session: Session, case_id: str, *, now: str) -> dict[str, Any] | Refused:
    if session.role not in CASE_READ_ROLES:
        return Refused("FORBIDDEN", "This role cannot view cases.")
    case = load_case(connection, session.tenant_id, case_id)
    if case is None:
        return NOT_FOUND
    db = connection.cursor()
    db.execute(sql("SELECT label, locality FROM sources WHERE tenant_id = ? AND id = ?", connection),
               (session.tenant_id, case["source_id"]))
    source = db.fetchone()
    db.execute(sql(
        "SELECT s.id, s.captured_at_device, s.received_at_server, s.method, s.indicative_flag, s.data_mode, "
        "s.supersedes_id, o.machine_bin, o.manual_bin, o.selected_bin, o.override_reason, o.quality_reasons, "
        "o.timing_valid FROM samples s JOIN observations o ON o.tenant_id = s.tenant_id AND o.sample_id = s.id "
        "WHERE s.tenant_id = ? AND s.id = ?", connection), (session.tenant_id, case["trigger_sample_id"]))
    s = db.fetchone()
    db.execute(sql("SELECT id, state, state_reason, media_type FROM evidence_assets "
                   "WHERE tenant_id = ? AND target_id = ? ORDER BY created_at", connection),
               (session.tenant_id, case["trigger_sample_id"]))
    evidence = [{"id": str(r[0]), "state": r[1], "reason": r[2], "media_type": r[3]} for r in db.fetchall()]
    db.execute(sql("SELECT event_type, actor_id, occurred_at, from_version, to_version, payload_json FROM case_events "
                   "WHERE tenant_id = ? AND case_id = ? ORDER BY to_version, occurred_at", connection),
               (session.tenant_id, case_id))
    timeline = [
        {"event_type": r[0], "actor_id": _plain(r[1]), "occurred_at": str(_plain(r[2])),
         "from_version": r[3], "to_version": r[4], "payload": json.loads(r[5])}
        for r in db.fetchall()
    ]
    return {
        **case,
        "requires_rereview": bool(case["requires_rereview"]),
        "source": {"id": case["source_id"], "label": source[0], "locality": source[1]},
        "overdue": is_overdue(case["due_at"], case["status"], now),
        "trigger_sample": {
            "id": str(s[0]), "captured_at_device": str(_plain(s[1])), "received_at_server": str(_plain(s[2])),
            "method": s[3], "indicative_flag": s[4], "data_mode": s[5], "supersedes_id": _plain(s[6]),
            # Three provenances, never merged (AGENTS.md).
            "machine_suggestion": {"bin": s[7]},
            "human_observation": {"manual_bin": s[8], "selected_bin": s[9], "override_reason": s[10]},
            "quality_reasons": json.loads(s[11]), "timing_valid": bool(s[12]),
        },
        "evidence": evidence,
        "timeline": timeline,
        "as_of": now,
    }
