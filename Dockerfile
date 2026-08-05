# GapOS — one image, two processes.
#
# Railway builds this image for the web service (default CMD) and the worker service
# (custom start command). Next binds $PORT (Railway injects it); the daemon needs none.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter @gapos/web build

FROM build AS runtime
EXPOSE 3000
# The web service: Next on $PORT (Railway's healthcheck probes /api/health).
CMD ["pnpm", "--filter", "@gapos/web", "start"]
