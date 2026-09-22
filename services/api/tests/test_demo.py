import hashlib
import uuid

from fastapi.testclient import TestClient

from services.api.app.main import app

client = TestClient(app, raise_server_exceptions=False)


def record(record_id: str, image_sha256: str, fixture_id: str = "SYN-A") -> dict[str, str]:
    return {
        "id": record_id,
        "fixture_id": fixture_id,
        "captured_at": "2026-09-22T02:30:00Z",
        "client_build": "demo-test",
        "image_sha256": image_sha256,
    }


def test_create_is_idempotent_and_rejects_changed_payload(tmp_path):
    app.state.demo_data_dir = tmp_path
    record_id = str(uuid.uuid4())
    body = record(record_id, "a" * 64)
    headers = {"Idempotency-Key": record_id}

    created = client.post("/demo/v1/records", json=body, headers=headers)
    assert created.status_code == 201
    assert created.json()["data_mode"] == "synthetic"
    assert created.json()["metadata_state"] == "SYNCED"
    assert created.json()["photo_state"] == "MISSING"

    replay = client.post("/demo/v1/records", json=body, headers=headers)
    assert replay.status_code == 200
    assert replay.json()["id"] == record_id

    mismatch = client.post(
        "/demo/v1/records",
        json={**body, "fixture_id": "SYN-B"},
        headers=headers,
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["code"] == "IDEMPOTENCY_MISMATCH"


def test_photo_and_supervisor_decision_keep_evidence_states_distinct(tmp_path):
    app.state.demo_data_dir = tmp_path
    photo = b"\x89PNG\r\n\x1a\ncontrolled-demo"
    digest = hashlib.sha256(photo).hexdigest()
    record_id = str(uuid.uuid4())
    assert client.post(
        "/demo/v1/records",
        json=record(record_id, digest),
        headers={"Idempotency-Key": record_id},
    ).status_code == 201

    uploaded = client.put(
        f"/demo/v1/records/{record_id}/photo",
        content=photo,
        headers={"Content-Type": "image/png", "X-Content-SHA256": digest},
    )
    assert uploaded.status_code == 200
    assert uploaded.json()["photo_state"] == "AVAILABLE"

    command_id = str(uuid.uuid4())
    decision = {"expected_version": 1, "decision": "ACCEPTED", "reason": "Synthetic fixture visible"}
    denied = client.post(
        f"/demo/v1/records/{record_id}/decisions",
        json=decision,
        headers={"Idempotency-Key": command_id},
    )
    assert denied.status_code == 403

    accepted = client.post(
        f"/demo/v1/records/{record_id}/decisions",
        json=decision,
        headers={"Idempotency-Key": command_id, "X-Demo-Role": "supervisor"},
    )
    assert accepted.status_code == 200
    assert accepted.json()["decision"] == "ACCEPTED"
    assert accepted.json()["version"] == 2

    listed = client.get("/demo/v1/records", params={"after": 0, "limit": 10})
    assert listed.status_code == 200
    assert listed.json()["items"][0]["id"] == record_id
    assert listed.json()["next_cursor"] >= 1


def test_photo_upload_rejects_untrusted_bytes(tmp_path):
    app.state.demo_data_dir = tmp_path
    photo = b"not-an-image"
    digest = hashlib.sha256(photo).hexdigest()
    record_id = str(uuid.uuid4())
    assert client.post(
        "/demo/v1/records",
        json=record(record_id, digest),
        headers={"Idempotency-Key": record_id},
    ).status_code == 201

    response = client.put(
        f"/demo/v1/records/{record_id}/photo",
        content=photo,
        headers={"Content-Type": "image/png", "X-Content-SHA256": digest},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_FAILED"


def test_invalid_demo_metadata_uses_problem_contract(tmp_path):
    app.state.demo_data_dir = tmp_path
    response = client.post(
        "/demo/v1/records",
        json={"fixture_id": "REAL-WATER"},
        headers={"Idempotency-Key": "not-a-record"},
    )
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["code"] == "VALIDATION_FAILED"
