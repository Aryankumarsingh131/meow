"""T17 migration: review cases and their append-only event log.

data-model.md:
  cases        tenant_id, id, source_id, trigger_sample_id, status, owner_id,
               due_at, version, policy_version, requires_rereview
               Unique tenant/trigger_sample_id; index tenant/status/due_at/id
               and tenant/owner/status.
  case_events  tenant_id, id, case_id, event_type, payload_version, actor_id,
               occurred_at, received_at, from_version, to_version
               Append-only; unique command ID; ordered server version.

`cases.status` has exactly one writer: the case command handler (cases.py).
"""

from __future__ import annotations

from typing import Any, Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz"},
    "sqlite": {"uuid": "text", "timestamp": "text"},
}

STATES = ("review_needed", "awaiting_lab", "action_required", "retest_due", "closure_review", "closed")

_TABLES = """
CREATE TABLE IF NOT EXISTS cases (
    tenant_id          {uuid}      NOT NULL,
    id                 {uuid}      NOT NULL,
    source_id          {uuid}      NOT NULL,
    trigger_sample_id  {uuid}      NOT NULL,
    trigger_flag       text        NOT NULL CHECK (trigger_flag IN ('review', 'uncertain', 'invalid')),
    status             text        NOT NULL CHECK (status IN ({states})),
    owner_id           {uuid},
    due_at             {timestamp},
    version            integer     NOT NULL CHECK (version >= 1),
    policy_version     integer,
    requires_rereview  boolean     NOT NULL DEFAULT false,
    disposition        text,
    retest_sample_id   {uuid},
    communication_id   {uuid},
    created_at         {timestamp} NOT NULL,
    updated_at         {timestamp} NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, trigger_sample_id),
    FOREIGN KEY (tenant_id, trigger_sample_id) REFERENCES samples (tenant_id, id),
    FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, id),
    FOREIGN KEY (tenant_id, retest_sample_id) REFERENCES samples (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS case_events (
    tenant_id     {uuid}      NOT NULL,
    id            {uuid}      NOT NULL,
    case_id       {uuid}      NOT NULL,
    command_id    {uuid},
    event_type    text        NOT NULL,
    payload_json  text        NOT NULL,
    payload_hash  text,
    result_json   text,
    actor_id      {uuid},
    occurred_at   {timestamp} NOT NULL,
    from_version  integer,
    to_version    integer     NOT NULL,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, command_id),
    FOREIGN KEY (tenant_id, case_id) REFERENCES cases (tenant_id, id)
)
"""

_INDEXES = (
    "CREATE INDEX IF NOT EXISTS cases_tenant_status_due_idx ON cases (tenant_id, status, due_at, id)",
    "CREATE INDEX IF NOT EXISTS cases_tenant_owner_status_idx ON cases (tenant_id, owner_id, status)",
    "CREATE INDEX IF NOT EXISTS case_events_tenant_case_idx ON case_events (tenant_id, case_id, to_version)",
)


def statements(dialect: Dialect = "postgresql") -> list[str]:
    tables = _TABLES.format(states=", ".join(f"'{s}'" for s in STATES), **_TYPES[dialect])
    return [s.strip() for s in tables.split(";\n") if s.strip()] + list(_INDEXES)


def apply(connection: Any, dialect: Dialect = "postgresql") -> None:
    cursor = connection.cursor()
    for statement in statements(dialect):
        cursor.execute(statement)
    connection.commit()
