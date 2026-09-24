"""T36: logical backup, restore and verification for the API database.

No `pg_dump` is needed: every table the migrations create is written as JSON
lines plus a manifest of row counts and checksums, and can be restored into an
EMPTY PostgreSQL or SQLite database. The checksum ignores dialect differences
(a PostgreSQL boolean and a SQLite 1 hash the same), so a restore into either
can be verified against the source.

    python -m services.api.app.backup dump    <database-url> <dir>
    python -m services.api.app.backup restore <dir> <database-url> [--evidence DIR --ledger FILE]
    python -m services.api.app.backup verify  <dir> <database-url> [--smoke]

`restore` checks the checksums itself before re-applying deletions; `verify`
is for re-checking later (it reports evidence_assets once deletions were re-applied).

A database URL is `postgresql://...` or `sqlite:///path/to/file.sqlite3`.
Nothing here writes to the source database. See infra/backup.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from . import db, retention
from .samples import sql


def tables() -> list[str]:
    """Every table, in foreign-key order (the migration order)."""
    names: list[str] = []
    for module in db.MIGRATIONS:
        for statement in module.statements("sqlite"):
            m = re.match(r"CREATE TABLE IF NOT EXISTS (\w+)", statement)
            if m and m[1] not in names:
                names.append(m[1])
    return names


def connect(url: str) -> Any:
    if url.startswith("sqlite:///"):
        return db.connector("", Path(url.removeprefix("sqlite:///")))()
    return db.connector(url, Path("unused"))()


def _plain(value: Any) -> Any:
    """A JSON value that restores into either dialect."""
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    return value


_TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$")


def _canon_value(v: Any) -> Any:
    """SQLite keeps booleans as 0/1 and timestamps as whatever text was written
    ('+00:00' or 'Z'); PostgreSQL returns bool and datetime. Hash both alike."""
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, str) and _TIMESTAMP.match(v):
        return _plain(datetime.fromisoformat(v))
    return v


def _canonical(row: list[Any]) -> str:
    return json.dumps([_canon_value(v) for v in row], separators=(",", ":"))


# ponytail: whole table in memory (about 26 MB per 10k samples, T41); stream
# with a server-side cursor once a table nears a million rows.
def _read(conn: Any, table: str) -> tuple[list[str], list[list[Any]]]:
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table}")
    columns = [d[0] for d in cursor.description]
    return columns, [[_plain(v) for v in row] for row in cursor.fetchall()]


def manifest_of(conn: Any) -> dict[str, dict[str, Any]]:
    out = {}
    for table in tables():
        _, rows = _read(conn, table)
        lines = sorted(_canonical(r) for r in rows)
        out[table] = {"rows": len(rows), "sha256": hashlib.sha256("\n".join(lines).encode()).hexdigest()}
    return out


def dump(url: str, directory: Path) -> dict[str, Any]:
    directory.mkdir(parents=True, exist_ok=True)
    conn = connect(url)
    try:
        # One snapshot for every table, so counts and the changefeed agree.
        if not isinstance(conn, sqlite3.Connection):
            conn.execute("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        taken_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        for table in tables():
            columns, rows = _read(conn, table)
            with (directory / f"{table}.jsonl").open("w", encoding="utf-8") as f:
                f.write(json.dumps(columns) + "\n")
                for row in rows:
                    f.write(json.dumps(row) + "\n")
        manifest = {"taken_at": taken_at, "tables": manifest_of(conn)}
    finally:
        conn.rollback()
        conn.close()
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _boolean_positions(conn: Any, table: str, columns: list[str]) -> list[int]:
    if isinstance(conn, sqlite3.Connection):
        return []
    cursor = conn.cursor()
    cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = %s AND table_name = %s "
                   "AND data_type = 'boolean'", (db.SCHEMA, table))
    names = {r[0] for r in cursor.fetchall()}
    return [i for i, c in enumerate(columns) if c in names]


def restore(directory: Path, url: str, *, evidence: Path | None = None,
            ledger: Path | None = None) -> tuple[list[str], list[str]]:
    """Load a dump into an empty database and check it against the manifest,
    THEN re-apply the deletion ledger (T47) so evidence deleted after the
    backup was taken stays deleted (that step changes evidence_assets, so it
    must come after the checksum). Returns (mismatched tables, re-deleted assets)."""
    conn = connect(url)
    try:
        db.migrate(conn)
        cursor = conn.cursor()
        for table in tables():
            cursor.execute(f"SELECT 1 FROM {table} LIMIT 1")
            if cursor.fetchone():
                raise SystemExit(f"refusing to restore: {table} is not empty (restore only into a fresh database)")
        for table in tables():
            lines = (directory / f"{table}.jsonl").read_text(encoding="utf-8").splitlines()
            columns = json.loads(lines[0])
            marks = ", ".join(["?"] * len(columns))
            statement = sql(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({marks})", conn)
            flags = _boolean_positions(conn, table, columns)
            for line in lines[1:]:
                row = json.loads(line)
                for i in flags:  # a SQLite dump holds booleans as 0/1
                    row[i] = None if row[i] is None else bool(row[i])
                cursor.execute(statement, row)
        conn.commit()
        mismatched = verify(directory, url)
        return mismatched, retention.reapply_deletions(conn, evidence, ledger) if evidence and ledger else []
    finally:
        conn.close()


def verify(directory: Path, url: str) -> list[str]:
    """Tables whose restored rows differ from the dump's manifest (empty = all reconcile)."""
    expected = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))["tables"]
    conn = connect(url)
    try:
        actual = manifest_of(conn)
    finally:
        conn.close()
    return [t for t in expected if expected[t] != actual.get(t)]


