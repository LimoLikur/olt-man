# syntax=docker/dockerfile:1
# Caddy image that serves the built SPA. Build context: repository root.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter "ui..." -r build

FROM caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS runtime
# Run as an unprivileged user; data/config dirs are pre-owned so named volumes inherit it.
# The upstream binary carries a cap_net_bind_service file capability, which exec refuses under
# no-new-privileges + cap_drop ALL; copying drops it (low ports come from the sysctl instead).
RUN cp /usr/bin/caddy /usr/bin/caddy.nocap && mv /usr/bin/caddy.nocap /usr/bin/caddy \
 && addgroup -S -g 1000 caddy-app && adduser -S -D -H -u 1000 -G caddy-app caddy-app \
 && mkdir -p /data/caddy /config/caddy && chown -R 1000:1000 /data /config
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/ui/dist /srv
USER 1000:1000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:2019/config/ || exit 1
