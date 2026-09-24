"""T14 commit-ordered pull and bootstrap snapshot.

api-contracts.md:
    GET /v1/bootstrap   assigned source pages + snapshot_cursor
    GET /v1/sync/pull   cursor, limit -> changes, next_cursor, has_more, server_time

Cursors are opaque, versioned and bound to the session tenant: another
tenant's cursor, or anything this server did not issue, is 422 (never
silently restarted from zero). A cursor the server can no longer serve without
a hole - below the compaction floor, or ahead of the committed head (a
database restored from backup) - is 410 RESET_REQUIRED. The client then
re-bootstraps and KEEPS its pending outbox.

Pull is read-only and deterministic for a given cursor, so a client whose
page apply failed can re-request the same cursor and get the same page.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel

from .auth import Session
from .changefeed import head
from .samples import sql
from .sources import DEFAULT_LIMIT, MAX_LIMIT, InvalidCursor, Source, list_sources


class SampleChange(BaseModel):
    """Server-accepted sample summary. `payload_hash` lets a device prove the
    accepted record is the one it saved."""

    id: str
    event_id: str
    source_id: str
    supersedes_id: str | None
    received_at_server: str
    method: str
    status: str
    indicative_flag: str
    data_mode: str
    payload_hash: str


class Change(BaseModel):
    seq: int
    entity_type: Literal["sample"]
    entity_id: str
    operation: Literal["upsert", "tombstone"]
    version: int
    sample: SampleChange | None


class PullPage(BaseModel):
    changes: list[Change]
    next_cursor: str
    has_more: bool
    server_time: str


@dataclass(frozen=True)
class ResetRequired:
    detail: str


@dataclass(frozen=True)
class BootstrapPage:
    sources: tuple[Source, ...]
    next_cursor: str | None
    #: Present only on the final page: start pulling from here.
    snapshot_cursor: str | None


def _encode(value: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def _decode(cursor: str, tenant_id: str, kind: str) -> dict[str, Any] | None:
    try:
        value = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except Exception:
        return None
    if not isinstance(value, dict) or value.get("v") != 1 or value.get("k") != kind:
        return None
    if value.get("t") != tenant_id:
        return None
    return value


def pull_cursor(tenant_id: str, seq: int) -> str:
    return _encode({"v": 1, "k": "pull", "t": tenant_id, "s": seq})


def _seq(value: dict[str, Any], key: str) -> int | None:
    seq = value.get(key)
    # bool is an int subclass; a forged `true` must not read as seq 1.
    return seq if isinstance(seq, int) and not isinstance(seq, bool) and seq >= 0 else None


def pull(
    connection: Any,
    session: Session,
    cursor: str,
    *,
    limit: int = DEFAULT_LIMIT,
    server_time: str,
) -> PullPage | InvalidCursor | ResetRequired:
    decoded = _decode(cursor, session.tenant_id, "pull")
    after = _seq(decoded, "s") if decoded else None
    if after is None:
        return InvalidCursor()

    committed, floor = head(connection, session.tenant_id)
    if after < floor:
        return ResetRequired("Changes after this cursor were compacted. Re-bootstrap; keep pending records.")
    if after > committed:
        return ResetRequired("Cursor is ahead of the server. Re-bootstrap; keep pending records.")

    page_size = max(1, min(int(limit), MAX_LIMIT))
    db = connection.cursor()
    db.execute(
        sql(
            "SELECT c.seq, c.entity_type, c.entity_id, c.operation, c.version, "
            "s.id, s.event_id, s.source_id, s.supersedes_id, s.received_at_server, s.method, "
            "s.status, s.indicative_flag, s.data_mode, s.payload_hash "
            "FROM changefeed c LEFT JOIN samples s "
            "ON c.entity_type = 'sample' AND s.tenant_id = c.tenant_id AND s.id = c.entity_id "
            "WHERE c.tenant_id = ? AND c.seq > ? ORDER BY c.seq LIMIT ?",
            connection,
        ),
        (session.tenant_id, after, page_size + 1),
    )
    rows = db.fetchall()
    has_more = len(rows) > page_size
    changes = [_change(row) for row in rows[:page_size]]
    last = changes[-1].seq if changes else after
    return PullPage(
        changes=changes,
        next_cursor=pull_cursor(session.tenant_id, last),
        has_more=has_more,
        server_time=server_time,
    )


def _change(row: Any) -> Change:
    if row[5] is None:
        # Samples are append-only, so a feed row without its entity is
        # corruption, not a deletion. Fail loudly rather than send a hole.
        raise RuntimeError(f"changefeed seq {row[0]} references a missing {row[1]}")
    return Change(
        seq=int(row[0]),
        entity_type=row[1],
        entity_id=str(row[2]),
        operation=row[3],
        version=int(row[4]),
        sample=SampleChange(
            id=str(row[5]),
            event_id=str(row[6]),
            source_id=str(row[7]),
            supersedes_id=None if row[8] is None else str(row[8]),
            received_at_server=str(row[9]),
            method=row[10],
            status=row[11],
            indicative_flag=row[12],
            data_mode=row[13],
            payload_hash=row[14],
        ),
    )


def bootstrap(
    connection: Any,
    session: Session,
    cursor: str | None,
    *,
    limit: int = DEFAULT_LIMIT,
) -> BootstrapPage | InvalidCursor | ResetRequired:
    """Page the active source catalogue under one snapshot sequence.

    The snapshot is the committed head read BEFORE page one. Source pages are
    keyset-ordered, so a catalogue edit mid-bootstrap is at worst seen twice,
    never lost, and every change committed after the snapshot is delivered by
    pull from `snapshot_cursor`. Nothing here advances the device's cursor; an
    interrupted bootstrap restarts from page one.
    """
    if cursor is None:
        snapshot, floor = head(connection, session.tenant_id)
        inner = None
    else:
        decoded = _decode(cursor, session.tenant_id, "boot")
        snapshot = _seq(decoded, "h") if decoded else None
        inner = decoded.get("c") if decoded else None
        if snapshot is None or not isinstance(inner, str):
            return InvalidCursor()
        committed, floor = head(connection, session.tenant_id)
        if snapshot > committed:
            return ResetRequired("Snapshot is ahead of the server. Restart bootstrap.")
    if snapshot < floor:
        return ResetRequired("Snapshot expired during bootstrap. Restart bootstrap.")

    page = list_sources(connection, session, cursor=inner, limit=limit)
    if isinstance(page, InvalidCursor):
        return page
    if page.next_cursor is None:
        return BootstrapPage(page.items, None, pull_cursor(session.tenant_id, snapshot))
    next_cursor = _encode({"v": 1, "k": "boot", "t": session.tenant_id, "h": snapshot, "c": page.next_cursor})
    return BootstrapPage(page.items, next_cursor, None)
