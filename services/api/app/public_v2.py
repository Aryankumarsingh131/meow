"""Resident routes over the public-v2 tables: resident accounts, email sign-in
(residents and staff), resident complaints, the public map, and the resident
web portal (/portal).

Schema: services/api/sql/public_v2 (006 holds residents, RLS and the rules
this module relies on). Every name is `public.`-qualified because the API's
connections run with search_path=jalsakshi.

Residents are Supabase Auth users with a `residents` row; they are never
profiles. Their token is the same kind as a staff token (Supabase Auth, or the
dev issuer on the synthetic stack). Every resident READ runs inside
`resident_scope`: as the `authenticated` role with the resident's JWT claims,
so the RLS policies in 006 - not this module - decide what comes back.
Writes go through the service role after validation.

Nothing here states or implies that any water source is safe.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Literal

import psycopg
from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, model_validator

from . import upload_validation
from .auth import Denied, bearer_token, verify_token
from .errors import ApiError
from .routes_v1 import _auth_for

router = APIRouter(prefix="/v1/public", tags=["public"])
auth_router = APIRouter(prefix="/v1/auth", tags=["auth"])
portal_router = APIRouter()

PHONE_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MAP_DISCLAIMER = ("Field screening results are not shown. A lab result describes one sample on one date; "
                  "this map is not a guarantee that water is safe to drink. Data may be up to 15 minutes old.")

COMPLAINT_STATUS_LABELS = {
    "new": "Received - not yet reviewed",
    "linked": "Linked to an investigation",
    "resolved": "Resolved",
}
RESOLUTION_LABELS = {
    "case_closed": "The investigation it was linked to is closed.",
    "dismissed": "Reviewed by a supervisor; no investigation was opened.",
}
SOURCE_STATUS_LABELS = {
    "not_tested": "Not yet tested",
    "under_review": "Under review",
    "action_pending": "Action pending",
    "no_open_issues": "No open issues (not a safety guarantee)",
    "lab_verified_safe": "Lab-verified at last test",
}

# (limit, window seconds). ponytail: fixed windows in Postgres; a burst across a
# window edge can reach 2x the limit. Sliding windows if that ever matters.
LIMITS = {
    "register": (5, 3600),
    "login": (20, 600),
    "login_email": (10, 900),
    "complaint": (5, 3600),
}

# Keys rate-limit buckets by a hash of the caller's address, never the address.
# ponytail: per-process pepper; buckets reset on restart and split per worker.
_PEPPER = secrets.token_bytes(32)


# --- plumbing ------------------------------------------------------------------

def pg(request: Request) -> Iterator[Any]:
    connect = getattr(request.app.state, "connect", None)
    if connect is None:
        raise ApiError("TEMPORARILY_UNAVAILABLE", "No database is configured.")
    conn = connect()
    try:
        if isinstance(conn, sqlite3.Connection):
            raise ApiError("TEMPORARILY_UNAVAILABLE", "Public features need the PostgreSQL database.")
        yield conn
    finally:
        conn.close()


def _client_key(request: Request) -> str:
    host = request.client.host if request.client else "unknown"
    return hmac.new(_PEPPER, host.encode(), hashlib.sha256).hexdigest()[:32]


def _rate_limit(conn: Any, kind: str, subject: str) -> None:
    limit, window = LIMITS[kind]
    hits = conn.execute(
        "insert into public.complaint_rate_limits (bucket_key, window_start, hits)"
        " values (%s, to_timestamp(floor(extract(epoch from now()) / %s) * %s), 1)"
        " on conflict (bucket_key, window_start)"
        " do update set hits = public.complaint_rate_limits.hits + 1 returning hits",
        (f"{kind}:{subject}", window, window)).fetchone()[0]
    conn.commit()   # the hit counts even when this request is refused
    if hits > limit:
        raise ApiError("RATE_LIMITED", f"Too many requests. Try again within {window // 60} minutes.",
                       extra={"retry_after_seconds": window})


def canonical_phone(raw: str) -> str:
    phone = re.sub(r"[\s\-().]", "", raw)
    if not PHONE_RE.match(phone):
        raise ApiError("VALIDATION_FAILED", "Enter the phone number with country code, e.g. +919812345678.",
                       field_errors={"phone": "invalid phone number"})
    return phone


def canonical_email(raw: str) -> str:
    email = raw.strip().lower()
    if not EMAIL_RE.match(email):
        raise ApiError("VALIDATION_FAILED", "Enter a valid email address.", field_errors={"email": "invalid email"})
    return email


def verified_subject(request: Request, authorization: str | None) -> str:
    """The verified token's subject (auth.users id) - staff and residents alike."""
    token = bearer_token(authorization)
    config, _ = _auth_for(request, token)
    verified = verify_token(token, config)
    if isinstance(verified, Denied):
        raise ApiError(verified.code, verified.detail)
    try:
        return str(uuid.UUID(verified.subject))
    except ValueError:   # a valid sign-in that can own no account here
        raise ApiError("FORBIDDEN", "No account for this sign-in.") from None


