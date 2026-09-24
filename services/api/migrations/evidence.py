"""T16 migration: private evidence assets.

data-model.md: `evidence_assets(tenant_id, id, sample_or_case_id, sha256,
media_type, bytes, storage_key, state, permission_version, expires_at)`;
"private generated keys; states local_only/uploading/quarantined/available/
rejected/deleted". `local_only` is a device state and never reaches the server.

The asset's state is independent of the sample it belongs to: a rejected or
missing photo never changes an accepted sample, and vice versa.
"""

from __future__ import annotations

from typing import Any, Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz"},
    "sqlite": {"uuid": "text", "timestamp": "text"},
}

_TABLE = """
CREATE TABLE IF NOT EXISTS evidence_assets (
    tenant_id          {uuid}      NOT NULL,
    id                 {uuid}      NOT NULL,
    context            text        NOT NULL CHECK (context IN ('sample_photo', 'lab_report')),
    target_id          {uuid}      NOT NULL,
    sha256             text        NOT NULL CHECK (length(sha256) = 64),
    media_type         text        NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    bytes              integer     NOT NULL CHECK (bytes > 0),
    storage_key        text        NOT NULL,
    state              text        NOT NULL CHECK (state IN ('uploading', 'quarantined', 'available', 'rejected', 'deleted')),
    state_reason       text,
    uploaded_by        {uuid}      NOT NULL,
    permission_version integer     NOT NULL CHECK (permission_version >= 1),
    created_at         {timestamp} NOT NULL,
    expires_at         {timestamp} NOT NULL,
    completed_at       {timestamp},
    PRIMARY KEY (tenant_id, id),
    UNIQUE (storage_key)
)
"""

_INDEXES = ("CREATE INDEX IF NOT EXISTS evidence_tenant_target_idx ON evidence_assets (tenant_id, target_id)",)


def statements(dialect: Dialect = "postgresql") -> list[str]:
    return [_TABLE.format(**_TYPES[dialect]).strip(), *_INDEXES]


def apply(connection: Any, dialect: Dialect = "postgresql") -> None:
    cursor = connection.cursor()
    for statement in statements(dialect):
        cursor.execute(statement)
    connection.commit()
