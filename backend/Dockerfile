# Streamlens API. Secrets are injected at runtime from Secret Manager —
# nothing from secrets/ is copied into the image.
FROM python:3.13-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.9.11 /uv /uvx /bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

COPY pyproject.toml uv.lock ./
COPY streamlens ./streamlens

RUN uv sync --frozen --no-dev

EXPOSE 8080

# Cloud Run sets PORT. /ready is the probe so a sleeping warehouse does not
# fail the revision.
CMD ["sh", "-c", "exec uv run --no-dev uvicorn streamlens.api:app --host 0.0.0.0 --port ${PORT:-8080}"]