# --- shared: uploads and test records (also used by staff_v2) ------------------

class Upload(BaseModel):
    content_type: Literal["image/jpeg", "image/png", "application/pdf"]
    data_base64: str = Field(min_length=4, max_length=14_000_000)   # 10 MiB PDF, base64-encoded


def store_upload(conn: Any, upload: Upload, uploaded_by: str | None, *, images_only: bool) -> str:
    """Inspect (decode-level, not MIME/filename) and store; returns 'blob:<uuid>'.
    PDFs pass structural checks only and are stored QUARANTINED: no malware
    scanner exists, so they are never served and never verified."""
    if images_only and upload.content_type == "application/pdf":
        raise ApiError("VALIDATION_FAILED", "Attach a JPEG or PNG photo.", field_errors={"content_type": "image required"})
    try:
        data = base64.b64decode(upload.data_base64, validate=True)
    except ValueError:
        raise ApiError("VALIDATION_FAILED", "The file is not valid base64.", field_errors={"data_base64": "invalid"}) from None
    inspection = upload_validation.inspect(data, upload.content_type)
    if inspection.outcome == "rejected":
        raise ApiError("VALIDATION_FAILED", f"The file was rejected ({inspection.reason}).",
                       field_errors={"data_base64": inspection.reason or "rejected"})
    blob_id = conn.execute(
        "insert into public.photo_blobs (content_type, availability, byte_size, sha256, data, uploaded_by)"
        " values (%s, %s, %s, %s, %s, %s) returning id",
        (upload.content_type, inspection.outcome, len(data), hashlib.sha256(data).hexdigest(), data, uploaded_by)).fetchone()[0]
    return f"blob:{blob_id}"


class TestPayload(BaseModel):
    """One water test. Provenance stays separate: raw_input / readings are the
    human observation, autofill_calculation the machine (model) suggestion.
    With readings, the risk level is the server's rule-based assessment and
    any client value is ignored."""

    local_record_id: uuid.UUID
    kit_id: uuid.UUID
    method: Literal["manual", "camera"]
    dropdown_selection: str | None = Field(default=None, max_length=64)
    raw_input: dict[str, Any] | None = None
    autofill_calculation: dict[str, Any] | None = None
    computed_risk_level: Literal["unknown", "low", "medium", "high"] = "unknown"
    # Pluccy: one value per kit parameter, and when the strip went in / came out.
    readings: dict[str, float] | None = Field(default=None, max_length=16)
    dip_started_at: datetime | None = None
    read_at: datetime | None = None

    @model_validator(mode="after")
    def provenance_matches_method(self) -> "TestPayload":
        if self.method == "manual" and (self.raw_input is None and self.readings is None
                                        or self.autofill_calculation is not None):
            raise ValueError("a manual test carries raw_input or readings, and no autofill_calculation")
        if self.method == "camera" and (self.autofill_calculation is None or self.readings is not None):
            raise ValueError("a camera test carries autofill_calculation and no readings")
        for value in (self.raw_input, self.autofill_calculation):
            if value is not None and len(json.dumps(value)) > 4096:
                raise ValueError("raw_input/autofill_calculation larger than 4 KB")
        if (self.dip_started_at is None) != (self.read_at is None):
            raise ValueError("dip_started_at and read_at go together")
        if self.read_at is not None:
            if self.read_at.tzinfo is None or self.dip_started_at.tzinfo is None:
                raise ValueError("dip_started_at and read_at need a time zone")
            if self.read_at < self.dip_started_at:
                raise ValueError("read_at is before dip_started_at")
            if self.read_at > datetime.now(timezone.utc) + timedelta(minutes=5):
                raise ValueError("read_at is in the future")
        return self


