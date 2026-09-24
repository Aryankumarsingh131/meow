"""T16: private evidence upload boundary.

Real app (development + synthetic), real T06 authenticate(), throwaway SQLite
and a throwaway evidence store. All fixtures are generated here and synthetic.

Run: python -m unittest tests.upload_test -v
Run PostgreSQL leg: set TEST_DATABASE_URL, same command.
"""

from __future__ import annotations

import hashlib
import io
import os
import struct
import tempfile
import unittest
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image

import tests.sync_push_test as t13
from services.api.app import dev_seed
from services.api.app import evidence as ev
from services.api.app.db import connector
from services.api.app.dev_issuer import _uid
from services.api.app.main import app
from services.api.app.upload_validation import MAX_PIXELS, inspect
from services.api.migrations.changefeed import statements as changefeed_statements
from services.api.migrations.evidence import statements as evidence_statements

WORKER = _uid("user.worker")
SUPERVISOR = _uid("user.supervisor")
OTHER_TENANT_WORKER = _uid("user.other-worker")


def jpeg(size: tuple[int, int] = (64, 48)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (120, 40, 200)).save(out, "JPEG", quality=80)
    return out.getvalue()


def png(size: tuple[int, int] = (32, 32)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (10, 200, 30)).save(out, "PNG")
    return out.getvalue()


def png_claiming(width: int, height: int) -> bytes:
    """A tiny, well-formed PNG whose header declares a huge canvas."""
    data = bytearray(png((1, 1)))
    ihdr = bytearray(data[16:29])
    ihdr[0:8] = struct.pack(">II", width, height)
    data[16:29] = ihdr
    data[29:33] = struct.pack(">I", zlib.crc32(b"IHDR" + bytes(ihdr)) & 0xFFFFFFFF)
    return bytes(data)


def pdf(pages: int = 1, extra: bytes = b"") -> bytes:
    body = b"".join(b"%d 0 obj<</Type /Page>>endobj\n" % (i + 2) for i in range(pages))
    return b"%PDF-1.4\n1 0 obj<</Type /Pages>>endobj\n" + body + extra + b"trailer<<>>\n%%EOF\n"


class InspectionTests(unittest.TestCase):
    """The object is judged by its bytes and decoder output, never its label."""

    def test_valid_images_are_available(self) -> None:
        self.assertEqual(inspect(jpeg(), "image/jpeg").outcome, "available")
        self.assertEqual(inspect(png(), "image/png").outcome, "available")

    def test_hostile_inputs_are_rejected_with_a_reason(self) -> None:
        cases = {
            "html labelled png": (b"<html><script>alert(1)</script></html>", "image/png", "magic_mismatch"),
            "png labelled jpeg": (png(), "image/jpeg", "magic_mismatch"),
            "jpeg+zip polyglot": (jpeg() + b"PK\x03\x04" + b"\x00" * 26, "image/jpeg", "trailing_or_truncated_data"),
            "png+html polyglot": (png() + b"<script>x</script>", "image/png", "trailing_or_truncated_data"),
            "truncated jpeg": (jpeg()[:-40], "image/jpeg", "trailing_or_truncated_data"),
            "decompression bomb header": (png_claiming(5000, 5000), "image/png", "too_many_pixels"),
            "svg": (b"<svg/>", "image/svg+xml", "media_type_not_allowed"),
            "empty": (b"", "image/png", "empty"),
            "oversize": (b"\xff\xd8\xff" + b"\x00" * (5 * 1024 * 1024), "image/jpeg", "too_large"),
            "pdf with javascript": (pdf(extra=b"<</S /JavaScript /JS (app.alert(1))>>"), "application/pdf", "active_content"),
            "pdf over page limit": (pdf(pages=21), "application/pdf", "too_many_pages"),
            "not a pdf": (b"GIF89a....%%EOF", "application/pdf", "magic_mismatch"),
        }
        for name, (data, media, reason) in cases.items():
            with self.subTest(name):
                result = inspect(data, media)
                self.assertEqual((result.outcome, result.reason), ("rejected", reason))

    def test_pixel_limit_boundary(self) -> None:
        # A real image of exactly 16 MP is accepted; one pixel row more is
        # refused from the header alone, before any decoding.
        self.assertEqual(4000 * 4000, MAX_PIXELS)
        self.assertEqual(inspect(png((4000, 4000)), "image/png").outcome, "available")
        self.assertEqual(inspect(png_claiming(4000, 4001), "image/png").reason, "too_many_pixels")

    def test_a_structurally_valid_pdf_is_quarantined_not_released(self) -> None:
        result = inspect(pdf(), "application/pdf")
        self.assertEqual((result.outcome, result.reason), ("quarantined", "malware_scan_unavailable"))


