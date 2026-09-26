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

from ..migrations import actions, cases, changefeed, communications, evidence, lab, memberships, retention, samples, source

# Dependency order: each table's foreign keys point at tables earlier in the list.
MIGRATIONS = (source, samples, changefeed, evidence, cases, lab, actions, communications, memberships, retention)

SCHEMA = "jalsakshi"

#: api-contracts.md: "DB statement budget 3 s".
STATEMENT_TIMEOUT_MS = 3000

Connector = Callable[[], Any]


#: Idle PostgreSQL connections kept for reuse; one to the hosted database costs ~1.5 s to open.
POOL_SIZE = 10
#: A connection idle longer than this is pinged before reuse (the server may have dropped it).
POOL_PING_AFTER_S = 20.0


def connector(database_url: str, sqlite_path: Path) -> Connector:
    """Return a zero-argument function that opens one connection.

    PostgreSQL connections are pooled: close() rolls back whatever the request
    left open (transaction-local settings such as `set local role` go with it)
    and keeps the connection for the next caller. Session settings are only the
    two SETs below, identical for every request."""
    if database_url.startswith(("postgres://", "postgresql://")):
        import queue
        import time

        import psycopg

        idle: queue.LifoQueue = queue.LifoQueue(maxsize=POOL_SIZE)

        class PooledConnection(psycopg.Connection):
            released_at = 0.0
            in_pool = False

            def close(self) -> None:
                if self.in_pool:   # a second close() must not pool it twice
                    return
                if not self.closed and not self.broken:
                    try:
                        self.rollback()
                        self.released_at, self.in_pool = time.monotonic(), True
                        idle.put_nowait(self)
                        return
                    except (psycopg.Error, queue.Full):
                        self.in_pool = False
                super().close()

        def connect_pg() -> Any:
            while True:
                try:
                    conn = idle.get_nowait()
                except queue.Empty:
                    break
                conn.in_pool = False
                if time.monotonic() - conn.released_at < POOL_PING_AFTER_S:
                    return conn
                try:
                    conn.execute("select 1")
                    conn.rollback()
                    return conn
                except psycopg.Error:
                    psycopg.Connection.close(conn)
            conn = PooledConnection.connect(database_url, connect_timeout=5)
            conn.execute(f"SET search_path TO {SCHEMA}")
            conn.execute(f"SET statement_timeout = {STATEMENT_TIMEOUT_MS}")
            # Keep session settings outside domain transactions: otherwise a
            # rollback also resets search_path and the retry query hits public.
            conn.commit()
            return conn

        return connect_pg

    def connect_sqlite() -> Any:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        # FastAPI may open a request's connection (db dependency) on one
        # threadpool thread and run the handler or teardown on another. Each
        # connection still belongs to exactly one request and is used strictly
        # sequentially, so the thread check only produced false 500s under
        # load (T30: 4,732 errors at 50 req/s). PostgreSQL has no such check.
        conn = sqlite3.connect(sqlite_path, check_same_thread=False)
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    return connect_sqlite


#: T35: one arbitrary, fixed key for pg_advisory_lock. Two instances starting
#: together (a deploy overlapping the old one, or a scale-out) would otherwise
#: run the same DDL concurrently; the second now waits for the first.
MIGRATION_LOCK_KEY = 7_202_609_250


def migrate(conn: Any) -> None:
    """Apply every migration idempotently (all DDL is `IF NOT EXISTS`)."""
    dialect = "sqlite" if isinstance(conn, sqlite3.Connection) else "postgresql"
    if dialect == "postgresql":
        conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK_KEY,))
    try:
        if dialect == "postgresql":
            conn.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
            conn.execute(f"SET search_path TO {SCHEMA}")
        for module in MIGRATIONS:
            for statement in module.statements(dialect):
                conn.execute(statement)
        conn.commit()
    finally:
        if dialect == "postgresql":
            conn.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_KEY,))
            conn.commit()
