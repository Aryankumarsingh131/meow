"""Development-only synthetic workflow.

This proves offline/sync state transitions; it is not a scientific API.
"""

import hashlib
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response
from pydantic import BaseModel, Field, field_validator

from .errors import ApiError

router = APIRouter(prefix="/demo/v1", tags=["synthetic-demo"])
MAX_PHOTO_BYTES = 5 * 1024 * 1024


class RecordCreate(BaseModel):
    id: UUID
    fixture_id: Literal["SYN-A", "SYN-B", "SYN-C", "SYN-D"]
    captured_at: datetime
    client_build: str = Field(min_length=1, max_length=64)
    image_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("captured_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("captured_at must include a timezone")
        return value


class DecisionCreate(BaseModel):
    expected_version: int = Field(ge=1)
    decision: Literal["ACCEPTED", "REFERRED"]
    reason: str = Field(min_length=1, max_length=500)


def _connect(request: Request) -> sqlite3.Connection:
    data_dir = Path(request.app.state.demo_data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(data_dir / "demo.sqlite3", timeout=5)
    connection.row_factory = sqlite3.Row
    connection.executescript(
        """
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS records (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            payload_hash TEXT NOT NULL,
            fixture_id TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            client_build TEXT NOT NULL,
            image_sha256 TEXT NOT NULL,
            metadata_state TEXT NOT NULL DEFAULT 'SYNCED',
            photo_state TEXT NOT NULL DEFAULT 'MISSING',
            photo_path TEXT,
            photo_bytes INTEGER,
            decision TEXT,
            decision_reason TEXT,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS commands (
            command_id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            response_json TEXT NOT NULL
        );
        """
    )
    return connection


def _record(row: sqlite3.Row) -> dict[str, object]:
    return {
        "seq": row["seq"],
        "id": row["id"],
        "data_mode": "synthetic",
        "fixture_id": row["fixture_id"],
        "captured_at": row["captured_at"],
        "client_build": row["client_build"],
        "image_sha256": row["image_sha256"],
        "metadata_state": row["metadata_state"],
        "photo_state": row["photo_state"],
        "photo_bytes": row["photo_bytes"],
        "decision": row["decision"],
        "decision_reason": row["decision_reason"],
        "version": row["version"],
    }


def _fetch(connection: sqlite3.Connection, record_id: str) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    if row is None:
        raise ApiError("NOT_FOUND", "Synthetic record not found.")
    return row


def _digest(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


@router.post("/records", status_code=201)
def create_record(
    body: RecordCreate,
    request: Request,
    response: Response,
    idempotency_key: Annotated[str, Header(min_length=1, max_length=128)],
) -> dict[str, object]:
    record_id = str(body.id)
    if idempotency_key != record_id:
        raise ApiError("VALIDATION_FAILED", "Idempotency-Key must equal the record UUID.")
    payload = body.model_dump(mode="json")
    payload_hash = _digest(payload)
    with _connect(request) as connection:
        existing = connection.execute(
            "SELECT * FROM records WHERE id = ?", (record_id,)
        ).fetchone()
        if existing is not None:
            if existing["payload_hash"] != payload_hash:
                raise ApiError(
                    "IDEMPOTENCY_MISMATCH",
                    "Record UUID was already used with different metadata.",
                )
            response.status_code = 200
            return _record(existing)
        connection.execute(
            """
            INSERT OR IGNORE INTO records
                (id, payload_hash, fixture_id, captured_at, client_build, image_sha256)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                payload_hash,
                body.fixture_id,
                body.captured_at.isoformat(),
                body.client_build,
                body.image_sha256,
            ),
        )
        created = _fetch(connection, record_id)
        if created["payload_hash"] != payload_hash:
            raise ApiError(
                "IDEMPOTENCY_MISMATCH",
                "Record UUID was already used with different metadata.",
            )
        return _record(created)


@router.put("/records/{record_id}/photo")
async def upload_photo(
    record_id: UUID,
    request: Request,
    content_sha256: Annotated[
        str, Header(alias="X-Content-SHA256", pattern=r"^[0-9a-f]{64}$")
    ],
) -> dict[str, object]:
    content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
    if content_type not in {"image/jpeg", "image/png"}:
        raise ApiError("VALIDATION_FAILED", "Photo must be JPEG or PNG.")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_PHOTO_BYTES:
            raise ApiError("PAYLOAD_TOO_LARGE", "Photo exceeds the 5 MiB demo limit.")
        chunks.append(chunk)
    photo = b"".join(chunks)
    magic_ok = photo.startswith(b"\xff\xd8\xff") if content_type == "image/jpeg" else photo.startswith(b"\x89PNG\r\n\x1a\n")
    if not magic_ok:
        raise ApiError("VALIDATION_FAILED", "Photo bytes do not match the declared image type.")
    digest = hashlib.sha256(photo).hexdigest()
    if digest != content_sha256:
        raise ApiError("VALIDATION_FAILED", "Photo digest does not match X-Content-SHA256.")

    with _connect(request) as connection:
        row = _fetch(connection, str(record_id))
        if digest != row["image_sha256"]:
            raise ApiError("VALIDATION_FAILED", "Photo digest does not match record metadata.")
        photo_dir = Path(request.app.state.demo_data_dir) / "photos"
        photo_dir.mkdir(parents=True, exist_ok=True)
        suffix = ".jpg" if content_type == "image/jpeg" else ".png"
        destination = photo_dir / f"{record_id}{suffix}"
        temporary = photo_dir / f"{record_id}.part"
        temporary.write_bytes(photo)
        os.replace(temporary, destination)
        connection.execute(
            """UPDATE records
               SET photo_state = 'AVAILABLE', photo_path = ?, photo_bytes = ?
               WHERE id = ?""",
            (str(destination), total, str(record_id)),
        )
        return _record(_fetch(connection, str(record_id)))


@router.get("/records")
def list_records(
    request: Request, after: int = 0, limit: int = 50
) -> dict[str, object]:
    if after < 0 or not 1 <= limit <= 100:
        raise ApiError("VALIDATION_FAILED", "after must be non-negative and limit must be 1-100.")
    with _connect(request) as connection:
        rows = connection.execute(
            "SELECT * FROM records WHERE seq > ? ORDER BY seq LIMIT ?", (after, limit)
        ).fetchall()
    items = [_record(row) for row in rows]
    return {"items": items, "next_cursor": items[-1]["seq"] if items else after}


@router.post("/records/{record_id}/decisions")
def decide_record(
    record_id: UUID,
    body: DecisionCreate,
    request: Request,
    idempotency_key: Annotated[UUID, Header()],
    demo_role: Annotated[str | None, Header(alias="X-Demo-Role")] = None,
) -> dict[str, object]:
    if demo_role != "supervisor":
        raise ApiError("FORBIDDEN", "Synthetic supervisor role required.")
    command_id = str(idempotency_key)
    payload_hash = _digest(body.model_dump(mode="json"))
    with _connect(request) as connection:
        prior = connection.execute(
            "SELECT * FROM commands WHERE command_id = ?", (command_id,)
        ).fetchone()
        if prior is not None:
            if prior["record_id"] != str(record_id) or prior["payload_hash"] != payload_hash:
                raise ApiError("IDEMPOTENCY_MISMATCH", "Command UUID was reused.")
            return json.loads(prior["response_json"])
        row = _fetch(connection, str(record_id))
        if row["photo_state"] != "AVAILABLE":
            raise ApiError("CLOSURE_EVIDENCE_INCOMPLETE", "Synthetic photo is not available.")
        if row["version"] != body.expected_version:
            raise ApiError(
                "CASE_VERSION_CONFLICT",
                "Synthetic record was modified by another reviewer.",
                extra={"current_version": row["version"]},
            )
        updated = connection.execute(
            """UPDATE records
               SET decision = ?, decision_reason = ?, version = version + 1
               WHERE id = ? AND version = ?""",
            (body.decision, body.reason, str(record_id), body.expected_version),
        )
        if updated.rowcount != 1:
            current = _fetch(connection, str(record_id))
            raise ApiError(
                "CASE_VERSION_CONFLICT",
                "Synthetic record was modified by another reviewer.",
                extra={"current_version": current["version"]},
            )
        result = _record(_fetch(connection, str(record_id)))
        connection.execute(
            "INSERT INTO commands VALUES (?, ?, ?, ?)",
            (command_id, str(record_id), payload_hash, json.dumps(result)),
        )
        return result
