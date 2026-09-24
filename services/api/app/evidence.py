"""T16: private evidence boundary.

api-contracts.md:
    POST /v1/evidence/intents          asset_id, context, bytes, media_type, sha256
                                       -> scoped upload URL, expires_at
    POST /v1/evidence/{id}/complete    upload checksum -> verification state
    GET  /v1/evidence/{id}/access      -> short-lived read URL or denied

Rules this module enforces:
  - Upload is OFF unless the deployment enables it (AC-018: "default no-upload
    mode sends no photos").
  - Tenant comes from the session; another tenant's asset or target is
    indistinguishable from a missing one.
  - A worker may read only their own captures (authorization-matrix.md).
  - URLs are HMAC tokens scoped to one tenant/asset/method/size, expiring in
    5 minutes (provisional, api-contracts.md). No public path serves objects.
  - The stored object is re-hashed and inspected before it can be available;
    the declared metadata is never trusted on its own.
  - An asset's state never changes the sample it belongs to.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from .auth import Session
from .samples import sql
from .upload_validation import MAX_BYTES, MEDIA_TYPES, inspect

URL_TTL = timedelta(minutes=5)
PERMISSION_VERSION = 1
State = Literal["uploading", "quarantined", "available", "rejected", "deleted"]


class IntentRequest(BaseModel):
    asset_id: UUID
    context: Literal["sample_photo"]
    target_id: UUID
    bytes: int = Field(gt=0)
    media_type: str = Field(max_length=64)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class IntentResponse(BaseModel):
    asset_id: UUID
    state: State
    upload_url: str | None
    expires_at: str | None


class EvidenceState(BaseModel):
    asset_id: UUID
    state: State
    reason: str | None


class AccessResponse(BaseModel):
    asset_id: UUID
    read_url: str
    expires_at: str


@dataclass(frozen=True)
class Refused:
    """Mapped to an ApiError by the route. `code` is from errors.ERROR_CODES."""

    code: str
    detail: str


NOT_FOUND = Refused("NOT_FOUND", "Evidence was not found.")


def _iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


# --- scoped tokens -------------------------------------------------------------


def sign(key: bytes, *, tenant_id: str, asset_id: str, method: str, size: int, expires: datetime) -> str:
    claims = {"t": tenant_id, "a": asset_id, "m": method, "b": size, "e": int(expires.timestamp())}
    body = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode()).decode()
    mac = hmac.new(key, body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{mac}"


def verify(key: bytes, token: str, *, asset_id: str, method: str, now: datetime) -> dict[str, Any] | None:
    body, _, mac = token.partition(".")
    expected = hmac.new(key, body.encode(), hashlib.sha256).hexdigest()
    if not mac or not hmac.compare_digest(mac, expected):
        return None
    try:
        claims = json.loads(base64.urlsafe_b64decode(body.encode()))
    except Exception:
        return None
    if claims.get("a") != asset_id or claims.get("m") != method or claims.get("e", 0) <= now.timestamp():
        return None
    return claims


# --- persistence ---------------------------------------------------------------

_COLUMNS = "id, context, target_id, sha256, media_type, bytes, storage_key, state, state_reason, uploaded_by, expires_at"


def _row(connection: Any, tenant_id: str, asset_id: str) -> dict[str, Any] | None:
    cursor = connection.cursor()
    try:
        cursor.execute(
            sql(f"SELECT {_COLUMNS} FROM evidence_assets WHERE tenant_id = ? AND id = ?", connection),
            (tenant_id, asset_id),
        )
    except Exception:
        # PostgreSQL rejects a malformed uuid; that is "not found", not a 500.
        connection.rollback()
        return None
    found = cursor.fetchone()
    if not found:
        return None
    return dict(zip([c.strip() for c in _COLUMNS.split(",")], [str(v) if isinstance(v, UUID) else v for v in found]))


def _set_state(connection: Any, tenant_id: str, asset_id: str, state: State, reason: str | None, now: datetime) -> None:
    connection.cursor().execute(
        sql(
            "UPDATE evidence_assets SET state = ?, state_reason = ?, completed_at = ? WHERE tenant_id = ? AND id = ?",
            connection,
        ),
        (state, reason, _iso(now), tenant_id, asset_id),
    )


def _can_read(session: Session, row: dict[str, Any]) -> bool:
    # authorization-matrix.md: worker -> own captures; other roles -> tenant.
    return session.role != "worker" or row["uploaded_by"] == session.user_id


# --- operations ----------------------------------------------------------------


def create_intent(
    connection: Any, session: Session, body: IntentRequest, *, key: bytes, enabled: bool, now: datetime
) -> IntentResponse | Refused:
    if not enabled:
        return Refused("EVIDENCE_UPLOAD_DISABLED", "Evidence upload is not enabled for this deployment.")
    if body.media_type not in MEDIA_TYPES or body.media_type == "application/pdf":
        # PDFs belong to lab reports (T19); a sample photo is an image.
        return Refused("VALIDATION_FAILED", "Media type is not allowed for a sample photo.")
    if body.bytes > MAX_BYTES[body.media_type]:
        return Refused("PAYLOAD_TOO_LARGE", "Evidence is larger than allowed.")

    cursor = connection.cursor()
    cursor.execute(
        sql("SELECT created_by FROM samples WHERE tenant_id = ? AND id = ?", connection),
        (session.tenant_id, str(body.target_id)),
    )
    sample = cursor.fetchone()
    # A worker attaches photos only to their own captures; a cross-tenant or
    # missing sample is the same NOT_FOUND.
    if sample is None or (session.role == "worker" and str(sample[0]) != session.user_id):
        return Refused("NOT_FOUND", "Sample was not found.")

    asset_id = str(body.asset_id)
    existing = _row(connection, session.tenant_id, asset_id)
    if existing:
        same = (
            existing["sha256"], existing["media_type"], existing["bytes"], existing["target_id"], existing["uploaded_by"]
        ) == (body.sha256, body.media_type, body.bytes, str(body.target_id), session.user_id)
        if not same:
            return Refused("IDEMPOTENCY_MISMATCH", "This asset id was already used with different metadata.")
        if existing["state"] != "uploading":
            # The original is immutable once completed: no second upload URL.
            return IntentResponse(asset_id=body.asset_id, state=existing["state"], upload_url=None, expires_at=None)
    else:
        connection.cursor().execute(
            sql(
                "INSERT INTO evidence_assets (tenant_id,id,context,target_id,sha256,media_type,bytes,storage_key,"
                "state,uploaded_by,permission_version,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                connection,
            ),
            (
                session.tenant_id, asset_id, body.context, str(body.target_id), body.sha256, body.media_type,
                body.bytes, secrets.token_hex(16), "uploading", session.user_id, PERMISSION_VERSION,
                _iso(now), _iso(now + URL_TTL),
            ),
        )
    expires = now + URL_TTL
    connection.cursor().execute(
        sql("UPDATE evidence_assets SET expires_at = ? WHERE tenant_id = ? AND id = ?", connection),
        (_iso(expires), session.tenant_id, asset_id),
    )
    connection.commit()
    token = sign(key, tenant_id=session.tenant_id, asset_id=asset_id, method="PUT", size=body.bytes, expires=expires)
    return IntentResponse(
        asset_id=body.asset_id, state="uploading",
        upload_url=f"/v1/evidence/{asset_id}/content?token={token}", expires_at=_iso(expires),
    )


def store_content(
    connection: Any, store: Path, asset_id: str, token: str, data: bytes, *, key: bytes, now: datetime
) -> EvidenceState | Refused:
    """Receive the bytes of an upload. Exactly the declared size, or nothing is kept."""
    claims = verify(key, token, asset_id=asset_id, method="PUT", now=now)
    if claims is None:
        return Refused("FORBIDDEN", "Upload link is invalid or expired.")
    row = _row(connection, claims["t"], asset_id)
    if row is None or row["state"] != "uploading":
        return Refused("FORBIDDEN", "Upload link is invalid or expired.")
    if len(data) != row["bytes"] or len(data) != claims["b"]:
        # Covers a cancelled/short upload and an oversize one. Nothing stored.
        return Refused("VALIDATION_FAILED", "Uploaded size does not match the declared size.")
    store.mkdir(parents=True, exist_ok=True)
    partial = store / f"{row['storage_key']}.part"
    partial.write_bytes(data)
    partial.replace(store / row["storage_key"])
    return EvidenceState(asset_id=UUID(asset_id), state="uploading", reason=None)


def complete(
    connection: Any, session: Session, store: Path, asset_id: str, sha256: str, *, now: datetime
) -> EvidenceState | Refused:
    row = _row(connection, session.tenant_id, asset_id)
    if row is None or row["uploaded_by"] != session.user_id:
        return NOT_FOUND
    if row["state"] != "uploading":
        return EvidenceState(asset_id=UUID(asset_id), state=row["state"], reason=row["state_reason"])
    path = store / row["storage_key"]
    if not path.exists():
        return Refused("VALIDATION_FAILED", "No uploaded content to complete.")
    data = path.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if not (actual == sha256 == row["sha256"]):
        state: State
        state, reason = "rejected", "hash_mismatch"
    else:
        result = inspect(data, row["media_type"])
        state, reason = result.outcome, result.reason
    if state == "rejected":
        path.unlink(missing_ok=True)  # rejected bytes are not kept
    _set_state(connection, session.tenant_id, asset_id, state, reason, now)
    connection.commit()
    return EvidenceState(asset_id=UUID(asset_id), state=state, reason=reason)


def grant_access(
    connection: Any, session: Session, asset_id: str, *, key: bytes, now: datetime
) -> AccessResponse | Refused:
    row = _row(connection, session.tenant_id, asset_id)
    if row is None or not _can_read(session, row):
        return NOT_FOUND
    if row["state"] != "available":
        return Refused("EVIDENCE_NOT_AVAILABLE", f"Evidence is {row['state']}; it cannot be read.")
    expires = now + URL_TTL
    token = sign(key, tenant_id=session.tenant_id, asset_id=asset_id, method="GET", size=row["bytes"], expires=expires)
    return AccessResponse(
        asset_id=UUID(asset_id), read_url=f"/v1/evidence/{asset_id}/content?token={token}", expires_at=_iso(expires)
    )


def read_content(
    connection: Any, store: Path, asset_id: str, token: str, *, key: bytes, now: datetime
) -> tuple[bytes, str] | Refused:
    claims = verify(key, token, asset_id=asset_id, method="GET", now=now)
    if claims is None:
        return Refused("FORBIDDEN", "Read link is invalid or expired.")
    row = _row(connection, claims["t"], asset_id)
    # Re-checked at read time: an asset rejected or deleted after the link was
    # issued is no longer served.
    if row is None or row["state"] != "available":
        return Refused("FORBIDDEN", "Read link is invalid or expired.")
    return (store / row["storage_key"]).read_bytes(), row["media_type"]
