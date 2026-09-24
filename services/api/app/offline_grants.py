"""T45: offline grant — a bounded, server-issued lease for working offline.

security-and-privacy.md: "Offline entitlement provisionally lasts 72h and is
separate from online access token validity." api-contracts.md:
`POST /v1/session/offline-grant  device_id, client_build -> signed grant,
policy/version, expires_at  (Online member; server grants scope, not client)`.

The grant is NOT authority on the server. Every push still authenticates the
online token and re-reads membership (T06), so a revoked member is refused on
reconnect whatever the phone holds ("A grant does not override server
revocation"). The grant only bounds how long the phone may be used offline.

Not signed in M1: the phone cannot verify RS256 (Hermes has no crypto.subtle)
and a signature checked only against a key stored beside it adds nothing
against local tampering. Recorded as a T32 hardening item, not claimed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from .auth import Session

#: Assumption A08, PROVISIONAL: "Offline entitlement valid 72 h after online
#: provisioning". Not domain- or operator-approved (reviewed with T06 operator).
LEASE_HOURS = 72
POLICY_VERSION = 1

#: Roles that may record field samples offline (authorization-matrix.md: push
#: is worker/supervisor). Other roles get a grant that permits nothing offline.
OFFLINE_CAPTURE_ROLES = frozenset({"worker", "supervisor"})


class OfflineGrantRequest(BaseModel):
    device_id: UUID
    client_build: str = Field(min_length=1, max_length=160)


class OfflineGrant(BaseModel):
    grant_id: UUID
    subject: str
    tenant_id: str
    role: str
    device_id: UUID
    policy_version: int
    capture_offline: bool
    issued_at: str
    expires_at: str
    #: The server clock at issue. The phone measures the lease against its own
    #: clock from this instant, so a skewed phone clock cannot lengthen it.
    server_time: str
    limitation: Literal["Revocation cannot reach a phone that stays offline; the lease is the bound."]


def _iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


def issue_grant(session: Session, body: OfflineGrantRequest, *, now: datetime | None = None) -> OfflineGrant:
    issued = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    membership = session.membership
    return OfflineGrant(
        grant_id=uuid4(),
        subject=membership.user_id,
        tenant_id=membership.tenant_id,
        role=membership.role,
        device_id=body.device_id,
        policy_version=POLICY_VERSION,
        capture_offline=membership.role in OFFLINE_CAPTURE_ROLES,
        issued_at=_iso(issued),
        expires_at=_iso(issued + timedelta(hours=LEASE_HOURS)),
        server_time=_iso(issued),
        limitation="Revocation cannot reach a phone that stays offline; the lease is the bound.",
    )
