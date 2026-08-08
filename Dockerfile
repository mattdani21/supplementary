# GapOS — one image, two processes.
#
# Railway builds this image for the web service (default CMD) and the worker service
# (custom start command). Next binds $PORT (Railway injects it); the daemon needs none.
#
#   web:    pnpm --filter @gapos/web start      (default CMD — `next start` on $PORT)
#   worker: pnpm --filter @gapos/worker start   (durable compile loop; use as the custom
#           start command of the worker service. It runs from TypeScript source via tsx,
#           so the image needs no separate worker compile step.)
#
# Both processes are configured entirely by GAPOS_* environment variables
# (docs/OPERATIONS.md "Deploying on Railway"); a deployment needs no config files.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# The workspace pins pnpm@10.33.0 in the packageManager field; activate it explicitly so
# the first pnpm invocation during the build never depends on a network round-trip.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
COPY scripts ./scripts
# Non-interactive install: pnpm aborts without a TTY if it ever needs to purge modules.
ENV CI=true
RUN pnpm install --frozen-lockfile

FROM deps AS build
# CI runs `pnpm lint`; the in-build ESLint pass is redundant and doubles the memory the
# builder needs (Next docs: eslint.ignoreDuringBuilds). The in-build type check stays on.
ENV NEXT_DISABLE_ESLINT=1
RUN pnpm --filter @gapos/web build

FROM build AS runtime
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
# The web service: Next on $PORT (Railway's healthcheck probes /api/health).
CMD ["pnpm", "--filter", "@gapos/web", "start"]
