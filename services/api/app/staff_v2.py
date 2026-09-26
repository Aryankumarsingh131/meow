"""Staff (supervisor / field worker) routes over the public-v2 tables: the
erd.md flows - water sources (flow 8), test records -> reports (flows 1-2),
labs and the re-report loop (flow 3), process photos (flow 4), notifications
(flow 5), resident complaint review - plus the Pluccy kit config and the
field-worker points summary (006).

Identity: the same verified token as /v1 (dev issuer or Supabase Auth); its
`sub` is `profiles.auth_user_id`. Every state change goes through a guarded
function in 004/006, which re-checks role and team itself; this module never
writes report/lab/complaint state directly. Another team's object is 404,
indistinguishable from a missing one.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import BaseModel, Field, model_validator

from .errors import ApiError
from .public_v2 import TestPayload, Upload, insert_test_record, pg, store_upload, verified_subject

router = APIRouter(prefix="/v1/staff", tags=["staff"])

MILESTONES = (10, 50, 100)
POINTS_RULE = ("+10 points for a screening with every reading the kit asks for, a photo, and the strip read "
               "after the kit's wait time and within the grace period after it.")


class Staff(BaseModel):
    profile_id: str
    role: Literal["supervisor", "field_worker"]
    team_id: str | None
    org_id: str | None


def require_staff(request: Request, authorization: str | None = Header(default=None),
                  conn: Any = Depends(pg)) -> Staff:
    subject = verified_subject(request, authorization)
    row = conn.execute(
        "select id::text, role, team_id::text, org_id::text from public.profiles"
        " where auth_user_id = %s and active and role in ('supervisor', 'field_worker')", (subject,)).fetchone()
    if row is None:
        raise ApiError("FORBIDDEN", "No active staff profile for this account.")
    return Staff(profile_id=row[0], role=row[1], team_id=row[2], org_id=row[3])


def supervisor(staff: Staff = Depends(require_staff)) -> Staff:
    if staff.role != "supervisor":
        raise ApiError("FORBIDDEN", "Supervisors only.")
    return staff


# Guarded-function exception message -> (API code, detail).
DB_ERRORS: dict[str, tuple[str, str]] = {
    "forbidden": ("FORBIDDEN", "Your role or team cannot do this."),
    "report_not_found": ("NOT_FOUND", "Report not found."),
    "lab_referral_not_found": ("NOT_FOUND", "Lab referral not found."),
    "complaint_not_found": ("NOT_FOUND", "Complaint not found."),
    "source_not_found": ("NOT_FOUND", "Water source not found."),
    "redemption_not_found": ("NOT_FOUND", "Redemption not found."),
    "version_conflict": ("CASE_VERSION_CONFLICT", "Someone else changed this report. Reload it and try again."),
    "transition_illegal": ("CASE_TRANSITION_ILLEGAL", "That status change is not allowed from the current status."),
    "use_close_report": ("CASE_TRANSITION_ILLEGAL", "Close a report with the close action."),
    "use_refer_to_lab": ("CASE_TRANSITION_ILLEGAL", "Send a report to a lab by creating a lab referral."),
    "closure_reason_required": ("VALIDATION_FAILED", "Give a closure reason of at least 10 characters."),
    "lab_name_required": ("VALIDATION_FAILED", "Name the lab."),
    "lab_result_missing": ("LAB_RESULT_MISSING", "No lab result has been recorded yet."),
    "lab_not_verified": ("LAB_REPORT_NOT_VERIFIED", "The lab result is uploaded but not verified."),
    "lab_result_quarantined": ("EVIDENCE_NOT_AVAILABLE",
                               "This file is quarantined (no malware scan is available) and cannot be verified."),
    "lab_result_already_recorded": ("LAB_RESULT_ALREADY_RECORDED", "A result is already recorded for this referral."),
    "lab_referral_decided": ("LAB_REPORT_DECIDED", "This lab result was already verified or rejected."),
    "self_review": ("VERIFICATION_SELF_REVIEW", "Whoever recorded a lab result cannot verify it."),
    "action_evidence_missing": ("ACTION_EVIDENCE_MISSING", "Add a corrective-action or closure photo first."),
    "re_report_open": ("RE_REPORT_OPEN", "The re-report the lab asked for is still open."),
    "re_report_exists": ("CASE_TRANSITION_ILLEGAL", "A follow-up sample (re-report) was already requested for this case."),
    "complaint_not_new": ("COMPLAINT_ALREADY_REVIEWED", "This complaint was already linked or resolved."),
    "report_closed": ("CASE_TRANSITION_ILLEGAL", "That report is closed; link the complaint to an open one."),
    "source_mismatch": ("VALIDATION_FAILED", "The report is about a different water source than the complaint."),
    "complaint_needs_source": ("VALIDATION_FAILED", "This complaint names no water source; link it to a report instead."),
    "risk_level_invalid": ("VALIDATION_FAILED", "Choose a risk level: low, medium or high."),
    "source_has_open_reports": ("CASE_TRANSITION_ILLEGAL", "Close every open report on this source first."),
    "override_approver_must_be_supervisor": ("FORBIDDEN", "A supervisor must approve a manual location."),
}


def guarded(conn: Any, sql: str, args: tuple) -> Any:
    """Run one guarded function call and commit; map its refusal to an ApiError."""
    try:
        row = conn.execute(sql, args).fetchone()
    except psycopg.errors.RaiseException as exc:
        conn.rollback()
        mapped = DB_ERRORS.get(str(exc).split("\n")[0].strip())
        if mapped is None:
            raise
        raise ApiError(*mapped) from None
    conn.commit()
    return row[0] if row else None


def _id(value: str, what: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise ApiError("NOT_FOUND", f"{what} not found.") from None


def _team_source(conn: Any, staff: Staff, source_id: str) -> str:
    sid = _id(source_id, "Water source")
    if conn.execute("select 1 from public.water_sources where id = %s and team_id = %s",
                    (sid, staff.team_id)).fetchone() is None:
        raise ApiError("NOT_FOUND", "Water source not found.")
    return sid


def points_summary(conn: Any, profile_id: str) -> dict[str, Any]:
    """Balance, qualifying screenings, and the streak: consecutive India-time
    days with at least one qualifying screening, ending today or yesterday."""
    balance, qualifying, today = conn.execute(
        "select points_balance, (select count(*) from public.points_ledger where profile_id = %s"
        " and reason = 'screening_on_time'), (now() at time zone 'Asia/Kolkata')::date"
        " from public.profiles where id = %s", (profile_id, profile_id)).fetchone()
    days = [d for (d,) in conn.execute(
        "select distinct (awarded_at at time zone 'Asia/Kolkata')::date as d from public.points_ledger"
        " where profile_id = %s and reason = 'screening_on_time' order by d desc limit 400", (profile_id,)).fetchall()]
    streak = 0
    expect = today if days and days[0] == today else today - timedelta(days=1)
    for day in days:
        if day != expect:
            break
        streak += 1
        expect -= timedelta(days=1)
    return {"points_balance": balance, "qualifying_screenings": qualifying, "streak_days": streak,
            "milestones": list(MILESTONES), "next_milestone": next((m for m in MILESTONES if m > qualifying), None),
            "rule": POINTS_RULE}


@router.get("/me")
def me(staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    return {**staff.model_dump(), "points": points_summary(conn, staff.profile_id)}


@router.get("/kits")
def kits(staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    """Pluccy's config: what to dip, how long to wait, which readings to enter."""
    rows = conn.execute(
        "select k.id::text, k.name, k.strip_type, k.dip_instruction, k.timing_window_sec, k.read_grace_sec, k.protocol,"
        " rp.key, rp.label, rp.unit, rp.input_kind, rp.min_value, rp.max_value, rp.ok_min, rp.ok_max,"
        " rp.watch_min, rp.watch_max, rp.tip, rp.basis"
        " from public.test_kits k join public.kit_parameters kp on kp.kit_id = k.id"
        " join public.reading_parameters rp on rp.key = kp.parameter"
        " where k.active order by k.name, kp.position, rp.key").fetchall()
    num = lambda v: float(v) if v is not None else None  # noqa: E731
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        kit = out.setdefault(r[0], {"kit_id": r[0], "name": r[1], "strip_type": r[2], "dip_instruction": r[3],
                                    "wait_seconds": r[4], "read_grace_seconds": r[5], "protocol": r[6], "parameters": []})
        kit["parameters"].append({"key": r[7], "label": r[8], "unit": r[9], "input_kind": r[10],
                                  "min": num(r[11]), "max": num(r[12]), "ok_min": num(r[13]), "ok_max": num(r[14]),
                                  "watch_min": num(r[15]), "watch_max": num(r[16]), "tip": r[17], "basis": r[18]})
    criteria = conn.execute("select key, category, question, tip from public.inspection_criteria"
                            " order by category desc, position").fetchall()
    return {"items": list(out.values()), "points_rule": POINTS_RULE,
            "inspection_criteria": [{"key": k, "category": c, "question": q, "tip": t} for k, c, q, t in criteria],
            "notice": "Bands are screening bands, not a laboratory result."}


