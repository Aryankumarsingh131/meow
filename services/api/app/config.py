"""Runtime configuration.

Startup validates required values and refuses unsafe production defaults, per
jalsakshi-blueprint/docs/engineering/deployment-and-operations.md. Secrets come from the environment,
never from a committed file.
"""

from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production"]


class Settings(BaseSettings):
    # hide_input_in_errors: a config error must never echo values (database
    # password, keys) into deployment logs.
    model_config = SettingsConfigDict(env_prefix="JALSAKSHI_", env_file=".env", hide_input_in_errors=True)

    environment: Environment = "development"

    # Empty is legal in development only; the validator below enforces that.
    database_url: str = ""
    oidc_issuer: str = ""
    oidc_audience: str = ""

    # data_mode is server-owned, never client-supplied (jalsakshi-blueprint/docs/architecture/data-model.md).
    tenant_data_mode: Literal["synthetic", "research", "operational"] = "synthetic"

    # Supabase. Declared explicitly because pydantic-settings forbids extra
    # inputs: an undeclared JALSAKSHI_* variable in .env makes Settings() raise
    # at import time and takes the whole API test suite down with it.
    #
    # The publishable ("anon") key is client-visible by design. The service_role
    # key must NEVER be added here - it bypasses row-level security, so it does
    # not belong in a value the application layer can read.
    supabase_url: str = ""
    supabase_publishable_key: str = ""

    request_timeout_seconds: float = Field(default=8.0, gt=0)

    # Origins of the separate supervisor board (and any other browser client),
    # comma-separated, exact scheme://host[:port]. Empty = no CORS at all.
    cors_allowed_origins: str = ""

    # T37 kill switch: SHA-256 of on-device model files the app must stop
    # using, comma-separated. Phones pick it up on their next online refresh.
    disabled_models: str = ""

    # 010 escalation emails (app/escalation.py). Empty smtp_host = emails stay queued.
    smtp_host: str = ""
    smtp_port: int = Field(default=587, gt=0, lt=65536)
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""
    smtp_starttls: bool = True
    escalation_interval_s: int = Field(default=300, ge=0)   # 0 turns the worker off
    dashboard_url: str = "http://127.0.0.1:5175"

    @model_validator(mode="after")
    def refuse_unsafe_production_defaults(self) -> "Settings":
        if self.environment == "development":
            return self

        # Supabase Auth's issuer is always <project URL>/auth/v1 and its access
        # tokens carry aud "authenticated", so the project URL is enough.
        if self.supabase_url and not self.oidc_issuer:
            self.oidc_issuer = self.supabase_url.rstrip("/") + "/auth/v1"
        if self.supabase_url and not self.oidc_audience:
            self.oidc_audience = "authenticated"

        missing = [
            name
            for name in ("database_url", "oidc_issuer", "oidc_audience")
            if not getattr(self, name)
        ]
        if missing:
            raise ValueError(
                f"{self.environment} requires {', '.join(sorted(missing))}; "
                "refusing to start with development defaults"
            )

        if self.environment == "production" and self.tenant_data_mode != "operational":
            raise ValueError(
                "production must run with tenant_data_mode=operational; "
                "synthetic data must not be served from production"
            )
        return self


def load_settings() -> Settings:
    return Settings()
