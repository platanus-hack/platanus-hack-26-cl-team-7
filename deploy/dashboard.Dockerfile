# Dashboard image: receives verdict webhooks and serves the one-page view on port 8090.
# Build context is the repo root.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /bin/uv

ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY dashboard ./dashboard

RUN useradd --system --uid 10001 dashboard && mkdir -p /data && chown dashboard /data
USER dashboard

EXPOSE 8090
CMD ["python", "-m", "dashboard", "--host", "0.0.0.0", "--port", "8090", "--db", "/data/verdicts.db"]