# --- water sources (flow 8) ------------------------------------------------------

class SourceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source_type: Literal["tap", "well", "hand_pump", "tank", "pond", "river", "other"]
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    location_source: Literal["gps_auto", "manual_override"] = "gps_auto"
    location_accuracy_m: float | None = Field(default=None, gt=0, le=100)
    override_reason: str | None = Field(default=None, min_length=10, max_length=500)
    approx_size: str | None = Field(default=None, max_length=120)
    village: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)
    landmark: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def pin_is_explicit(self) -> "SourceRequest":
        if self.location_source == "gps_auto" and self.location_accuracy_m is None:
            raise ValueError("a GPS pin needs the device's location_accuracy_m (at most 100 m)")
        if self.location_source == "manual_override" and self.override_reason is None:
            raise ValueError("a manual pin needs an override_reason")
        return self


@router.post("/sources", status_code=201)
def create_source(body: SourceRequest, staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    if staff.team_id is None:
        raise ApiError("FORBIDDEN", "Your account has no team.")
    manual = body.location_source == "manual_override"
    if manual and staff.role != "supervisor":
        raise ApiError("FORBIDDEN", "A supervisor must approve a manual location. Use the phone's GPS instead.")
    try:
        sid = conn.execute(
            "insert into public.water_sources (name, source_type, location, location_source, location_accuracy_m,"
            " location_overridden_by, location_override_reason, approx_size, village, ward, landmark, team_id, org_id,"
            " created_by) values (%s, %s, public.st_setsrid(public.st_makepoint(%s, %s), 4326)::public.geography,"
            " %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (body.name, body.source_type, body.longitude, body.latitude, body.location_source,
             None if manual else body.location_accuracy_m, staff.profile_id if manual else None,
             body.override_reason if manual else None, body.approx_size, body.village, body.ward, body.landmark,
             staff.team_id, staff.org_id, staff.profile_id)).fetchone()[0]
    except psycopg.errors.RaiseException as exc:
        conn.rollback()
        raise ApiError(*DB_ERRORS.get(str(exc).split("\n")[0].strip(), ("FORBIDDEN", "Refused."))) from None
    conn.commit()
    return {"source_id": str(sid), "location_source": body.location_source, "location_auto_pinned": not manual}


