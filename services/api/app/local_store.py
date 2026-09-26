"""Internal fallback database: the v2 routes on a SQLite file inside the repo.

When Supabase (Postgres) cannot be reached, main.py routes the /v1/auth/login,
/v1/staff and /v1/public requests here, so the mobile app and the supervisor
dashboard keep working - and keep sharing data - through this machine's API.
The same rules as the Postgres functions (004/006/008) are applied in Python:
team scope, report versions, lab-verification and closure evidence, the
complaint lifecycle, the screening bands and the points rule.

Data: services/api/local_db/seed.json (a committed snapshot of the live data,
refreshed with tools/export_local_seed.py) is loaded into
services/api/local_db/jalsakshi_local.sqlite3 on first use. Offline sign-in:
the seed's demo accounts with password 1234, plus residents who register while
offline. Tokens are 'local1.*', signed with a key kept next to the database.

ponytail: one-way. What is written here is not copied back to Supabase when it
returns; a sync job is the upgrade path if offline edits must reach the cloud.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Literal

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Response
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field

from . import upload_validation
from .errors import ApiError, api_error_handler, validation_error_handler
from .public_v2 import (COMPLAINT_STATUS_LABELS, LEADERBOARD_NOTE, MAP_DISCLAIMER, RESOLUTION_LABELS,
                        SOURCE_STATUS_LABELS, ComplaintRequest, EmailLogin, RegisterRequest, Upload, canonical_email,
                        build_stats, canonical_phone, combine, display_name, judge)
from .staff_v2 import (MILESTONES, POINTS_RULE, _photo_json, CloseRequest, CommunicationRequest, NoteRequest, PhotoRequest,
                       ReferralRequest, ReviewRequest, SourceRequest, SourceUpdate, TestRecordRequest,
                       TransitionRequest, VerifyRequest, VersionRequest)

DB_DIR = Path(os.environ.get("JALSAKSHI_LOCAL_DB_DIR", Path(__file__).resolve().parents[1] / "local_db"))
SEED = DB_DIR / "seed.json"
TOKEN_PREFIX = "local1."
TOKEN_TTL = 12 * 3600
IST = timezone(timedelta(hours=5, minutes=30))
_init_lock = threading.Lock()

SCHEMA = """
create table if not exists teams (id text primary key, name text not null, region text);
create table if not exists profiles (id text primary key, email text unique not null, role text not null,
  full_name text, team_id text, active integer not null default 1, password_hash text);
create table if not exists residents (id text primary key, email text unique not null, full_name text,
  phone text unique, active integer not null default 1, password_hash text);
create table if not exists water_sources (id text primary key, team_id text, name text not null, source_type text not null,
  latitude real, longitude real, location_source text, location_accuracy_m real, village text, ward text,
  current_risk_level text, current_public_status text, created_at text);
create table if not exists test_kits (id text primary key, name text, strip_type text, dip_instruction text,
  timing_window_sec integer, read_grace_sec integer not null default 60, active integer not null default 1);
create table if not exists reading_parameters (key text primary key, label text, unit text, input_kind text,
  min_value real, max_value real, ok_min real, ok_max real, watch_min real, watch_max real, tip text, basis text);
create table if not exists kit_parameters (kit_id text, parameter text, position integer, primary key (kit_id, parameter));
create table if not exists blobs (id text primary key, content_type text, availability text, data blob, uploaded_by text, created_at text);
create table if not exists test_records (id text primary key, local_record_id text unique not null, source_id text not null,
  performed_by text not null, kit_id text, method text, dropdown_selection text, raw_input text, autofill_calculation text,
  computed_risk_level text, rule_assessment text, readings text, photo_url text, dip_started_at text, read_at text, created_at text);
create table if not exists reports (id text primary key, source_id text not null, test_record_id text, risk_level text,
  status text not null, version integer not null default 1, origin text not null default 'screening',
  is_re_report integer not null default 0, previous_report_id text, created_by text, created_at text, closed_at text,
  closure_reason text);
create table if not exists lab_referrals (id text primary key, report_id text not null, lab_name text, sent_at text,
  result_file_url text, verification_status text not null default 'pending', re_report_requested integer not null default 0,
  recorded_by text, verified_by text, verified_at text);
create table if not exists process_photos (id text primary key, report_id text, source_id text, photo_url text,
  process_stage text, inspection_level text, uploaded_by text, uploaded_at text);
create table if not exists complaints (id text primary key, reference_number text unique not null, resident_id text,
  source_id text, complaint_type text, description text, photo_url text, status text not null default 'new',
  resolution text, linked_report_id text, linked_at text, linked_by text, version integer not null default 1, submitted_at text);
create table if not exists points_ledger (id integer primary key autoincrement, profile_id text, points integer, reason text,
  related_test_record_id text unique, awarded_at text);
create table if not exists notifications (id text primary key, related_report_id text, channel text, message text,
  sent_at text, delivery_status text);
create table if not exists audit_log (id integer primary key autoincrement, actor_id text, entity_type text, entity_id text,
  action text, after_data text, at text);
