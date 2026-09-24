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

from fastapi import APIRouter, Depends, Header, Query, Request

from .auth import Denied, Session, authenticate, bearer_token
from .errors import ApiError
from .schemas import PushRequest
from .sources import DEFAULT_LIMIT, MAX_LIMIT, MAX_SEARCH_LENGTH, InvalidCursor, list_sources, source_history
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
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, Any]:
    page = list_sources(conn, session, q=q, cursor=cursor, limit=limit)
    if isinstance(page, InvalidCursor):
        raise _invalid_cursor(page)
    return {
        "items": [
            {
                "id": s.id,
                "qr_code": s.qr_code,
                "label": s.label,
                "locality": s.locality,
                "latitude": s.latitude,
                "longitude": s.longitude,
                "accuracy_m": s.accuracy_m,
                "version": s.version,
            }
            for s in page.items
        ],
        "next_cursor": page.next_cursor,
        "served_at": _now(),
    }


@router.get("/sources/{source_id}/history")
def get_source_history(
    source_id: str,
    session: Session = Depends(require_session),
    conn: Any = Depends(db),
    cursor: str | None = Query(default=None, max_length=512),
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