def _checked_readings(conn: Any, kit_id: str, readings: dict[str, float]) -> dict[str, Any]:
    """Every reading must be one of the kit's parameters and inside its input
    range; returns the rule-based assessment."""
    params = {k: (float(lo), float(hi), kind) for k, lo, hi, kind in conn.execute(
        "select rp.key, rp.min_value, rp.max_value, rp.input_kind from public.kit_parameters kp"
        " join public.reading_parameters rp on rp.key = kp.parameter where kp.kit_id = %s", (kit_id,)).fetchall()}
    errors = {}
    for key, value in readings.items():
        if key not in params:
            errors[f"readings.{key}"] = "not measured by this kit"
            continue
        lo, hi, kind = params[key]
        if kind == "presence" and value not in (0, 1):
            errors[f"readings.{key}"] = "0 (absent) or 1 (present)"
        elif not lo <= value <= hi:
            errors[f"readings.{key}"] = f"between {lo:g} and {hi:g}"
    if errors:
        raise ApiError("VALIDATION_FAILED", "Check the readings.", field_errors=errors)
    return conn.execute("select public.assess_readings(%s)", (json.dumps(readings),)).fetchone()[0]


def insert_test_record(conn: Any, payload: TestPayload, source_id: str, performed_by: str,
                       photo: Upload | None = None) -> tuple[str, str]:
    """Idempotent on local_record_id: ('accepted'|'duplicate', id). The same id
    with a different payload is refused, never overwritten. The caller commits;
    points (006) are decided at that commit."""
    if conn.execute("select 1 from public.test_kits where id = %s and active", (str(payload.kit_id),)).fetchone() is None:
        raise ApiError("VALIDATION_FAILED", "Unknown or retired test kit.", field_errors={"kit_id": "not found"})
    assessment = _checked_readings(conn, str(payload.kit_id), payload.readings) if payload.readings is not None else None
    risk = assessment["risk_level"] if assessment else payload.computed_risk_level
    fields = (source_id, performed_by, str(payload.kit_id), payload.method, payload.dropdown_selection,
              json.dumps(payload.raw_input) if payload.raw_input is not None else None,
              json.dumps(payload.autofill_calculation) if payload.autofill_calculation is not None else None,
              risk)
    row = conn.execute(
        "insert into public.test_records (source_id, performed_by, kit_id, method, dropdown_selection, raw_input,"
        " autofill_calculation, computed_risk_level, local_record_id, synced_at, dip_started_at, read_at, rule_assessment)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, now(), %s, %s, %s)"
        " on conflict (local_record_id) do nothing returning id",
        (*fields, str(payload.local_record_id), payload.dip_started_at, payload.read_at,
         json.dumps(assessment) if assessment else None)).fetchone()
    if row is not None:
        record_id = str(row[0])
        if photo is not None:
            url = store_upload(conn, photo, performed_by, images_only=True)
            conn.execute("update public.test_records set photo_url = %s where id = %s", (url, record_id))
        for key, value in (payload.readings or {}).items():
            conn.execute("insert into public.test_readings (test_record_id, parameter, value) values (%s, %s, %s)",
                         (record_id, key, value))
        return "accepted", record_id
    existing = conn.execute(
        "select id, source_id::text, performed_by::text, kit_id::text, method, dropdown_selection, raw_input,"
        " autofill_calculation, computed_risk_level from public.test_records where local_record_id = %s",
        (str(payload.local_record_id),)).fetchone()
    stored = {k: float(v) for k, v in conn.execute(
        "select parameter, value from public.test_readings where test_record_id = %s", (existing[0],)).fetchall()}
    same = (existing[1:6] == fields[:5] and existing[6] == payload.raw_input
            and existing[7] == payload.autofill_calculation and existing[8] == risk
            and stored == {k: float(v) for k, v in (payload.readings or {}).items()})
    if not same:
        raise ApiError("IDEMPOTENCY_MISMATCH", "This local_record_id was already used for a different test.")
    return "duplicate", str(existing[0])


