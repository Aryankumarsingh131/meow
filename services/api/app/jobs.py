"""T43: minimal cancelable job registry for CSV export.

ponytail: single-process, in-memory dict, no persistence, no worker pool.
Exports here are tenant-scoped and denominator-bounded (a few thousand rows at
most for a synthetic pilot); move to a real queue (Celery/RQ) if export size
or concurrency ever demands it.

"No partial file publication": `result` is only ever set once, at the moment
a run finishes every row without being cancelled. A cancelled or failed run
leaves `result` as None forever - there is no code path that assigns a
partial buffer to it.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Iterable, Literal
from uuid import uuid4

JobStatus = Literal["running", "done", "cancelled", "failed"]


@dataclass
class Job:
    id: str
    tenant_id: str
    status: JobStatus = "running"
    result: bytes | None = None
    error: str | None = None
    row_count: int = 0
    cancel_event: threading.Event = field(default_factory=threading.Event)


_JOBS: dict[str, Job] = {}
_LOCK = threading.Lock()


def create(tenant_id: str) -> Job:
    job = Job(id=str(uuid4()), tenant_id=tenant_id)
    with _LOCK:
        _JOBS[job.id] = job
    return job


def get(tenant_id: str, job_id: str) -> Job | None:
    job = _JOBS.get(job_id)
    return job if job is not None and job.tenant_id == tenant_id else None


def cancel(tenant_id: str, job_id: str) -> bool:
    job = get(tenant_id, job_id)
    if job is None or job.status != "running":
        return False
    job.cancel_event.set()
    return True


def run(job: Job, header: list[str], rows: Iterable[list[str]]) -> None:
    """Synchronous by design: an HTTP caller runs this in a background thread
    (`threading.Thread(target=run, args=(job, header, rows), daemon=True)`);
    a test can call it directly on the calling thread for determinism."""
    import csv
    import io

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    try:
        count = 0
        for row in rows:
            if job.cancel_event.is_set():
                job.status = "cancelled"
                return
            writer.writerow(row)
            count += 1
        job.row_count = count
        job.result = buffer.getvalue().encode("utf-8")
        job.status = "done"
    except Exception as error:  # pragma: no cover - defensive; never publishes a partial file
        job.status = "failed"
        job.error = str(error)
