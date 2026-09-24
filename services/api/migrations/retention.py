"""T47: the deletion ledger. One row per evidence asset purged by retention.

Written BEFORE the bytes are removed (`requested_at`) and completed after
(`completed_at`), so an interrupted purge is resumable. Each completed row is
also appended to a file outside the database (retention.LEDGER_FILE): a
database restored from an older backup would otherwise roll the ledger back
along with everything else and resurrect deleted evidence.
"""

from __future__ import annotations

from typing import Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz"},
    "sqlite": {"uuid": "text", "timestamp": "text"},
}

_TABLE = """
CREATE TABLE IF NOT EXISTS deletion_ledger (
    tenant_id     {uuid}      NOT NULL,
    asset_id      {uuid}      NOT NULL,
    storage_key   text        NOT NULL,
    sha256        text        NOT NULL,
    reason        text        NOT NULL,
    requested_at  {timestamp} NOT NULL,
    completed_at  {timestamp},
    PRIMARY KEY (tenant_id, asset_id)
)
"""


def statements(dialect: Dialect = "postgresql") -> list[str]:
    return [_TABLE.format(**_TYPES[dialect]).strip()]