# --- sign-in (residents and staff) -----------------------------------------------

def supabase_password_grant(base_url: str, publishable_key: str, email: str, password: str) -> dict[str, Any] | None:
    """Supabase Auth email+password sign-in. None = wrong credentials."""
    if not base_url.startswith("https://"):
        raise ApiError("TEMPORARILY_UNAVAILABLE", "Sign-in is misconfigured.")
    request = urllib.request.Request(
        base_url.rstrip("/") + "/auth/v1/token?grant_type=password", method="POST",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"apikey": publishable_key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=8) as response:  # noqa: S310 - https checked above
            return json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code in (400, 401):
            return None
        if exc.code == 429:
            raise ApiError("RATE_LIMITED", "Too many sign-in attempts. Try again shortly.") from None
        raise ApiError("TEMPORARILY_UNAVAILABLE", "The sign-in service is unavailable.") from None
    except (urllib.error.URLError, TimeoutError):
        raise ApiError("TEMPORARILY_UNAVAILABLE", "The sign-in service is unavailable.") from None


def _session(request: Request, conn: Any, email: str, password: str, auth_user_id: str, role: str) -> dict[str, Any] | None:
    """A token for this account, or None for a wrong password. Supabase Auth
    checks the password when hosted; on the synthetic dev stack the same bcrypt
    hash in auth.users is checked and the dev issuer mints the token."""
    issuer = getattr(request.app.state, "dev_issuer", None)
    if issuer is not None:
        ok = conn.execute(
            "select 1 from auth.users where id = %s and deleted_at is null"
            " and (banned_until is null or banned_until < now())"
            " and encrypted_password = extensions.crypt(%s, encrypted_password)",
            (auth_user_id, password)).fetchone()
        if ok is None:
            return None
        return {"token": issuer.mint(auth_user_id), "expires_at": int(time.time()) + issuer.ttl_seconds,
                "role": role, "token_type": "dev"}
    supabase = getattr(request.app.state, "supabase_auth", None)
    if supabase is None:
        raise ApiError("TEMPORARILY_UNAVAILABLE", "Sign-in is not configured.")
    session = supabase_password_grant(*supabase, email, password)
    if session is None or (session.get("user") or {}).get("id") != auth_user_id:
        return None
    return {"token": session["access_token"], "refresh_token": session.get("refresh_token"),
            "expires_at": int(time.time()) + int(session.get("expires_in", 3600)),
            "role": role, "token_type": "supabase"}


