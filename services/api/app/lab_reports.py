"""T19: laboratory report entry and verification.

api-contracts.md:
    POST /v1/lab-reports              report metadata -> UNVERIFIED report
    POST /v1/lab-reports/{id}/verify  command_id, expected_version, decision,
                                      reason -> verification record
case-state-machine.md "Verification does not move the case": verifying writes
a case event and bumps cases.version (so racing case commands conflict) but
NEVER changes cases.status. The case command handler stays the one writer.

Rules:
  - Recording a report is not verifying it; only lab_reviewer/admin verify,
    and never a report they recorded (G-VERIFY-SEP, also a DB CHECK).
  - Mismatches (source, sample, parameter, unit, collection time) are computed
    when the report is recorded, returned at once, and block verification:
    "cannot verify mismatched source silently". The reviewer can reject it,
    and a corrected report can supersede it.
  - Corrections append a superseding report; the old row is never edited. A
    correction on a case in closure_review/closed flags it for re-review; it
    does not silently reopen it.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from . import case_policy as policy
from .auth import Session
from .cases import NOT_FOUND, Refused, _conflict, _event, _plain, _prior, load_case
from .samples import sql

RECORD_ROLES = frozenset({"supervisor", "lab_reviewer", "admin"})   # authorization-matrix.md
VERIFY_ROLES = frozenset({"lab_reviewer", "admin"})
CLOCK_SLACK = timedelta(minutes=5)


class LabReportCreate(BaseModel):
    report_id: UUID
    case_id: UUID
    source_id: UUID = Field(description="The source the LAB says it tested, as printed on the report.")
    sample_id: UUID | None = None
    lab_name: str = Field(min_length=1, max_length=160)
    external_ref: str | None = Field(default=None, max_length=160)
    collected_at: datetime
    method: str = Field(min_length=1, max_length=160)
    parameter: str = Field(min_length=1, max_length=160)
    result: str = Field(min_length=1, max_length=160)
    unit: str | None = Field(default=None, max_length=64)
    lab_interpretation: Literal["exceeds_limit", "within_limit", "not_stated"]
    report_asset_id: UUID | None = None
    supersedes_id: UUID | None = None


class LabReportView(BaseModel):
    id: str
    case_id: str
    verification_state: Literal["unverified", "verified", "rejected"]
    mismatches: list[str]
    superseded: bool
    supersedes_id: str | None
    lab_interpretation: str
    uploaded_by: str
    verified_by: str | None


class VerifyRequest(BaseModel):
    command_id: UUID
    expected_version: int = Field(ge=1)
    decision: Literal["verify", "reject"]
    reason: str = Field(min_length=10, max_length=2000)


class DecisionReceipt(BaseModel):
    command_id: str
    report_id: str
    case_id: str
    verification_state: Literal["verified", "rejected"]
    case_version: int
    event_id: str


def _utc(value: Any) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed.astimezone(timezone.utc)


def _hash(body: BaseModel) -> str:
    return hashlib.sha256(json.dumps(body.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()


def _mismatches(connection: Any, tenant_id: str, case: dict[str, Any], body: LabReportCreate, now: str) -> list[str]:
    found: list[str] = []
    if str(body.source_id) != case["source_id"]:
        found.append("source_mismatch")
    cursor = connection.cursor()
    cursor.execute(sql("SELECT protocol_id, protocol_version, captured_at_device FROM samples "
                       "WHERE tenant_id = ? AND id = ?", connection), (tenant_id, case["trigger_sample_id"]))
    trigger = cursor.fetchone()
    if body.sample_id is not None:
        cursor.execute(sql("SELECT source_id FROM samples WHERE tenant_id = ? AND id = ?", connection),
                       (tenant_id, str(body.sample_id)))
        linked = cursor.fetchone()
        # A sample the tenant cannot see is reported exactly like one of another source.
        if linked is None or str(linked[0]) != case["source_id"]:
            found.append("sample_mismatch")
    doc = policy.protocol_doc(str(trigger[0]), int(trigger[1]))
    if doc is None:
        found.append("protocol_unknown")
    else:
        if body.parameter.strip() != doc.get("parameter"):
            found.append("parameter_mismatch")
        if (body.unit or "").strip() != (doc.get("unit") or ""):
            found.append("unit_mismatch")
    collected = _utc(body.collected_at)
    if collected < _utc(trigger[2]) - CLOCK_SLACK:
        found.append("collected_before_screening")
    if collected > _utc(now) + CLOCK_SLACK:
        found.append("collected_in_future")
    return found


def _view(connection: Any, tenant_id: str, report_id: str) -> LabReportView | None:
    cursor = connection.cursor()
    try:
        cursor.execute(sql(
            "SELECT r.id, r.case_id, r.verification_state, r.mismatches, r.supersedes_id, r.lab_interpretation, "
            "r.uploaded_by, r.verified_by, EXISTS (SELECT 1 FROM lab_reports n WHERE n.tenant_id = r.tenant_id "
            "AND n.supersedes_id = r.id) FROM lab_reports r WHERE r.tenant_id = ? AND r.id = ?", connection),
            (tenant_id, report_id))
    except Exception:
        connection.rollback()  # malformed uuid on PostgreSQL
        return None
    r = cursor.fetchone()
    if r is None:
        return None
    return LabReportView(
        id=str(r[0]), case_id=str(r[1]), verification_state=r[2], mismatches=json.loads(r[3]),
        supersedes_id=_plain(r[4]), lab_interpretation=r[5], uploaded_by=str(r[6]), verified_by=_plain(r[7]),
        superseded=bool(r[8]),
    )


def record_report(connection: Any, session: Session, body: LabReportCreate, *, now: str) -> LabReportView | Refused:
    if session.role not in RECORD_ROLES:
        return Refused("FORBIDDEN", "This role cannot record lab reports.")
    if body.collected_at.tzinfo is None:
        return Refused("VALIDATION_FAILED", "collected_at needs a timezone.", field_errors={"collected_at": "timezone"})
    case = load_case(connection, session.tenant_id, str(body.case_id))
    if case is None:
        return NOT_FOUND
    report_id, digest = str(body.report_id), _hash(body)
    cursor = connection.cursor()
    cursor.execute(sql("SELECT payload_hash FROM lab_reports WHERE tenant_id = ? AND id = ?", connection),
                   (session.tenant_id, report_id))
    existing = cursor.fetchone()
    if existing:
        if existing[0] != digest:
            return Refused("IDEMPOTENCY_MISMATCH", "This report id was already used with different content.")
        return _view(connection, session.tenant_id, report_id)  # replay
    if body.supersedes_id is not None:
        old = _view(connection, session.tenant_id, str(body.supersedes_id))
        if old is None or old.case_id != case["id"]:
            return Refused("VALIDATION_FAILED", "A correction must supersede a report on the same case.",
                           field_errors={"supersedes_id": "not on this case"})
        if old.superseded:
            return Refused("LAB_REPORT_SUPERSEDED", "That report was already corrected; supersede the latest one.")
    if body.report_asset_id is not None:
        cursor.execute(sql("SELECT 1 FROM evidence_assets WHERE tenant_id = ? AND id = ? AND context = 'lab_report' "
                           "AND target_id = ?", connection), (session.tenant_id, str(body.report_asset_id), case["id"]))
        if cursor.fetchone() is None:
            return Refused("VALIDATION_FAILED", "Report file must be evidence attached to this case.",
                           field_errors={"report_asset_id": "not found"})

    mismatches = _mismatches(connection, session.tenant_id, case, body, now)
    try:
        cursor.execute(sql(
            "INSERT INTO lab_reports (tenant_id,id,case_id,source_id,sample_id,lab_name,external_ref,collected_at,method,"
            "parameter,result,unit,lab_interpretation,report_asset_id,mismatches,payload_hash,verification_state,"
            "uploaded_by,uploaded_at,supersedes_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", connection), (
            session.tenant_id, report_id, case["id"], str(body.source_id), _plain(body.sample_id), body.lab_name.strip(),
            body.external_ref, _utc(body.collected_at).isoformat().replace("+00:00", "Z"), body.method.strip(),
            body.parameter.strip(), body.result.strip(), (body.unit or None), body.lab_interpretation,
            _plain(body.report_asset_id), json.dumps(mismatches), digest, "unverified", session.user_id, now,
            _plain(body.supersedes_id),
        ))
        rereview = body.supersedes_id is not None and case["status"] in ("closure_review", "closed")
        # New evidence invalidates any decision made on the previous version, so
        # a case command racing this insert conflicts instead of acting blind.
        cursor.execute(sql(
            "UPDATE cases SET version = version + 1, updated_at = ?"
            f"{', requires_rereview = true' if rereview else ''} WHERE tenant_id = ? AND id = ? RETURNING version",
            connection), (now, session.tenant_id, case["id"]))
        version = int(cursor.fetchone()[0])
        _event(connection, session.tenant_id, case["id"],
               "lab_report.superseded_rereview" if rereview else "lab_report.recorded",
               {"report_id": report_id, "mismatches": mismatches, "supersedes_id": _plain(body.supersedes_id)},
               now=now, actor_id=session.user_id, from_version=version - 1, to_version=version)
        connection.commit()
    except Exception as error:
        connection.rollback()
        if any(p.__name__ == "IntegrityError" for p in type(error).__mro__):
            again = _view(connection, session.tenant_id, report_id)
            if again is not None:  # same report raced itself
                return again
            return Refused("LAB_REPORT_SUPERSEDED", "That report was already corrected; supersede the latest one.")
        raise
    return _view(connection, session.tenant_id, report_id)


def decide_report(connection: Any, session: Session, report_id: str, body: VerifyRequest, *, now: str) -> DecisionReceipt | Refused:
    command_id = str(body.command_id)
    digest = hashlib.sha256(json.dumps({"report": report_id, **body.model_dump(mode="json")}, sort_keys=True).encode()).hexdigest()
    prior = _prior(connection, session.tenant_id, command_id)
    if prior:
        if prior[0] != digest:
            return Refused("IDEMPOTENCY_MISMATCH", "This command id was already used with a different command.")
        return DecisionReceipt.model_validate_json(prior[1])
    report = _view(connection, session.tenant_id, report_id)
    if report is None:
        return Refused("NOT_FOUND", "Lab report was not found.")
    case = load_case(connection, session.tenant_id, report.case_id)
    if body.expected_version != case["version"]:
        return _conflict(case)
    if session.role not in VERIFY_ROLES:
        return Refused("FORBIDDEN", "Only a lab reviewer can verify or reject a report.")
    if report.verification_state != "unverified":
        return Refused("LAB_REPORT_DECIDED", f"This report is already {report.verification_state}.")
    if report.superseded:
        return Refused("LAB_REPORT_SUPERSEDED", "This report was corrected; decide on the latest version.")
    if report.uploaded_by == session.user_id:
        return Refused("VERIFICATION_SELF_REVIEW", "A report cannot be verified or rejected by the person who recorded it.")
    if body.decision == "verify" and report.mismatches:
        return Refused("LAB_REPORT_MISMATCH", "This report does not match the case; reject it or record a correction.",
                       field_errors={m: "mismatch" for m in report.mismatches})

    state = "verified" if body.decision == "verify" else "rejected"
    cursor = connection.cursor()
    cursor.execute(sql(
        "UPDATE lab_reports SET verification_state = ?, verified_by = ?, verified_at = ?, decision_reason = ? "
        "WHERE tenant_id = ? AND id = ? AND verification_state = 'unverified'", connection),
        (state, session.user_id, now, body.reason.strip(), session.tenant_id, report_id))
    decided = cursor.rowcount == 1
    cursor.execute(sql("UPDATE cases SET version = version + 1, updated_at = ? WHERE tenant_id = ? AND id = ? AND version = ?",
                       connection), (now, session.tenant_id, case["id"], case["version"]))
    if not decided or cursor.rowcount != 1:
        # Another reviewer or a case command won the race. Nothing written.
        connection.rollback()
        prior = _prior(connection, session.tenant_id, command_id)
        if prior and prior[0] == digest:
            return DecisionReceipt.model_validate_json(prior[1])
        current = _view(connection, session.tenant_id, report_id)
        if current and current.verification_state != "unverified":
            return Refused("LAB_REPORT_DECIDED", f"This report is already {current.verification_state}.")
        return _conflict(load_case(connection, session.tenant_id, case["id"]) or case)
    receipt = DecisionReceipt(command_id=command_id, report_id=report_id, case_id=case["id"], verification_state=state,
                              case_version=case["version"] + 1, event_id=str(uuid4()))
    _event(connection, session.tenant_id, case["id"], f"lab_report.{state}",
           {"report_id": report_id, "reason": body.reason.strip()}, now=now, actor_id=session.user_id,
           from_version=case["version"], to_version=case["version"] + 1, command_id=command_id, payload_hash=digest,
           result_json=receipt.model_dump_json(), event_id=receipt.event_id)
    connection.commit()
    return receipt


def reports_for_case(connection: Any, tenant_id: str, case_id: str) -> list[dict[str, Any]]:
    """For the case detail: the lab result as its OWN provenance, never merged
    with the machine suggestion or the worker's reading."""
    cursor = connection.cursor()
    cursor.execute(sql(
        "SELECT r.id, r.lab_name, r.external_ref, r.collected_at, r.method, r.parameter, r.result, r.unit, "
        "r.lab_interpretation, r.verification_state, r.mismatches, r.uploaded_by, r.verified_by, r.verified_at, "
        "r.decision_reason, r.supersedes_id, r.report_asset_id, "
        "EXISTS (SELECT 1 FROM lab_reports n WHERE n.tenant_id = r.tenant_id AND n.supersedes_id = r.id) "
        "FROM lab_reports r WHERE r.tenant_id = ? AND r.case_id = ? ORDER BY r.uploaded_at, r.id", connection),
        (tenant_id, case_id))
    keys = ("id", "lab_name", "external_ref", "collected_at", "method", "parameter", "result", "unit",
            "lab_interpretation", "verification_state", "mismatches", "uploaded_by", "verified_by", "verified_at",
            "decision_reason", "supersedes_id", "report_asset_id", "superseded")
    rows = []
    for r in cursor.fetchall():
        row = {k: _plain(v) for k, v in zip(keys, r)}
        row["mismatches"] = json.loads(row["mismatches"])
        row["superseded"] = bool(row["superseded"])
        row["collected_at"] = str(row["collected_at"])
        row["verified_at"] = None if row["verified_at"] is None else str(row["verified_at"])
        rows.append(row)
    return rows
