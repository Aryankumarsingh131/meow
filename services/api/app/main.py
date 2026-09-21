"""JalSakshi API.

Skeleton only: health, config validation and the error contract. Domain routers
(sync, cases, lab reports, evidence, admin) are added by their own tasks against
jalsakshi-blueprint/docs/architecture/api-contracts.md.
"""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import load_settings
from app.demo import router as demo_router
from app.errors import ApiError, api_error_handler, validation_error_handler

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
