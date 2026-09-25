"""RFC 7807 problem+json error contract.

Shape and codes are fixed by jalsakshi-blueprint/docs/architecture/api-contracts.md. Handlers raise
ApiError; nothing constructs an error response by hand, so every error carries a
request_id and no handler can leak a stack trace.
"""

import uuid
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

CONTENT_TYPE = "application/problem+json"

# code -> (http status, title, retryable)
ERROR_CODES: dict[str, tuple[int, str, bool]] = {
    "VALIDATION_FAILED": (422, "Validation failed", False),
    "AUTH_REQUIRED": (401, "Authentication required", False),
    "FORBIDDEN": (403, "Forbidden", False),
    "NOT_FOUND": (404, "Not found", False),
    "IDEMPOTENCY_MISMATCH": (409, "Idempotency key reused with a different payload", False),
    "PROTOCOL_REVOKED": (409, "Protocol revoked", False),
    "CASE_VERSION_CONFLICT": (409, "Case version conflict", False),
    "CASE_TRANSITION_ILLEGAL": (409, "Illegal case transition", False),
    "CLOSURE_EVIDENCE_INCOMPLETE": (409, "Closure evidence incomplete", False),
    # T17 guards (case-state-machine.md "Guards").
    "CASE_OWNER_REQUIRED": (409, "Case owner and due date required", False),
    "CASE_POLICY_FORBIDS": (409, "Protocol policy forbids this transition", False),
    "LAB_REPORT_NOT_VERIFIED": (409, "No verified lab report", False),
    "VERIFICATION_SELF_REVIEW": (409, "Report cannot be verified by its uploader", False),
    "DISPOSITION_REQUIRED": (409, "Disposition required", False),
    "ACTION_EVIDENCE_MISSING": (409, "Action evidence missing", False),
    "RETEST_INVALID": (409, "Retest sample invalid", False),
    # T19 lab reports.
    "LAB_RESULT_NOT_ADVERSE": (409, "No verified report states the result exceeds the limit", False),
    "LAB_RESULT_NOT_WITHIN_LIMIT": (409, "Not every verified report states the result is within the limit", False),
    "LAB_REPORT_MISMATCH": (409, "Report does not match the case", False),
    "LAB_REPORT_DECIDED": (409, "Report already verified or rejected", False),
    "LAB_REPORT_SUPERSEDED": (409, "Report has been superseded", False),
    # api-contracts.md: expired sync cursor -> 410 with safe rebootstrap instructions.
    "RESET_REQUIRED": (410, "Sync reset required", False),
    "PAYLOAD_TOO_LARGE": (413, "Payload too large", False),
    # T16. Upload is off unless the deployment enables it (AC-018).
    "EVIDENCE_UPLOAD_DISABLED": (403, "Evidence upload disabled", False),
    "EVIDENCE_NOT_AVAILABLE": (409, "Evidence not available", False),
    # Public v2 (public_v2.py).
    "PHONE_ALREADY_REGISTERED": (409, "Phone number already registered", False),
    "EMAIL_ALREADY_REGISTERED": (409, "Email already registered", False),
    # Staff v2 (staff_v2.py, 004/006 SQL).
    "LAB_RESULT_MISSING": (409, "No lab result recorded", False),
    "LAB_RESULT_ALREADY_RECORDED": (409, "Lab result already recorded", False),
    "RE_REPORT_OPEN": (409, "A requested re-report is still open", False),
    "COMPLAINT_ALREADY_REVIEWED": (409, "Complaint already reviewed", False),
    "RATE_LIMITED": (429, "Rate limited", True),
    "TEMPORARILY_UNAVAILABLE": (503, "Temporarily unavailable", True),
    # T33: an unhandled server fault, answered with the request id to quote.
    "INTERNAL_ERROR": (500, "Internal error", False),
}


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        detail: str,
        field_errors: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        if code not in ERROR_CODES:
            raise KeyError(f"unknown error code {code!r}")
        if extra and extra.keys() & {
            "type", "title", "status", "code", "detail", "request_id", "field_errors", "retryable"
        }:
            raise ValueError("extra cannot override problem fields")
        self.code = code
        self.detail = detail
        self.field_errors = field_errors or {}
        self.extra = extra or {}
        super().__init__(detail)

    @property
    def status(self) -> int:
        return ERROR_CODES[self.code][0]


def request_id(request: Request) -> str:
    # T33: the id the tracing middleware already assigned, so the problem body
    # and the log line carry the same value.
    assigned = getattr(request.state, "request_id", None)
    if assigned:
        return assigned
    existing = request.headers.get("x-request-id")
    return existing if existing and len(existing) <= 128 and existing.isascii() and existing.isprintable() else str(uuid.uuid4())


def problem_response(request: Request, error: ApiError) -> JSONResponse:
    status, title, retryable = ERROR_CODES[error.code]
    body: dict[str, Any] = {
        "type": f"https://jalsakshi.invalid/problems/{error.code.lower()}",
        "title": title,
        "status": status,
        "code": error.code,
        "detail": error.detail,
        "request_id": request_id(request),
        "field_errors": error.field_errors,
        "retryable": retryable,
    }
    body.update(error.extra)
    return JSONResponse(status_code=status, content=body, media_type=CONTENT_TYPE)


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ApiError)
    return problem_response(request, exc)


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    fields = {
        ".".join(str(part) for part in error["loc"]): error["msg"]
        for error in exc.errors()
    }
    return problem_response(
        request,
        ApiError("VALIDATION_FAILED", "Request validation failed.", field_errors=fields),
    )