@router.get("/sources")
def list_sources(staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    rows = conn.execute(
        "select id, name, source_type, public.st_y(location::public.geometry), public.st_x(location::public.geometry),"
        " location_source, location_accuracy_m, current_risk_level, current_public_status, village, ward, updated_at"
        " from public.water_sources where team_id = %s order by name", (staff.team_id,)).fetchall()
    return {"items": [{
        "source_id": str(r[0]), "name": r[1], "source_type": r[2], "latitude": r[3], "longitude": r[4],
        "location_source": r[5], "location_accuracy_m": float(r[6]) if r[6] is not None else None,
        "current_risk_level": r[7], "current_public_status": r[8], "village": r[9], "ward": r[10],
        "updated_at": r[11].isoformat()} for r in rows]}


class SourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    village: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)


@router.patch("/sources/{source_id}")
def update_source(source_id: str, body: SourceUpdate, staff: Staff = Depends(supervisor),
                  conn: Any = Depends(pg)) -> dict[str, Any]:
    """Supervisor edit of a source's name and area. The location pin is not
    editable here: it stays GPS-or-approved-override (flow 8)."""
    sid = _team_source(conn, staff, source_id)
    fields = body.model_dump(exclude_none=True)
    if not fields:
        raise ApiError("VALIDATION_FAILED", "Nothing to change.")
    conn.execute("update public.water_sources set name = coalesce(%s, name), village = coalesce(%s, village),"
                 " ward = coalesce(%s, ward) where id = %s", (body.name, body.village, body.ward, sid))
    conn.execute("insert into public.audit_log (actor_id, entity_type, entity_id, action, after_data)"
                 " values (%s, 'water_sources', %s, 'source_edited', %s)", (staff.profile_id, sid, json.dumps(fields)))
    conn.execute("select public.refresh_public_map()")
    conn.commit()
    return {"source_id": sid, **fields}


@router.get("/team")
def team(staff: Staff = Depends(supervisor), conn: Any = Depends(pg)) -> dict[str, Any]:
    """The supervisor's team with each member's screening activity and points."""
    rows = conn.execute(
        "select p.id::text, p.email, p.full_name, p.role, p.active, p.points_balance,"
        " (select count(*) from public.test_records t where t.performed_by = p.id),"
        " (select count(*) from public.reports r join public.test_records t on t.id = r.test_record_id"
        "   where t.performed_by = p.id and not r.is_re_report),"
        " (select count(*) from public.points_ledger l where l.profile_id = p.id and l.reason = 'screening_on_time')"
        " from public.profiles p where p.team_id = %s order by p.role desc, p.full_name", (staff.team_id,)).fetchall()
    return {"items": [{"profile_id": r[0], "email": r[1], "full_name": r[2], "role": r[3], "active": r[4],
                       "points_balance": r[5], "tests": r[6], "reports_raised": r[7], "on_time_screenings": r[8]}
                      for r in rows]}


class NoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


def _team_report(conn: Any, staff: Staff, report_id: str) -> str:
    rid = _id(report_id, "Report")
    if conn.execute("select 1 from public.reports r join public.water_sources ws on ws.id = r.source_id"
                    " where r.id = %s and ws.team_id = %s", (rid, staff.team_id)).fetchone() is None:
        raise ApiError("NOT_FOUND", "Report not found.")
    return rid


