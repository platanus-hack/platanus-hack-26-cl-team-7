# Mirror-lane image: the demo shop (real and twin), its data jobs (demo.seed, demo.mask, demo.sync)
# and the router (python -m mirror, which runs the engine Detector inline). Build context is the
# repo root. The volume mount points are created here, owned by the service user, so Docker gives
# each new named volume that owner; the Unix sockets are 0600 and every service runs as uid 10001.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /bin/uv

ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY engine ./engine
COPY demo ./demo
COPY mirror ./mirror
COPY config ./config

RUN useradd --system --uid 10001 mirror \
    && mkdir -p /run/edge /run/twin /data/real /data/twin /app/run \
    && chown mirror /run/edge /run/twin /data/real /data/twin /app/run
USER mirror
