"""T14 migration: per-tenant commit-ordered change feed.

data-model.md: `sync_heads(tenant_id, next_seq)` and
`changefeed(tenant_id, seq, entity_type/id, operation, version)`, "allocate
under tenant lock inside mutation transaction; indexed tenant/seq".

`floor_seq` is the highest compacted sequence. A pull cursor below it cannot
be served without silently skipping changes, so it answers 410 RESET_REQUIRED.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz"},
    "sqlite": {"uuid": "text", "timestamp": "text"},
}

_TABLES = """
CREATE TABLE IF NOT EXISTS sync_heads (
    tenant_id  {uuid}  NOT NULL PRIMARY KEY,
    next_seq   bigint  NOT NULL CHECK (next_seq >= 1),
    floor_seq  bigint  NOT NULL DEFAULT 0 CHECK (floor_seq >= 0 AND floor_seq < next_seq)
);

CREATE TABLE IF NOT EXISTS changefeed (
    tenant_id     {uuid}      NOT NULL,
    seq           bigint      NOT NULL CHECK (seq >= 1),
    entity_type   text        NOT NULL CHECK (entity_type IN ('sample')),
    entity_id     {uuid}      NOT NULL,
    operation     text        NOT NULL CHECK (operation IN ('upsert', 'tombstone')),
    version       integer     NOT NULL CHECK (version >= 1),
    committed_at  {timestamp} NOT NULL,
    PRIMARY KEY (tenant_id, seq)
)
"""


def statements(dialect: Dialect = "postgresql") -> list[str]:
    tables = _TABLES.format(**_TYPES[dialect])
    return [statement.strip() for statement in tables.split(";\n") if statement.strip()]


def apply(connection: Any, dialect: Dialect = "postgresql") -> None:
    cursor = connection.cursor()
    for statement in statements(dialect):
        cursor.execute(statement)
    connection.commit()


def apply_sqlite(connection: sqlite3.Connection) -> None:
    apply(connection, "sqlite")
