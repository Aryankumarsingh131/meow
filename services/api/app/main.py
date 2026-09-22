"""JalSakshi API.

Integrated 2026-09-22 from the sibling `meow` repository, which built the
service skeleton (health, configuration validation, error contract) and the
synthetic demo workflow, while this repository built the v1 contracts (T05),
authorization (T06) and the source catalogue (T07).

Domain routers (sync, cases, lab reports, evidence, admin) are added by their
own tasks against jalsakshi-blueprint/docs/architecture/api-contracts.md.

**`contracts/openapi.json` is NOT generated from this module.** It is a frozen
T05 deliverable generated from `app.contracts_app`, which carries only the two
v1 contract routes. Generating it from here would add `/health/*` and the
synthetic demo paths to the frozen document. See `contracts_app.py`.
"""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import load_settings
from .demo import router as demo_router
from .errors import ApiError, api_error_handler, validation_error_handler

app = FastAPI(title="JalSakshi API", version="0.1.0")
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)

settings = load_settings()  # Validate deployment configuration at startup.
if settings.environment == "development" and settings.tenant_data_mode == "synthetic":
    app.state.demo_data_dir = ".data/demo"
    app.include_router(demo_router)


@app.get("/health/live")
def live() -> dict[str, str]:
    """Public liveness. Exposes no dependency or configuration detail."""
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> JSONResponse:
    """Stay unready until database and identity checks are implemented."""
    return JSONResponse(status_code=503, content={"ready": False})
