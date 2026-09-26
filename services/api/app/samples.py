"""T13 sample persistence. Accepted rows are append-only; corrections append."""

from __future__ import annotations

import json
from typing import Any, Literal

from .auth import Session
from .schemas import SampleCorrectEvent, SampleCreateEvent

SampleEventModel = SampleCreateEvent | SampleCorrectEvent


class SampleRejected(Exception):
    def __init__(
        self,
        code: str,
        detail: str,
        *,
        status: Literal["rejected", "conflict"] = "rejected",
        retryable: bool = False,
    ) -> None:
        self.code = code
        self.detail = detail
        self.status = status
        self.retryable = retryable
        super().__init__(detail)


def sql(statement: str, connection: Any) -> str:
    return statement.replace("?", "%s") if any("psycopg" in c.__module__ for c in type(connection).__mro__) else statement


def sample_exists(connection: Any, tenant_id: str, sample_id: str) -> bool:
    cursor = connection.cursor()
    cursor.execute(
        sql("SELECT 1 FROM samples WHERE tenant_id = ? AND id = ?", connection),
        (tenant_id, sample_id),
    )
    return cursor.fetchone() is not None


def insert_sample(
    connection: Any,
    session: Session,
    event: SampleEventModel,
    *,
    device_id: str,
    payload_hash: str,
    server_data_mode: Literal["synthetic", "research", "operational"],
    server_time: str,
) -> None:
    payload = event.payload
    tenant_id = session.tenant_id
    cursor = connection.cursor()

    cursor.execute(
        sql("SELECT active FROM sources WHERE tenant_id = ? AND id = ?", connection),
        (tenant_id, str(payload.source_id)),
    )
    source = cursor.fetchone()
    if source is None or not bool(source[0]):
        raise SampleRejected("SOURCE_NOT_FOUND", "Source was not found.")

    supersedes_id: str | None = None
    if isinstance(event, SampleCorrectEvent):
        supersedes_id = str(event.payload.supersedes_id)
        cursor.execute(
            sql("SELECT source_id FROM samples WHERE tenant_id = ? AND id = ?", connection),
            (tenant_id, supersedes_id),
        )
        prior = cursor.fetchone()
        if prior is None:
            raise SampleRejected(
                "SUPERSEDED_SAMPLE_NOT_FOUND",
                "The sample being corrected has not arrived yet.",
                retryable=True,
            )
        if str(prior[0]) != str(payload.source_id):
            raise SampleRejected("CORRECTION_SOURCE_MISMATCH", "A correction must retain its source.")

    if sample_exists(connection, tenant_id, str(payload.sample_id)):
        raise SampleRejected(
            "SAMPLE_ID_CONFLICT",
            "Sample ID is already in use.",
            status="conflict",
        )

    authoritative_payload = payload.model_dump(mode="json")
    authoritative_payload["data_mode"] = server_data_mode
    payload_json = json.dumps(authoritative_payload, sort_keys=True, separators=(",", ":"))
    observation = payload.observation
    values = (
        tenant_id,
        str(payload.sample_id),
        str(event.event_id),
        str(payload.source_id),
        str(payload.protocol.id),
        payload.protocol.version,
        str(payload.kit_lot_id),
        payload.captured_at_device.isoformat(),
        server_time,
        payload.method.value,
        "accepted",
        supersedes_id,
        payload.schema_version,
        payload.client_build,
        server_data_mode,
        payload_hash,
        payload_json,
        device_id,
        session.user_id,
        observation.indicative_flag.value,
    )
    cursor.execute(
        sql(
            """INSERT INTO samples (
                tenant_id,id,event_id,source_id,protocol_id,protocol_version,kit_lot_id,
                captured_at_device,received_at_server,method,status,supersedes_id,
                record_schema_version,client_build,data_mode,payload_hash,payload_json,
                device_id,created_by,indicative_flag
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            connection,
        ),
        values,
    )
    cursor.execute(
        sql(
            """INSERT INTO observations (
                tenant_id,sample_id,machine_bin,manual_bin,selected_bin,indicative_flag,
                quality_reasons,model_version,calibration_version,confidence,timing_valid,
                override_reason
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            connection,
        ),
        (
            tenant_id,
            str(payload.sample_id),
            observation.machine_bin,
            observation.manual_bin,
            observation.selected_bin,
            observation.indicative_flag.value,
            json.dumps(observation.quality_reasons, separators=(",", ":")),
            observation.model_version,
            observation.calibration_version,
            observation.confidence,
            payload.timing.valid,
            observation.override_reason,
        ),
    )
