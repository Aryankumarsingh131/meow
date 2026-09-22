"""T07 migration: the `sources` table.

Columns, constraints and indexes come from the `sources` row of
jalsakshi-blueprint/docs/architecture/data-model.md:

    tenant_id, id, qr_code, label, locality, optional coordinates/accuracy,
    active, version | Unique (tenant_id, qr_code); index tenant/label and
    tenant/id

Scope: this migration owns ONLY `sources`. `samples` and `cases` belong to
T13/T14 (`services/api/migrations/samples.py`, `.../changefeed.py`) and are
deliberately not created here - one owner per migration, per AGENTS.md. The
source-history read in services/api/app/sources.py therefore depends on T13's
table; see that module's docstring for the interface expectation.

**PostgreSQL is the target and has never been run against.** No PostgreSQL
server and no psycopg driver exist in this environment, so the DDL below is
exercised against SQLite in tests/sources_test.py. The dialect differences are
isolated to `_TYPES` rather than maintained as two separate scripts, and a
test asserts both dialects produce the same columns and constraints. That is
not the same as having run the migration on PostgreSQL - it has not been, and
the handoff records that.

No `DROP` and no hard delete: deactivation is `active = false`
(api-contracts.md, `PATCH /v1/admin/sources/{id}`).
"""

from __future__ import annotations

import sqlite3
from typing import Any, Literal

Dialect = Literal["postgresql", "sqlite"]

# The only types that differ between the target and the test dialect. SQLite
# has no native uuid type and stores timestamps as text.
_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz", "float": "double precision"},
    "sqlite": {"uuid": "text", "timestamp": "text", "float": "real"},
}

# Bounds are enforced in the database as well as at the API trust boundary.
# A CHECK here is what survives a future caller that forgets to validate.
MAX_QR_CODE_LENGTH = 64
MAX_LABEL_LENGTH = 120
MAX_LOCALITY_LENGTH = 80

_TABLE = """
CREATE TABLE IF NOT EXISTS sources (
    tenant_id   {uuid}    NOT NULL,
    id          {uuid}    NOT NULL,
    qr_code     text      NOT NULL,
    label       text      NOT NULL,
    locality    text      NOT NULL,
    latitude    {float},
    longitude   {float},
    accuracy_m  {float},
    active      boolean   NOT NULL DEFAULT true,
    version     integer   NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT sources_qr_code_bounded  CHECK (length(qr_code) BETWEEN 1 AND {max_qr}),
    CONSTRAINT sources_label_bounded    CHECK (length(label) BETWEEN 1 AND {max_label}),
    CONSTRAINT sources_locality_bounded CHECK (length(locality) BETWEEN 1 AND {max_locality}),
    -- Coordinates are optional, but a present coordinate must be real. A
    -- nonsense latitude would otherwise be rendered on a map as fact.
    CONSTRAINT sources_latitude_range   CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
    CONSTRAINT sources_longitude_range  CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
    CONSTRAINT sources_accuracy_positive CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
    CONSTRAINT sources_version_positive CHECK (version >= 1),
    -- Latitude without longitude is not a location. Storing half a coordinate
    -- invites a caller to treat the other half as zero, which is a real place.
    CONSTRAINT sources_coordinates_paired
        CHECK ((latitude IS NULL) = (longitude IS NULL))
)
"""

# Unique per tenant, NOT globally: two tenants may legitimately print the same
# QR value, and a global unique index would leak one tenant's existence to
# another as an insert conflict.
_INDEXES = (
    "CREATE UNIQUE INDEX IF NOT EXISTS sources_tenant_qr_code_key ON sources (tenant_id, qr_code)",
    "CREATE INDEX IF NOT EXISTS sources_tenant_label_idx ON sources (tenant_id, label)",
)


def statements(dialect: Dialect = "postgresql") -> list[str]:
    """Return the ordered DDL statements for `dialect`."""
    types = _TYPES[dialect]
    table = _TABLE.format(
        uuid=types["uuid"],
        float=types["float"],
        max_qr=MAX_QR_CODE_LENGTH,
        max_label=MAX_LABEL_LENGTH,
        max_locality=MAX_LOCALITY_LENGTH,
    )
    return [table.strip(), *_INDEXES]


def apply(connection: Any, dialect: Dialect = "postgresql") -> None:
    """Apply the migration. `connection` is a DB-API connection.

    Idempotent (`IF NOT EXISTS` throughout) so a partial previous run is
    recoverable without a manual repair step.
    """
    cursor = connection.cursor()
    for statement in statements(dialect):
        cursor.execute(statement)
    connection.commit()


def apply_sqlite(connection: sqlite3.Connection) -> None:
    """SQLite entry point used by tests. Enables CHECK/FK enforcement, which
    SQLite leaves off by default - without this the bounds above would be
    silently unenforced and the tests would pass for the wrong reason."""
    connection.execute("PRAGMA foreign_keys = ON")
    apply(connection, "sqlite")