def smoke(url: str) -> list[str]:
    """Authorization smoke on a restored database, through the real API routes:
    a restored member signs in (local test issuer) and sees their tenant's
    sources; a stranger is refused. Returns failures."""
    from .dev_issuer import DevIssuer, load_or_create_key
    from .main import app
    from .provider import db_membership_lookup

    conn = connect(url)
    try:
        cursor = conn.cursor()
        cursor.execute(sql("SELECT user_id, tenant_id FROM memberships WHERE active = ?", conn), (True,))
        member = cursor.fetchone()
        if member is None:
            return ["the restored database has no active membership to sign in with"]
        cursor.execute(sql("SELECT count(*) FROM sources WHERE tenant_id = ? AND active = true", conn), (member[1],))
        expected_sources = cursor.fetchone()[0]
    finally:
        conn.close()
    issuer = DevIssuer(load_or_create_key(Path(".data") / "backup-smoke-key.pem"))
    saved = {k: getattr(app.state, k, None) for k in ("connect", "auth")}
    app.state.connect = lambda: connect(url)
    app.state.auth = (issuer.oidc_config(), db_membership_lookup(app.state.connect))
    try:
        failures = _smoke_requests(app, issuer, member, expected_sources)
    finally:
        for k, v in saved.items():
            setattr(app.state, k, v)
    return failures


def _smoke_requests(app: Any, issuer: Any, member: Any, expected_sources: int) -> list[str]:
    from fastapi.testclient import TestClient

    failures = []
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {issuer.mint(str(member[0]))}"}
        me = client.get("/v1/me", headers=headers)
        if me.status_code != 200 or me.json().get("tenant_id") != str(member[1]):
            failures.append(f"/v1/me for a restored member: {me.status_code}")
        sources = client.get("/v1/sources?limit=100", headers=headers)
        if sources.status_code != 200 or len(sources.json()["items"]) != min(expected_sources, 100):
            failures.append(f"/v1/sources: {sources.status_code}")
        stranger = client.get("/v1/me", headers={"Authorization": f"Bearer {issuer.mint('00000000-0000-4000-8000-000000000000')}"})
        if stranger.status_code != 403:
            failures.append(f"a user with no membership got {stranger.status_code}, expected 403")
    return failures


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="backup")
    sub = p.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dump"); d.add_argument("url"); d.add_argument("dir", type=Path)  # noqa: E702
    r = sub.add_parser("restore"); r.add_argument("dir", type=Path); r.add_argument("url")  # noqa: E702
    r.add_argument("--evidence", type=Path); r.add_argument("--ledger", type=Path)  # noqa: E702
    v = sub.add_parser("verify"); v.add_argument("dir", type=Path); v.add_argument("url")  # noqa: E702
    v.add_argument("--smoke", action="store_true")
    a = p.parse_args(argv)
    started = time.perf_counter()
    if a.cmd == "dump":
        m = dump(a.url, a.dir)
        print(f"dumped {sum(t['rows'] for t in m['tables'].values())} rows from {len(m['tables'])} tables at {m['taken_at']}")
    elif a.cmd == "restore":
        bad, redone = restore(a.dir, a.url, evidence=a.evidence, ledger=a.ledger)
        print(("MISMATCH: " + ", ".join(bad)) if bad else "restored; all tables reconcile with the manifest")
        print(f"deletion ledger re-applied to {len(redone)} assets")
        if bad:
            return 1
    else:
        bad = verify(a.dir, a.url) + (smoke(a.url) if a.smoke else [])
        print("MISMATCH: " + "; ".join(bad) if bad else "all tables reconcile" + (" and the authorization smoke passed" if a.smoke else ""))
        if bad:
            return 1
    print(f"took {time.perf_counter() - started:.2f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