class TokenTests(unittest.TestCase):
    key = b"k" * 32
    now = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)

    def token(self, **over: object) -> str:
        args = {"tenant_id": "t", "asset_id": "a", "method": "PUT", "size": 10, "expires": self.now + ev.URL_TTL}
        args.update(over)
        return ev.sign(self.key, **args)  # type: ignore[arg-type]

    def test_scope_expiry_and_tampering(self) -> None:
        good = self.token()
        self.assertIsNotNone(ev.verify(self.key, good, asset_id="a", method="PUT", now=self.now))
        self.assertIsNone(ev.verify(self.key, good, asset_id="b", method="PUT", now=self.now), "other asset")
        self.assertIsNone(ev.verify(self.key, good, asset_id="a", method="GET", now=self.now), "other method")
        self.assertIsNone(ev.verify(self.key, good, asset_id="a", method="PUT", now=self.now + ev.URL_TTL), "expired")
        self.assertIsNone(ev.verify(b"x" * 32, good, asset_id="a", method="PUT", now=self.now), "other key")
        body, _, mac = good.partition(".")
        forged = self.token(size=10**9).partition(".")[0] + "." + mac
        self.assertIsNone(ev.verify(self.key, forged, asset_id="a", method="PUT", now=self.now), "swapped claims")
        self.assertIsNone(ev.verify(self.key, body, asset_id="a", method="PUT", now=self.now), "no signature")


