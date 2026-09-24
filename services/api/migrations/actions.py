"""T20 corrective actions; completion remains unset until evidence is accepted."""

from typing import Literal


def statements(dialect: Literal["postgresql", "sqlite"] = "postgresql") -> list[str]:
    uuid = "uuid" if dialect == "postgresql" else "text"
    timestamp = "timestamptz" if dialect == "postgresql" else "text"
    return [f"""
CREATE TABLE IF NOT EXISTS actions (
    tenant_id {uuid} NOT NULL,
    id {uuid} NOT NULL,
    case_id {uuid} NOT NULL,
    description text NOT NULL,
    owner_id {uuid} NOT NULL,
    due_at {timestamp} NOT NULL,
    completed_at {timestamp},
    evidence_ids text NOT NULL DEFAULT '[]',
    accepted_by {uuid},
    accepted_at {timestamp},
    created_at {timestamp} NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, case_id) REFERENCES cases (tenant_id, id)
)""".strip(), f"""
CREATE TABLE IF NOT EXISTS action_evidence (
    tenant_id {uuid} NOT NULL,
    id {uuid} NOT NULL,
    action_id {uuid} NOT NULL,
    kind text NOT NULL CHECK (kind = 'operator_note'),
    note text NOT NULL,
    recorded_by {uuid} NOT NULL,
    recorded_at {timestamp} NOT NULL,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, action_id) REFERENCES actions (tenant_id, id)
)""".strip(),
        "CREATE INDEX IF NOT EXISTS actions_tenant_case_idx ON actions (tenant_id, case_id)"]
