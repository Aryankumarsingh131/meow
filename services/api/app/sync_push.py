"""T13 per-event transactional sync push with payload-guarded idempotency."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from .auth import Denied, Session, require_role
from .changefeed import record_change
from .samples import SampleEventModel, SampleRejected, insert_sample, sample_exists, sql
from .schemas import PushRequest


class EventError(BaseModel):
    code: str
    detail: str
    retryable: bool


class EventResult(BaseModel):
    event_id: UUID
    status: Literal["accepted", "duplicate", "rejected", "conflict"]
    resource_id: UUID | None = None
    resource_version: int | None = None
    server_time: str
    error: EventError | None = None


class PushResponse(BaseModel):
    results: list[EventResult]


def canonical_event_hash(event: SampleEventModel) -> str:
    intent = event.model_dump(mode="json", exclude={"event_id"})
    encoded = json.dumps(intent, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _prior(connection: Any, tenant_id: str, event_id: str) -> tuple[str, EventResult] | None:
    cursor = connection.cursor()
    cursor.execute(
        sql(
            "SELECT payload_hash, result_json FROM idempotency_receipts WHERE tenant_id = ? AND event_id = ?",
            connection,
        ),
        (tenant_id, event_id),
    )
    row = cursor.fetchone()
    return (row[0], EventResult.model_validate_json(row[1])) if row else None


def _resolve_prior(
    prior: tuple[str, EventResult],
    payload_hash: str,
    event_id: UUID,
    server_time: str,
) -> EventResult:
    stored_hash, stored = prior
    if stored_hash == payload_hash:
        return stored.model_copy(update={"status": "duplicate"})
    return EventResult(
        event_id=event_id,
        status="conflict",
        server_time=server_time,
        error=EventError(
            code="IDEMPOTENCY_MISMATCH",
            detail="Event ID was already used with a different payload.",
            retryable=False,
        ),
    )


def _store_receipt(
    connection: Any,
    tenant_id: str,
    payload_hash: str,
    result: EventResult,
) -> None:
    connection.cursor().execute(
        sql(
            "INSERT INTO idempotency_receipts (tenant_id,event_id,payload_hash,result_json,created_at) VALUES (?,?,?,?,?)",
            connection,
        ),
        (
            tenant_id,
            str(result.event_id),
            payload_hash,
            result.model_dump_json(),
            result.server_time,
        ),
    )


def _is_integrity_error(error: Exception) -> bool:
    return any(parent.__name__ == "IntegrityError" for parent in type(error).__mro__)


def _rejection(event: SampleEventModel, error: SampleRejected, server_time: str) -> EventResult:
    return EventResult(
        event_id=event.event_id,
        status=error.status,
        server_time=server_time,
        error=EventError(code=error.code, detail=error.detail, retryable=error.retryable),
    )


def _process_event(
    connection: Any,
    session: Session,
    event: SampleEventModel,
    *,
    device_id: str,
    server_data_mode: Literal["synthetic", "research", "operational"],
    server_time: str,
) -> EventResult:
    event_id = str(event.event_id)
    payload_hash = canonical_event_hash(event)
    prior = _prior(connection, session.tenant_id, event_id)
    if prior:
        return _resolve_prior(prior, payload_hash, event.event_id, server_time)

    try:
        # Tenant change lock first (T14): sequence order must equal commit order.
        record_change(
            connection, session.tenant_id, "sample", str(event.payload.sample_id), "upsert", 1, server_time
        )
        insert_sample(
            connection,
            session,
            event,
            device_id=device_id,
            payload_hash=payload_hash,
            server_data_mode=server_data_mode,
            server_time=server_time,
        )
        result = EventResult(
            event_id=event.event_id,
            status="accepted",
            resource_id=event.payload.sample_id,
            resource_version=1,
            server_time=server_time,
        )
        _store_receipt(connection, session.tenant_id, payload_hash, result)
        connection.commit()
        return result
    except SampleRejected as error:
        connection.rollback()
        result = _rejection(event, error, server_time)
        if error.retryable:
            return result
        try:
            _store_receipt(connection, session.tenant_id, payload_hash, result)
            connection.commit()
            return result
        except Exception as race:
            connection.rollback()
            if not _is_integrity_error(race):
                raise
    except Exception as error:
        connection.rollback()
        if not _is_integrity_error(error):
            raise

    prior = _prior(connection, session.tenant_id, event_id)
    if prior:
        return _resolve_prior(prior, payload_hash, event.event_id, server_time)
    if sample_exists(connection, session.tenant_id, str(event.payload.sample_id)):
        result = _rejection(
            event,
            SampleRejected("SAMPLE_ID_CONFLICT", "Sample ID is already in use.", status="conflict"),
            server_time,
        )
        try:
            _store_receipt(connection, session.tenant_id, payload_hash, result)
            connection.commit()
            return result
        except Exception as race:
            connection.rollback()
            if not _is_integrity_error(race):
                raise
            prior = _prior(connection, session.tenant_id, event_id)
            if prior:
                return _resolve_prior(prior, payload_hash, event.event_id, server_time)
    raise RuntimeError("Sample transaction failed without an idempotency result")


def push_events(
    connection: Any,
    session: Session,
    request: PushRequest,
    *,
    server_data_mode: Literal["synthetic", "research", "operational"],
    server_time: str,
) -> PushResponse | Denied:
    denial = require_role(session, ["worker", "supervisor"])
    if denial:
        return denial
    return PushResponse(
        results=[
            _process_event(
                connection,
                session,
                event,
                device_id=str(request.device_id),
                server_data_mode=server_data_mode,
                server_time=server_time,
            )
            for event in request.events
        ]
    )
