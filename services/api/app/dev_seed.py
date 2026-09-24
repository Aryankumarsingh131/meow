"""Synthetic source catalogue for the M1 dev stack (ADR-M1-001, ADR-M1-002).

Run at startup only in development + synthetic (see main.py). Every label and
locality says "synthetic" so a screenshot of the app can never be read as a
real village's water point. Inserts are idempotent, so restarts are safe and
nothing is ever overwritten.
"""

from __future__ import annotations

from typing import Any

from .dev_issuer import SYNTHETIC_OTHER_TENANT_ID, SYNTHETIC_TENANT_ID, _uid
from .sources import _adapt

#: (tenant, key, qr_code, label, locality, active)
SYNTHETIC_SOURCES = (
    (SYNTHETIC_TENANT_ID, "src.1", "JS-SYN-0001", "Synthetic handpump 1", "Riverside (synthetic)", True),
    (SYNTHETIC_TENANT_ID, "src.2", "JS-SYN-0002", "Synthetic handpump 2", "Riverside (synthetic)", True),
    (SYNTHETIC_TENANT_ID, "src.3", "JS-SYN-0003", "Synthetic well north", "Hillside (synthetic)", True),
    (SYNTHETIC_TENANT_ID, "src.4", "JS-SYN-0004", "Synthetic retired pump", "Hillside (synthetic)", False),
    # Other tenant: exists only so cross-tenant denial can be demonstrated.
    (SYNTHETIC_OTHER_TENANT_ID, "src.other.1", "JS-SYN-9001", "Other-tenant pump", "Elsewhere (synthetic)", True),
)


def source_id(key: str) -> str:
    return _uid(key)


def seed(conn: Any) -> None:
    statement = _adapt(
        "INSERT INTO sources (tenant_id, id, qr_code, label, locality, active, version)"
        " VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT DO NOTHING",
        conn,
    )
    for tenant, key, qr, label, locality, active in SYNTHETIC_SOURCES:
        conn.execute(statement, (tenant, source_id(key), qr, label, locality, active))
    conn.commit()
