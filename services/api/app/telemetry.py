"""T33: request tracing, safe logging and operational alerts.

One request id per request: taken from a well-formed `X-Request-Id` header or
generated, echoed in the response header, placed in every problem body, and on
the one JSON log line the request produces. A worker reporting "it failed" can
quote the id from the app; support finds the exact line.

What a log line holds, deliberately nothing more:
  ts, request_id, method, route TEMPLATE (/v1/cases/{case_id}, never the raw
  path), status, ms, and on a crash the exception TYPE.
Never: query strings (signed evidence URLs carry tokens there), headers
(Authorization), bodies, exception messages (they can echo values), user or
tenant ids.

    python -m services.api.app.telemetry alerts     # print actionable alerts
"""

from __future__ import annotations

import json
import logging
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import Request

log = logging.getLogger("jalsakshi.requests")
if not log.handlers:
    _handler = logging.StreamHandler(sys.stdout)
    _handler.setFormatter(logging.Formatter("%(message)s"))
    log.addHandler(_handler)
    log.setLevel(logging.INFO)
    log.propagate = False


def request_id_for(request: Request) -> str:
    existing = getattr(request.state, "request_id", None)
    if existing:
        return existing
    from .errors import request_id

    rid = request_id(request)
    request.state.request_id = rid
    return rid


def _line(**fields: Any) -> str:
    return json.dumps({"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), **fields}, separators=(",", ":"))


async def trace_requests(request: Request, call_next: Callable):
    rid = request_id_for(request)
    started = time.perf_counter()
    status, crash = 500, None
    try:
        response = await call_next(request)
        status = response.status_code
    except Exception as exc:  # noqa: BLE001 - logged by TYPE only, then answered safely
        crash = type(exc).__name__
        from .errors import ApiError, problem_response

        response = problem_response(request, ApiError(code="INTERNAL_ERROR",
                                                      detail="Unexpected error. Quote the request id to support."))
    route = request.scope.get("route")
    fields = {"request_id": rid, "method": request.method,
              "route": getattr(route, "path", "unmatched"), "status": status if crash is None else 500,
              "ms": round((time.perf_counter() - started) * 1000, 1)}
    if crash:
        fields["error"] = crash
    log.info(_line(**fields))
    response.headers["X-Request-Id"] = rid
    return response


# --- operational alerts ------------------------------------------------------

#: name -> (SQL returning one count, threshold, what the on-call person does)
ALERTS: dict[str, tuple[str, int, str]] = {
    "overdue_open_cases": (
        "SELECT COUNT(*) FROM cases WHERE status != 'closed' AND due_at IS NOT NULL AND due_at < ?", 1,
        "Open the board filtered to overdue; reassign or extend each with a reason (docs/alert-runbook.md)."),
    "unassigned_cases_older_than_1_day": (
        "SELECT COUNT(*) FROM cases WHERE status != 'closed' AND owner_id IS NULL AND created_at < ?", 1,
        "Assign an owner and due date; a flagged sample is waiting for a human."),
    "unverified_lab_reports_older_than_2_days": (
        "SELECT COUNT(*) FROM lab_reports WHERE verification_state = 'unverified' AND uploaded_at < ?", 1,
        "Ask a lab reviewer to verify or reject; closure is blocked until they do."),
}


def alerts(connection: Any, now: datetime | None = None) -> list[dict[str, Any]]:
    """Every alert whose count reaches its threshold. Counts only: no ids, no
    tenant names, nothing a log reader should not see."""
    from datetime import timedelta

    from .samples import sql

    now = now or datetime.now(timezone.utc)
    cutoffs = {
        "overdue_open_cases": now,
        "unassigned_cases_older_than_1_day": now - timedelta(days=1),
        "unverified_lab_reports_older_than_2_days": now - timedelta(days=2),
    }
    fired = []
    cursor = connection.cursor()
    for name, (query, threshold, action) in ALERTS.items():
        cursor.execute(sql(query, connection), (cutoffs[name].isoformat().replace("+00:00", "Z"),))
        count = int(cursor.fetchone()[0])
        if count >= threshold:
            fired.append({"alert": name, "count": count, "action": action})
    return fired


if __name__ == "__main__" and sys.argv[1:] == ["alerts"]:
    from pathlib import Path

    from .config import load_settings
    from .db import connector

    s = load_settings()
    conn = connector(s.database_url, Path(".data") / "dev.sqlite3")()
    try:
        for a in alerts(conn):
            print(_line(level="alert", **a))
    finally:
        conn.close()
