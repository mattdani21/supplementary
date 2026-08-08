# State

_Under active construction (README.md "Status"). Core engine done; not yet deployable._

## Current state

- All backlog tasks GAP-000 → GAP-031 plus GAP-014b are `done` with evidence (tasks/status.json, updated 2026-08-03): domain state machines, AI contracts + deterministic fakes, in-memory + Postgres repositories, durable queue/worker with resume, HTTP API (apps/web), offline PWA, CLI, evaluation pack with live baselines (9/9 fixtures pass on deepseek-v4-flash + Google TTS, GAP-014b).
- Quality gate green: `pnpm verify` = format:check + lint + typecheck + test (package.json). CI runs the quality gate plus a Postgres + MinIO database job (.github/workflows/ci.yml).
- tasks/backlog.yaml still lists GAP-020…GAP-031 as `ready`, but status.json records them done — status.json is the record of truth (backlog.yaml header).

## Broken / incomplete

- Not deployable: no root Dockerfile, no railway.json (open issue #6 "Deployable single-node: audio proxy for no-S3 storage, Dockerfile, railway.json"); only infra/local/docker-compose.yml (Postgres + MinIO) for development.
- Audio artefacts require S3/MinIO storage (GAPOS_STORAGE=s3); there is no no-S3 audio proxy path yet.
- Auth is a single X-Owner-Id header — no real identity; rate limiting absent (both explicitly deferred in GAP-021 out_of_scope).
- Live mode refuses to boot without keys (GAPOS_PROVIDER_MODE=live, packages/provider-adapters) — a staging run cannot silently be a fake run, by design.

## Blockers

- None recorded (tasks/status.json `"blockers": []`). Deploying publicly is a human approval gate (AGENTS.md §5: stop and ask a human before "deploying publicly").

## Test command

pnpm verify

Postgres suites (skipped loudly without GAPOS_TEST_DATABASE_URL): pnpm test packages/database

## Run command

`pnpm local:up` (Postgres + MinIO), then `pnpm db:migrate`; web + HTTP API: `pnpm --filter @gapos/web dev` (:3000); worker: `pnpm --filter @gapos/worker start` (README.md "Run it").
