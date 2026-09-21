"""JalSakshi API.

Skeleton only: health, config validation and the error contract. Domain routers
(sync, cases, lab reports, evidence, admin) are added by their own tasks against
jalsakshi-blueprint/docs/architecture/api-contracts.md.
"""

from fastapi import FastAPI

from app.config import Settings, load_settings
from app.errors import ApiError, api_error_handler

app = FastAPI(title="JalSakshi API", version="0.1.0")
app.add_exception_handler(ApiError, api_error_handler)

settings: Settings = load_settings()


@app.get("/health/live")
def live() -> dict[str, str]:
    """Public liveness. Exposes no dependency or configuration detail."""
    return {"status": "ok"}


@app.get("/health/ready")
def ready() -> dict[str, object]:
    """Readiness. Reports what is actually wired, never a blanket 'ready'."""
    checks = {
        "config": True,
        "database": bool(settings.database_url),
        "identity": bool(settings.oidc_issuer and settings.oidc_audience),
    }
    return {
        "ready": all(checks.values()),
        "checks": checks,
        "environment": settings.environment,
        "data_mode": settings.tenant_data_mode,
    }