create table if not exists inspection_criteria (key text primary key, category text, question text, tip text, position integer);
"""

# Columns added after a database file may already exist (009): (table, column, type).
LATER_COLUMNS = [("test_kits", "protocol", "text"), ("test_records", "inspection", "text"),
                 # 011: JSON lists
                 ("test_records", "extra_photo_urls", "text"), ("complaints", "extra_photo_urls", "text"), ("complaints", "also", "text")]


# --- storage ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120_000)
    return f"pbkdf2${salt.hex()}${digest.hex()}"


def _check(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("pbkdf2$"):
        return False
    _, salt, _digest = stored.split("$")
    return hmac.compare_digest(_hash(password, bytes.fromhex(salt)), stored)


def db_path() -> Path:
    return DB_DIR / "jalsakshi_local.sqlite3"


def _load_seed(conn: sqlite3.Connection) -> None:
    seed = json.loads(SEED.read_text(encoding="utf-8")) if SEED.exists() else {}
    demo = set(seed.get("demo_logins", []))
    demo_hash = _hash("1234")
    js = lambda v: json.dumps(v) if v is not None else None  # noqa: E731

    def put(table: str, rows: list[dict], cols: list[str], transform=lambda r: r) -> None:
        for row in rows:
            row = transform(dict(row))
            conn.execute(f"insert or ignore into {table} ({', '.join(cols)}) values ({', '.join('?' * len(cols))})",
                         [row.get(c) for c in cols])

    put("teams", seed.get("teams", []), ["id", "name", "region"])
    put("profiles", seed.get("profiles", []), ["id", "email", "role", "full_name", "team_id", "active", "password_hash"],
        lambda r: {**r, "active": int(r.get("active", True)), "password_hash": demo_hash if r["email"] in demo else None})
    put("residents", seed.get("residents", []), ["id", "email", "full_name", "phone", "active", "password_hash"],
        lambda r: {**r, "active": int(r.get("active", True)), "password_hash": demo_hash if r["email"] in demo else None})
    put("water_sources", seed.get("water_sources", []), ["id", "team_id", "name", "source_type", "latitude", "longitude",
        "location_source", "location_accuracy_m", "village", "ward", "current_risk_level", "current_public_status", "created_at"])
    put("test_kits", seed.get("test_kits", []), ["id", "name", "strip_type", "dip_instruction", "timing_window_sec",
        "read_grace_sec", "active", "protocol"], lambda r: {**r, "active": int(r.get("active", True)), "protocol": js(r.get("protocol"))})
    put("reading_parameters", seed.get("reading_parameters", []), ["key", "label", "unit", "input_kind", "min_value",
        "max_value", "ok_min", "ok_max", "watch_min", "watch_max", "tip", "basis"])
    put("kit_parameters", seed.get("kit_parameters", []), ["kit_id", "parameter", "position"])
    put("inspection_criteria", seed.get("inspection_criteria", []), ["key", "category", "question", "tip", "position"])
    for k in seed.get("test_kits", []):   # a kit's protocol also reaches databases created before 009
        conn.execute("update test_kits set protocol = ? where id = ? and protocol is null", (js(k.get("protocol")), k["id"]))
    put("test_records", seed.get("test_records", []), ["id", "local_record_id", "source_id", "performed_by", "kit_id",
        "method", "dropdown_selection", "raw_input", "autofill_calculation", "computed_risk_level", "rule_assessment",
        "readings", "dip_started_at", "read_at", "created_at", "inspection"],
        lambda r: {**r, **{k: js(r.get(k)) for k in ("raw_input", "autofill_calculation", "rule_assessment", "readings", "inspection")}})
    put("reports", seed.get("reports", []), ["id", "source_id", "test_record_id", "risk_level", "status", "version",
        "origin", "is_re_report", "previous_report_id", "created_by", "created_at", "closed_at", "closure_reason"],
        lambda r: {**r, "is_re_report": int(r.get("is_re_report") or False)})
    put("lab_referrals", seed.get("lab_referrals", []), ["id", "report_id", "lab_name", "sent_at", "verification_status",
        "re_report_requested", "verified_by", "verified_at"],
        lambda r: {**r, "re_report_requested": int(r.get("re_report_requested") or False)})
    put("process_photos", seed.get("process_photos", []), ["id", "report_id", "source_id", "process_stage",
        "inspection_level", "uploaded_by", "uploaded_at"])
    put("complaints", seed.get("complaints", []), ["id", "reference_number", "resident_id", "source_id", "complaint_type",
        "description", "status", "resolution", "linked_report_id", "linked_at", "linked_by", "version", "submitted_at"])
    put("points_ledger", seed.get("points_ledger", []), ["profile_id", "points", "reason", "related_test_record_id", "awarded_at"])
    put("notifications", seed.get("notifications", []), ["id", "related_report_id", "channel", "message", "sent_at",
        "delivery_status"])
    put("audit_log", seed.get("audit_log", []), ["actor_id", "entity_type", "entity_id", "action", "after_data", "at"],
        lambda r: {**r, "after_data": js(r.get("after_data"))})


def connect() -> sqlite3.Connection:
    """A connection to the internal database, created from the seed on first use."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with _init_lock:
        fresh = not db_path().exists()
        conn = sqlite3.connect(db_path(), timeout=15, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("pragma journal_mode = wal")
        conn.executescript(SCHEMA)
        added = False
        for table, column, kind in LATER_COLUMNS:
            if column not in {r["name"] for r in conn.execute(f"pragma table_info({table})")}:
                conn.execute(f"alter table {table} add column {column} {kind}")
                added = True
        if fresh or added or one(conn, "select 1 from inspection_criteria") is None:
            conn.execute("begin")
            _load_seed(conn)   # insert-or-ignore: new seed rows arrive, nothing existing is overwritten
            conn.execute("commit")
    return conn


def db() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


class Tx:
    """`with Tx(conn):` - one immediate write transaction, rolled back on error."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn

    def __enter__(self) -> sqlite3.Connection:
        self.conn.execute("begin immediate")
        return self.conn

    def __exit__(self, exc_type, *_: Any) -> None:
        self.conn.execute("rollback" if exc_type else "commit")


def one(conn: sqlite3.Connection, sql: str, *args: Any) -> sqlite3.Row | None:
    return conn.execute(sql, args).fetchone()


def audit(conn: sqlite3.Connection, actor: str | None, entity: str, entity_id: str, action: str, data: dict | None = None) -> None:
    conn.execute("insert into audit_log (actor_id, entity_type, entity_id, action, after_data, at) values (?, ?, ?, ?, ?, ?)",
                 (actor, entity, entity_id, action, json.dumps(data) if data is not None else None, _now()))


# --- tokens and identities ------------------------------------------------------------------

def _key() -> bytes:
    path = DB_DIR / ".token_key"
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with _init_lock:
        if not path.exists():
            path.write_bytes(secrets.token_bytes(32))
    return path.read_bytes()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def issue_token(kind: str, subject: str) -> tuple[str, int]:
    exp = int(time.time()) + TOKEN_TTL
    payload = _b64(json.dumps({"k": kind, "sub": subject, "exp": exp}, separators=(",", ":")).encode())
    return f"{TOKEN_PREFIX}{payload}.{_b64(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())}", exp


def read_token(authorization: str | None) -> dict | None:
    token = (authorization or "").partition(" ")[2].strip()
    if not token.startswith(TOKEN_PREFIX):
        return None
    try:
        payload, sig = token[len(TOKEN_PREFIX):].split(".")
        if not hmac.compare_digest(_b64(hmac.new(_key(), payload.encode(), hashlib.sha256).digest()), sig):
            return None
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, KeyError):
        return None
    return claims if claims.get("exp", 0) > time.time() else None


class Staff(BaseModel):
    profile_id: str
    role: Literal["supervisor", "field_worker"]
    team_id: str | None


def require_staff(authorization: str | None = Header(default=None), conn: sqlite3.Connection = Depends(db)) -> Staff:
    claims = read_token(authorization)
    if claims is None:
        raise ApiError("AUTH_REQUIRED", "Sign in again.")
    row = one(conn, "select id, role, team_id from profiles where id = ? and active and role in ('supervisor', 'field_worker')",
              claims["sub"]) if claims.get("k") == "staff" else None
    if row is None:
        raise ApiError("FORBIDDEN", "No active staff profile for this account.")
    return Staff(profile_id=row["id"], role=row["role"], team_id=row["team_id"])


def supervisor(staff: Staff = Depends(require_staff)) -> Staff:
    if staff.role != "supervisor":
        raise ApiError("FORBIDDEN", "Supervisors only.")
    return staff


def require_resident(authorization: str | None = Header(default=None), conn: sqlite3.Connection = Depends(db)) -> str:
    claims = read_token(authorization)
    if claims is None:
        raise ApiError("AUTH_REQUIRED", "Sign in again.")
    row = one(conn, "select id from residents where id = ? and active", claims["sub"]) if claims.get("k") == "resident" else None
    if row is None:
        raise ApiError("FORBIDDEN", "Sign in with a resident account.")
    return row["id"]


def _uuid(value: str | None, what: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        raise ApiError("NOT_FOUND", f"{what} not found.") from None


# --- shared rules ---------------------------------------------------------------------------

def store_upload(conn: sqlite3.Connection, upload: Upload, by: str | None, *, images_only: bool) -> str:
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
    bid = str(uuid.uuid4())
    conn.execute("insert into blobs (id, content_type, availability, data, uploaded_by, created_at) values (?, ?, ?, ?, ?, ?)",
                 (bid, upload.content_type, inspection.outcome, data, by, _now()))
    return f"blob:{bid}"


def update_report(conn: sqlite3.Connection, report_id: str, **fields: Any) -> int:
    """Every report update bumps its version (the trg_reports_version rule)."""
    sets = "".join(f", {k} = ?" for k in fields)
    conn.execute(f"update reports set version = version + 1{sets} where id = ?", (*fields.values(), report_id))
    derive_public_status(conn, one(conn, "select source_id from reports where id = ?", report_id)["source_id"])
    return one(conn, "select version from reports where id = ?", report_id)["version"]


def derive_public_status(conn: sqlite3.Connection, source_id: str) -> None:
    statuses = [r["status"] for r in conn.execute("select status from reports where source_id = ?", (source_id,))]
    current = one(conn, "select current_public_status from water_sources where id = ?", source_id)
    status = ("action_pending" if "action_taken" in statuses
              else "under_review" if set(statuses) & {"open", "sent_to_lab", "under_review"}
              else "lab_verified_safe" if current and current["current_public_status"] == "lab_verified_safe"
              else "no_open_issues" if statuses else (current["current_public_status"] if current else "not_tested"))
    conn.execute("update water_sources set current_public_status = ? where id = ?", (status, source_id))


def team_report(conn: sqlite3.Connection, staff: Staff, report_id: str) -> sqlite3.Row:
    row = one(conn, "select r.* from reports r join water_sources ws on ws.id = r.source_id where r.id = ? and ws.team_id = ?",
              _uuid(report_id, "Report"), staff.team_id)
    if row is None:
        raise ApiError("NOT_FOUND", "Report not found.")
    return row


def check_version(row: sqlite3.Row, expected: int | None) -> None:
    if expected is None or row["version"] != expected:
        raise ApiError("CASE_VERSION_CONFLICT", "Someone else changed this report. Reload it and try again.")


def new_report(conn: sqlite3.Connection, source_id: str, test_record_id: str | None, risk: str, origin: str,
               created_by: str, previous: str | None = None) -> str:
    rid = str(uuid.uuid4())
    conn.execute("insert into reports (id, source_id, test_record_id, risk_level, status, version, origin, is_re_report,"
                 " previous_report_id, created_by, created_at) values (?, ?, ?, ?, 'open', 1, ?, ?, ?, ?, ?)",
                 (rid, source_id, test_record_id, risk, origin, int(previous is not None), previous, created_by, _now()))
    derive_public_status(conn, source_id)
    return rid


def assess(conn: sqlite3.Connection, readings: dict[str, float]) -> dict[str, Any]:
    findings = []
    for key in sorted(readings):
        p = one(conn, "select * from reading_parameters where key = ?", key)
        if p is None:
            continue
        v = readings[key]
        inside = lambda lo, hi: (lo is None or v >= lo) and (hi is None or v <= hi)  # noqa: E731
        level = "low" if inside(p["ok_min"], p["ok_max"]) else "medium" if inside(p["watch_min"], p["watch_max"]) else "high"
        findings.append({"parameter": key, "value": v, "level": level})
    rank = {"low": 1, "medium": 2, "high": 3}
    risk = max((f["level"] for f in findings), key=rank.get, default="unknown")
    return {"risk_level": risk, "findings": findings}


def points_summary(conn: sqlite3.Connection, profile_id: str) -> dict[str, Any]:
    rows = conn.execute("select points, reason, awarded_at from points_ledger where profile_id = ?", (profile_id,)).fetchall()
    on_time = [r for r in rows if r["reason"] == "screening_on_time"]
    days = sorted({datetime.fromisoformat(r["awarded_at"]).astimezone(IST).date() for r in on_time}, reverse=True)
    today = datetime.now(IST).date()
    expect = today if days and days[0] == today else today - timedelta(days=1)
    streak = 0
    for day in days:
        if day != expect:
            break
        streak += 1
        expect -= timedelta(days=1)
    qualifying = len(on_time)
    return {"points_balance": sum(r["points"] for r in rows), "qualifying_screenings": qualifying, "streak_days": streak,
            "milestones": list(MILESTONES), "next_milestone": next((m for m in MILESTONES if m > qualifying), None),
            "rule": POINTS_RULE}


# --- routes -----------------------------------------------------------------------------------

auth_router = APIRouter(prefix="/v1/auth")
public = APIRouter(prefix="/v1/public")
staff_router = APIRouter(prefix="/v1/staff")


@auth_router.post("/login")
def login(body: EmailLogin, conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    email = canonical_email(body.email)
    staff = one(conn, "select id, role, password_hash from profiles where email = ? and active", email)
    resident = None if staff else one(conn, "select id, password_hash from residents where email = ? and active", email)
    row = staff or resident
    if row is None or not _check(body.password, row["password_hash"]):
        raise ApiError("AUTH_REQUIRED", "Email or password is incorrect.")
    token, exp = issue_token("staff" if staff else "resident", row["id"])
    return {"token": token, "expires_at": exp, "role": staff["role"] if staff else "resident", "token_type": "local"}


@public.post("/accounts", status_code=201)
def register(body: RegisterRequest, conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    email = canonical_email(body.email)
    phone = canonical_phone(body.phone) if body.phone else None
    if body.password.lower() in ("12345678", "password", "jalsakshi"):
        raise ApiError("VALIDATION_FAILED", "Choose a less common password.", field_errors={"password": "too common"})
    with Tx(conn):
        if one(conn, "select 1 from residents where email = ? union select 1 from profiles where email = ?", email, email):
            raise ApiError("EMAIL_ALREADY_REGISTERED", "This email already has an account. Sign in instead.")
        if phone and one(conn, "select 1 from residents where phone = ?", phone):
            raise ApiError("PHONE_ALREADY_REGISTERED", "This number already has an account.")
        rid = str(uuid.uuid4())
        conn.execute("insert into residents (id, email, full_name, phone, password_hash) values (?, ?, ?, ?, ?)",
                     (rid, email, body.full_name, phone, _hash(body.password)))
    token, exp = issue_token("resident", rid)
    return {"token": token, "expires_at": exp, "role": "resident", "token_type": "local"}


@public.get("/me")
def resident_me(resident: str = Depends(require_resident), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    r = one(conn, "select full_name, email, phone from residents where id = ?", resident)
    phone = r["phone"]
    return {"full_name": r["full_name"], "email": r["email"],
            "phone": phone[:3] + "*" * (len(phone) - 6) + phone[-3:] if phone else None}


@public.post("/complaints", status_code=201)
def file_complaint(body: ComplaintRequest, resident: str = Depends(require_resident),
                   conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        if body.source_id is not None and one(conn, "select 1 from water_sources where id = ?", body.source_id) is None:
            raise ApiError("VALIDATION_FAILED", "Unknown water source.", field_errors={"source_id": "not found"})
        photo = store_upload(conn, body.photo, None, images_only=True) if body.photo else None
        extra = [store_upload(conn, x, None, images_only=True) for x in body.extra_photos]
        reference = "JS-" + secrets.token_hex(5).upper()
        conn.execute("insert into complaints (id, reference_number, resident_id, source_id, complaint_type, description,"
                     " photo_url, submitted_at, extra_photo_urls, also) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (str(uuid.uuid4()), reference, resident, body.source_id, body.complaint_type, body.description, photo, _now(),
                      json.dumps(extra), json.dumps(body.also)))
    return {"reference_number": reference, "status": "new", "status_label": COMPLAINT_STATUS_LABELS["new"],
            "supervisors_notified": 0, "photo_attached": photo is not None, "photos_attached": len(extra) + (photo is not None),
            "notice": "You can follow this complaint under My complaints. A complaint is not a test result."}


@public.get("/complaints")
def my_complaints(resident: str = Depends(require_resident), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    rows = conn.execute("select c.*, ws.name as source_name from complaints c left join water_sources ws on ws.id = c.source_id"
                        " where c.resident_id = ? order by c.submitted_at desc limit 100", (resident,)).fetchall()
    return {"items": [{"reference_number": r["reference_number"], "complaint_type": r["complaint_type"], "status": r["status"],
                       "status_label": COMPLAINT_STATUS_LABELS[r["status"]], "resolution_label": RESOLUTION_LABELS.get(r["resolution"]),
                       "source_name": r["source_name"], "submitted_at": r["submitted_at"], "linked_at": r["linked_at"],
                       "description": r["description"], "also": json.loads(r["also"] or "[]")} for r in rows]}


@public.get("/map")
def public_map(conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    rows = conn.execute(
        "select ws.*, (select max(coalesce(t.read_at, t.created_at)) from test_records t where t.source_id = ws.id) as screened,"
        " (select count(*) from test_records t where t.source_id = ws.id and t.created_at > ?) as recent,"
        " (select count(*) from reports r where r.source_id = ws.id and r.status <> 'closed') as open_issues,"
        " (select max(l.verified_at) from lab_referrals l join reports r on r.id = l.report_id"
        "   where r.source_id = ws.id and l.verification_status = 'verified') as verified"
        " from water_sources ws order by ws.name", ((datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),)).fetchall()
    fuzz = lambda v, exact: v if exact or v is None else round(round(v / 0.005) * 0.005, 6)  # noqa: E731
    return {"items": [{
        "source_id": r["id"], "name": r["name"], "source_type": r["source_type"], "status": r["current_public_status"],
        "status_label": SOURCE_STATUS_LABELS.get(r["current_public_status"], "Not yet tested"),
        "latitude": fuzz(r["latitude"], r["current_public_status"] == "lab_verified_safe"),
        "longitude": fuzz(r["longitude"], r["current_public_status"] == "lab_verified_safe"),
        "location_precision": "exact" if r["current_public_status"] == "lab_verified_safe" else "approximate (about 500 m)",
        "last_updated": r["created_at"], "village": r["village"], "ward": r["ward"], "last_screened_at": r["screened"],
        "screenings_30d": r["recent"], "open_issues": r["open_issues"], "lab_verified_at": r["verified"]} for r in rows],
        "disclaimer": MAP_DISCLAIMER}


@public.get("/leaderboard")
def public_leaderboard(conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    workers = conn.execute(
        "select p.full_name, t.region, (select coalesce(sum(points), 0) from points_ledger l where l.profile_id = p.id) as points,"
        " (select count(*) from points_ledger l where l.profile_id = p.id and l.reason = 'screening_on_time') as on_time,"
        " (select count(*) from test_records r where r.performed_by = p.id) as tests"
        " from profiles p left join teams t on t.id = p.team_id where p.role = 'field_worker' and p.active"
        " order by points desc, tests desc, p.full_name limit 20").fetchall()
    areas = conn.execute(
        "select coalesce(ws.village, 'Unnamed area') as area, count(*) as sources,"
        " sum((select count(*) from test_records t where t.source_id = ws.id and t.created_at > ?)) as recent,"
        " sum((select count(*) from reports r where r.source_id = ws.id and r.status <> 'closed')) as open_issues"
        " from water_sources ws group by 1 order by 3 desc, 1", (since,)).fetchall()
    return {"field_workers": [{"rank": n + 1, "display_name": display_name(w["full_name"]), "area": w["region"],
                               "points": w["points"], "on_time_screenings": w["on_time"], "screenings": w["tests"]}
                              for n, w in enumerate(workers)],
            "areas": [{"rank": n + 1, "area": a["area"], "sources": a["sources"], "screenings_30d": a["recent"] or 0,
                       "open_issues": a["open_issues"] or 0} for n, a in enumerate(areas)],
            "disclaimer": LEADERBOARD_NOTE}


@public.get("/stats")
def public_stats(conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    since = (now - timedelta(weeks=13)).isoformat()
    return build_stats(
        now,
        [tuple(r) for r in conn.execute("select created_at, computed_risk_level from test_records where created_at > ?", (since,))],
        [(r[0], r[1], 0) for r in conn.execute("select created_at, closed_at from reports")],
        [tuple(r) for r in conn.execute("select submitted_at, complaint_type from complaints where submitted_at > ?", (since,))],
        [tuple(r) for r in conn.execute("select source_type, current_public_status from water_sources")])


@staff_router.get("/me")
def staff_me(staff: Staff = Depends(require_staff), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    return {**staff.model_dump(), "org_id": None, "points": points_summary(conn, staff.profile_id)}


@staff_router.get("/kits")
def kits(staff: Staff = Depends(require_staff), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    out = []
    for k in conn.execute("select * from test_kits where active order by name"):
        params = conn.execute("select rp.* from kit_parameters kp join reading_parameters rp on rp.key = kp.parameter"
                              " where kp.kit_id = ? order by kp.position, rp.key", (k["id"],)).fetchall()
        if params:
            out.append({"kit_id": k["id"], "name": k["name"], "strip_type": k["strip_type"], "dip_instruction": k["dip_instruction"],
                        "wait_seconds": k["timing_window_sec"], "read_grace_seconds": k["read_grace_sec"],
                        "protocol": json.loads(k["protocol"]) if k["protocol"] else [],
                        "parameters": [{"key": p["key"], "label": p["label"], "unit": p["unit"], "input_kind": p["input_kind"],
                                        "min": p["min_value"], "max": p["max_value"], "ok_min": p["ok_min"], "ok_max": p["ok_max"],
                                        "watch_min": p["watch_min"], "watch_max": p["watch_max"], "tip": p["tip"],
                                        "basis": p["basis"]} for p in params]})
    criteria = conn.execute("select key, category, question, tip from inspection_criteria order by category desc, position").fetchall()
    return {"items": out, "points_rule": POINTS_RULE,
            "inspection_criteria": [{"key": c["key"], "category": c["category"], "question": c["question"], "tip": c["tip"]}
                                    for c in criteria],
            "notice": "Bands are screening bands, not a laboratory result."}


@staff_router.get("/sources")
def sources(staff: Staff = Depends(require_staff), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    rows = conn.execute("select * from water_sources where team_id = ? order by name", (staff.team_id,)).fetchall()
    return {"items": [{"source_id": r["id"], "name": r["name"], "source_type": r["source_type"], "latitude": r["latitude"],
                       "longitude": r["longitude"], "location_source": r["location_source"],
                       "location_accuracy_m": r["location_accuracy_m"], "current_risk_level": r["current_risk_level"],
                       "current_public_status": r["current_public_status"], "village": r["village"], "ward": r["ward"],
                       "updated_at": r["created_at"]} for r in rows]}


@staff_router.post("/sources", status_code=201)
def create_source(body: SourceRequest, staff: Staff = Depends(require_staff), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    if staff.team_id is None:
        raise ApiError("FORBIDDEN", "Your account has no team.")
    manual = body.location_source == "manual_override"
    if manual and staff.role != "supervisor":
        raise ApiError("FORBIDDEN", "A supervisor must approve a manual location. Use the phone's GPS instead.")
    sid = str(uuid.uuid4())
    with Tx(conn):
        conn.execute("insert into water_sources (id, team_id, name, source_type, latitude, longitude, location_source,"
                     " location_accuracy_m, village, ward, current_risk_level, current_public_status, created_at)"
                     " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', 'not_tested', ?)",
                     (sid, staff.team_id, body.name, body.source_type, body.latitude, body.longitude, body.location_source,
                      None if manual else body.location_accuracy_m, body.village, body.ward, _now()))
        audit(conn, staff.profile_id, "water_sources", sid, "source_created", {"location_source": body.location_source})
    return {"source_id": sid, "location_source": body.location_source, "location_auto_pinned": not manual}


@staff_router.patch("/sources/{source_id}")
def update_source(source_id: str, body: SourceUpdate, staff: Staff = Depends(supervisor),
                  conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise ApiError("VALIDATION_FAILED", "Nothing to change.")
    with Tx(conn):
        sid = _uuid(source_id, "Water source")
        if one(conn, "select 1 from water_sources where id = ? and team_id = ?", sid, staff.team_id) is None:
            raise ApiError("NOT_FOUND", "Water source not found.")
        conn.execute(f"update water_sources set {', '.join(f'{k} = ?' for k in fields)} where id = ?", (*fields.values(), sid))
        audit(conn, staff.profile_id, "water_sources", sid, "source_edited", fields)
    return {"source_id": sid, **fields}


@staff_router.post("/test-records")
def push_test_record(body: TestRecordRequest, response: Response, staff: Staff = Depends(require_staff),
                     conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        sid = _uuid(body.source_id, "Water source")
        if one(conn, "select 1 from water_sources where id = ? and team_id = ?", sid, staff.team_id) is None:
            raise ApiError("NOT_FOUND", "Water source not found.")
        kit = one(conn, "select * from test_kits where id = ? and active", str(body.kit_id))
        if kit is None:
            raise ApiError("VALIDATION_FAILED", "Unknown or retired test kit.", field_errors={"kit_id": "not found"})
        params = {p["key"]: p for p in conn.execute("select rp.* from kit_parameters kp join reading_parameters rp"
                                                   " on rp.key = kp.parameter where kp.kit_id = ?", (kit["id"],))}
        assessment = None
        if body.readings is not None:
            errors = {}
            for key, value in body.readings.items():
                p = params.get(key)
                if p is None:
                    errors[f"readings.{key}"] = "not measured by this kit"
                elif p["input_kind"] == "presence" and value not in (0, 1):
                    errors[f"readings.{key}"] = "0 (absent) or 1 (present)"
                elif not p["min_value"] <= value <= p["max_value"]:
                    errors[f"readings.{key}"] = f"between {p['min_value']:g} and {p['max_value']:g}"
            if errors:
                raise ApiError("VALIDATION_FAILED", "Check the readings.", field_errors=errors)
            assessment = assess(conn, body.readings)
        risk = assessment["risk_level"] if assessment else body.computed_risk_level
        inspection = judge([(c["key"], c["category"]) for c in conn.execute("select key, category from inspection_criteria")],
                           body.inspection) if body.inspection is not None else None
        risk, assessment = combine(assessment, risk, inspection)
        existing = one(conn, "select * from test_records where local_record_id = ?", str(body.local_record_id))
        if existing is not None:
            same = (existing["source_id"] == sid and existing["performed_by"] == staff.profile_id and existing["kit_id"] == kit["id"]
                    and existing["computed_risk_level"] == risk
                    and json.loads(existing["readings"] or "null") == (body.readings or None)
                    and json.loads(existing["inspection"] or "null") == body.inspection)
            if not same:
                raise ApiError("IDEMPOTENCY_MISMATCH", "This local_record_id was already used for a different test.")
            record_id, outcome = existing["id"], "duplicate"
        else:
            record_id, outcome = str(uuid.uuid4()), "accepted"
            photo = store_upload(conn, body.photo, staff.profile_id, images_only=True) if body.photo else None
            extra = [store_upload(conn, x, staff.profile_id, images_only=True) for x in body.extra_photos] if photo else []
            conn.execute("insert into test_records (id, local_record_id, source_id, performed_by, kit_id, method, dropdown_selection,"
                         " raw_input, autofill_calculation, computed_risk_level, rule_assessment, readings, photo_url,"
                         " dip_started_at, read_at, created_at, inspection, extra_photo_urls)"
                         " values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (record_id, str(body.local_record_id), sid, staff.profile_id, kit["id"], body.method,
                          body.dropdown_selection, json.dumps(body.raw_input) if body.raw_input is not None else None,
                          json.dumps(body.autofill_calculation) if body.autofill_calculation is not None else None, risk,
                          json.dumps(assessment) if assessment else None, json.dumps(body.readings) if body.readings else None,
                          photo, body.dip_started_at.isoformat() if body.dip_started_at else None,
                          body.read_at.isoformat() if body.read_at else None, _now(),
                          json.dumps(body.inspection) if body.inspection is not None else None, json.dumps(extra)))
            conn.execute("update water_sources set current_risk_level = ? where id = ?", (risk, sid))
            if risk in ("medium", "high"):
                new_report(conn, sid, record_id, risk, "screening", staff.profile_id)
            # The points rule (006 award_screening_points).
            elapsed = (body.read_at - body.dip_started_at).total_seconds() if body.read_at and body.dip_started_at else None
            if (staff.role == "field_worker" and photo and elapsed is not None and kit["timing_window_sec"] is not None
                    and params and all(k in (body.readings or {}) for k in params)
                    and kit["timing_window_sec"] <= elapsed <= kit["timing_window_sec"] + kit["read_grace_sec"]):
                conn.execute("insert or ignore into points_ledger (profile_id, points, reason, related_test_record_id, awarded_at)"
                             " values (?, 10, 'screening_on_time', ?, ?)", (staff.profile_id, record_id, _now()))
    report = one(conn, "select id from reports where test_record_id = ? and not is_re_report", record_id)
    awarded = one(conn, "select 1 from points_ledger where related_test_record_id = ?", record_id) is not None
    response.status_code = 201 if outcome == "accepted" else 200
    return {"test_record_id": record_id, "outcome": outcome, "report_id": report["id"] if report else None,
            "risk_level": risk, "assessment": assessment, "points_awarded": 10 if awarded else 0,
            "points": points_summary(conn, staff.profile_id)}


def _report_json(r: sqlite3.Row, source_name: str) -> dict[str, Any]:
    return {"report_id": r["id"], "source_id": r["source_id"], "source_name": source_name, "test_record_id": r["test_record_id"],
            "risk_level": r["risk_level"], "status": r["status"], "version": r["version"], "is_re_report": bool(r["is_re_report"]),
            "previous_report_id": r["previous_report_id"], "created_at": r["created_at"], "closed_at": r["closed_at"],
            "closure_reason": r["closure_reason"], "origin": r["origin"]}


@staff_router.get("/reports")
def list_reports(status: str | None = Query(None), staff: Staff = Depends(require_staff),
                 conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    rows = conn.execute("select r.*, ws.name as source_name from reports r join water_sources ws on ws.id = r.source_id"
                        " where ws.team_id = ? and (? is null or r.status = ?) order by r.created_at desc limit 200",
                        (staff.team_id, status, status)).fetchall()
    return {"items": [_report_json(r, r["source_name"]) for r in rows]}


@staff_router.get("/reports/{report_id}")
def report_detail(report_id: str, staff: Staff = Depends(require_staff), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    r = team_report(conn, staff, report_id)
    rid = r["id"]
    t = one(conn, "select * from test_records where id = ?", r["test_record_id"]) if r["test_record_id"] else None
    loads = lambda v: json.loads(v) if v else None  # noqa: E731
    child = one(conn, "select id, status from reports where previous_report_id = ?", rid)
    history = conn.execute(
        "select * from audit_log where entity_id = ? or entity_id in (select id from lab_referrals where report_id = ?)"
        " or entity_id in (select id from process_photos where report_id = ?)"
        " or entity_id in (select id from complaints where linked_report_id = ?) order by at, id limit 500",
        (rid, rid, rid, rid)).fetchall()
    return {
        **_report_json(r, one(conn, "select name from water_sources where id = ?", r["source_id"])["name"]),
        "test": {"method": t["method"], "dropdown_selection": t["dropdown_selection"], "human_observation": loads(t["raw_input"]),
                 "machine_suggestion": loads(t["autofill_calculation"]), "computed_risk_level": t["computed_risk_level"],
                 "performed_by": t["performed_by"], "rule_assessment": loads(t["rule_assessment"]), "photo": t["photo_url"],
                 "readings": loads(t["readings"]), "dip_started_at": t["dip_started_at"], "read_at": t["read_at"],
                 "extra_photos": loads(t["extra_photo_urls"]) or []} if t else None,
        "lab_referrals": [{"lab_referral_id": lr["id"], "lab_name": lr["lab_name"], "verification_status": lr["verification_status"],
                           "re_report_requested": bool(lr["re_report_requested"]), "result_file": lr["result_file_url"],
                           "verified_by": lr["verified_by"], "verified_at": lr["verified_at"], "sent_at": lr["sent_at"]}
                          for lr in conn.execute("select * from lab_referrals where report_id = ? order by sent_at", (rid,))],
        "photos": [{"photo_id": p["id"], "photo": p["photo_url"], "process_stage": p["process_stage"],
                    "inspection_level": p["inspection_level"], "uploaded_at": p["uploaded_at"]}
                   for p in conn.execute("select * from process_photos where report_id = ? order by uploaded_at", (rid,))],
        "linked_complaints": [{"complaint_id": c["id"], "reference_number": c["reference_number"],
                               "complaint_type": c["complaint_type"], "status": c["status"]}
                              for c in conn.execute("select * from complaints where linked_report_id = ? order by submitted_at", (rid,))],
        "re_report": {"report_id": child["id"], "status": child["status"]} if child else None,
        "history": [{"id": h["id"], "at": h["at"], "actor": h["actor_id"], "entity": h["entity_type"], "action": h["action"],
                     "details": loads(h["after_data"])} for h in history],
        "communications": [{"id": m["id"], "channel": m["channel"], "message": m["message"], "sent_at": m["sent_at"],
                            "delivery_status": m["delivery_status"]}
                           for m in conn.execute("select * from notifications where related_report_id = ? order by sent_at", (rid,))],
    }


ALLOWED = {("open", "under_review"), ("open", "action_taken"), ("sent_to_lab", "under_review"), ("sent_to_lab", "action_taken"),
           ("under_review", "action_taken"), ("action_taken", "under_review")}


@staff_router.post("/reports/{report_id}/transition")
def transition(report_id: str, body: TransitionRequest, staff: Staff = Depends(supervisor),
               conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        r = team_report(conn, staff, report_id)
        check_version(r, body.version)
        if body.to == "closed":
            raise ApiError("CASE_TRANSITION_ILLEGAL", "Close a report with the close action.")
        if body.to == "sent_to_lab":
            raise ApiError("CASE_TRANSITION_ILLEGAL", "Send a report to a lab by creating a lab referral.")
        if (r["status"], body.to) not in ALLOWED:
            raise ApiError("CASE_TRANSITION_ILLEGAL", "That status change is not allowed from the current status.")
        version = update_report(conn, r["id"], status=body.to)
        audit(conn, staff.profile_id, "reports", r["id"], "transition", {"status": body.to, "version": version})
    return {"report_id": r["id"], "status": body.to, "version": version}


@staff_router.post("/reports/{report_id}/close")
def close(report_id: str, body: CloseRequest, staff: Staff = Depends(supervisor), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        r = team_report(conn, staff, report_id)
        rid = r["id"]
        check_version(r, body.version)
        if r["status"] != "action_taken":
            raise ApiError("CASE_TRANSITION_ILLEGAL", "That status change is not allowed from the current status.")
        if len(body.closure_reason.strip()) < 10:
            raise ApiError("VALIDATION_FAILED", "Give a closure reason of at least 10 characters.")
        labs = [lr["verification_status"] for lr in conn.execute("select verification_status from lab_referrals where report_id = ?", (rid,))]
        if "verified" not in labs:
            if "uploaded" in labs:
                raise ApiError("LAB_REPORT_NOT_VERIFIED", "The lab result is uploaded but not verified.")
            raise ApiError("LAB_RESULT_MISSING", "No lab result has been recorded yet.")
        if one(conn, "select 1 from process_photos where report_id = ? and process_stage in ('corrective_action', 'closure')", rid) is None:
            raise ApiError("ACTION_EVIDENCE_MISSING", "Add a corrective-action or closure photo first.")
        if one(conn, "select 1 from reports where previous_report_id = ? and status <> 'closed'", rid):
            raise ApiError("RE_REPORT_OPEN", "The re-report the lab asked for is still open.")
        version = update_report(conn, rid, status="closed", closed_at=_now(), closure_reason=body.closure_reason.strip())
        conn.execute("update complaints set status = 'resolved', resolution = 'case_closed', version = version + 1"
                     " where linked_report_id = ? and status = 'linked'", (rid,))
        audit(conn, staff.profile_id, "reports", rid, "closed", {"closure_reason": body.closure_reason.strip(), "version": version})
    return {"report_id": rid, "status": "closed", "version": version}


@staff_router.post("/reports/{report_id}/lab-referrals", status_code=201)
def refer(report_id: str, body: ReferralRequest, staff: Staff = Depends(supervisor), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        r = team_report(conn, staff, report_id)
        check_version(r, body.version)
        if r["status"] not in ("open", "under_review", "sent_to_lab"):
            raise ApiError("CASE_TRANSITION_ILLEGAL", "That status change is not allowed from the current status.")
        lid = str(uuid.uuid4())
        conn.execute("insert into lab_referrals (id, report_id, lab_name, sent_at) values (?, ?, ?, ?)",
                     (lid, r["id"], body.lab_name.strip(), _now()))
        update_report(conn, r["id"], status="sent_to_lab")
        audit(conn, staff.profile_id, "lab_referrals", lid, "referred", {"lab_name": body.lab_name.strip()})
    return {"lab_referral_id": lid, "verification_status": "pending"}


def _team_referral(conn: sqlite3.Connection, staff: Staff, referral_id: str) -> tuple[sqlite3.Row, sqlite3.Row]:
    lr = one(conn, "select * from lab_referrals where id = ?", _uuid(referral_id, "Lab referral"))
    if lr is None:
        raise ApiError("NOT_FOUND", "Lab referral not found.")
    return lr, team_report(conn, staff, lr["report_id"])


@staff_router.post("/lab-referrals/{referral_id}/result")
def record_result(referral_id: str, body: Upload, staff: Staff = Depends(require_staff),
                  conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        lr, r = _team_referral(conn, staff, referral_id)
        if lr["verification_status"] != "pending":
            raise ApiError("LAB_RESULT_ALREADY_RECORDED", "A result is already recorded for this referral.")
        url = store_upload(conn, body, staff.profile_id, images_only=False)
        conn.execute("update lab_referrals set result_file_url = ?, verification_status = 'uploaded', recorded_by = ? where id = ?",
                     (url, staff.profile_id, lr["id"]))
        if r["status"] == "sent_to_lab":
            update_report(conn, r["id"], status="under_review")
        audit(conn, staff.profile_id, "lab_referrals", lr["id"], "lab_result_recorded")
    return {"lab_referral_id": lr["id"], "verification_status": "uploaded", "result_file": url,
            "result_file_available": body.content_type != "application/pdf"}


@staff_router.post("/lab-referrals/{referral_id}/verify")
def verify(referral_id: str, body: VerifyRequest, staff: Staff = Depends(supervisor), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    child = None
    with Tx(conn):
        lr, r = _team_referral(conn, staff, referral_id)
        if lr["verification_status"] in ("verified", "rejected"):
            raise ApiError("LAB_REPORT_DECIDED", "This lab result was already verified or rejected.")
        if lr["verification_status"] != "uploaded" or not lr["result_file_url"]:
            raise ApiError("LAB_RESULT_MISSING", "No lab result has been recorded yet.")
        blob = one(conn, "select availability from blobs where 'blob:' || id = ?", lr["result_file_url"])
        if blob is not None and blob["availability"] != "available":
            raise ApiError("EVIDENCE_NOT_AVAILABLE", "This file is quarantined (no malware scan is available) and cannot be verified.")
        if lr["recorded_by"] == staff.profile_id:
            raise ApiError("VERIFICATION_SELF_REVIEW", "Whoever recorded a lab result cannot verify it.")
        conn.execute("update lab_referrals set verification_status = ?, verified_by = ?, verified_at = ?, re_report_requested = ?"
                     " where id = ?", (body.decision, staff.profile_id, _now(), int(body.re_report_requested), lr["id"]))
        if body.re_report_requested and one(conn, "select 1 from reports where previous_report_id = ?", r["id"]) is None:
            child = new_report(conn, r["source_id"], r["test_record_id"], r["risk_level"], r["origin"], staff.profile_id, r["id"])
        audit(conn, staff.profile_id, "lab_referrals", lr["id"], f"lab_{body.decision}",
              {"re_report_requested": body.re_report_requested})
    return {"lab_referral_id": lr["id"], "verification_status": body.decision, "re_report_id": child}


@staff_router.post("/reports/{report_id}/photos", status_code=201)
def add_photo(report_id: str, body: PhotoRequest, staff: Staff = Depends(require_staff),
              conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    level = body.inspection_level or ("field" if staff.role == "field_worker" else "supervisor")
    if staff.role == "field_worker" and level != "field":
        raise ApiError("FORBIDDEN", "Field workers record field-level inspection photos.")
    with Tx(conn):
        r = team_report(conn, staff, report_id)
        url = store_upload(conn, body, staff.profile_id, images_only=True)
        pid = str(uuid.uuid4())
        conn.execute("insert into process_photos (id, report_id, source_id, photo_url, process_stage, inspection_level,"
                     " uploaded_by, uploaded_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
                     (pid, r["id"], r["source_id"], url, body.process_stage, level, staff.profile_id, _now()))
        audit(conn, staff.profile_id, "reports", r["id"], "photo_added", {"process_stage": body.process_stage})
    return {"photo_id": pid, "photo": url, "process_stage": body.process_stage, "inspection_level": level}


@staff_router.get("/blobs/{blob_id}")
def get_blob(blob_id: str, staff: Staff = Depends(require_staff), conn: sqlite3.Connection = Depends(db)) -> Response:
    url = f"blob:{_uuid(blob_id, 'File')}"
    team = staff.team_id
    visible = conn.execute(
        "select 1 where exists (select 1 from test_records t join water_sources ws on ws.id = t.source_id"
        "  where (t.photo_url = :u or exists (select 1 from json_each(coalesce(t.extra_photo_urls, '[]')) where value = :u))"
        "  and ws.team_id = :t)"
        " or exists (select 1 from process_photos p join water_sources ws on ws.id = p.source_id where p.photo_url = :u and ws.team_id = :t)"
        " or exists (select 1 from lab_referrals l join reports r on r.id = l.report_id join water_sources ws on ws.id = r.source_id"
        "  where l.result_file_url = :u and ws.team_id = :t)"
        " or (:sup and exists (select 1 from complaints c left join water_sources ws on ws.id = c.source_id"
        "  where (c.photo_url = :u or exists (select 1 from json_each(coalesce(c.extra_photo_urls, '[]')) where value = :u))"
        "  and (c.source_id is null or ws.team_id = :t)))",
                  {"u": url, "t": team, "sup": int(staff.role == "supervisor")}).fetchone()
    blob = one(conn, "select * from blobs where 'blob:' || id = ?", url) if visible else None
    if blob is None:
        raise ApiError("NOT_FOUND", "File not found.")
    if blob["availability"] != "available":
        raise ApiError("EVIDENCE_NOT_AVAILABLE", "This file is quarantined: no malware scan is available.")
    return Response(content=bytes(blob["data"]), media_type=blob["content_type"],
                    headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


@staff_router.get("/photos/recent")
def recent_photos(limit: int = Query(60, ge=1, le=200), staff: Staff = Depends(require_staff),
                  conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    photos = ("with photos(owner, url, n) as ("
              " select 'c' || c.id, c.photo_url, 1 from complaints c where c.photo_url is not null"
              " union all select 'c' || c.id, j.value, j.key + 2 from complaints c, json_each(coalesce(c.extra_photo_urls, '[]')) j"
              " union all select 't' || t.id, t.photo_url, 1 from test_records t where t.photo_url is not null"
              " union all select 't' || t.id, j.value, j.key + 2 from test_records t, json_each(coalesce(t.extra_photo_urls, '[]')) j)")
    rows = conn.execute(photos + """
        select * from (
          select 'complaint', c.id, c.linked_report_id, c.source_id, coalesce(ws.name, 'No source named'), p.url, p.n,
                 c.submitted_at as at, c.reference_number || ' · ' || replace(c.complaint_type, '_', ' '), c.description, c.status
            from complaints c join photos p on p.owner = 'c' || c.id left join water_sources ws on ws.id = c.source_id
           where :sup and (c.source_id is null or ws.team_id = :t)
          union all
          select 'screening', t.id, (select r.id from reports r where r.test_record_id = t.id limit 1), t.source_id, ws.name,
                 p.url, p.n, coalesce(t.created_at, t.read_at), 'Screening · ' || coalesce(t.computed_risk_level, 'recorded') || ' risk',
                 null, t.computed_risk_level
            from test_records t join photos p on p.owner = 't' || t.id join water_sources ws on ws.id = t.source_id
           where ws.team_id = :t
          union all
          select 'field', ph.id, ph.report_id, ph.source_id, ws.name, ph.photo_url, 1, ph.uploaded_at,
                 replace(ph.process_stage, '_', ' ') || ' photo', coalesce(ph.inspection_level, 'field') || ' inspection', null
            from process_photos ph join water_sources ws on ws.id = ph.source_id
           where ws.team_id = :t and ph.photo_url is not null
        ) order by at desc, 7 limit :limit""", {"sup": int(staff.role == "supervisor"), "t": staff.team_id, "limit": limit}).fetchall()
    return {"items": [_photo_json(tuple(r)) for r in rows]}


@staff_router.get("/complaints")
def list_complaints(status: str | None = Query(None), staff: Staff = Depends(supervisor),
                    conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    rows = conn.execute("select c.*, ws.name as source_name from complaints c left join water_sources ws on ws.id = c.source_id"
                        " where (c.source_id is null or ws.team_id = ?) and (? is null or c.status = ?)"
                        " order by (c.status = 'new') desc, (c.complaint_type = 'illness') desc, c.submitted_at desc limit 200",
                        (staff.team_id, status, status)).fetchall()
    return {"items": [{"complaint_id": r["id"], "reference_number": r["reference_number"], "complaint_type": r["complaint_type"],
                       "status": r["status"], "resolution": r["resolution"], "source_id": r["source_id"],
                       "source_name": r["source_name"], "description": r["description"], "photo": r["photo_url"],
                       "linked_report_id": r["linked_report_id"], "submitted_at": r["submitted_at"],
                       "linked_at": r["linked_at"], "version": r["version"], "also": json.loads(r["also"] or "[]"),
                       "extra_photos": json.loads(r["extra_photo_urls"] or "[]")} for r in rows]}


@staff_router.post("/complaints/{complaint_id}/review")
def review(complaint_id: str, body: ReviewRequest, staff: Staff = Depends(supervisor),
           conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        c = one(conn, "select c.* from complaints c left join water_sources ws on ws.id = c.source_id"
                      " where c.id = ? and (c.source_id is null or ws.team_id = ?)", _uuid(complaint_id, "Complaint"), staff.team_id)
        if c is None:
            raise ApiError("NOT_FOUND", "Complaint not found.")
        if c["status"] != "new":
            raise ApiError("COMPLAINT_ALREADY_REVIEWED", "This complaint was already linked or resolved.")
        report = None
        if body.action == "link":
            r = team_report(conn, staff, body.report_id)
            if r["status"] == "closed":
                raise ApiError("CASE_TRANSITION_ILLEGAL", "That report is closed; link the complaint to an open one.")
            if c["source_id"] and r["source_id"] != c["source_id"]:
                raise ApiError("VALIDATION_FAILED", "The report is about a different water source than the complaint.")
            check_version(r, body.version)
            update_report(conn, r["id"])
            report = r["id"]
        elif body.action == "open_report":
            if not c["source_id"]:
                raise ApiError("VALIDATION_FAILED", "This complaint names no water source; link it to a report instead.")
            report = new_report(conn, c["source_id"], None, body.risk_level, "resident", staff.profile_id)
        if report:
            conn.execute("update complaints set status = 'linked', linked_report_id = ?, linked_at = ?, linked_by = ?,"
                         " version = version + 1 where id = ?", (report, _now(), staff.profile_id, c["id"]))
            status = "linked"
        else:
            conn.execute("update complaints set status = 'resolved', resolution = 'dismissed', version = version + 1 where id = ?", (c["id"],))
            status = "resolved"
        audit(conn, staff.profile_id, "complaints", c["id"], f"review_{body.action}", {"status": status, "linked_report_id": report})
    return {"complaint_id": c["id"], "status": status, "report_id": report}


@staff_router.get("/team")
def team(staff: Staff = Depends(supervisor), conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    rows = conn.execute(
        "select p.*, (select count(*) from test_records t where t.performed_by = p.id) as tests,"
        " (select count(*) from reports r join test_records t on t.id = r.test_record_id where t.performed_by = p.id and not r.is_re_report) as raised,"
        " (select count(*) from points_ledger l where l.profile_id = p.id and l.reason = 'screening_on_time') as on_time,"
        " (select coalesce(sum(points), 0) from points_ledger l where l.profile_id = p.id) as balance"
        " from profiles p where p.team_id = ? order by p.role desc, p.full_name", (staff.team_id,)).fetchall()
    return {"items": [{"profile_id": r["id"], "email": r["email"], "full_name": r["full_name"], "role": r["role"],
                       "active": bool(r["active"]), "points_balance": r["balance"], "tests": r["tests"],
                       "reports_raised": r["raised"], "on_time_screenings": r["on_time"]} for r in rows]}


@staff_router.post("/reports/{report_id}/notes", status_code=201)
def add_note(report_id: str, body: NoteRequest, staff: Staff = Depends(require_staff),
             conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        r = team_report(conn, staff, report_id)
        audit(conn, staff.profile_id, "reports", r["id"], "note", {"text": body.text.strip()})
    return {"report_id": r["id"], "note": body.text.strip()}


@staff_router.post("/reports/{report_id}/communications", status_code=201)
def log_communication(report_id: str, body: CommunicationRequest, staff: Staff = Depends(supervisor),
                      conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    if body.delivery_status != "queued" and body.sent_at is None:
        raise ApiError("VALIDATION_FAILED", "Say when the message was sent.", field_errors={"sent_at": "required"})
    with Tx(conn):
        r = team_report(conn, staff, report_id)
        nid = str(uuid.uuid4())
        conn.execute("insert into notifications (id, related_report_id, channel, message, sent_at, delivery_status)"
                     " values (?, ?, ?, ?, ?, ?)", (nid, r["id"], body.channel, body.message,
                                                     body.sent_at.isoformat() if body.sent_at else None, body.delivery_status))
        audit(conn, staff.profile_id, "reports", r["id"], "communication_logged",
              {"channel": body.channel, "delivery_status": body.delivery_status})
    return {"communication_id": nid, "delivery_status": body.delivery_status}


@staff_router.post("/reports/{report_id}/re-report", status_code=201)
def request_re_report(report_id: str, body: VersionRequest, staff: Staff = Depends(supervisor),
                      conn: sqlite3.Connection = Depends(db)) -> dict[str, Any]:
    with Tx(conn):
        r = team_report(conn, staff, report_id)
        check_version(r, body.version)
        if r["status"] == "closed":
            raise ApiError("CASE_TRANSITION_ILLEGAL", "That report is closed; link the complaint to an open one.")
        if one(conn, "select 1 from reports where previous_report_id = ?", r["id"]):
            raise ApiError("CASE_TRANSITION_ILLEGAL", "A follow-up sample (re-report) was already requested for this case.")
        child = new_report(conn, r["source_id"], r["test_record_id"], r["risk_level"], r["origin"], staff.profile_id, r["id"])
        update_report(conn, r["id"])
        audit(conn, staff.profile_id, "reports", r["id"], "re_report_requested", {"re_report_id": child})
    return {"report_id": r["id"], "re_report_id": child}


def build_local_app() -> FastAPI:
    app = FastAPI(title="JalSakshi API (internal database)")
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    for router in (auth_router, public, staff_router):
        app.include_router(router)

    @app.api_route("/{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])
    def unavailable(rest: str) -> None:
        raise ApiError("TEMPORARILY_UNAVAILABLE", "Not available while the cloud database is unreachable.")

    return app
