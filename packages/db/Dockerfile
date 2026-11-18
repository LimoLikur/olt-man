# syntax=docker/dockerfile:1
# One-shot image: `migrate` (all profiles) and `seed` (dev). Build context: repository root.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Dev dependencies stay: the Prisma CLI runs the migrations.
RUN pnpm --filter "@olt/db..." -r build \
 && pnpm --filter @olt/db deploy --legacy /out

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
WORKDIR /app
COPY --from=build --chown=root:root /out .
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]
