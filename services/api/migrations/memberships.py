"""Tenant memberships: which signed-in user belongs to which tenant, in which role.

`user_id` is the identity provider's subject (Supabase Auth user id). T06
resolves tenant and role from this table on every request, never from a token
claim. Rows are added by an operator (docs/deploy-render.md); there is no API
that writes them.
"""

from __future__ import annotations

from typing import Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz", "now": "now()"},
    "sqlite": {"uuid": "text", "timestamp": "text", "now": "CURRENT_TIMESTAMP"},
}

_TABLE = """
CREATE TABLE IF NOT EXISTS memberships (
    tenant_id   {uuid}      NOT NULL,
    user_id     {uuid}      NOT NULL,
    role        text        NOT NULL CHECK (role IN ('worker', 'supervisor', 'lab_reviewer', 'admin')),
    active      boolean     NOT NULL DEFAULT true,
    created_at  {timestamp} NOT NULL DEFAULT {now},
    PRIMARY KEY (tenant_id, user_id)
)
"""

_INDEXES = ("CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id)",)


def statements(dialect: Dialect = "postgresql") -> list[str]:
    return [_TABLE.format(**_TYPES[dialect]).strip(), *_INDEXES]
