"""T05: v1 contract schemas (Pydantic v2).

Implements the discriminated envelopes named in
jalsakshi-blueprint/docs/architecture/api-contracts.md:
  - sync-push sample events (discriminator: `kind`)
  - case commands (discriminator: `type`)

and the canonical sample structure from
jalsakshi-blueprint/docs/architecture/data-model.md. Field lengths/enums are
copied from those two documents, not invented. No threshold/concentration
value is defined here - `observation` fields carry ordinal bins and flags
only, matching AGENTS.md's "never fabricated precision" rule.

This is the source of truth `contracts/openapi.json` is generated from (see
services/api/app/main.py and README-adjacent generation command in
docs/agent-workflow/handoff-T05.md) - never hand-edit the generated
openapi.json or contracts/client.ts to "fix" something; fix it here instead.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# --- shared enums (api-contracts.md / data-model.md) -----------------------


class Method(str, Enum):
    assisted = "assisted"
    manual = "manual"


class IndicativeFlag(str, Enum):
    """'no_flag' means the tested parameter did not trigger that protocol's
    review rule - it is never a potability/safety claim (AGENTS.md)."""

    no_flag = "no_flag"
    review = "review"
    uncertain = "uncertain"
    invalid = "invalid"


class DataMode(str, Enum):
    synthetic = "synthetic"
    research = "research"
    operational = "operational"


# --- canonical sample (data-model.md "Canonical sample structure") ---------


class ProtocolRef(BaseModel):
    id: UUID
    version: int = Field(ge=1)


#: Read-window states the device timer (apps/mobile/src/timer.ts, T08) can
#: MEASURE. Mirrors T08's TimingState minus "indeterminate", which has its
#: own model below because it has no elapsed time at all.
MeasuredTimingState = Literal["preparing", "waiting", "in_window", "late", "expired"]

#: Why elapsed time could not be established. Mirrors T08's
#: ElapsedIndeterminateReason, plus `read_window_malformed` for a protocol
#: whose window is unusable (T08 returns indeterminate with no reason there).
IndeterminateReason = Literal[
    "reboot",
    "clock_rollback",
    "clock_disagreement",
    "monotonic_regression",
    "read_window_malformed",
]


class TimingMeasured(BaseModel):
    """Elapsed time was genuinely measured on a trustworthy clock.

    `valid` is not free for the client to assert: it must equal
    `state == "in_window"`, enforced below. protocol-schema.md makes the
    in-window case the ONLY valid one, so a client cannot send
    `state="expired", valid=true` and have the server believe it.
    """

    state: MeasuredTimingState
    elapsed_ms: int = Field(ge=0)
    valid: bool

    @model_validator(mode="after")
    def _valid_matches_state(self) -> "TimingMeasured":
        if self.valid != (self.state == "in_window"):
            raise ValueError(
                f"timing.valid={self.valid} contradicts state={self.state!r}; "
                "only 'in_window' is valid"
            )
        return self


class TimingIndeterminate(BaseModel):
    """Elapsed time could NOT be established (reboot, clock change, ...).

    Deliberately has NO `elapsed_ms`. The previous v1 shape required one, so
    a rebooted test could only be recorded by inventing a number
    (`elapsed_ms=0`) — fabricated precision, forbidden by AGENTS.md. Absence of
    the field is the only honest representation of "unknown".
    """

    # extra="forbid": pydantic otherwise IGNORES unknown fields, so a client
    # sending {"state": "indeterminate", "elapsed_ms": 0} would have the
    # guessed number silently dropped rather than refused. Contradictory input
    # at a trust boundary is rejected, not quietly cleaned.
    model_config = ConfigDict(extra="forbid")

    state: Literal["indeterminate"]
    reason: IndeterminateReason
    valid: Literal[False] = False


#: Discriminated on `state`. Replaces the original `{elapsed_ms, valid: bool}`,
#: which could not carry indeterminate timing and whose `valid: bool`
#: collapsed late / expired / indeterminate into one indistinguishable value.
#: Contract change recorded in docs/agent-workflow/handoff-T05.md.
Timing = Annotated[Union[TimingMeasured, TimingIndeterminate], Field(discriminator="state")]


class Observation(BaseModel):
    """Machine suggestion and human observation are kept as distinct
    optional fields (machine_bin / manual_bin / selected_bin) rather than
    ever collapsed into one 'result' field - this is the AGENTS.md
    provenance-separation rule expressed as a schema shape, not a comment."""

    machine_bin: Optional[str] = Field(default=None, max_length=64)
    manual_bin: Optional[str] = Field(default=None, max_length=64)
    selected_bin: Optional[str] = Field(default=None, max_length=64)
    indicative_flag: IndicativeFlag
    quality_reasons: list[str] = Field(default_factory=list, max_length=32)
    model_version: Optional[str] = Field(default=None, max_length=160)
    calibration_version: Optional[str] = Field(default=None, max_length=160)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class CanonicalSampleV1(BaseModel):
    schema_version: Literal[1] = 1
    sample_id: UUID
    source_id: UUID
    protocol: ProtocolRef
    kit_lot_id: UUID
    captured_at_device: datetime
    timing: Timing
    method: Method
    observation: Observation
    evidence_ids: list[UUID] = Field(default_factory=list)
    client_build: str = Field(min_length=1, max_length=160)
    # data-model.md: "the server sets it, not the client" - accepted here so
    # the envelope round-trips, but a real endpoint must overwrite this from
    # tenant policy rather than trust it. See docs/feature-schema.md-style
    # note in docs/agent-workflow/handoff-T05.md for why it stays in the
    # schema instead of being silently dropped.
    data_mode: DataMode

    @field_validator("captured_at_device")
    @classmethod
    def _tz_aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("captured_at_device must be timezone-aware (UTC)")
        return v


class SampleCorrectionSampleV1(CanonicalSampleV1):
    """sample.correct payload: same shape, plus the required pointer to the
    record it supersedes (data-model.md `samples.supersedes_id`)."""

    supersedes_id: UUID


class SampleCreateEvent(BaseModel):
    event_id: UUID
    kind: Literal["sample.create"]
    schema_version: Literal[1] = 1
    payload: CanonicalSampleV1


class SampleCorrectEvent(BaseModel):
    event_id: UUID
    kind: Literal["sample.correct"]
    schema_version: Literal[1] = 1
    payload: SampleCorrectionSampleV1


SampleEvent = Annotated[Union[SampleCreateEvent, SampleCorrectEvent], Field(discriminator="kind")]


class PushRequest(BaseModel):
    """POST /v1/sync/push envelope. Batch bound (50) matches
    api-contracts.md 'Common rules' - not an arbitrary number picked here."""

    device_id: UUID
    events: list[SampleEvent] = Field(min_length=1, max_length=50)


# --- case commands (api-contracts.md "Case commands") -----------------------


class _CaseCommandBase(BaseModel):
    command_id: UUID
    expected_version: int = Field(ge=1)


class AssignPayload(BaseModel):
    owner_id: UUID


class AssignCommand(_CaseCommandBase):
    type: Literal["assign"]
    payload: AssignPayload


class ReferToLabPayload(BaseModel):
    lab_name: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=2000)


class ReferToLabCommand(_CaseCommandBase):
    type: Literal["refer_to_lab"]
    payload: ReferToLabPayload


class RecordActionPayload(BaseModel):
    description: str = Field(min_length=1, max_length=2000)
    owner_id: UUID
    due_at: datetime


class RecordActionCommand(_CaseCommandBase):
    type: Literal["record_action"]
    payload: RecordActionPayload


class AcceptActionPayload(BaseModel):
    action_id: UUID


class AcceptActionCommand(_CaseCommandBase):
    type: Literal["accept_action"]
    payload: AcceptActionPayload


class LinkRetestPayload(BaseModel):
    retest_sample_id: UUID


class LinkRetestCommand(_CaseCommandBase):
    type: Literal["link_retest"]
    payload: LinkRetestPayload


class RecordCommunicationPayload(BaseModel):
    channel: str = Field(min_length=1, max_length=160)
    template_version: int = Field(ge=1)
    audience_description: str = Field(min_length=1, max_length=2000)


class RecordCommunicationCommand(_CaseCommandBase):
    type: Literal["record_communication"]
    payload: RecordCommunicationPayload


class RequestClosurePayload(BaseModel):
    disposition: Optional[str] = Field(default=None, max_length=2000)


class RequestClosureCommand(_CaseCommandBase):
    type: Literal["request_closure"]
    payload: RequestClosurePayload


class ClosePayload(BaseModel):
    """api-contracts.md: 'close includes verified_report_id,
    retest_sample_id or authorized exemption, action IDs or exemption,
    communication_id, disposition and policy_version.' The or-exemption
    pattern is enforced below, not just documented - this is what makes
    acceptance criterion 1 ('command discriminators reject invalid data')
    real rather than type-checking alone."""

    verified_report_id: Optional[UUID] = None
    verified_report_exemption_reason: Optional[str] = Field(default=None, max_length=2000)
    retest_sample_id: Optional[UUID] = None
    retest_exemption_reason: Optional[str] = Field(default=None, max_length=2000)
    action_ids: list[UUID] = Field(default_factory=list)
    action_exemption_reason: Optional[str] = Field(default=None, max_length=2000)
    communication_id: UUID
    disposition: str = Field(min_length=1, max_length=2000)
    policy_version: int = Field(ge=1)

    @model_validator(mode="after")
    def _evidence_or_exemption(self) -> "ClosePayload":
        if self.verified_report_id is None and not self.verified_report_exemption_reason:
            raise ValueError(
                "close requires verified_report_id or verified_report_exemption_reason"
            )
        if self.retest_sample_id is None and not self.retest_exemption_reason:
            raise ValueError("close requires retest_sample_id or retest_exemption_reason")
        if not self.action_ids and not self.action_exemption_reason:
            raise ValueError("close requires at least one action_id or action_exemption_reason")
        return self


class CloseCommand(_CaseCommandBase):
    type: Literal["close"]
    payload: ClosePayload


class ReopenPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class ReopenCommand(_CaseCommandBase):
    type: Literal["reopen"]
    payload: ReopenPayload


class DismissPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class DismissCommand(_CaseCommandBase):
    type: Literal["dismiss"]
    payload: DismissPayload


CaseCommandRequest = Annotated[
    Union[
        AssignCommand,
        ReferToLabCommand,
        RecordActionCommand,
        AcceptActionCommand,
        LinkRetestCommand,
        RecordCommunicationCommand,
        RequestClosureCommand,
        CloseCommand,
        ReopenCommand,
        DismissCommand,
    ],
    Field(discriminator="type"),
]


# --- error envelope (api-contracts.md "Common rules") -----------------------


class ProblemDetail(BaseModel):
    type: str
    title: str
    status: int
    code: str
    detail: str
    request_id: str
    field_errors: Optional[dict[str, list[str]]] = None
    retryable: bool
