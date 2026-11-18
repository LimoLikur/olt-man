# syntax=docker/dockerfile:1
# Build context: repository root.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# --filter-prod: skip workspace devDependencies (mock-olt, test-only), whose source is not in git.
RUN pnpm --filter-prod "worker..." -r build \
 && pnpm --filter worker deploy --prod --legacy /out

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out .
USER node
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 CMD ["node", "dist/heartbeat/healthcheck.js"]
# DES-CBC (SNMPv3 "des56" privacy) is only in the OpenSSL 3 legacy provider.
CMD ["node", "--openssl-legacy-provider", "dist/main.js"]