@router.post("/reports/{report_id}/notes", status_code=201)
def add_note(report_id: str, body: NoteRequest, staff: Staff = Depends(require_staff),
             conn: Any = Depends(pg)) -> dict[str, Any]:
    rid = _team_report(conn, staff, report_id)
    conn.execute("insert into public.audit_log (actor_id, entity_type, entity_id, action, after_data)"
                 " values (%s, 'reports', %s, 'note', %s)", (staff.profile_id, rid, json.dumps({"text": body.text.strip()})))
    conn.commit()
    return {"report_id": rid, "note": body.text.strip()}


class CommunicationRequest(BaseModel):
    """A record of a message a supervisor sent or attempted outside the app.
    Recording it sends nothing."""

    channel: Literal["sms", "ivr"]
    message: str = Field(min_length=1, max_length=500)
    delivery_status: Literal["queued", "sent", "failed", "confirmed"]
    sent_at: datetime | None = None


@router.post("/reports/{report_id}/communications", status_code=201)
def log_communication(report_id: str, body: CommunicationRequest, staff: Staff = Depends(supervisor),
                      conn: Any = Depends(pg)) -> dict[str, Any]:
    rid = _team_report(conn, staff, report_id)
    if body.delivery_status != "queued" and body.sent_at is None:
        raise ApiError("VALIDATION_FAILED", "Say when the message was sent.", field_errors={"sent_at": "required"})
    nid = conn.execute("insert into public.notifications (related_report_id, channel, message, sent_at, delivery_status)"
                       " values (%s, %s, %s, %s, %s) returning id",
                       (rid, body.channel, body.message, body.sent_at, body.delivery_status)).fetchone()[0]
    conn.execute("insert into public.audit_log (actor_id, entity_type, entity_id, action, after_data)"
                 " values (%s, 'reports', %s, 'communication_logged', %s)",
                 (staff.profile_id, rid, json.dumps({"channel": body.channel, "delivery_status": body.delivery_status})))
    conn.commit()
    return {"communication_id": str(nid), "delivery_status": body.delivery_status}


class VersionRequest(BaseModel):
    version: int


@router.post("/reports/{report_id}/re-report", status_code=201)
def request_re_report(report_id: str, body: VersionRequest, staff: Staff = Depends(supervisor),
                      conn: Any = Depends(pg)) -> dict[str, Any]:
    child = guarded(conn, "select public.request_re_report(%s, %s, %s)",
                    (_id(report_id, "Report"), staff.profile_id, body.version))
    return {"report_id": report_id, "re_report_id": str(child)}


@router.post("/sources/{source_id}/lab-verified")
def mark_lab_verified(source_id: str, staff: Staff = Depends(supervisor), conn: Any = Depends(pg)) -> dict[str, Any]:
    guarded(conn, "select public.mark_source_lab_verified(%s, %s)", (_id(source_id, "Water source"), staff.profile_id))
    return {"source_id": source_id, "current_public_status": "lab_verified_safe"}


# --- test records -> reports (flows 1-2) ----------------------------------------------

class TestRecordRequest(TestPayload):
    source_id: str
    photo: Upload | None = None   # Pluccy's photo proof (JPEG/PNG)
    extra_photos: list[Upload] = Field(default_factory=list, max_length=3)   # more angles (011)

    @model_validator(mode="after")
    def photos_start_with_photo(self) -> "TestRecordRequest":
        if self.extra_photos and self.photo is None:
            raise ValueError("send the first photo as 'photo'")
        return self


@router.post("/test-records")
def push_test_record(body: TestRecordRequest, response: Response, staff: Staff = Depends(require_staff),
                     conn: Any = Depends(pg)) -> dict[str, Any]:
    sid = _team_source(conn, staff, body.source_id)
    outcome, record_id = insert_test_record(conn, body, sid, staff.profile_id, body.photo, body.extra_photos)
    conn.commit()   # the points trigger (006) decides here
    risk, assessment, report, awarded = conn.execute(
        "select t.computed_risk_level, t.rule_assessment,"
        " (select r.id::text from public.reports r where r.test_record_id = t.id and not r.is_re_report),"
        " exists (select 1 from public.points_ledger l where l.related_test_record_id = t.id)"
        " from public.test_records t where t.id = %s", (record_id,)).fetchone()
    response.status_code = 201 if outcome == "accepted" else 200
    return {"test_record_id": record_id, "outcome": outcome, "report_id": report, "risk_level": risk,
            "assessment": assessment, "points_awarded": 10 if awarded else 0,
            "points": points_summary(conn, staff.profile_id)}


# --- reports, labs, photos (flows 2-4) ------------------------------------------------

REPORT_COLUMNS = ("select r.id::text, r.source_id::text, ws.name, r.test_record_id::text, r.risk_level, r.status,"
                  " r.version, r.is_re_report, r.previous_report_id::text, r.created_at, r.closed_at, r.closure_reason,"
                  " r.origin from public.reports r join public.water_sources ws on ws.id = r.source_id")


