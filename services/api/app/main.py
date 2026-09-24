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

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import load_settings
from .demo import router as demo_router
from .errors import ApiError, api_error_handler, validation_error_handler
from .routes_v1 import router as v1_router

settings = load_settings()  # Validate deployment configuration at startup.

#: True only for a local synthetic dev stack. Both the synthetic demo router and
#: the M1 dev token issuer (ADR-M1-002) are mounted behind this single gate, so
#: neither can exist in staging or production. config.py independently refuses
#: to start production with synthetic data.
SYNTHETIC_DEV = settings.environment == "development" and settings.tenant_data_mode == "synthetic"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrate and seed at startup, not import: importing this module must not
    # touch the network (tests import it freely).
    if SYNTHETIC_DEV:
        from . import db, dev_seed

        conn = app.state.connect()
        try:
            db.migrate(conn)
            dev_seed.seed(conn)
        finally:
            conn.close()
    yield


app = FastAPI(title="JalSakshi API", version="0.1.0", lifespan=lifespan)
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
# Mounted everywhere; without `app.state.auth` every route answers 503.
app.include_router(v1_router)

if SYNTHETIC_DEV:
    app.state.demo_data_dir = ".data/demo"
    app.include_router(demo_router)

    # Imported inside the gate on purpose: outside development+synthetic the
    # issuer module is never even loaded, so no key is generated.
    from .db import connector
    from .dev_issuer import DevIssuer, build_router, load_or_create_key

    app.state.dev_issuer = DevIssuer(load_or_create_key())
    app.include_router(build_router(app.state.dev_issuer))
    app.state.auth = (app.state.dev_issuer.oidc_config(), app.state.dev_issuer.memberships.lookup)
    app.state.connect = connector(settings.database_url, Path(".data") / "dev.sqlite3")


@app.get("/health/live")
def live() -> dict[str, str]:
    """Public liveness. Exposes no dependency or configuration detail."""
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> JSONResponse:
    """Stay unready until database and identity checks are implemented."""
    return JSONResponse(status_code=503, content={"ready": False})
