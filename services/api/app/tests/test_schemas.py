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
        timing={"state": "in_window", "elapsed_ms": 30000, "valid": True},
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


class TimingDiscriminatorTests(unittest.TestCase):
    """The v1 `Timing` shape was changed from `{elapsed_ms, valid: bool}` to a
    discriminated union (2026-09-24, M1 T05 review). These pin why.

    The original shape could not record a rebooted test without inventing
    `elapsed_ms=0`, and its `valid: bool` made late / expired / indeterminate
    indistinguishable. Both contradict T08's device timer and AGENTS.md.
    """

    def _sample(self, timing: dict) -> CanonicalSampleV1:
        return CanonicalSampleV1(**make_valid_sample(timing=timing))

    def test_indeterminate_timing_needs_no_invented_number(self):
        s = self._sample({"state": "indeterminate", "reason": "reboot"})
        self.assertEqual(s.timing.state, "indeterminate")
        self.assertEqual(s.timing.reason, "reboot")
        self.assertFalse(s.timing.valid)
        # The honest shape has NO elapsed time at all.
        self.assertFalse(hasattr(s.timing, "elapsed_ms"))

    def test_indeterminate_cannot_carry_an_elapsed_time(self):
        # REJECTED, not silently dropped. Pydantic ignores unknown fields by
        # default, which would let a client send a guessed number and have it
        # vanish quietly; TimingIndeterminate forbids extras so the
        # contradiction surfaces as an error.
        with self.assertRaises(ValidationError):
            self._sample({"state": "indeterminate", "reason": "reboot", "elapsed_ms": 0})

    def test_indeterminate_can_never_be_valid(self):
        with self.assertRaises(ValidationError):
            self._sample({"state": "indeterminate", "reason": "reboot", "valid": True})

    def test_every_indeterminate_reason_is_accepted(self):
        for reason in ("reboot", "clock_rollback", "clock_disagreement",
                       "monotonic_regression", "read_window_malformed"):
            with self.subTest(reason=reason):
                self.assertEqual(self._sample({"state": "indeterminate", "reason": reason}).timing.reason, reason)

    def test_unknown_indeterminate_reason_rejected(self):
        with self.assertRaises(ValidationError):
            self._sample({"state": "indeterminate", "reason": "the_dog_ate_it"})

    def test_late_expired_and_indeterminate_are_now_distinguishable(self):
        late = self._sample({"state": "late", "elapsed_ms": 60000, "valid": False}).timing
        expired = self._sample({"state": "expired", "elapsed_ms": 130000, "valid": False}).timing
        indet = self._sample({"state": "indeterminate", "reason": "reboot"}).timing
        self.assertEqual({late.state, expired.state, indet.state}, {"late", "expired", "indeterminate"})

    def test_only_in_window_may_be_valid(self):
        self.assertTrue(self._sample({"state": "in_window", "elapsed_ms": 30000, "valid": True}).timing.valid)
        for state in ("preparing", "waiting", "late", "expired"):
            with self.subTest(state=state):
                self.assertFalse(
                    self._sample({"state": state, "elapsed_ms": 1000, "valid": False}).timing.valid
                )

    def test_a_client_cannot_claim_an_expired_capture_is_valid(self):
        # The lying-client case: the server must not believe `valid` blindly.
        with self.assertRaises(ValidationError):
            self._sample({"state": "expired", "elapsed_ms": 130000, "valid": True})

    def test_a_client_cannot_claim_an_in_window_capture_is_invalid(self):
        with self.assertRaises(ValidationError):
            self._sample({"state": "in_window", "elapsed_ms": 30000, "valid": False})

    def test_measured_timing_still_requires_a_non_negative_elapsed_time(self):
        with self.assertRaises(ValidationError):
            self._sample({"state": "late", "elapsed_ms": -1, "valid": False})
        with self.assertRaises(ValidationError):
            self._sample({"state": "late", "valid": False})

    def test_the_old_shape_is_rejected(self):
        # No discriminator -> rejected. The pre-review shape cannot be sent.
        with self.assertRaises(ValidationError):
            self._sample({"elapsed_ms": 60000, "valid": True})


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
