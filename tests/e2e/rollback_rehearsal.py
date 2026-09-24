"""T37: roll the API back to an older release and forward again, on the SAME
database, while a phone's queued events are replayed.

    python tests/e2e/rollback_rehearsal.py [old-commit]   (default 67dbf71, T34)

Uses the local synthetic dev stack (test issuer, SQLite) in a temp directory,
and a git worktree for the old release. Nothing hosted is touched.

1. NEW release: worker pushes event A.
2. ROLL BACK to the old release, whose code predates tables the new release
   created (deletion_ledger): it must start, see A, treat A's replay as a
   duplicate, and accept queued event B.
3. ROLL FORWARD: B's replay is a duplicate; A and B are both in the
   changefeed, in commit order, with no gap.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD = sys.argv[1] if len(sys.argv) > 1 else "67dbf71"
SOURCE = "97c23cd1-ab42-5db5-b75b-0fe07dfd1923"
PROTOCOL = {"id": "f96bdca3-5020-5313-b65a-072967c46292", "version": 1}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def call(base: str, method: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


class Api:
    def __init__(self, code_root: Path, data_dir: Path) -> None:
        env = {k: v for k, v in os.environ.items() if not k.startswith("JALSAKSHI_")}
        env.update(PYTHONPATH=str(code_root), JALSAKSHI_ENVIRONMENT="development", JALSAKSHI_TENANT_DATA_MODE="synthetic")
        port = free_port()
        self.base = f"http://127.0.0.1:{port}"
        self.proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "services.api.app.main:app", "--port", str(port)],
                                     cwd=data_dir, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                if call(self.base, "GET", "/health/live")[0] == 200:
                    return
            except OSError:
                pass
            time.sleep(0.2)
        raise SystemExit(f"API from {code_root} did not start")

    def token(self) -> str:
        status, body = call(self.base, "POST", "/dev/v1/token", {"username": "worker", "password": "jalsakshi"})
        assert status == 200, status
        return body["access_token"]

    def push(self, event: dict) -> str:
        status, body = call(self.base, "POST", "/v1/sync/push", {"device_id": DEVICE, "events": [event]}, self.token())
        assert status == 200, (status, body)
        return body["results"][0]["status"]

    def stop(self) -> None:
        self.proc.terminate()
        self.proc.wait(10)


DEVICE = str(uuid.uuid4())


def event() -> dict:
    return {"event_id": str(uuid.uuid4()), "kind": "sample.create", "schema_version": 1, "payload": {
        "schema_version": 1, "sample_id": str(uuid.uuid4()), "source_id": SOURCE, "protocol": PROTOCOL,
        "kit_lot_id": str(uuid.uuid4()), "captured_at_device": "2026-09-25T06:00:00Z",
        "timing": {"state": "in_window", "elapsed_ms": 31000, "valid": True}, "method": "manual",
        "observation": {"machine_bin": None, "manual_bin": "bin_1", "selected_bin": "bin_1", "indicative_flag": "no_flag",
                        "quality_reasons": ["QUALITY_NOT_ASSESSED"], "model_version": None, "calibration_version": None,
                        "confidence": None, "override_reason": "Read the chart by hand"},
        "evidence_ids": [], "client_build": "t37-rehearsal", "data_mode": "synthetic"}}


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="t37-"))
    old_root, data = tmp / "old", tmp / "data"
    data.mkdir()
    subprocess.run(["git", "worktree", "add", "--detach", str(old_root), OLD], cwd=ROOT, check=True, capture_output=True)
    results: list[tuple[str, bool]] = []
    check = lambda name, ok: results.append((name, bool(ok)))  # noqa: E731
    a, b = event(), event()
    try:
        new = Api(ROOT, data)
        check("new release: event A accepted", new.push(a) == "accepted")
        new.stop()

        old = Api(old_root, data)
        check(f"rollback to {OLD}: starts on the newer database", True)
        check("rollback: A's replay is a duplicate", old.push(a) == "duplicate")
        check("rollback: queued event B accepted", old.push(b) == "accepted")
        check("rollback: the new kill-switch route is absent (the phone keeps its last list)",
              call(old.base, "GET", "/models/disabled")[0] == 404)
        old.stop()

        new = Api(ROOT, data)
        check("roll forward: B's replay is a duplicate", new.push(b) == "duplicate")
        new.stop()

        db = sqlite3.connect(data / ".data" / "dev.sqlite3")
        ids = {a["payload"]["sample_id"], b["payload"]["sample_id"]}
        feed = [r for r in db.execute("SELECT seq, entity_id FROM changefeed ORDER BY seq") if r[1] in ids]
        check("A and B each appear once in the changefeed, A before B",
              [r[1] for r in feed] == [a["payload"]["sample_id"], b["payload"]["sample_id"]])
        seqs = [r[0] for r in db.execute("SELECT seq FROM changefeed ORDER BY seq")]
        check("changefeed has no gap across the rollback", seqs == list(range(1, len(seqs) + 1)))
        db.close()
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(old_root)], cwd=ROOT, capture_output=True)
        shutil.rmtree(tmp, ignore_errors=True)

    for name, ok in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
    failed = sum(not ok for _, ok in results)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