class EmailLogin(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


@auth_router.post("/login")
def email_login(body: EmailLogin, request: Request, conn: Any = Depends(pg)) -> dict[str, Any]:
    """One email + password sign-in for staff (role supervisor | field_worker)
    and residents (role resident). Unknown email and wrong password look
    identical."""
    email = canonical_email(body.email)
    _rate_limit(conn, "login", _client_key(request))
    _rate_limit(conn, "login_email", hashlib.sha256(email.encode()).hexdigest()[:32])
    row = conn.execute(
        "select auth_user_id::text, role from public.profiles where email = %s and active"
        " union all select auth_user_id::text, 'resident' from public.residents where email = %s and active",
        (email, email)).fetchone()
    session = _session(request, conn, email, body.password, *row) if row else None
    if session is None:
        raise ApiError("AUTH_REQUIRED", "Email or password is incorrect.")
    return session


# --- residents ---------------------------------------------------------------------

class Resident(BaseModel):
    resident_id: str
    auth_user_id: str


def require_resident(request: Request, authorization: str | None = Header(default=None),
                     conn: Any = Depends(pg)) -> Resident:
    subject = verified_subject(request, authorization)
    row = conn.execute("select id::text from public.residents where auth_user_id = %s and active", (subject,)).fetchone()
    if row is None:
        raise ApiError("FORBIDDEN", "Sign in with a resident account.")
    return Resident(resident_id=row[0], auth_user_id=subject)


@contextmanager
def resident_scope(conn: Any, resident: Resident) -> Iterator[None]:
    """Run reads as `authenticated` with this resident's claims: RLS applies.
    Ends with a rollback, so never wrap a write in it."""
    conn.execute("set local role authenticated")
    conn.execute("select set_config('request.jwt.claims', %s, true)",
                 (json.dumps({"sub": resident.auth_user_id, "role": "authenticated"}),))
    try:
        yield
    finally:
        conn.rollback()


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=32)


@router.post("/accounts", status_code=201)
def register(body: RegisterRequest, request: Request, conn: Any = Depends(pg)) -> dict[str, Any]:
    """A resident account: Supabase Auth user + residents row. Neither the email
    nor the phone is verified: no email or SMS provider is configured."""
    email = canonical_email(body.email)
    phone = canonical_phone(body.phone) if body.phone else None
    if body.password.lower() in ("12345678", "password", "jalsakshi"):
        raise ApiError("VALIDATION_FAILED", "Choose a less common password.", field_errors={"password": "too common"})
    _rate_limit(conn, "register", _client_key(request))
    try:
        auth_user_id = str(conn.execute("select public.create_resident_login(%s, %s, %s, %s)",
                                        (email, body.password, body.full_name, phone)).fetchone()[0])
    except (psycopg.errors.RaiseException, psycopg.errors.UniqueViolation) as exc:
        conn.rollback()
        if "email" in str(exc):
            raise ApiError("EMAIL_ALREADY_REGISTERED", "This email already has an account. Sign in instead.") from None
        if "phone" in str(exc):
            raise ApiError("PHONE_ALREADY_REGISTERED", "This number already has an account.") from None
        raise
    conn.commit()
    session = _session(request, conn, email, body.password, auth_user_id, "resident")
    if session is None:   # pragma: no cover - the password was just set
        raise ApiError("TEMPORARILY_UNAVAILABLE", "Account created; sign in to continue.")
    return session


@router.get("/me")
def me(resident: Resident = Depends(require_resident), conn: Any = Depends(pg)) -> dict[str, Any]:
    with resident_scope(conn, resident):
        row = conn.execute("select full_name, email, phone from public.residents").fetchone()
    if row is None:
        raise ApiError("AUTH_REQUIRED", "Sign in again.")
    name, email, phone = row
    return {"full_name": name, "email": email,
            "phone": phone[:3] + "*" * (len(phone) - 6) + phone[-3:] if phone else None}


class ComplaintRequest(BaseModel):
    complaint_type: Literal["discoloration", "smell", "taste", "sediment", "illness", "other"]
    source_id: str | None = None
    description: str | None = Field(default=None, max_length=1000)
    photo: Upload | None = None


