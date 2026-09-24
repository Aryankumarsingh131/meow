"""T43: metrics and safe export slice.

Both endpoints (`metrics`, `export`) are tenant-scoped and role-gated like
T18's board (`CASE_READ_ROLES`), and both EXCLUDE synthetic data
(`samples.data_mode = 'synthetic'`) from every count and every exported row:
a synthetic demo case must never inflate a real operational metric.

CSV export is safe by construction: every cell that begins with `=`, `+`, `-`
or `@` (an Excel/Sheets formula trigger - CSV injection) is prefixed with a
leading `'` before being written, so a spreadsheet renders it as text rather
than evaluating it. Export runs as a cancelable job (jobs.py): a cancelled
export publishes no file at all.
"""

from __future__ import annotations

import threading
from typing import Any, Literal

from pydantic import BaseModel

from . import jobs
from .auth import Session
from .cases import Refused
from .samples import sql

REPORT_ROLES = frozenset({"supervisor", "lab_reviewer", "admin"})  # authorization-matrix.md
STATUSES = ("review_needed", "awaiting_lab", "action_required", "retest_due", "closure_review", "closed")

# A formula-injection payload always starts with one of these; a leading
# apostrophe is the standard mitigation (OWASP CSV injection).
_FORMULA_PREFIXES = ("=", "+", "-", "@")


class ReportFilters(BaseModel):
    status: str | None = None
    source_id: str | None = None
    created_from: str | None = None  # ISO, inclusive
    created_to: str | None = None  # ISO, inclusive


class MetricsSummary(BaseModel):
    total: int
    by_status: dict[str, int]
    overdue: int
    as_of: str


class ExportStarted(BaseModel):
    job_id: str


class ExportStatus(BaseModel):
    status: Literal["running", "done", "cancelled", "failed"]
    row_count: int
    error: str | None


def neutralize(value: str) -> str:
    return f"'{value}" if value and value[0] in _FORMULA_PREFIXES else value


def _where(tenant_id: str, filters: ReportFilters) -> tuple[str, list[Any]]:
    clauses = ["c.tenant_id = ?", "s.data_mode != 'synthetic'"]
    params: list[Any] = [tenant_id]
    if filters.status is not None:
        clauses.append("c.status = ?")
        params.append(filters.status)
    if filters.source_id is not None:
        clauses.append("c.source_id = ?")
        params.append(filters.source_id)
    if filters.created_from is not None:
        clauses.append("c.created_at >= ?")
        params.append(filters.created_from)
    if filters.created_to is not None:
        clauses.append("c.created_at <= ?")
        params.append(filters.created_to)
    return " AND ".join(clauses), params


def metrics(connection: Any, session: Session, filters: ReportFilters, *, now: str) -> MetricsSummary | Refused:
    if session.role not in REPORT_ROLES:
        return Refused("FORBIDDEN", "This role cannot view reports.")
    where, params = _where(session.tenant_id, filters)
    cursor = connection.cursor()
    cursor.execute(
        sql(f"SELECT c.status, COUNT(*) FROM cases c JOIN samples s ON s.tenant_id = c.tenant_id "
            f"AND s.id = c.trigger_sample_id WHERE {where} GROUP BY c.status", connection),
        params,
    )
    by_status = {status: 0 for status in STATUSES}
    for status, count in cursor.fetchall():
        by_status[status] = int(count)
    cursor.execute(
        sql(f"SELECT COUNT(*) FROM cases c JOIN samples s ON s.tenant_id = c.tenant_id "
            f"AND s.id = c.trigger_sample_id WHERE {where} AND c.due_at IS NOT NULL AND c.due_at < ? "
            "AND c.status != 'closed'", connection),
        [*params, now],
    )
    overdue = int(cursor.fetchone()[0])
    return MetricsSummary(total=sum(by_status.values()), by_status=by_status, overdue=overdue, as_of=now)


_EXPORT_HEADER = ["case_id", "status", "source_id", "trigger_flag", "owner_id", "due_at", "disposition", "created_at"]


def _export_rows(connection: Any, tenant_id: str, filters: ReportFilters):
    where, params = _where(tenant_id, filters)
    cursor = connection.cursor()
    cursor.execute(
        sql(f"SELECT c.id, c.status, c.source_id, c.trigger_flag, c.owner_id, c.due_at, c.disposition, c.created_at "
            f"FROM cases c JOIN samples s ON s.tenant_id = c.tenant_id AND s.id = c.trigger_sample_id "
            f"WHERE {where} ORDER BY c.created_at, c.id", connection),
        params,
    )
    for row in cursor.fetchall():
        yield [neutralize(str(cell)) if cell is not None else "" for cell in row]


def start_export(connection: Any, session: Session, filters: ReportFilters, *, background: bool = True) -> ExportStarted | Refused:
    if session.role not in REPORT_ROLES:
        return Refused("FORBIDDEN", "This role cannot export reports.")
    job = jobs.create(session.tenant_id)
    # Rows are fetched eagerly (one query, on the caller's connection) before
    # any thread starts: sqlite3/psycopg connections are not thread-safe to
    # share, but a plain list of already-fetched rows is.
    rows = list(_export_rows(connection, session.tenant_id, filters))
    if background:
        threading.Thread(target=jobs.run, args=(job, _EXPORT_HEADER, rows), daemon=True).start()
    else:
        jobs.run(job, _EXPORT_HEADER, rows)  # tests: deterministic, same thread
    return ExportStarted(job_id=job.id)


def export_status(session: Session, job_id: str) -> ExportStatus | Refused:
    job = jobs.get(session.tenant_id, job_id)
    if job is None:
        return Refused("NOT_FOUND", "Export job was not found.")
    return ExportStatus(status=job.status, row_count=job.row_count, error=job.error)


def export_result(session: Session, job_id: str) -> bytes | Refused:
    job = jobs.get(session.tenant_id, job_id)
    if job is None or job.status != "done" or job.result is None:
        return Refused("NOT_FOUND", "No completed export with this id.")
    return job.result


def cancel_export(session: Session, job_id: str) -> bool:
    return jobs.cancel(session.tenant_id, job_id)
