"""Checks for the pieces the skeleton actually implements.

Deliberately small: config refusal, the error contract and honest health output.
Domain behaviour has no tests here because it has no implementation here.
"""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import ApiError, api_error_handler
from app.main import app

client = TestClient(app)


def test_live_exposes_no_dependency_detail():
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_ready_reports_unwired_dependencies_instead_of_claiming_ready():
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    # Nothing is wired yet, so readiness must be False rather than optimistic.
    assert body["ready"] is False
    assert body["checks"]["database"] is False


def test_development_allows_empty_config():
    assert Settings(environment="development").database_url == ""


def test_production_refuses_development_defaults():
    with pytest.raises(ValueError, match="refusing to start"):
        Settings(environment="production")


def test_production_refuses_synthetic_data_mode():
    with pytest.raises(ValueError, match="tenant_data_mode=operational"):
        Settings(
            environment="production",
            database_url="postgresql://localhost/x",
            oidc_issuer="https://issuer.invalid",
            oidc_audience="jalsakshi",
            tenant_data_mode="synthetic",
        )


def test_unknown_error_code_is_rejected_at_construction():
    with pytest.raises(KeyError):
        ApiError("NOT_A_REAL_CODE", "boom")


def _problem_client() -> TestClient:
    probe = FastAPI()
    probe.add_exception_handler(ApiError, api_error_handler)

    @probe.get("/boom")
    def boom(request: Request):
        raise ApiError(
            "CASE_VERSION_CONFLICT",
            "Case was modified by another reviewer.",
            extra={"current_version": 5},
        )

    return TestClient(probe, raise_server_exceptions=False)


def test_problem_json_shape_matches_contract():
    response = _problem_client().get("/boom", headers={"x-request-id": "req-123"})
    assert response.status_code == 409
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["code"] == "CASE_VERSION_CONFLICT"
    assert body["retryable"] is False
    assert body["request_id"] == "req-123"
    assert body["current_version"] == 5
    # A conflict must never leak internals.
    assert "traceback" not in response.text.lower()
