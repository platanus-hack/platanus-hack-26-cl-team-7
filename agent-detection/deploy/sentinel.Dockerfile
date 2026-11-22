# Sentinel image: API, SSE stream and the built dashboard on port 8787, SQLite in /data.
# Build context is the repo root; sentinel.Dockerfile.dockerignore keeps host node_modules out.
FROM node:24-slim

ENV CI=true SENTINEL_HOST=0.0.0.0 SENTINEL_DB=/data/sentinel.db
WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools
COPY landing ./landing
RUN pnpm install --frozen-lockfile && pnpm --filter @sentinel/web build

RUN mkdir -p /data && chown node /data
USER node

EXPOSE 8787
CMD ["pnpm", "--filter", "@sentinel/server", "start"]
