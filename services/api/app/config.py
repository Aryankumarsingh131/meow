"""Runtime configuration.

Startup validates required values and refuses unsafe production defaults, per
jalsakshi-blueprint/docs/engineering/deployment-and-operations.md. Secrets come from the environment,
never from a committed file.
"""

from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="JALSAKSHI_", env_file=".env")

    environment: Environment = "development"

    # Empty is legal in development only; the validator below enforces that.
    database_url: str = ""
    oidc_issuer: str = ""
    oidc_audience: str = ""

    # data_mode is server-owned, never client-supplied (jalsakshi-blueprint/docs/architecture/data-model.md).
    tenant_data_mode: Literal["synthetic", "research", "operational"] = "synthetic"

    request_timeout_seconds: float = Field(default=8.0, gt=0)

    @model_validator(mode="after")
    def refuse_unsafe_production_defaults(self) -> "Settings":
        if self.environment == "development":
            return self

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
