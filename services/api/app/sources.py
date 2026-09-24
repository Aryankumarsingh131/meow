"""T07: tenant-scoped source catalogue and source history.

Implements the two field endpoints from
jalsakshi-blueprint/docs/architecture/api-contracts.md:

    GET /v1/sources             q, active, cursor, limit -> items, next_cursor
    GET /v1/sources/{id}/history  cursor, limit -> accepted tests/cases

Rules this module exists to enforce:

* **Tenant comes from the session, never from a caller argument.** Every
  statement filters on `session.tenant_id` (T06's `Session`). There is no
  parameter that lets a caller name a tenant.
* **Parameterized SQL only.** No value is ever formatted into a statement.
  The search term additionally escapes LIKE wildcards, which are not SQL
  injection but are a denial-of-service and a correctness bug ("%" matching
  every row in the tenant).
* **Bounded inputs.** `limit` is clamped and `q` is length-capped before it
  reaches the database.
* **Typed outcomes.** QR resolution returns a discriminated result, never
  `Source | None` - "this QR is not a source" and "this QR is not even a
  JalSakshi code" are different facts and the UI must show different things.

**Paramstyle (resolved 2026-09-22).** Statements below are written with DB-API
`qmark` (`?`) placeholders. SQLite accepts those directly; psycopg wants
`pyformat` (`%s`). `_adapt` rewrites them per connection, so one set of
statements serves both. This is no longer an untested translation: it has been
run against a real PostgreSQL 17.6 server (Supabase) as well as SQLite, and
tests/sources_test.py passes on both. See docs/agent-workflow/handoff-T07.md.

Interface dependency: `source_history` reads the `samples` table, which is
**T13's** migration (`services/api/migrations/samples.py`) and does not exist
yet. T07 owns only `sources`. The expected column set is documented in
`SAMPLES_COLUMNS_EXPECTED` below and stood up as a fixture in the tests; it is
an expectation to agree with T13's owner, not a schema this task defines.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Any, Literal, Sequence

from .auth import Denied, Session
from ..migrations.source import MAX_LABEL_LENGTH, MAX_QR_CODE_LENGTH

#: Query-string bound for a catalogue cursor; see `_encode_cursor`.
MAX_CURSOR_LENGTH = 1024

# Bounds for list/history paging. A caller asking for more gets the maximum,
# not an error: a bounded result is always a correct answer to "give me some".
DEFAULT_LIMIT = 50
MAX_LIMIT = 100  # api-contracts.md: default 50, max 100
MAX_SEARCH_LENGTH = 60

# Columns `source_history` expects T13 to provide on `samples`.
SAMPLES_COLUMNS_EXPECTED = (
    "tenant_id",
    "id",
    "source_id",
    "received_at_server",
    "status",
    "method",
    "indicative_flag",
)

# A JalSakshi QR payload is an opaque bounded token. It is deliberately NOT a
# URL: see `parse_qr_payload`.
_QR_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")


def _is_uuid(value: str) -> bool:
    """True if `value` can be bound to a PostgreSQL `uuid` column.

    Ids reaching this module from a path or a cursor are caller-controlled.
    PostgreSQL raises on `id = 'abc'` (and aborts the transaction); SQLite
    accepts anything. Checking here makes both dialects answer the same way.
    """
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


@dataclass(frozen=True)
class Source:
    tenant_id: str
    id: str
    qr_code: str
    label: str
    locality: str
    latitude: float | None
    longitude: float | None
    accuracy_m: float | None
    active: bool
    version: int

    @property
    def has_coordinates(self) -> bool:
        """Missing coordinates never block identification (data-model.md)."""
        return self.latitude is not None and self.longitude is not None


@dataclass(frozen=True)
class SourcePage:
    items: tuple[Source, ...]
    next_cursor: str | None


@dataclass(frozen=True)
class InvalidCursor:
    """The cursor is not one this server issued (api-contracts.md: 422).

    Returned, not silently treated as "first page": a client that loops on
    `next_cursor` would otherwise restart from page one forever.
    """

    code: Literal["VALIDATION_FAILED"] = "VALIDATION_FAILED"
    detail: str = "Unrecognised paging cursor."


@dataclass(frozen=True)
class HistoryEntry:
    """One previously accepted test for a source.

    `indicative_flag` is the machine/ordinal screening outcome only. It is not
    a lab result and not a potability statement (AGENTS.md); the three
    provenance fields stay separate all the way to the screen.
    """

    sample_id: str
    received_at_server: str
    status: str
    method: str
    indicative_flag: str


@dataclass(frozen=True)
class HistoryPage:
    source_id: str
    items: tuple[HistoryEntry, ...]
    next_cursor: str | None
    #: Server clock at query time. The client needs this to label staleness
    #: against a trustworthy clock rather than the device's own.
    served_at: str


# --- QR resolution outcomes (discriminated) --------------------------------


@dataclass(frozen=True)
class QrMatched:
    source: Source


@dataclass(frozen=True)
class QrUnknown:
    """Well-formed token, but no source in this tenant carries it.

    Indistinguishable from "exists in another tenant" by construction: the
    lookup is tenant-filtered, so the other tenant's row is simply not there.
    """

    token: str


@dataclass(frozen=True)
class QrMalformed:
    """Not a JalSakshi token at all - a URL, a vCard, arbitrary bytes.

    Carries only a reason, never the payload. Echoing scanned content back
    into a UI or a log is how a hostile QR reaches somewhere it should not.
    """

    reason: Literal["empty", "too_long", "illegal_characters"]


QrResult = QrMatched | QrUnknown | QrMalformed


def parse_qr_payload(payload: str | None) -> str | QrMalformed:
    """Validate a scanned payload as a bounded opaque token.

    A JalSakshi QR carries an identifier and nothing else. It is explicitly not
    a URL, so a scanned `https://...` is `illegal_characters` and can never be
    navigated to - AC-001, "unknown QR never navigates arbitrary URLs". The
    allowlist is the control; there is no blocklist of "dangerous" schemes to
    keep up to date.
    """
    if payload is None:
        return QrMalformed("empty")
    token = payload.strip()
    if not token:
        return QrMalformed("empty")
    if len(token) > MAX_QR_CODE_LENGTH:
        # Checked before the regex: a megabyte QR payload should not be run
        # through a pattern match at all.
        return QrMalformed("too_long")
    if not _QR_TOKEN.match(token):
        return QrMalformed("illegal_characters")
    return token


def _row_to_source(row: Sequence[Any]) -> Source:
    # psycopg returns native `uuid.UUID` objects for uuid columns; SQLite
    # returns plain strings. `Source` declares these as `str`, so coerce here
    # rather than leaking a driver-dependent type to every caller - otherwise
    # `source.id == "..."` silently fails on PostgreSQL and passes on SQLite.
    return Source(
        tenant_id=str(row[0]),
        id=str(row[1]),
        qr_code=row[2],
        label=row[3],
        locality=row[4],
        latitude=row[5],
        longitude=row[6],
        accuracy_m=row[7],
        active=bool(row[8]),
        version=row[9],
    )


_SELECT = (
    "SELECT tenant_id, id, qr_code, label, locality, latitude, longitude, "
    "accuracy_m, active, version FROM sources"
)


def _adapt(statement: str, connection: Any) -> str:
    """Rewrite `?` placeholders to `%s` for psycopg connections.

    Only the placeholder style differs between the two targets; the SQL itself
    is portable (`active = true`, row-value comparison, `LIKE ... ESCAPE`).

    Safe as a blind replace **because no statement in this module contains a
    literal `?` inside a string literal** - the only quoted literal is
    `'accepted'`. If that ever changes, this must become a real tokeniser
    rather than a substitution.
    """
    if "psycopg" in type(connection).__module__:
        return statement.replace("?", "%s")
    return statement


def _clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so a user's `%` searches for a literal percent.

    Backslash first, or it would double-escape the escapes it just added.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def resolve_qr(connection: Any, session: Session, payload: str | None) -> QrResult:
    """Resolve a scanned QR payload to a source **within the session tenant**."""
    parsed = parse_qr_payload(payload)
    if isinstance(parsed, QrMalformed):
        return parsed

    cursor = connection.cursor()
    cursor.execute(
        _adapt(f"{_SELECT} WHERE tenant_id = ? AND qr_code = ?", connection),
        (session.tenant_id, parsed),
    )
    row = cursor.fetchone()
    if row is None:
        return QrUnknown(parsed)
    source = _row_to_source(row)
    if not source.active:
        # A deactivated source must not be selectable for a new test, and the
        # worker must not be told "unknown" either - that would send them
        # hunting for a typo that does not exist.
        return QrUnknown(parsed)
    return QrMatched(source)


def list_sources(
    connection: Any,
    session: Session,
    *,
    q: str | None = None,
    include_inactive: bool = False,
    cursor: str | None = None,
    limit: int | None = None,
) -> SourcePage | InvalidCursor:
    """Tenant-scoped, searchable, keyset-paginated source catalogue.

    `include_inactive` is available for completeness but the field catalogue
    calls it with the default `False`; listing inactive sources is the admin
    route's job (api-contracts.md `GET /v1/admin/sources`).

    Paging is keyset on `(label, id)`, not OFFSET: a catalogue that is being
    edited while a worker pages through it would otherwise skip or repeat rows.
    """
    page_size = _clamp_limit(limit)
    conditions = ["tenant_id = ?"]
    params: list[Any] = [session.tenant_id]

    if not include_inactive:
        # `active = true`, not `active = 1`: the latter is a type error in
        # PostgreSQL, which is the target dialect.
        conditions.append("active = true")

    if q is not None:
        term = q.strip()[:MAX_SEARCH_LENGTH]
        if term:
            # Search label and locality - a worker knows the village name as
            # often as the handpump label.
            conditions.append("(label LIKE ? ESCAPE '\\' OR locality LIKE ? ESCAPE '\\')")
            pattern = f"%{_escape_like(term)}%"
            params.extend([pattern, pattern])

    if cursor is not None:
        decoded = _decode_cursor(cursor)
        if decoded is None:
            return InvalidCursor()
        last_label, last_id = decoded
        conditions.append("(label, id) > (?, ?)")
        params.extend([last_label, last_id])

    # `page_size + 1` tells us whether a further page exists without a second
    # COUNT query over the whole catalogue.
    statement = (
        f"{_SELECT} WHERE {' AND '.join(conditions)} ORDER BY label, id LIMIT ?"
    )
    params.append(page_size + 1)

    db = connection.cursor()
    db.execute(_adapt(statement, connection), params)
    rows = db.fetchall()

    has_more = len(rows) > page_size
    items = tuple(_row_to_source(row) for row in rows[:page_size])
    next_cursor = _encode_cursor(items[-1].label, items[-1].id) if has_more and items else None
    return SourcePage(items=items, next_cursor=next_cursor)


def _encode_cursor(label: str, source_id: str) -> str:
    import base64
    import json

    # UTF-8, not \uXXXX escapes: a 120-character Devanagari label escaped is a
    # 1,340-character cursor, past MAX_CURSOR_LENGTH, which made every page
    # after it unreachable. UTF-8 bounds it at ~704 even for 4-byte characters.
    raw = json.dumps([label, source_id], separators=(",", ":"), ensure_ascii=False).encode()
    return base64.urlsafe_b64encode(raw).decode()


def _decode_cursor(cursor: str) -> tuple[str, str] | None:
    """Decode a paging cursor, or `None` if it is not one.

    Callers turn `None` into `InvalidCursor` (422). The decoded values are
    never trusted as SQL - they are bound as parameters like everything else.
    """
    import base64
    import json

    try:
        raw = base64.urlsafe_b64decode(cursor.encode())
        value = json.loads(raw)
    except Exception:
        return None
    if not isinstance(value, list) or len(value) != 2:
        return None
    if not all(isinstance(part, str) for part in value):
        return None
    if len(value[0]) > MAX_LABEL_LENGTH or not _is_uuid(value[1]):
        return None
    return value[0], value[1]


def source_history(
    connection: Any,
    session: Session,
    source_id: str,
    *,
    served_at: str,
    cursor: str | None = None,
    limit: int | None = None,
) -> HistoryPage | Denied | InvalidCursor:
    """Accepted tests for one source, newest first.

    Returns `Denied("NOT_FOUND")` when the source is not in the session
    tenant. Same reasoning as T06's object check: a 403 would confirm that
    another tenant's source ID is real and let a worker enumerate them.

    Reads `samples`, which is T13's table - see the module docstring.
    """
    page_size = _clamp_limit(limit)
    # A malformed id cannot name any source: same answer as a missing one.
    if not _is_uuid(source_id):
        return Denied("NOT_FOUND", "Resource not found.")
    db = connection.cursor()

    # Re-check the parent object in this tenant before reading any child rows.
    db.execute(
        _adapt("SELECT 1 FROM sources WHERE tenant_id = ? AND id = ?", connection),
        (session.tenant_id, source_id),
    )
    if db.fetchone() is None:
        return Denied("NOT_FOUND", "Resource not found.")

    conditions = ["tenant_id = ?", "source_id = ?", "status = 'accepted'"]
    params: list[Any] = [session.tenant_id, source_id]

    if cursor is not None:
        decoded = _decode_cursor(cursor)
        if decoded is None:
            return InvalidCursor()
        last_received, last_id = decoded
        conditions.append("(received_at_server, id) < (?, ?)")
        params.extend([last_received, last_id])

    statement = (
        "SELECT id, received_at_server, status, method, indicative_flag FROM samples "
        f"WHERE {' AND '.join(conditions)} ORDER BY received_at_server DESC, id DESC LIMIT ?"
    )
    params.append(page_size + 1)
    db.execute(_adapt(statement, connection), params)
    rows = db.fetchall()

    has_more = len(rows) > page_size
    items = tuple(
        HistoryEntry(
            sample_id=str(row[0]),  # psycopg returns uuid.UUID; see _row_to_source
            received_at_server=row[1],
            status=row[2],
            method=row[3],
            indicative_flag=row[4],
        )
        for row in rows[:page_size]
    )
    next_cursor = (
        _encode_cursor(items[-1].received_at_server, items[-1].sample_id)
        if has_more and items
        else None
    )
    return HistoryPage(
        source_id=source_id,
        items=items,
        next_cursor=next_cursor,
        served_at=served_at,
    )
