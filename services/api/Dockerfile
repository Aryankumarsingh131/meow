# ── Stage 1: dependency installation ────────────────────────────────────────
# Use a slim build image to install deps; nothing from this stage leaks into
# the runtime image except the installed packages.
FROM python:3.11-slim AS builder

WORKDIR /build

# Install pip dependencies into an isolated prefix so we can COPY them cleanly.
# psycopg[binary] bundles libpq so we never need a system libpq in the image.
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt \
    && pip install --no-cache-dir --prefix=/install \
       uvicorn[standard]==0.32.0 \
       pydantic-settings>=2.6

# ── Stage 2: runtime image ───────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Non-root user. Render runs containers as root by default, but defence-in-
# depth: if we ever migrate to a stricter runtime this is already correct.
RUN useradd --no-create-home --shell /bin/false api

WORKDIR /app

# Copy installed packages from builder.
COPY --from=builder /install /usr/local

# Copy the application source into the SAME package path it has in the repo.
# The code's package root is `services.api` (app/db.py and app/sources.py do
# `from ..migrations import ...`), so it must be importable as
# `services.api.app.main`. Copying it to /app and running `app.main` makes
# `app` the top-level package and every `..` import fails at startup with
# "attempted relative import beyond top-level package".
# Build context is services/api/ (render.yaml rootDir), so services/__init__.py
# is outside it and is recreated here (it is empty in the repo).
COPY . services/api/
RUN touch services/__init__.py

ENV PYTHONPATH=/app

# Render injects PORT at runtime; default 8000 for local docker run.
ENV PORT=8000

# Do NOT bake secrets into the image. All JALSAKSHI_* vars come from
# Render's environment group at deploy time (see render.yaml).
# The app validates required vars at startup and refuses to start with
# missing production config (config.py → refuse_unsafe_production_defaults).

USER api

# Expose the port uvicorn listens on.
EXPOSE ${PORT}

# Production entrypoint. --workers 2 is safe on Render's free/starter tier
# (512 MB RAM). Raise to 4 on Standard+ instances.
# --no-access-log keeps log volume low; structured app logs are sufficient.
CMD ["sh", "-c", "uvicorn services.api.app.main:app --host 0.0.0.0 --port ${PORT} --workers 2 --no-access-log --proxy-headers --forwarded-allow-ips '*'"]
