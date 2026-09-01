# ─────────────────────────────────────────────────────────────────────────
# DocFlow Web (Next.js 15 + React 19) — multi-stage standalone image
#
# Stage 1 (deps):  pnpm install (frozen lockfile)
# Stage 2 (build): next build with output: "standalone" → copy .next/standalone + static
# Stage 3 (runtime): minimal Alpine + node + standalone server, non-root
#
# NOTE: Next.js `output: "standalone"` must be set in next.config.ts to enable
#       the production self-contained build used below. See DEPLOYMENT.md.
#
# Build: docker build -f apps/web/Dockerfile -t docflow/web:tag .
# Run:   docker run -p 3000:3000 docflow/web:tag
#
# Image size target: ~400 MB on alpine
# ─────────────────────────────────────────────────────────────────────────

# ───────────────────────── Stage 1: deps ─────────────────────────
FROM node:22-alpine AS deps

WORKDIR /repo

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Workspace manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json     ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @docflow/web... --ignore-scripts

# ───────────────────────── Stage 2: build ────────────────────────
FROM node:22-alpine AS build

WORKDIR /repo

# Pull installed deps from the previous stage
COPY --from=deps /repo/ ./

WORKDIR /repo/apps/web

# Public env baked at build time (read by `next build` / `next runtimeConfig`)
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Build the standalone bundle. Build-time env vars only — runtime secrets go in headers.
RUN pnpm --filter @docflow/web run build

# Strip dev deps to slim the runtime install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @docflow/web... --ignore-scripts

# ───────────────────────── Stage 3: runtime ──────────────────────
FROM node:22-alpine AS runtime

RUN apk add --no-cache tini wget

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_OPTIONS="--enable-source-maps"

RUN addgroup -g 10001 -S docflow \
 && adduser  -u 10001 -S docflow -G docflow -h /app -s /sbin/nologin

WORKDIR /app

# Standalone output bundles the runtime + a minimal `node_modules` tree.
# Static assets and public/ live alongside it.
COPY --from=build --chown=docflow:docflow /repo/apps/web/.next/standalone ./apps/web
COPY --from=build --chown=docflow:docflow /repo/apps/web/.next/static     ./apps/web/.next/static
COPY --from=build --chown=docflow:docflow /repo/apps/web/public           ./apps/web/public
COPY --from=build --chown=docflow:docflow /repo/packages                  ./packages

USER docflow

EXPOSE 3000

# Lightweight HTTP probe against the homepage. A 200 response is enough for liveness;
# the deep `/api/v1/health` is owned by the API container, not the web.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]