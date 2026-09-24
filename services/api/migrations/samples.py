"""T13 migration: immutable samples, observations and idempotency receipts."""

from __future__ import annotations

import sqlite3
from typing import Any, Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz", "float": "double precision"},
    "sqlite": {"uuid": "text", "timestamp": "text", "float": "real"},
}

_TABLES = """
CREATE TABLE IF NOT EXISTS samples (
    tenant_id              {uuid}      NOT NULL,
    id                     {uuid}      NOT NULL,
    event_id               {uuid}      NOT NULL,
    source_id              {uuid}      NOT NULL,
    protocol_id            {uuid}      NOT NULL,
    protocol_version       integer     NOT NULL CHECK (protocol_version >= 1),
    kit_lot_id             {uuid}      NOT NULL,
    captured_at_device     {timestamp} NOT NULL,
    received_at_server     {timestamp} NOT NULL,
    method                 text        NOT NULL CHECK (method IN ('assisted', 'manual')),
    status                 text        NOT NULL CHECK (status = 'accepted'),
    supersedes_id          {uuid},
    record_schema_version  integer     NOT NULL CHECK (record_schema_version = 1),
    client_build           text        NOT NULL CHECK (length(client_build) BETWEEN 1 AND 160),
    data_mode              text        NOT NULL CHECK (data_mode IN ('synthetic', 'research', 'operational')),
    payload_hash           text        NOT NULL CHECK (length(payload_hash) = 64),
    payload_json           text        NOT NULL,
    device_id              {uuid}      NOT NULL,
    created_by             {uuid}      NOT NULL,
    indicative_flag        text        NOT NULL CHECK (indicative_flag IN ('no_flag', 'review', 'uncertain', 'invalid')),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, event_id),
    FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, id),
    FOREIGN KEY (tenant_id, supersedes_id) REFERENCES samples (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS observations (
    tenant_id           {uuid}  NOT NULL,
    sample_id           {uuid}  NOT NULL,
    machine_bin         text,
    manual_bin          text,
    selected_bin        text,
    indicative_flag     text    NOT NULL CHECK (indicative_flag IN ('no_flag', 'review', 'uncertain', 'invalid')),
    quality_reasons     text    NOT NULL,
    model_version       text,
    calibration_version text,
    confidence          {float} CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
    timing_valid        boolean NOT NULL,
    override_reason     text,
    PRIMARY KEY (tenant_id, sample_id),
    FOREIGN KEY (tenant_id, sample_id) REFERENCES samples (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS idempotency_receipts (
    tenant_id    {uuid}      NOT NULL,
    event_id     {uuid}      NOT NULL,
    payload_hash text        NOT NULL CHECK (length(payload_hash) = 64),
    result_json  text        NOT NULL,
    created_at   {timestamp} NOT NULL,
    PRIMARY KEY (tenant_id, event_id)
)
"""

_INDEXES = (
    "CREATE INDEX IF NOT EXISTS samples_tenant_source_received_idx ON samples (tenant_id, source_id, received_at_server DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS samples_tenant_supersedes_idx ON samples (tenant_id, supersedes_id)",
)


def statements(dialect: Dialect = "postgresql") -> list[str]:
    tables = _TABLES.format(**_TYPES[dialect])
    return [statement.strip() for statement in tables.split(";\n") if statement.strip()] + list(_INDEXES)


def apply(connection: Any, dialect: Dialect = "postgresql") -> None:
    cursor = connection.cursor()
    for statement in statements(dialect):
        cursor.execute(statement)
    connection.commit()


def apply_sqlite(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA foreign_keys = ON")
    apply(connection, "sqlite")
