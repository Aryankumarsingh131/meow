"""Authenticated v1 field routes.

Every route resolves the caller through T06's real `authenticate()`; tenant
comes from the membership lookup, never from the request. This is the first
production caller of T06.

`app.state.auth` holds `(OIDCConfig, membership_lookup)`. It is only set where
an identity provider exists - today that is the synthetic dev issuer
(ADR-M1-002). Anywhere else the routes answer 503 rather than run
unauthenticated.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterator

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

from .auth import Denied, Session, authenticate, bearer_token
from .errors import ApiError
from . import evidence as ev
from .offline_grants import OfflineGrant, OfflineGrantRequest, issue_grant
from . import cases as case_engine
from .schemas import CaseCommandRequest, PushRequest
from .sources import (
    DEFAULT_LIMIT,
    MAX_CURSOR_LENGTH,
    MAX_LIMIT,
    MAX_SEARCH_LENGTH,
    InvalidCursor,
    Source,
    list_sources,
    source_history,
)
from .sync_pull import PullPage, ResetRequired, bootstrap, pull
from .sync_push import PushResponse, push_events

router = APIRouter(prefix="/v1", tags=["v1"])


def require_session(request: Request, authorization: str | None = Header(default=None)) -> Session:
    auth = getattr(request.app.state, "auth", None)
    if auth is None:
        raise ApiError(code="TEMPORARILY_UNAVAILABLE", detail="No identity provider is configured.")
    config, lookup = auth
    outcome = authenticate(bearer_token(authorization), config, lookup)
    if isinstance(outcome, Denied):
        raise ApiError(code=outcome.code, detail=outcome.detail)
    return outcome.session


def db(request: Request) -> Iterator[Any]:
    connect = getattr(request.app.state, "connect", None)
    if connect is None:
        raise ApiError(code="TEMPORARILY_UNAVAILABLE", detail="No database is configured.")
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _invalid_cursor(outcome: InvalidCursor) -> ApiError:
    return ApiError(code=outcome.code, detail=outcome.detail, field_errors={"cursor": outcome.detail})


def _reset(outcome: ResetRequired) -> ApiError:
    return ApiError(code="RESET_REQUIRED", detail=outcome.detail)


def _source_json(s: Source) -> dict[str, Any]:
    return {
        "id": s.id,
        "qr_code": s.qr_code,
        "label": s.label,
        "locality": s.locality,
        "latitude": s.latitude,
        "longitude": s.longitude,
        "accuracy_m": s.accuracy_m,
        "version": s.version,
    }


@router.post("/sync/push", response_model=PushResponse)
def post_sync_push(
    body: PushRequest,
    request: Request,
    session: Session = Depends(require_session),
    conn: Any = Depends(db),
) -> PushResponse:
    outcome = push_events(
        conn,
        session,
        body,
        server_data_mode=request.app.state.tenant_data_mode,
        server_time=_now(),
    )
    if isinstance(outcome, Denied):
        raise ApiError(code=outcome.code, detail=outcome.detail)
    return outcome


@router.get("/sources")
def get_sources(
    session: Session = Depends(require_session),
    conn: Any = Depends(db),
    q: str | None = Query(default=None, max_length=MAX_SEARCH_LENGTH),
    cursor: str | None = Query(default=None, max_length=MAX_CURSOR_LENGTH),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, Any]:
    page = list_sources(conn, session, q=q, cursor=cursor, limit=limit)
    if isinstance(page, InvalidCursor):
        raise _invalid_cursor(page)
    return {
        "items": [_source_json(s) for s in page.items],
        "next_cursor": page.next_cursor,
        "served_at": _now(),
    }


@router.get("/sources/{source_id}/history")
def get_source_history(
    source_id: str,
    session: Session = Depends(require_session),
    conn: Any = Depends(db),
    cursor: str | None = Query(default=None, max_length=MAX_CURSOR_LENGTH),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, Any]:
    page = source_history(conn, session, source_id, served_at=_now(), cursor=cursor, limit=limit)
    if isinstance(page, Denied):
        raise ApiError(code=page.code, detail=page.detail)
    if isinstance(page, InvalidCursor):
        raise _invalid_cursor(page)
    return {
        "source_id": page.source_id,
        "items": [
            {
                "sample_id": e.sample_id,
                "received_at_server": str(e.received_at_server),
                "status": e.status,
                "method": e.method,
                "indicative_flag": e.indicative_flag,
            }
            for e in page.items
        ],
        "next_cursor": page.next_cursor,
        "served_at": page.served_at,
    }


@router.get("/sync/pull", response_model=PullPage)
def get_sync_pull(
    session: Session = Depends(require_session),
    conn: Any = Depends(db),
    cursor: str = Query(max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> PullPage:
    page = pull(conn, session, cursor, limit=limit, server_time=_now())
    if isinstance(page, InvalidCursor):
        raise _invalid_cursor(page)
    if isinstance(page, ResetRequired):
        raise _reset(page)
    return page


@router.get("/bootstrap")
def get_bootstrap(
    session: Session = Depends(require_session),
    conn: Any = Depends(db),
    cursor: str | None = Query(default=None, max_length=2 * MAX_CURSOR_LENGTH),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, Any]:
    page = bootstrap(conn, session, cursor, limit=limit)
    if isinstance(page, InvalidCursor):
        raise _invalid_cursor(page)
    if isinstance(page, ResetRequired):
        raise _reset(page)
    return {
        "sources": [_source_json(s) for s in page.sources],
        "next_cursor": page.next_cursor,
        "snapshot_cursor": page.snapshot_cursor,
        "server_time": _now(),
    }


@router.post("/session/offline-grant", response_model=OfflineGrant)
def post_offline_grant(body: OfflineGrantRequest, session: Session = Depends(require_session)) -> OfflineGrant:
    """T45. Any active member (authorization-matrix.md); scope comes from the
    membership, never from the request."""
    return issue_grant(session, body)


# --- T16: private evidence ---------------------------------------------------


def _evidence(request: Request) -> tuple[bytes, Any]:
    key = getattr(request.app.state, "evidence_key", None)
    if key is None:
        raise ApiError(code="TEMPORARILY_UNAVAILABLE", detail="Evidence storage is not configured.")
    return key, request.app.state.evidence_dir


def _utc() -> datetime:
    return datetime.now(timezone.utc)


def _refused(outcome: ev.Refused) -> ApiError:
    return ApiError(code=outcome.code, detail=outcome.detail)


@router.post("/evidence/intents", response_model=ev.IntentResponse)
def post_evidence_intent(
    body: ev.IntentRequest, request: Request, session: Session = Depends(require_session), conn: Any = Depends(db)
) -> ev.IntentResponse:
    key, _ = _evidence(request)
    outcome = ev.create_intent(
        conn, session, body, key=key, enabled=getattr(request.app.state, "evidence_upload_enabled", False), now=_utc()
    )
    if isinstance(outcome, ev.Refused):
        raise _refused(outcome)
    return outcome


@router.put("/evidence/{asset_id}/content", response_model=ev.EvidenceState)
async def put_evidence_content(
    asset_id: str, request: Request, token: str = Query(max_length=1024)
) -> ev.EvidenceState:
    """Authorised by the scoped token alone, like a presigned URL.

    Async only to stream the body with a bound. The database work runs in one
    threadpool call that opens, uses and closes its own connection: a
    connection opened by the (threadpool) `db` dependency cannot be used from
    the event-loop thread (SQLite refuses; found by tests/upload_test.py).
    """
    key, store = _evidence(request)
    limit = max(ev.MAX_BYTES.values())
    received = bytearray()
    async for chunk in request.stream():
        received.extend(chunk)
        if len(received) > limit:  # stop reading; never buffer an unbounded body
            raise ApiError(code="PAYLOAD_TOO_LARGE", detail="Evidence is larger than allowed.")
    connect = getattr(request.app.state, "connect", None)
    if connect is None:
        raise ApiError(code="TEMPORARILY_UNAVAILABLE", detail="No database is configured.")

    def store_once() -> ev.EvidenceState | ev.Refused:
        conn = connect()
        try:
            return ev.store_content(conn, store, asset_id, token, bytes(received), key=key, now=_utc())
        finally:
            conn.close()

    outcome = await run_in_threadpool(store_once)
    if isinstance(outcome, ev.Refused):
        raise _refused(outcome)
    return outcome


@router.post("/evidence/{asset_id}/complete", response_model=ev.EvidenceState)
def post_evidence_complete(
    asset_id: str, body: dict[str, str], request: Request,
    session: Session = Depends(require_session), conn: Any = Depends(db),
) -> ev.EvidenceState:
    _, store = _evidence(request)
    outcome = ev.complete(conn, session, store, asset_id, str(body.get("sha256", "")), now=_utc())
    if isinstance(outcome, ev.Refused):
        raise _refused(outcome)
    return outcome


@router.get("/evidence/{asset_id}/access", response_model=ev.AccessResponse)
def get_evidence_access(
    asset_id: str, request: Request, session: Session = Depends(require_session), conn: Any = Depends(db)
) -> ev.AccessResponse:
    key, _ = _evidence(request)
    outcome = ev.grant_access(conn, session, asset_id, key=key, now=_utc())
    if isinstance(outcome, ev.Refused):
        raise _refused(outcome)
    return outcome


@router.get("/evidence/{asset_id}/content")
def get_evidence_content(
    asset_id: str, request: Request, token: str = Query(max_length=1024), conn: Any = Depends(db)
) -> Response:
    key, store = _evidence(request)
    outcome = ev.read_content(conn, store, asset_id, token, key=key, now=_utc())
    if isinstance(outcome, ev.Refused):
        raise _refused(outcome)
    data, media_type = outcome
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": "attachment",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


# --- T17: case commands -------------------------------------------------------


def _active_member_check(request: Request, tenant_id: str):
    _, lookup = request.app.state.auth

    def is_active_member(user_id: str) -> bool:
        return any(m.active and m.tenant_id == tenant_id for m in lookup(user_id))

    return is_active_member


@router.post("/cases/{case_id}/commands", response_model=case_engine.CommandReceipt)
def post_case_command(
    case_id: str, body: CaseCommandRequest, request: Request,
    session: Session = Depends(require_session), conn: Any = Depends(db),
) -> case_engine.CommandReceipt:
    outcome = case_engine.apply_command(
        conn, session, case_id, body, is_active_member=_active_member_check(request, session.tenant_id), now=_now(),
    )
    if isinstance(outcome, case_engine.Refused):
        raise ApiError(code=outcome.code, detail=outcome.detail, field_errors=outcome.field_errors, extra=outcome.extra)
    return outcome
