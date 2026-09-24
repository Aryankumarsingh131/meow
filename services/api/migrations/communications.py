"""T22 migration: resident communication records.

data-model.md / case-state-machine.md: recording a communication never implies
delivery happened - it is the operator's own record of channel, template
version and audience, with who and when attached automatically. Closure (row
11) reads this table for real evidence instead of trusting a client-typed id.

Append-only: there is no update or delete path, matching lab_reports and
case_events. The row's `id` is the client-chosen `command_id` of the
`record_communication` case command that created it (see cases.py), so a
client can pass that same id straight back as `close`'s `communication_id`
without a second round trip.
"""

from __future__ import annotations

from typing import Any, Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz"},
    "sqlite": {"uuid": "text", "timestamp": "text"},
}

_TABLE = """
CREATE TABLE IF NOT EXISTS communications (
    tenant_id            {uuid}      NOT NULL,
    id                    {uuid}      NOT NULL,
    case_id               {uuid}      NOT NULL,
    channel               text        NOT NULL CHECK (length(channel) BETWEEN 1 AND 160),
    template_version      integer     NOT NULL CHECK (template_version >= 1),
    audience_description  text        NOT NULL CHECK (length(audience_description) BETWEEN 1 AND 2000),
    actor_id              {uuid}      NOT NULL,
    occurred_at           {timestamp} NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, case_id) REFERENCES cases (tenant_id, id)
)
"""

_INDEXES = ("CREATE INDEX IF NOT EXISTS communications_tenant_case_idx ON communications (tenant_id, case_id)",)


def statements(dialect: Dialect = "postgresql") -> list[str]:
    return [_TABLE.format(**_TYPES[dialect]).strip(), *_INDEXES]


def apply(connection: Any, dialect: Dialect = "postgresql") -> None:
    cursor = connection.cursor()
    for statement in statements(dialect):
        cursor.execute(statement)
    connection.commit()
