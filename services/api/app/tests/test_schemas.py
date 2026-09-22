"""T05 Python-side schema unit tests (stdlib unittest, no new dependency).

Run: python -m unittest services.api.app.tests.test_schemas -v

Covers the one real business-rule check that ajv cannot express structurally
(ClosePayload's report-or-exemption requirement is a cross-field
model_validator, not a plain JSON Schema constraint) - see
tests/contracts.test.ts's comment on why that case is deliberately not
attempted there.
"""

import unittest
from datetime import datetime, timezone
from uuid import UUID, uuid4

from pydantic import TypeAdapter, ValidationError

from services.api.app.schemas import (
    CanonicalSampleV1,
    CaseCommandRequest,
    ClosePayload,
    IndicativeFlag,
    Method,
    Observation,
    ProtocolRef,
    PushRequest,
    SampleCreateEvent,
    SampleEvent,
    Timing,
)


def make_valid_sample(**overrides) -> dict:
    base = dict(
        schema_version=1,
        sample_id=str(uuid4()),
        source_id=str(uuid4()),
        protocol={"id": str(uuid4()), "version": 1},
        kit_lot_id=str(uuid4()),
        captured_at_device="2026-09-25T10:00:00Z",
        timing={"elapsed_ms": 60000, "valid": True},
        method="assisted",
        observation={
            "machine_bin": "bin_2",
            "manual_bin": None,
            "selected_bin": "bin_2",
            "indicative_flag": "review",
            "quality_reasons": [],
            "model_version": "research-0",
            "calibration_version": None,
            "confidence": None,
        },
        evidence_ids=[],
        client_build="demo-build-id",
        data_mode="synthetic",
    )
    base.update(overrides)
    return base


class CanonicalSampleTests(unittest.TestCase):
    def test_valid_sample_round_trips(self):
        data = make_valid_sample()
        sample = CanonicalSampleV1.model_validate(data)
        self.assertEqual(sample.schema_version, 1)
        self.assertEqual(sample.observation.indicative_flag, IndicativeFlag.review)
        # round trip: serialize back out and re-validate
        again = CanonicalSampleV1.model_validate_json(sample.model_dump_json())
        self.assertEqual(sample.sample_id, again.sample_id)

    def test_naive_datetime_rejected(self):
        data = make_valid_sample(captured_at_device="2026-09-25T10:00:00")  # no timezone
        with self.assertRaises(ValidationError):
            CanonicalSampleV1.model_validate(data)

    def test_machine_and_manual_bin_stay_distinct_fields(self):
        # AGENTS.md provenance-separation rule: machine suggestion and human
        # observation are never merged into one field. Assert the schema
        # keeps them addressable independently, not collapsed by validation.
        data = make_valid_sample()
        data["observation"]["machine_bin"] = "bin_2"
        data["observation"]["manual_bin"] = "bin_1"  # human disagrees with machine
        sample = CanonicalSampleV1.model_validate(data)
        self.assertEqual(sample.observation.machine_bin, "bin_2")
        self.assertEqual(sample.observation.manual_bin, "bin_1")
        self.assertNotEqual(sample.observation.machine_bin, sample.observation.manual_bin)


class SampleEventDiscriminatorTests(unittest.TestCase):
    def setUp(self):
        self.adapter = TypeAdapter(SampleEvent)

    def test_sample_create_accepted(self):
        event = self.adapter.validate_python(
            {
                "event_id": str(uuid4()),
                "kind": "sample.create",
                "schema_version": 1,
                "payload": make_valid_sample(),
            }
        )
        self.assertIsInstance(event, SampleCreateEvent)

    def test_sample_correct_requires_supersedes_id(self):
        with self.assertRaises(ValidationError):
            self.adapter.validate_python(
                {
                    "event_id": str(uuid4()),
                    "kind": "sample.correct",
                    "schema_version": 1,
                    "payload": make_valid_sample(),  # missing supersedes_id
                }
            )

    def test_unknown_kind_rejected(self):
        with self.assertRaises(ValidationError):
            self.adapter.validate_python(
                {
                    "event_id": str(uuid4()),
                    "kind": "sample.delete",
                    "schema_version": 1,
                    "payload": make_valid_sample(),
                }
            )


class PushRequestTests(unittest.TestCase):
    def test_batch_over_fifty_rejected(self):
        events = [
            {
                "event_id": str(uuid4()),
                "kind": "sample.create",
                "schema_version": 1,
                "payload": make_valid_sample(),
            }
            for _ in range(51)
        ]
        with self.assertRaises(ValidationError):
            PushRequest.model_validate({"device_id": str(uuid4()), "events": events})

    def test_fifty_events_accepted(self):
        events = [
            {
                "event_id": str(uuid4()),
                "kind": "sample.create",
                "schema_version": 1,
                "payload": make_valid_sample(),
            }
            for _ in range(50)
        ]
        req = PushRequest.model_validate({"device_id": str(uuid4()), "events": events})
        self.assertEqual(len(req.events), 50)


class ClosePayloadBusinessRuleTests(unittest.TestCase):
    """The one rule ajv cannot check structurally: this is why this file
    exists alongside tests/contracts.test.ts, not instead of it."""

    def _base(self, **overrides) -> dict:
        base = dict(
            verified_report_id=None,
            verified_report_exemption_reason="lab access unavailable, supervisor exemption on file",
            retest_sample_id=str(uuid4()),
            retest_exemption_reason=None,
            action_ids=[str(uuid4())],
            action_exemption_reason=None,
            communication_id=str(uuid4()),
            disposition="resolved, resident notified",
            policy_version=1,
        )
        base.update(overrides)
        return base

    def test_valid_close_with_exemptions_accepted(self):
        payload = ClosePayload.model_validate(self._base())
        self.assertIsNone(payload.verified_report_id)
        self.assertTrue(payload.verified_report_exemption_reason)

    def test_close_without_report_or_exemption_rejected(self):
        with self.assertRaises(ValidationError):
            ClosePayload.model_validate(
                self._base(verified_report_id=None, verified_report_exemption_reason=None)
            )

    def test_close_without_retest_or_exemption_rejected(self):
        with self.assertRaises(ValidationError):
            ClosePayload.model_validate(
                self._base(retest_sample_id=None, retest_exemption_reason=None)
            )

    def test_close_without_actions_or_exemption_rejected(self):
        with self.assertRaises(ValidationError):
            ClosePayload.model_validate(
                self._base(action_ids=[], action_exemption_reason=None)
            )


class CaseCommandDiscriminatorTests(unittest.TestCase):
    def setUp(self):
        self.adapter = TypeAdapter(CaseCommandRequest)

    def test_assign_command_accepted(self):
        cmd = self.adapter.validate_python(
            {
                "command_id": str(uuid4()),
                "expected_version": 1,
                "type": "assign",
                "payload": {"owner_id": str(uuid4())},
            }
        )
        self.assertEqual(cmd.type, "assign")

    def test_unknown_command_type_rejected(self):
        with self.assertRaises(ValidationError):
            self.adapter.validate_python(
                {
                    "command_id": str(uuid4()),
                    "expected_version": 1,
                    "type": "delete_case",
                    "payload": {},
                }
            )

    def test_expected_version_below_one_rejected(self):
        with self.assertRaises(ValidationError):
            self.adapter.validate_python(
                {
                    "command_id": str(uuid4()),
                    "expected_version": 0,
                    "type": "assign",
                    "payload": {"owner_id": str(uuid4())},
                }
            )


if __name__ == "__main__":
    unittest.main()