@router.post("/complaints", status_code=201)
def submit_complaint(body: ComplaintRequest, resident: Resident = Depends(require_resident),
                     conn: Any = Depends(pg)) -> dict[str, Any]:
    _rate_limit(conn, "complaint", resident.resident_id)
    source = None
    if body.source_id is not None:
        try:
            sid = str(uuid.UUID(body.source_id))
        except ValueError:
            sid = None
        source = sid and conn.execute("select id, name, team_id from public.water_sources where id = %s",
                                      (sid,)).fetchone()
        if not source:
            raise ApiError("VALIDATION_FAILED", "Unknown water source.", field_errors={"source_id": "not found"})
    photo_url = store_upload(conn, body.photo, None, images_only=True) if body.photo else None
    details = {"description": body.description} if body.description else None
    complaint_id, reference, status = conn.execute(
        "insert into public.complaints (resident_id, source_id, complaint_type, details, photo_url)"
        " values (%s, %s, %s, %s, %s) returning id, reference_number, status",
        (resident.resident_id, source[0] if source else None, body.complaint_type,
         json.dumps(details) if details else None, photo_url)).fetchone()

    notified = 0
    if body.complaint_type == "illness":
        # A symptom report must reach a person, not just set a flag: queue an
        # in-app notification to the source's team supervisors (every active
        # supervisor when the source is unknown). Delivery beyond the queue
        # needs a push/SMS provider - recorded as a blocker.
        where = source[1] if source else "an unregistered source"
        message = (f"Symptom report {reference} received for {where}. Review it now; "
                   "this is a resident report, not a diagnosis.")
        notified = conn.execute(
            "insert into public.notifications (user_id, channel, message, delivery_status)"
            " select p.id, 'in_app', %s, 'queued' from public.profiles p"
            " where p.role = 'supervisor' and p.active and (%s::uuid is null or p.team_id = %s::uuid)",
            (message, source[2] if source else None, source[2] if source else None)).rowcount
        conn.execute("insert into public.audit_log (entity_type, entity_id, action, after_data)"
                     " values ('complaints', %s, 'symptom_report_notified', %s)",
                     (complaint_id, json.dumps({"supervisors_notified": notified})))
    conn.commit()
    return {
        "reference_number": reference,
        "status": status,
        "status_label": COMPLAINT_STATUS_LABELS[status],
        "supervisors_notified": notified,
        "photo_attached": photo_url is not None,
        "notice": "You can follow this complaint under My complaints. A complaint is not a test result.",
    }


@router.get("/complaints")
def my_complaints(resident: Resident = Depends(require_resident), conn: Any = Depends(pg)) -> dict[str, Any]:
    """This resident's complaints. RLS returns only their own rows and only
    resident-safe columns; no case, lab or staff detail exists on this path."""
    with resident_scope(conn, resident):
        rows = conn.execute(
            "select reference_number, complaint_type, status, resolution, source_id::text, submitted_at, linked_at,"
            " details->>'description' from public.complaints order by submitted_at desc limit 100").fetchall()
    names = dict(conn.execute("select source_id::text, name from public.public_map_view where source_id = any(%s::uuid[])",
                              ([r[4] for r in rows if r[4]],)).fetchall())
    return {"items": [{
        "reference_number": ref, "complaint_type": ctype, "status": status,
        "status_label": COMPLAINT_STATUS_LABELS[status], "resolution_label": RESOLUTION_LABELS.get(resolution),
        "source_name": names.get(sid), "submitted_at": submitted.isoformat(),
        "linked_at": linked.isoformat() if linked else None, "description": description,
    } for ref, ctype, status, resolution, sid, submitted, linked, description in rows]}


# --- map and portal ------------------------------------------------------------------

@router.get("/map")
def public_map(conn: Any = Depends(pg)) -> dict[str, Any]:
    rows = conn.execute(
        "select source_id, name, source_type, status_label, last_updated,"
        " public.st_y(public_location::public.geometry), public.st_x(public_location::public.geometry)"
        " from public.public_map_view order by name").fetchall()
    return {
        "items": [{
            "source_id": str(sid), "name": name, "source_type": stype, "status": status,
            "status_label": SOURCE_STATUS_LABELS.get(status, "Not yet tested"),
            "latitude": lat, "longitude": lon,
            "location_precision": "exact" if status == "lab_verified_safe" else "approximate (about 500 m)",
            "last_updated": updated.isoformat(),
        } for sid, name, stype, status, updated, lat, lon in rows],
        "disclaimer": MAP_DISCLAIMER,
    }


PORTAL_HTML = Path(__file__).with_name("portal.html")


@portal_router.get("/portal", include_in_schema=False)
def portal() -> HTMLResponse:
    """The resident web portal: the page a shared link or QR code opens."""
    return HTMLResponse(PORTAL_HTML.read_text(encoding="utf-8"),
                        headers={"Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"})