@unittest.skipUnless(hasattr(app.state, "dev_issuer"), "needs development+synthetic")
class EvidenceHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved = (app.state.connect, app.state.evidence_dir)
        app.state.connect = connector("", Path(cls.tmp.name) / "api.sqlite3")
        app.state.evidence_dir = Path(cls.tmp.name) / "evidence"
        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)
        app.state.connect, app.state.evidence_dir = cls.saved
        app.state.evidence_upload_enabled = True
        cls.tmp.cleanup()

    def auth(self, user: str = WORKER) -> dict[str, str]:
        return {"Authorization": f"Bearer {app.state.dev_issuer.mint(user)}"}

    def sample(self, user: str = WORKER) -> str:
        payload = t13.sample(f"s-{uuid4()}", dev_seed.source_id("src.1"))
        payload["sample_id"] = str(uuid4())
        response = self.client.post("/v1/sync/push", headers=self.auth(user), json={
            "device_id": str(uuid4()),
            "events": [{"event_id": str(uuid4()), "kind": "sample.create", "schema_version": 1, "payload": payload}],
        })
        self.assertEqual(response.json()["results"][0]["status"], "accepted", response.text)
        return payload["sample_id"]

    def intent(self, data: bytes, target: str, media: str = "image/jpeg", user: str = WORKER, asset: str | None = None):
        return self.client.post("/v1/evidence/intents", headers=self.auth(user), json={
            "asset_id": asset or str(uuid4()), "context": "sample_photo", "target_id": target,
            "bytes": len(data), "media_type": media, "sha256": hashlib.sha256(data).hexdigest(),
        })

    def upload(self, data: bytes, target: str, media: str = "image/jpeg", user: str = WORKER):
        intent = self.intent(data, target, media, user)
        self.assertEqual(intent.status_code, 200, intent.text)
        body = intent.json()
        put = self.client.put(body["upload_url"], content=data)
        self.assertEqual(put.status_code, 200, put.text)
        done = self.client.post(f"/v1/evidence/{body['asset_id']}/complete", headers=self.auth(user),
                                json={"sha256": hashlib.sha256(data).hexdigest()})
        return body["asset_id"], done

    def stored_objects(self) -> list[str]:
        store = app.state.evidence_dir
        return sorted(p.name for p in store.iterdir()) if store.exists() else []

    def test_authorised_upload_becomes_available_and_is_readable_only_with_a_scoped_url(self) -> None:
        data = jpeg()
        asset, done = self.upload(data, self.sample())
        self.assertEqual(done.json()["state"], "available")
        access = self.client.get(f"/v1/evidence/{asset}/access", headers=self.auth())
        self.assertEqual(access.status_code, 200, access.text)
        content = self.client.get(access.json()["read_url"])
        self.assertEqual(content.content, data)
        self.assertEqual(content.headers["x-content-type-options"], "nosniff")
        self.assertEqual(content.headers["content-disposition"], "attachment")
        self.assertIn("no-store", content.headers["cache-control"])
        # The upload URL cannot be used to read, and a read URL cannot write.
        self.assertEqual(self.client.get(f"/v1/evidence/{asset}/content?token=x").status_code, 403)

    def test_wrong_tenant_and_other_workers_are_denied_like_missing(self) -> None:
        asset, done = self.upload(jpeg(), self.sample())
        self.assertEqual(done.json()["state"], "available")
        missing = self.client.get(f"/v1/evidence/{uuid4()}/access", headers=self.auth())
        other_tenant = self.client.get(f"/v1/evidence/{asset}/access", headers=self.auth(OTHER_TENANT_WORKER))
        self.assertEqual((other_tenant.status_code, other_tenant.json()["code"]), (404, "NOT_FOUND"))
        self.assertEqual(other_tenant.json()["detail"], missing.json()["detail"])
        self.assertEqual(self.client.get(f"/v1/evidence/{asset}/access", headers=self.auth(SUPERVISOR)).status_code, 200)
        # Other tenant cannot attach to this tenant's sample, nor complete this asset.
        self.assertEqual(self.intent(jpeg(), self.sample(), user=OTHER_TENANT_WORKER).status_code, 404)
        stolen = self.client.post(f"/v1/evidence/{asset}/complete", headers=self.auth(OTHER_TENANT_WORKER), json={"sha256": "0" * 64})
        self.assertEqual(stolen.status_code, 404)
        self.assertEqual(self.client.get("/v1/evidence/not-a-uuid/access", headers=self.auth()).status_code, 404)

    def test_worker_cannot_read_a_capture_they_did_not_make(self) -> None:
        sample = self.sample()
        asset, done = self.upload(jpeg(), sample, user=SUPERVISOR)  # supervisor attaches to worker's sample
        self.assertEqual(done.json()["state"], "available")
        self.assertEqual(self.client.get(f"/v1/evidence/{asset}/access", headers=self.auth()).status_code, 404)
        # And a worker cannot attach to a sample someone else captured.
        supervisors_sample = self.sample(SUPERVISOR)
        self.assertEqual(self.intent(jpeg(), supervisors_sample).status_code, 404)

    def test_unsafe_content_is_rejected_and_its_bytes_are_not_kept(self) -> None:
        polyglot = jpeg() + b"PK\x03\x04" + b"\x00" * 26
        asset, done = self.upload(polyglot, self.sample())
        self.assertEqual((done.json()["state"], done.json()["reason"]), ("rejected", "trailing_or_truncated_data"))
        access = self.client.get(f"/v1/evidence/{asset}/access", headers=self.auth())
        self.assertEqual((access.status_code, access.json()["code"]), (409, "EVIDENCE_NOT_AVAILABLE"))
        conn = app.state.connect()
        try:
            key = conn.execute("SELECT storage_key FROM evidence_assets WHERE id = ?", (asset,)).fetchone()[0]
        finally:
            conn.close()
        self.assertNotIn(key, self.stored_objects(), "rejected bytes are deleted")
        disguised = b"<html>" + b"x" * 100
        _, done2 = self.upload(disguised, self.sample(), media="image/png")
        self.assertEqual(done2.json()["reason"], "magic_mismatch")

    def test_declared_metadata_is_enforced_before_any_bytes(self) -> None:
        sample = self.sample()
        self.assertEqual(self.intent(b"GIF89a", sample, media="image/gif").json()["code"], "VALIDATION_FAILED")
        self.assertEqual(self.intent(pdf(), sample, media="application/pdf").json()["code"], "VALIDATION_FAILED")
        big = self.client.post("/v1/evidence/intents", headers=self.auth(), json={
            "asset_id": str(uuid4()), "context": "sample_photo", "target_id": sample,
            "bytes": 5 * 1024 * 1024 + 1, "media_type": "image/jpeg", "sha256": "0" * 64,
        })
        self.assertEqual((big.status_code, big.json()["code"]), (413, "PAYLOAD_TOO_LARGE"))
        bad_hash = self.client.post("/v1/evidence/intents", headers=self.auth(), json={
            "asset_id": str(uuid4()), "context": "sample_photo", "target_id": sample,
            "bytes": 10, "media_type": "image/jpeg", "sha256": "not-a-hash",
        })
        self.assertEqual(bad_hash.status_code, 422)
        unknown_context = self.client.post("/v1/evidence/intents", headers=self.auth(), json={
            "asset_id": str(uuid4()), "context": "anything", "target_id": sample,
            "bytes": 10, "media_type": "image/jpeg", "sha256": "0" * 64,
        })
        self.assertEqual(unknown_context.status_code, 422)

    def test_uploaded_bytes_must_match_the_declared_hash_and_size(self) -> None:
        sample = self.sample()
        data = jpeg()
        body = self.intent(data, sample).json()
        swapped = jpeg((65, 48))
        swapped = swapped[: len(data)] if len(swapped) >= len(data) else swapped + b"\x00" * (len(data) - len(swapped))
        self.assertEqual(self.client.put(body["upload_url"], content=swapped).status_code, 200)
        done = self.client.post(f"/v1/evidence/{body['asset_id']}/complete", headers=self.auth(),
                                json={"sha256": hashlib.sha256(data).hexdigest()})
        self.assertEqual((done.json()["state"], done.json()["reason"]), ("rejected", "hash_mismatch"))

    def test_cancelled_or_oversize_upload_stores_nothing_and_a_renewed_intent_works(self) -> None:
        sample = self.sample()
        data = jpeg()
        asset = str(uuid4())
        body = self.intent(data, sample, asset=asset).json()
        before = self.stored_objects()
        short = self.client.put(body["upload_url"], content=data[: len(data) // 2])  # client aborted mid-upload
        self.assertEqual(short.status_code, 422)
        longer = self.client.put(body["upload_url"], content=data + b"\x00")
        self.assertEqual(longer.status_code, 422)
        self.assertEqual(self.stored_objects(), before, "no partial object kept")
        renewed = self.intent(data, sample, asset=asset).json()  # same asset, same metadata
        self.assertEqual(self.client.put(renewed["upload_url"], content=data).status_code, 200)
        done = self.client.post(f"/v1/evidence/{asset}/complete", headers=self.auth(), json={"sha256": hashlib.sha256(data).hexdigest()})
        self.assertEqual(done.json()["state"], "available")
        # Completed originals are immutable: no second upload URL, and a
        # different payload under the same asset id is a conflict.
        self.assertIsNone(self.intent(data, sample, asset=asset).json()["upload_url"])
        self.assertEqual(self.intent(jpeg((10, 10)), sample, asset=asset).json()["code"], "IDEMPOTENCY_MISMATCH")
        self.assertEqual(self.client.put(renewed["upload_url"], content=data).status_code, 403)

    def test_expired_and_forged_urls_are_refused(self) -> None:
        data = jpeg()
        body = self.intent(data, self.sample()).json()
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        expired = ev.sign(app.state.evidence_key, tenant_id="x", asset_id=body["asset_id"], method="PUT", size=len(data), expires=past)
        self.assertEqual(self.client.put(f"/v1/evidence/{body['asset_id']}/content?token={expired}", content=data).status_code, 403)
        forged = body["upload_url"].split("token=")[1][:-4] + "0000"
        self.assertEqual(self.client.put(f"/v1/evidence/{body['asset_id']}/content?token={forged}", content=data).status_code, 403)
        # A valid token for one asset does not open another.
        other = self.intent(jpeg((20, 20)), self.sample()).json()
        token = body["upload_url"].split("token=")[1]
        self.assertEqual(self.client.put(f"/v1/evidence/{other['asset_id']}/content?token={token}", content=data).status_code, 403)

    def test_sample_and_photo_states_are_independent(self) -> None:
        sample = self.sample()
        _, done = self.upload(jpeg() + b"trailing", sample)
        self.assertEqual(done.json()["state"], "rejected")
        conn = app.state.connect()
        try:
            status = conn.execute("SELECT status FROM samples WHERE id = ?", (sample,)).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(status, "accepted", "a rejected photo never changes the accepted sample")

    def test_an_issued_read_url_stops_working_when_the_asset_leaves_available(self) -> None:
        asset, done = self.upload(jpeg(), self.sample())
        url = self.client.get(f"/v1/evidence/{asset}/access", headers=self.auth()).json()["read_url"]
        self.assertEqual(self.client.get(url).status_code, 200)
        conn = app.state.connect()
        try:  # e.g. retention deletion (T47) after the link was handed out
            conn.execute("UPDATE evidence_assets SET state = 'deleted' WHERE id = ?", (asset,))
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(self.client.get(url).status_code, 403)

    def test_only_the_uploader_can_complete_an_upload(self) -> None:
        data = jpeg()
        body = self.intent(data, self.sample()).json()
        self.assertEqual(self.client.put(body["upload_url"], content=data).status_code, 200)
        digest = {"sha256": hashlib.sha256(data).hexdigest()}
        same_tenant = self.client.post(f"/v1/evidence/{body['asset_id']}/complete", headers=self.auth(SUPERVISOR), json=digest)
        self.assertEqual(same_tenant.status_code, 404)
        own = self.client.post(f"/v1/evidence/{body['asset_id']}/complete", headers=self.auth(), json=digest)
        self.assertEqual(own.json()["state"], "available")

    def test_upload_is_off_unless_enabled(self) -> None:
        app.state.evidence_upload_enabled = False
        try:
            response = self.intent(jpeg(), self.sample())
            self.assertEqual((response.status_code, response.json()["code"]), (403, "EVIDENCE_UPLOAD_DISABLED"))
        finally:
            app.state.evidence_upload_enabled = True

    def test_unauthenticated_requests_are_refused(self) -> None:
        self.assertEqual(self.client.post("/v1/evidence/intents", json={}).status_code, 401)
        self.assertEqual(self.client.get(f"/v1/evidence/{uuid4()}/access").status_code, 401)


try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None


@unittest.skipIf(psycopg is None, "psycopg not installed")
@unittest.skipIf(not os.environ.get("TEST_DATABASE_URL"), "TEST_DATABASE_URL not configured")
class PostgresEvidenceTests(unittest.TestCase):
    schema = "jalsakshi_test_t16"

    def setUp(self) -> None:
        self.db = psycopg.connect(os.environ["TEST_DATABASE_URL"])
        self.db.execute(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE")
        self.db.execute(f"CREATE SCHEMA {self.schema}")
        self.db.execute(f"SET search_path TO {self.schema}")
        for statement in (t13.source_statements("postgresql") + t13.sample_statements("postgresql")
                          + changefeed_statements("postgresql") + evidence_statements("postgresql")
                          + t13.case_statements("postgresql")):
            self.db.execute(statement)
        self.db.commit()
        t13.seed_sources(self.db)
        self.store = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        self.db.rollback()
        self.db.execute(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE")
        self.db.commit()
        self.db.close()

    def test_intent_upload_complete_access_on_postgres(self) -> None:
        worker = t13.session()
        body = t13.request(("pg-ev", "sample.create", t13.sample("pg-ev")))
        from services.api.app.sync_push import push_events
        push_events(self.db, worker, body, server_data_mode="synthetic", server_time="2026-09-24T12:00:00Z")
        data, key, now = png(), b"k" * 32, datetime.now(timezone.utc)
        intent = ev.create_intent(self.db, worker, ev.IntentRequest(
            asset_id=uuid4(), context="sample_photo", target_id=t13.uid("pg-ev"), bytes=len(data),
            media_type="image/png", sha256=hashlib.sha256(data).hexdigest()), key=key, enabled=True, now=now)
        self.assertIsInstance(intent, ev.IntentResponse)
        asset = str(intent.asset_id)
        token = intent.upload_url.split("token=")[1]
        self.assertIsInstance(ev.store_content(self.db, self.store, asset, token, data, key=key, now=now), ev.EvidenceState)
        done = ev.complete(self.db, worker, self.store, asset, hashlib.sha256(data).hexdigest(), now=now)
        self.assertEqual(done.state, "available")
        self.assertIsInstance(ev.grant_access(self.db, worker, asset, key=key, now=now), ev.AccessResponse)
        other = t13.session(t13.TENANT_B)
        self.assertEqual(ev.grant_access(self.db, other, asset, key=key, now=now), ev.NOT_FOUND)
        self.assertEqual(ev.grant_access(self.db, worker, "not-a-uuid", key=key, now=now), ev.NOT_FOUND)
        # Malformed id rolled back cleanly; the connection is still usable.
        self.assertIsInstance(ev.grant_access(self.db, worker, asset, key=key, now=now), ev.AccessResponse)


if __name__ == "__main__":
    unittest.main()
