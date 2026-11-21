# Engine image: follows the Caddy access log and posts verdicts. Build context is the repo root.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /bin/uv

ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY engine ./engine
COPY config ./config

RUN useradd --system --uid 10001 engine
USER engine

ENTRYPOINT ["python", "-m", "engine"]
CMD ["--help"]