def _report_json(r: tuple) -> dict[str, Any]:
    return {"report_id": r[0], "source_id": r[1], "source_name": r[2], "test_record_id": r[3], "risk_level": r[4],
            "status": r[5], "version": r[6], "is_re_report": r[7], "previous_report_id": r[8],
            "created_at": r[9].isoformat(), "closed_at": r[10].isoformat() if r[10] else None, "closure_reason": r[11],
            "origin": r[12]}


@router.get("/reports")
def list_reports(status: Literal["open", "sent_to_lab", "under_review", "action_taken", "closed"] | None = Query(None),
                 staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    rows = conn.execute(REPORT_COLUMNS + " where ws.team_id = %s and (%s::text is null or r.status = %s)"
                        " order by r.created_at desc limit 200", (staff.team_id, status, status)).fetchall()
    return {"items": [_report_json(r) for r in rows]}


def _iso(v: Any) -> str | None:
    return v.isoformat() if v else None


def report_details(conn: Any, rows: list[tuple]) -> list[dict[str, Any]]:
    """Full details for many reports with one query per kind (not per report):
    the supervisor board loads a whole team at once."""
    if not rows:
        return []
    ids = [r[0] for r in rows]
    tests = {t[0]: t[1:] for t in conn.execute(
        "select t.id::text, method, dropdown_selection, raw_input, autofill_calculation, computed_risk_level,"
        " performed_by::text, rule_assessment, photo_url, dip_started_at, read_at,"
        " (select jsonb_object_agg(parameter, value) from public.test_readings where test_record_id = t.id), extra_photo_urls"
        " from public.test_records t where t.id = any(%s::uuid[])", ([r[3] for r in rows if r[3]],)).fetchall()}
    by: dict[str, dict[str, list]] = {rid: {"labs": [], "photos": [], "complaints": [], "history": [], "messages": []} for rid in ids}
    owner: dict[str, str] = {rid: rid for rid in ids}   # audit entity id -> report id
    for l in conn.execute("select report_id::text, id::text, lab_name, verification_status, re_report_requested, result_file_url,"
                          " verified_by::text, verified_at, sent_at from public.lab_referrals where report_id = any(%s::uuid[])"
                          " order by sent_at", (ids,)).fetchall():
        by[l[0]]["labs"].append(l[1:])
        owner[l[1]] = l[0]
    for ph in conn.execute("select report_id::text, id::text, photo_url, process_stage, inspection_level, uploaded_at"
                           " from public.process_photos where report_id = any(%s::uuid[]) order by uploaded_at", (ids,)).fetchall():
        by[ph[0]]["photos"].append(ph[1:])
        owner[ph[1]] = ph[0]
    for c in conn.execute("select linked_report_id::text, id::text, reference_number, complaint_type, status from public.complaints"
                          " where linked_report_id = any(%s::uuid[]) order by submitted_at", (ids,)).fetchall():
        by[c[0]]["complaints"].append(c[1:])
        owner[c[1]] = c[0]
    children = {c[0]: c[1:] for c in conn.execute(
        "select previous_report_id::text, id::text, status from public.reports where previous_report_id = any(%s::uuid[])", (ids,)).fetchall()}
    # Case history: each report's audit rows and those of its referrals, photos and linked complaints.
    for h in conn.execute("select a.entity_id::text, a.id, a.at, a.actor_id::text, a.entity_type, a.action, a.after_data"
                          " from public.audit_log a where a.entity_id = any(%s::uuid[]) order by a.at, a.id", (list(owner),)).fetchall():
        rows_h = by[owner[h[0]]]["history"]
        if len(rows_h) < 500:
            rows_h.append(h[1:])
    for m in conn.execute("select related_report_id::text, id::text, channel, message, sent_at, delivery_status from public.notifications"
                          " where related_report_id = any(%s::uuid[]) and channel in ('sms', 'ivr', 'email')"
                          " order by coalesce(sent_at, now()), id", (ids,)).fetchall():
        by[m[0]]["messages"].append(m[1:])
    out = []
    for row in rows:
        d, test, child = by[row[0]], tests.get(row[3]) if row[3] else None, children.get(row[0])
        out.append({
            **_report_json(row),
            # Provenance kept structurally separate - never merged into one value.
            # A resident-origin report has no test record.
            "test": {"method": test[0], "dropdown_selection": test[1], "human_observation": test[2],
                     "machine_suggestion": test[3], "computed_risk_level": test[4], "performed_by": test[5],
                     "rule_assessment": test[6], "photo": test[7], "readings": test[10], "extra_photos": list(test[11] or []),
                     "dip_started_at": _iso(test[8]), "read_at": _iso(test[9])} if test else None,
            "lab_referrals": [{"lab_referral_id": l[0], "lab_name": l[1], "verification_status": l[2],
                               "re_report_requested": l[3], "result_file": l[4], "verified_by": l[5],
                               "verified_at": _iso(l[6]), "sent_at": l[7].isoformat()} for l in d["labs"]],
            "photos": [{"photo_id": p[0], "photo": p[1], "process_stage": p[2], "inspection_level": p[3],
                        "uploaded_at": p[4].isoformat()} for p in d["photos"]],
            "linked_complaints": [{"complaint_id": c[0], "reference_number": c[1], "complaint_type": c[2],
                                   "status": c[3]} for c in d["complaints"]],
            "re_report": {"report_id": child[0], "status": child[1]} if child else None,
            "history": [{"id": h[0], "at": h[1].isoformat(), "actor": h[2], "entity": h[3], "action": h[4],
                         "details": h[5]} for h in d["history"]],
            "communications": [{"id": m[0], "channel": m[1], "message": m[2], "sent_at": _iso(m[3]),
                                "delivery_status": m[4]} for m in d["messages"]],
        })
    return out


# Declared before /reports/{report_id} so "details" is not read as an id.
@router.get("/reports/details")
def team_report_details(staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    """Every report of the team (the same 200 as GET /reports) with its full details, in one call."""
    rows = conn.execute(REPORT_COLUMNS + " where ws.team_id = %s order by r.created_at desc limit 200", (staff.team_id,)).fetchall()
    return {"items": report_details(conn, rows)}


@router.get("/reports/{report_id}")
def report_detail(report_id: str, staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    rid = _id(report_id, "Report")
    row = conn.execute(REPORT_COLUMNS + " where r.id = %s and ws.team_id = %s", (rid, staff.team_id)).fetchone()
    if row is None:
        raise ApiError("NOT_FOUND", "Report not found.")
    return report_details(conn, [row])[0]


class TransitionRequest(BaseModel):
    to: Literal["under_review", "action_taken", "sent_to_lab", "closed", "open"]
    version: int


@router.post("/reports/{report_id}/transition")
def transition(report_id: str, body: TransitionRequest, staff: Staff = Depends(supervisor),
               conn: Any = Depends(pg)) -> dict[str, Any]:
    version = guarded(conn, "select public.transition_report(%s, %s, %s, %s)",
                      (_id(report_id, "Report"), staff.profile_id, body.version, body.to))
    return {"report_id": report_id, "status": body.to, "version": version}


class CloseRequest(BaseModel):
    version: int
    closure_reason: str = Field(max_length=1000)


@router.post("/reports/{report_id}/close")
def close(report_id: str, body: CloseRequest, staff: Staff = Depends(supervisor), conn: Any = Depends(pg)) -> dict[str, Any]:
    version = guarded(conn, "select public.close_report(%s, %s, %s, %s)",
                      (_id(report_id, "Report"), staff.profile_id, body.version, body.closure_reason))
    return {"report_id": report_id, "status": "closed", "version": version}


class ReferralRequest(BaseModel):
    lab_name: str = Field(min_length=1, max_length=200)
    version: int


@router.post("/reports/{report_id}/lab-referrals", status_code=201)
def refer(report_id: str, body: ReferralRequest, staff: Staff = Depends(supervisor), conn: Any = Depends(pg)) -> dict[str, Any]:
    referral = guarded(conn, "select public.refer_to_lab(%s, %s, %s, %s)",
                       (_id(report_id, "Report"), staff.profile_id, body.version, body.lab_name))
    return {"lab_referral_id": str(referral), "verification_status": "pending"}


@router.post("/lab-referrals/{referral_id}/result")
def record_result(referral_id: str, body: Upload, staff: Staff = Depends(require_staff),
                  conn: Any = Depends(pg)) -> dict[str, Any]:
    rid = _id(referral_id, "Lab referral")
    url = store_upload(conn, body, staff.profile_id, images_only=False)
    guarded(conn, "select public.record_lab_result(%s, %s, %s)", (rid, staff.profile_id, url))
    quarantined = body.content_type == "application/pdf"
    return {"lab_referral_id": rid, "verification_status": "uploaded", "result_file": url,
            "result_file_available": not quarantined}


class VerifyRequest(BaseModel):
    decision: Literal["verified", "rejected"]
    re_report_requested: bool = False


@router.post("/lab-referrals/{referral_id}/verify")
def verify(referral_id: str, body: VerifyRequest, staff: Staff = Depends(supervisor), conn: Any = Depends(pg)) -> dict[str, Any]:
    rid = _id(referral_id, "Lab referral")
    guarded(conn, "select public.verify_lab_referral(%s, %s, %s, %s)",
            (rid, staff.profile_id, body.decision, body.re_report_requested))
    child = conn.execute("select r.id::text from public.lab_referrals l join public.reports r"
                         " on r.previous_report_id = l.report_id where l.id = %s", (rid,)).fetchone()
    return {"lab_referral_id": rid, "verification_status": body.decision,
            "re_report_id": child[0] if child and body.re_report_requested else None}


class PhotoRequest(Upload):
    content_type: Literal["image/jpeg", "image/png"]
    process_stage: Literal["initial_capture", "lab_referral", "corrective_action", "retest", "closure"]
    inspection_level: Literal["field", "supervisor", "lab"] | None = None


@router.post("/reports/{report_id}/photos", status_code=201)
def add_photo(report_id: str, body: PhotoRequest, staff: Staff = Depends(require_staff),
              conn: Any = Depends(pg)) -> dict[str, Any]:
    rid = _id(report_id, "Report")
    level = body.inspection_level or ("field" if staff.role == "field_worker" else "supervisor")
    if staff.role == "field_worker" and level != "field":
        raise ApiError("FORBIDDEN", "Field workers record field-level inspection photos.")
    report = conn.execute("select r.source_id from public.reports r join public.water_sources ws on ws.id = r.source_id"
                          " where r.id = %s and ws.team_id = %s", (rid, staff.team_id)).fetchone()
    if report is None:
        raise ApiError("NOT_FOUND", "Report not found.")
    url = store_upload(conn, body, staff.profile_id, images_only=True)
    photo_id = conn.execute("insert into public.process_photos (report_id, source_id, photo_url, process_stage,"
                            " inspection_level, uploaded_by) values (%s, %s, %s, %s, %s, %s) returning id",
                            (rid, report[0], url, body.process_stage, level, staff.profile_id)).fetchone()[0]
    conn.commit()
    return {"photo_id": str(photo_id), "photo": url, "process_stage": body.process_stage, "inspection_level": level}


RECENT_PHOTOS_SQL = """
select * from (
  select 'complaint' as kind, c.id::text as record_id, c.linked_report_id::text as report_id, c.source_id::text,
         coalesce(ws.name, 'No source named') as source_name, u.url as photo, u.n::int as position, c.submitted_at as at,
         c.reference_number || ' · ' || replace(c.complaint_type, '_', ' ') as title,
         c.details->>'description' as detail, c.status
    from public.complaints c left join public.water_sources ws on ws.id = c.source_id
    cross join lateral unnest(array[c.photo_url] || c.extra_photo_urls) with ordinality as u(url, n)
   where %(sup)s and u.url is not null and (c.source_id is null or ws.team_id = %(team)s)
  union all
  select 'screening', t.id::text, (select r.id::text from public.reports r where r.test_record_id = t.id limit 1),
         t.source_id::text, ws.name, u.url, u.n::int, t.created_at,
         'Screening · ' || coalesce(t.computed_risk_level, 'recorded') || ' risk', null, t.computed_risk_level
    from public.test_records t join public.water_sources ws on ws.id = t.source_id
    cross join lateral unnest(array[t.photo_url] || t.extra_photo_urls) with ordinality as u(url, n)
   where u.url is not null and ws.team_id = %(team)s
  union all
  select 'field', p.id::text, p.report_id::text, p.source_id::text, ws.name, p.photo_url, 1, p.uploaded_at,
         replace(p.process_stage, '_', ' ') || ' photo', coalesce(p.inspection_level, 'field') || ' inspection', null
    from public.process_photos p left join public.reports r on r.id = p.report_id
    join public.water_sources ws on ws.id = coalesce(r.source_id, p.source_id)
   where ws.team_id = %(team)s and p.photo_url is not null
) x order by at desc, position limit %(limit)s"""


def _photo_json(r: Any) -> dict[str, Any]:
    at = r[7] if isinstance(r[7], str) else r[7].isoformat()
    return {"kind": r[0], "record_id": r[1], "report_id": r[2], "source_id": r[3], "source_name": r[4],
            "blob_id": r[5][5:] if r[5].startswith("blob:") else None, "position": r[6], "at": at,
            "title": r[8], "detail": r[9], "status": r[10]}


@router.get("/photos/recent")
def recent_photos(limit: int = Query(60, ge=1, le=200), staff: Staff = Depends(require_staff),
                  conn: Any = Depends(pg)) -> dict[str, Any]:
    """Newest photos across the team, one cheap query: the supervisor board polls this every few seconds.
    Complaint photos only for supervisors, like GET /blobs."""
    rows = conn.execute(RECENT_PHOTOS_SQL, {"sup": staff.role == "supervisor", "team": staff.team_id, "limit": limit}).fetchall()
    return {"items": [_photo_json(r) for r in rows]}


@router.get("/blobs/{blob_id}")
def get_blob(blob_id: str, staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> Response:
    bid = _id(blob_id, "File")
    url = f"blob:{bid}"
    row = conn.execute(
        "select b.content_type, b.availability, b.data from public.photo_blobs b where b.id = %(id)s and ("
        " exists (select 1 from public.process_photos p left join public.reports r on r.id = p.report_id"
        "   join public.water_sources ws on ws.id = coalesce(r.source_id, p.source_id)"
        "   where p.photo_url = %(url)s and ws.team_id = %(team)s)"
        " or exists (select 1 from public.lab_referrals l join public.reports r on r.id = l.report_id"
        "   join public.water_sources ws on ws.id = r.source_id where l.result_file_url = %(url)s and ws.team_id = %(team)s)"
        " or exists (select 1 from public.test_records t join public.water_sources ws on ws.id = t.source_id"
        "   where (t.photo_url = %(url)s or %(url)s = any(t.extra_photo_urls)) and ws.team_id = %(team)s)"
        " or (%(sup)s and exists (select 1 from public.complaints c left join public.water_sources ws on ws.id = c.source_id"
        "   where (c.photo_url = %(url)s or %(url)s = any(c.extra_photo_urls)) and (c.source_id is null or ws.team_id = %(team)s))))",
        {"id": bid, "url": url, "team": staff.team_id, "sup": staff.role == "supervisor"}).fetchone()
    if row is None:
        raise ApiError("NOT_FOUND", "File not found.")
    if row[1] != "available":
        raise ApiError("EVIDENCE_NOT_AVAILABLE", "This file is quarantined: no malware scan is available.")
    return Response(content=bytes(row[2]), media_type=row[0],
                    headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


# --- resident complaints (review is supervisor-only) ----------------------------------

@router.get("/complaints")
def list_complaints(status: Literal["new", "linked", "resolved"] | None = Query(None),
                    staff: Staff = Depends(supervisor), conn: Any = Depends(pg)) -> dict[str, Any]:
    rows = conn.execute(
        "select c.id::text, c.reference_number, c.complaint_type, c.status, c.resolution, c.source_id::text, ws.name,"
        " c.details->>'description', c.photo_url, c.linked_report_id::text, c.submitted_at, c.linked_at, c.version,"
        " coalesce(c.details->'also', '[]'::jsonb), c.extra_photo_urls"
        " from public.complaints c left join public.water_sources ws on ws.id = c.source_id"
        " where (c.source_id is null or ws.team_id = %s) and (%s::text is null or c.status = %s)"
        " order by (c.status = 'new') desc, (c.complaint_type = 'illness') desc, c.submitted_at desc limit 200",
        (staff.team_id, status, status)).fetchall()
    return {"items": [{
        "complaint_id": r[0], "reference_number": r[1], "complaint_type": r[2], "status": r[3], "resolution": r[4],
        "source_id": r[5], "source_name": r[6], "description": r[7], "photo": r[8], "linked_report_id": r[9],
        "also": r[13], "extra_photos": list(r[14] or []),
        "submitted_at": r[10].isoformat(), "linked_at": r[11].isoformat() if r[11] else None,
        "version": r[12]} for r in rows]}


class ReviewRequest(BaseModel):
    """link: to an open report, naming its current version. open_report: a new
    resident-origin report from this complaint. dismiss: resolve, no case."""

    action: Literal["link", "open_report", "dismiss"]
    report_id: str | None = None
    version: int | None = None
    risk_level: Literal["low", "medium", "high"] | None = None

    @model_validator(mode="after")
    def fields_match_action(self) -> "ReviewRequest":
        if (self.action == "link") != (self.report_id is not None and self.version is not None):
            raise ValueError("report_id and version are required for link, and only for link")
        if (self.action == "open_report") != (self.risk_level is not None):
            raise ValueError("risk_level is required for open_report, and only for open_report")
        return self


@router.post("/complaints/{complaint_id}/review")
def review(complaint_id: str, body: ReviewRequest, staff: Staff = Depends(supervisor),
           conn: Any = Depends(pg)) -> dict[str, Any]:
    cid = _id(complaint_id, "Complaint")
    status = guarded(conn, "select public.review_complaint(%s, %s, %s, %s, %s, %s)",
                     (cid, staff.profile_id, body.action, _id(body.report_id, "Report") if body.report_id else None,
                      body.version, body.risk_level))
    report = conn.execute("select linked_report_id::text from public.complaints where id = %s", (cid,)).fetchone()
    return {"complaint_id": complaint_id, "status": status, "report_id": report[0] if report else None}


# --- notifications (flow 5) -------------------------------------------------------------

@router.get("/notifications")
def notifications(staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    rows = conn.execute("select id::text, channel, message, related_report_id::text, delivery_status"
                        " from public.notifications where user_id = %s and channel in ('in_app', 'push')"
                        " order by (delivery_status = 'confirmed'), id desc limit 100", (staff.profile_id,)).fetchall()
    return {"items": [{"notification_id": r[0], "channel": r[1], "message": r[2], "related_report_id": r[3],
                       "delivery_status": r[4]} for r in rows]}


@router.post("/notifications/{notification_id}/ack")
def ack(notification_id: str, staff: Staff = Depends(require_staff), conn: Any = Depends(pg)) -> dict[str, Any]:
    done = conn.execute("update public.notifications set delivery_status = 'confirmed', sent_at = coalesce(sent_at, now())"
                        " where id = %s and user_id = %s and channel in ('in_app', 'push')",
                        (_id(notification_id, "Notification"), staff.profile_id)).rowcount
    if not done:
        raise ApiError("NOT_FOUND", "Notification not found.")
    conn.commit()
    return {"notification_id": notification_id, "delivery_status": "confirmed"}
