# ─────────────────────────────────────────────────────────────────────────
# DocFlow API — production-grade multi-stage image
# Stage 1 (deps): pnpm install with frozen lockfile, prisma generate
# Stage 2 (build): nest build (tsc + webpack) → dist/
# Stage 3 (runtime): dist/ + production node_modules + prisma client + non-root user
#
# Build:   docker build -f apps/api/Dockerfile -t docflow/api:tag .
# Run:     docker run -p 4000:4000 docflow/api:tag
#
# Image size target: ~250 MB on alpine
# ─────────────────────────────────────────────────────────────────────────

# ───────────────────────── Stage 1: deps ─────────────────────────
FROM node:22-alpine AS deps

# Required for Prisma engines (binary download) + native bcrypt fallback
RUN apk add --no-cache python3 make g++ openssl

WORKDIR /repo

# Enable pnpm via corepack (ships with Node 22)
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy ONLY manifests first for maximum layer-cache reuse.
# Workspace resolution requires package.json from packages/shared.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# Install all deps (including dev — needed by the build stage)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @docflow/api... --ignore-scripts

# ───────────────────────── Stage 2: build ────────────────────────
FROM node:22-alpine AS build

WORKDIR /repo

# Carry the install from the previous stage
COPY --from=deps /repo/ ./

# Generate the Prisma client against the committed schema.
# `prisma generate` runs the postinstall hooks that pnpm --ignore-scripts skipped.
WORKDIR /repo/apps/api
RUN npx prisma generate

# Compile the NestJS app
RUN pnpm --filter @docflow/api run build

# Re-install with prod-only deps so dev tooling isn't shipped.
# We do this in the build stage (not runtime) so the final layer stays small.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @docflow/api... --ignore-scripts

# ───────────────────────── Stage 3: runtime ──────────────────────
FROM node:22-alpine AS runtime

# tini for proper PID 1 + signal handling, wget for healthcheck
RUN apk add --no-cache tini wget

ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS="--enable-source-maps"

# Dedicated non-root user (UID 10001 — safe on most host filesystems)
RUN addgroup -g 10001 -S docflow \
 && adduser  -u 10001 -S docflow -G docflow -h /app -s /sbin/nologin

WORKDIR /app

# Copy the compiled app + production node_modules + prisma schema (runtime requires it)
COPY --from=build --chown=docflow:docflow /repo/apps/api/dist         ./dist
COPY --from=build --chown=docflow:docflow /repo/apps/api/node_modules ./node_modules
COPY --from=build --chown=docflow:docflow /repo/apps/api/prisma       ./prisma
COPY --from=build --chown=docflow:docflow /repo/packages              ./packages

USER docflow

EXPOSE 4000

# ─────────────── Health check (matches /api/v1/health) ──────────
# Aligned with the API's existing HealthController — cheap DB ping is enough for liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health | grep -q '"status":"ok"' || exit 1

# tini → node dist/src/main.js
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main.js"]