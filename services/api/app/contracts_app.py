"""T05: minimal FastAPI app whose ONLY purpose is to generate a real
`contracts/openapi.json` from services/api/app/schemas.py - so that document
is produced by FastAPI's own generator, not hand-typed. It registers only
the two v1 routes this task's contracts touch (sync push, case commands);
every other route in
jalsakshi-blueprint/docs/architecture/api-contracts.md's endpoint inventory
is out of scope for T05 and deliberately not stubbed here to avoid
scaffolding unused endpoints.

Not a real backend: there is no database, no auth, no business logic. Do not
run this expecting it to accept real traffic - see
docs/agent-workflow/handoff-T05.md.

**Renamed from `main.py` during the meow integration (2026-09-22).** `main.py`
is now the real service (health, config validation, error contract, synthetic
demo router). This module stays separate on purpose: `contracts/openapi.json`
is a FROZEN T05 deliverable, and generating it from an app that also carries
health/demo routes would silently add those paths to the frozen document.
Keeping the contract surface isolated is what lets the regeneration stay
byte-identical.

Regeneration command (updated for the rename):

    python -c "from services.api.app.contracts_app import app; import json; \
        json.dump(app.openapi(), open('contracts/openapi.json','w'), indent=2); \
        open('contracts/openapi.json','a').write('\\n')"
"""

from __future__ import annotations

from fastapi import FastAPI, Response

from .schemas import CaseCommandRequest, ProblemDetail, PushRequest

app = FastAPI(
    title="JalSakshi API (v1 contracts only)",
    version="1.0.0",
    description=(
        "Contract-only surface generated for T05. Not a running backend - "
        "see docs/agent-workflow/handoff-T05.md."
    ),
)


@app.post(
    "/v1/sync/push",
    responses={422: {"model": ProblemDetail}, 409: {"model": ProblemDetail}},
    summary="Idempotent sample event batch push",
)
def sync_push(body: PushRequest) -> Response:
    raise NotImplementedError("contract-only stub; see docs/agent-workflow/handoff-T05.md")


@app.post(
    "/v1/cases/{case_id}/commands",
    responses={422: {"model": ProblemDetail}, 409: {"model": ProblemDetail}},
    summary="Role-checked, idempotent case command",
)
def case_command(case_id: str, body: CaseCommandRequest) -> Response:
    raise NotImplementedError("contract-only stub; see docs/agent-workflow/handoff-T05.md")
