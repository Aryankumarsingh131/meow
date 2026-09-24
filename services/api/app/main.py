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

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
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

#: Staging/production with a real identity provider (Supabase Auth) and a real
#: database. config.py already refuses to start these without database_url,
#: oidc_issuer and oidc_audience.
HOSTED = settings.environment != "development" and bool(settings.database_url and settings.oidc_issuer)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrate and seed at startup, not import: importing this module must not
    # touch the network (tests import it freely). All DDL is IF NOT EXISTS and
    # all seed inserts ON CONFLICT DO NOTHING, so every restart is safe.
    if SYNTHETIC_DEV or HOSTED:
        from . import db, dev_seed

        conn = app.state.connect()
        try:
            db.migrate(conn)
            # The synthetic catalogue only ever goes into a synthetic tenant
            # (production refuses synthetic mode in config.py).
            if settings.tenant_data_mode == "synthetic":
                dev_seed.seed(conn)
        finally:
            conn.close()
    yield


app = FastAPI(title="JalSakshi API", version="0.1.0", lifespan=lifespan)
app.state.tenant_data_mode = settings.tenant_data_mode
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)


async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Convert FastAPI's bare HTTPException (including 404 Not Found) into the
    RFC 7807 problem+json shape used by the rest of the API, so clients never
    see a raw {"detail": "..."} from framework internals."""
    from .errors import ApiError, problem_response

    code_map = {
        401: "AUTH_REQUIRED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        429: "RATE_LIMITED",
        503: "TEMPORARILY_UNAVAILABLE",
    }
    code = code_map.get(exc.status_code, "NOT_FOUND")
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return problem_response(request, ApiError(code=code, detail=detail))


app.add_exception_handler(HTTPException, _http_exception_handler)


def is_transient_db_error(exc: BaseException) -> bool:
    """Contention, not a fault: SQLite's single-writer lock, and PostgreSQL's
    statement timeout (3 s budget), lock timeout, deadlock and serialization
    failures. Every write is idempotent, so the client may simply retry."""
    import sqlite3

    if isinstance(exc, sqlite3.OperationalError):
        return "locked" in str(exc) or "busy" in str(exc)
    return getattr(getattr(exc, "diag", None), "sqlstate", None) in {"57014", "55P03", "40P01", "40001"}


@app.middleware("http")
async def transient_db_errors_are_retryable(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001 - re-raised unless transient
        if not is_transient_db_error(exc):
            raise
        from .errors import problem_response

        # T30: at 50 req/s the SQLite stack returned 500 for lock waits.
        return problem_response(request, ApiError(code="TEMPORARILY_UNAVAILABLE",
                                                  detail="The database is busy. Retry shortly."))

# The supervisor board is a separate web app at its own address, calling this
# API from the browser. CORS is opened ONLY to the origins listed in
# JALSAKSHI_CORS_ALLOWED_ORIGINS (comma-separated; empty = no cross-origin
# access). Bearer tokens, no cookies: allow_credentials stays False, so no
# ambient credential ever crosses origins and CSRF does not apply.
_origins = [o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=False,
        allow_methods=["GET", "HEAD", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
        max_age=600,
    )

# T33: added last, so it is the OUTERMOST layer: it sees every response
# (including the 503 mapping above) and every crash, and logs each request once.
from .telemetry import trace_requests  # noqa: E402

app.middleware("http")(trace_requests)

# Mounted everywhere; without `app.state.auth` every route answers 503.
app.include_router(v1_router)

if SYNTHETIC_DEV:
    app.state.demo_data_dir = ".data/demo"
    app.include_router(demo_router)

    # Created inside the gate on purpose: outside development+synthetic no
    # issuer is built, so no signing key is ever generated or loaded.
    from .db import connector
    from .dev_issuer import DevIssuer, build_router, load_or_create_key

    app.state.dev_issuer = DevIssuer(load_or_create_key())
    app.include_router(build_router(app.state.dev_issuer))
    app.state.auth = (app.state.dev_issuer.oidc_config(), app.state.dev_issuer.memberships.lookup)
    app.state.connect = connector(settings.database_url, Path(".data") / "dev.sqlite3")

    # T16. Evidence upload is enabled ONLY on the synthetic dev stack; every
    # other deployment keeps AC-018's default of no upload (routes answer 503
    # without these). ponytail: per-process random signing key - a shared,
    # configured key is needed before running more than one worker.
    import secrets

    app.state.evidence_upload_enabled = True
    app.state.evidence_key = secrets.token_bytes(32)
    app.state.evidence_dir = Path(".data") / "evidence"


if HOSTED:
    from .db import connector
    from .provider import HostedAuth, db_membership_lookup

    app.state.connect = connector(settings.database_url, Path(".data") / "unused.sqlite3")
    app.state.auth = HostedAuth(settings.oidc_issuer, settings.oidc_audience, db_membership_lookup(app.state.connect))


@app.api_route("/", methods=["GET", "HEAD"])
def root() -> dict[str, str]:
    """API root. Confirms the service is up; directs clients to the right path."""
    return {"service": "JalSakshi API", "version": "0.1.0", "docs": "/docs", "health": "/health/live"}


def _is_publishable(key: str) -> bool:
    """Only a publishable key may ever be served. A secret key pasted into the
    wrong variable (sb_secret_..., or a legacy JWT whose role is not anon) is
    refused, so this public endpoint can never leak it."""
    if key.startswith("sb_publishable_"):
        return True
    if key.count(".") == 2:  # legacy anon key: a JWT
        import base64
        import json

        try:
            body = key.split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
            return claims.get("role") == "anon"
        except ValueError:
            return False
    return False


@app.get("/auth/config")
def auth_config() -> JSONResponse:
    """How the app should sign in here. Public by design: the Supabase URL and
    publishable key are client-visible values (never the service_role key),
    served so the app build needs no key baked in."""
    if HOSTED and settings.supabase_url and _is_publishable(settings.supabase_publishable_key):
        return JSONResponse({"provider": "supabase", "url": settings.supabase_url.rstrip("/"),
                             "publishable_key": settings.supabase_publishable_key})
    if SYNTHETIC_DEV:
        return JSONResponse({"provider": "synthetic_dev_issuer"})
    return JSONResponse(status_code=503, content={"provider": None})


@app.get("/models/disabled")
def disabled_models() -> dict[str, list[str]]:
    """T37: on-device models switched off without an app release. Public: a
    file hash reveals nothing, and a phone must learn it even mid-sign-in."""
    return {"sha256": sorted({s.strip().lower() for s in settings.disabled_models.split(",") if s.strip()})}


@app.api_route("/health/live", methods=["GET", "HEAD"])
def live() -> dict[str, str]:
    """Public liveness. Exposes no dependency or configuration detail."""
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> JSONResponse:
    """Readiness check. Returns 200 when the database connector is configured."""
    if getattr(app.state, "connect", None) is not None:
        return JSONResponse(status_code=200, content={"ready": True})
    return JSONResponse(status_code=503, content={"ready": False})
