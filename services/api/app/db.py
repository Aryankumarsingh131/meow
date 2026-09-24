"""Database connections for the API.

PostgreSQL is the target (`JALSAKSHI_DATABASE_URL`); SQLite is the no-server
fallback for local development and tests. Query modules are dialect-neutral
(see `sources._adapt`), so both run the same statements.

**PostgreSQL tables live in the `jalsakshi` schema, never `public`.** On
Supabase the Data API exposes `public` to any holder of the publishable key,
which is client-visible by design. A table there without row-level security
would be readable and writable by anyone, bypassing T06 entirely. A schema the
Data API does not expose keeps the API the only way in.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any, Callable

from ..migrations import source

SCHEMA = "jalsakshi"

#: api-contracts.md: "DB statement budget 3 s".
STATEMENT_TIMEOUT_MS = 3000

Connector = Callable[[], Any]


def connector(database_url: str, sqlite_path: Path) -> Connector:
    """Return a zero-argument function that opens one connection."""
    if database_url.startswith(("postgres://", "postgresql://")):
        import psycopg

        def connect_pg() -> Any:
            conn = psycopg.connect(database_url, connect_timeout=5)
            conn.execute(f"SET search_path TO {SCHEMA}")
            conn.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
            return conn

        return connect_pg

    def connect_sqlite() -> Any:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(sqlite_path)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    return connect_sqlite


def migrate(conn: Any) -> None:
    """Apply every migration idempotently (all DDL is `IF NOT EXISTS`)."""
    if isinstance(conn, sqlite3.Connection):
        for statement in source.statements("sqlite"):
            conn.execute(statement)
    else:
        conn.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
        conn.execute(f"SET search_path TO {SCHEMA}")
        for statement in source.statements("postgresql"):
            conn.execute(statement)
    conn.commit()
