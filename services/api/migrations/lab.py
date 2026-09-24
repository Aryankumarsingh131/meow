"""T19 migration: laboratory reports.

data-model.md: `lab_reports(tenant_id, id, case_id, sample_id, lab_name,
external_ref, collected_at, method, parameter, result, unit, report_asset_id,
verification_state, uploaded_by, verified_by/at, supersedes_id)`.
"Verification distinct from upload; verified_by != uploaded_by; corrections
append superseding reports."

Append-only apart from the single unverified -> verified|rejected decision.
A report is superseded when another report names it in `supersedes_id`; the
old row is never edited to say so.

`lab_interpretation` is what the LAB states about its own result
(exceeds_limit / within_limit / not_stated). The protocol schema defines no
lab action rule, and this system must not invent thresholds, so the case
engine reads this transcribed statement instead (flagged for T46).
"""

from __future__ import annotations

from typing import Any, Literal

Dialect = Literal["postgresql", "sqlite"]

_TYPES: dict[Dialect, dict[str, str]] = {
    "postgresql": {"uuid": "uuid", "timestamp": "timestamptz"},
    "sqlite": {"uuid": "text", "timestamp": "text"},
}

_TABLE = """
CREATE TABLE IF NOT EXISTS lab_reports (
    tenant_id           {uuid}      NOT NULL,
    id                  {uuid}      NOT NULL,
    case_id             {uuid}      NOT NULL,
    source_id           {uuid}      NOT NULL,
    sample_id           {uuid},
    lab_name            text        NOT NULL CHECK (length(lab_name) BETWEEN 1 AND 160),
    external_ref        text        CHECK (external_ref IS NULL OR length(external_ref) <= 160),
    collected_at        {timestamp} NOT NULL,
    method              text        NOT NULL CHECK (length(method) BETWEEN 1 AND 160),
    parameter           text        NOT NULL CHECK (length(parameter) BETWEEN 1 AND 160),
    result              text        NOT NULL CHECK (length(result) BETWEEN 1 AND 160),
    unit                text        CHECK (unit IS NULL OR length(unit) <= 64),
    lab_interpretation  text        NOT NULL CHECK (lab_interpretation IN ('exceeds_limit', 'within_limit', 'not_stated')),
    report_asset_id     {uuid},
    mismatches          text        NOT NULL,
    payload_hash        text        NOT NULL CHECK (length(payload_hash) = 64),
    verification_state  text        NOT NULL CHECK (verification_state IN ('unverified', 'verified', 'rejected')),
    decision_reason     text,
    uploaded_by         {uuid}      NOT NULL,
    uploaded_at         {timestamp} NOT NULL,
    verified_by         {uuid},
    verified_at         {timestamp},
    supersedes_id       {uuid},
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, supersedes_id),
    CHECK (verified_by IS NULL OR verified_by <> uploaded_by),
    FOREIGN KEY (tenant_id, case_id) REFERENCES cases (tenant_id, id),
    FOREIGN KEY (tenant_id, supersedes_id) REFERENCES lab_reports (tenant_id, id)
)
"""

_INDEXES = ("CREATE INDEX IF NOT EXISTS lab_reports_tenant_case_idx ON lab_reports (tenant_id, case_id)",)


def statements(dialect: Dialect = "postgresql") -> list[str]:
    return [_TABLE.format(**_TYPES[dialect]).strip(), *_INDEXES]


def apply(connection: Any, dialect: Dialect = "postgresql") -> None:
    cursor = connection.cursor()
    for statement in statements(dialect):
        cursor.execute(statement)
    connection.commit()
