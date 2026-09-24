"""T47: evidence retention, interrupted-purge recovery, and re-applying
deletions after a restore.

Policy (assumptions A10, PROVISIONAL until an operator/privacy reviewer
approves it): photos and report files are kept 30 days. Metadata (samples,
cases) is kept 12 months, but redacting it is NOT implemented here: which
"minimal authorized audit facts" survive (data-model.md) is the operator's
call, not ours.

Rules this module enforces:
- Evidence for a case that is not closed (or a sample whose case is not
  closed) is never purged. It is reported as HELD, never silently skipped.
- A purge is two-phase: ledger row first, then the bytes, then completion. A
  purge killed midway is finished by the next run.
- The asset row stays, with state `deleted`, so "evidence deleted" remains a
  truthful status instead of the evidence silently vanishing.
- Every completed deletion is appended to a ledger file outside the database;
  `reapply_deletions` replays it after a restore.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .samples import sql

PHOTO_RETENTION = timedelta(days=30)
REASON = "retention:photos_30_days (A10, provisional)"
PURGEABLE_STATES = ("available", "rejected", "quarantined")


@dataclass
class PurgeReport:
    purged: list[str] = field(default_factory=list)
    resumed: list[str] = field(default_factory=list)
    held: list[str] = field(default_factory=list)


def _iso(t: datetime) -> str:
    return t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _unresolved(connection: Any, tenant_id: str, context: str, target_id: str) -> bool:
    """True while the evidence could still decide an open case."""
    cursor = connection.cursor()
    if context == "lab_report":
        cursor.execute(sql("SELECT status FROM cases WHERE tenant_id = ? AND id = ?", connection), (tenant_id, target_id))
    else:
        cursor.execute(sql("SELECT status FROM cases WHERE tenant_id = ? AND trigger_sample_id = ?", connection),
                       (tenant_id, target_id))
    rows = cursor.fetchall()
    return any(r[0] != "closed" for r in rows)


def _complete(connection: Any, store: Path, ledger_file: Path, tenant_id: str, asset_id: str,
              storage_key: str, sha256: str, now: datetime) -> None:
    (store / storage_key).unlink(missing_ok=True)
    cursor = connection.cursor()
    cursor.execute(sql("UPDATE evidence_assets SET state = 'deleted', state_reason = ? WHERE tenant_id = ? AND id = ?",
                       connection), (REASON, tenant_id, asset_id))
    cursor.execute(sql("UPDATE deletion_ledger SET completed_at = ? WHERE tenant_id = ? AND asset_id = ?", connection),
                   (_iso(now), tenant_id, asset_id))
    connection.commit()
    ledger_file.parent.mkdir(parents=True, exist_ok=True)
    with ledger_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"tenant_id": tenant_id, "asset_id": asset_id, "storage_key": storage_key,
                            "sha256": sha256, "reason": REASON, "completed_at": _iso(now)}) + "\n")


def purge(connection: Any, store: Path, ledger_file: Path, *, now: datetime) -> PurgeReport:
    report = PurgeReport()
    cursor = connection.cursor()

    # 1. Finish any purge a previous run started and did not complete.
    cursor.execute(sql("SELECT tenant_id, asset_id, storage_key, sha256 FROM deletion_ledger WHERE completed_at IS NULL",
                       connection))
    for tenant_id, asset_id, key, sha in cursor.fetchall():
        _complete(connection, store, ledger_file, str(tenant_id), str(asset_id), key, sha, now)
        report.resumed.append(str(asset_id))

    # 2. Everything past its retention period.
    cursor.execute(sql(
        f"SELECT tenant_id, id, context, target_id, storage_key, sha256 FROM evidence_assets "
        f"WHERE state IN ({', '.join('?' * len(PURGEABLE_STATES))}) AND created_at < ?", connection),
        (*PURGEABLE_STATES, _iso(now - PHOTO_RETENTION)))
    for tenant_id, asset_id, context, target_id, key, sha in cursor.fetchall():
        tenant_id, asset_id = str(tenant_id), str(asset_id)
        if _unresolved(connection, tenant_id, context, str(target_id)):
            report.held.append(asset_id)
            continue
        cursor.execute(sql("INSERT INTO deletion_ledger (tenant_id, asset_id, storage_key, sha256, reason, requested_at) "
                           "VALUES (?, ?, ?, ?, ?, ?)", connection), (tenant_id, asset_id, key, sha, REASON, _iso(now)))
        connection.commit()  # the intent is durable before any byte is removed
        _complete(connection, store, ledger_file, tenant_id, asset_id, key, sha, now)
        report.purged.append(asset_id)
    return report


def reapply_deletions(connection: Any, store: Path, ledger_file: Path) -> list[str]:
    """After restoring an older backup: delete again everything the external
    ledger says was deleted. Idempotent; returns the assets re-deleted."""
    if not ledger_file.exists():
        return []
    redone = []
    cursor = connection.cursor()
    for line in ledger_file.read_text(encoding="utf-8").splitlines():
        entry = json.loads(line)
        cursor.execute(sql("SELECT state FROM evidence_assets WHERE tenant_id = ? AND id = ?", connection),
                       (entry["tenant_id"], entry["asset_id"]))
        row = cursor.fetchone()
        file_back = (store / entry["storage_key"]).exists()
        if (row and row[0] != "deleted") or file_back:
            (store / entry["storage_key"]).unlink(missing_ok=True)
            cursor.execute(sql("UPDATE evidence_assets SET state = 'deleted', state_reason = ? WHERE tenant_id = ? AND id = ?",
                               connection), (entry["reason"], entry["tenant_id"], entry["asset_id"]))
            redone.append(entry["asset_id"])
    connection.commit()
    return redone
