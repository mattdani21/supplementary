# Root Dockerfile that builds and runs apps/web + apps/worker (issue #9)

## What changed

- **`Dockerfile`** — hardened the root build for both services:
  - Pinned pnpm to the workspace's `packageManager` version (`corepack prepare pnpm@10.33.0 --activate`) so the build never depends on a network round-trip at first `pnpm` use.
  - `ENV CI=true` for the install stage: pnpm aborts without a TTY when it needs to purge modules — a build from a dirty checkout would fail instead of recovering.
  - `ENV NEXT_DISABLE_ESLINT=1` in the build stage: CI already runs `pnpm lint`, and the in-build ESLint pass roughly doubles the builder memory (Next's documented `eslint.ignoreDuringBuilds` trade-off). The in-build type check stays on.
  - `ENV NEXT_TELEMETRY_DISABLED=1` in the runtime stage.
  - Documented both start commands in the header: web is the default `CMD` (`next start` on `$PORT`), worker is the custom start command (`pnpm --filter @gapos/worker start`, runs from source via tsx — no separate worker compile step needed).
- **`.dockerignore`** (new) — the build context is sources only. Without it, a checkout that has `node_modules/`, `.next/`, `.toolchain/` or core dumps present ships host artefacts into the image (foreign-platform binaries break `pnpm install --frozen-lockfile`) and the context balloons from ~1 MB to hundreds of MB. `.env*` is excluded even though the Dockerfile does not COPY it, so a future `COPY .` can never leak credentials into an image.
- **`apps/web/src/app/api/health/route.ts`** — the health probe no longer goes through the shared owner-requiring `run()` helper. Railway's healthcheck (railway.json `healthcheckPath: /api/health`) sends a plain GET with no `X-Owner-Id`; the old route answered 401, so a healthy deployment would look dead to the platform and restart forever. The route now answers `200 {ok:true}` without a header; boot-time errors still surface as 500. This is the only endpoint that deliberately skips ownership.
- **`apps/web/src/app/api/health/route.test.ts`** (new) — regression test: the probe answers 200 without an owner header.

## Why

M1 acceptance (GOAL.md): "a fresh deployment boots with env config only and serves a compiled course with audio." The Dockerfile from #6 was written but never built; this change makes it build reliably from any checkout state and makes the platform healthcheck actually pass so the deployment can reach healthy.

## How it was tested

- **Simulated the Docker build from a fresh checkout** (no Docker available in this sandbox): context assembled exactly as the Dockerfile COPYs it with `.dockerignore` semantics applied (1.3 MB context, zero `node_modules`/`.git` leakage) → `pnpm install --frozen-lockfile` (10.4 s) → `pnpm --filter @gapos/web build` (`next build` succeeded: compile, type-check, route table, 85 MB `.next`).
- **Booted both processes env-only** from that build (no `GAPOS_DATABASE_URL`, no S3, default fake providers):
  - web on `$PORT=3000`: `/api/health` answered `200 {ok:true}` with a header-less probe.
  - Full HTTP journey against the running server: create user (201) → create gap → register source (accepted) → transition define → compile (`run.status=complete`) → curriculum returns Day 1 lesson with an audio artefact → audio endpoint served the bytes (`audio/mpeg`, `FAKE-AUDIO:` payload) through the no-S3 proxy path. 8/8 smoke steps PASS.
  - worker: `pnpm --filter @gapos/worker start` boots, logs `gapos-worker started`, and on SIGTERM logs `gapos-worker stopped cleanly` and exits 0.
- **Quality gate** — `pnpm verify` passes end-to-end: `format:check` OK, `lint` OK, `typecheck` OK, `test` 401 passed / 26 skipped (4 Postgres/S3/live suites skip loudly without `GAPOS_TEST_DATABASE_URL`, as documented in STATE.md).

## Notes for the reviewer

- The web build's in-build type check needs a heap cap on very small builders (~700 MB); CI (7 GB runner) and standard builders are unaffected — no flag was added to the Dockerfile for this.
- Verification was performed in this sandbox on linux-arm64 / Node 22.17.1 / pnpm 10.33.0 (matching the CI toolchain); the `node:22-slim` image builds on any platform.
