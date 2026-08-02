# GapOS

Turn a noticed knowledge gap into a source-grounded, audio-first course with verified practice —
and keep the resulting capability retrievable.

A learner defines a gap, supplies sources, and within ten minutes receives a seven-day curriculum
with audio lessons, transcripts and independently verified practice. The gap stays open until the
learner demonstrates and retains mastery.

## Status

Under active construction. See `tasks/backlog.yaml` for the task graph and `tasks/status.json`
for what is actually done, with evidence.

## Quick start

    pnpm install
    pnpm verify

That is the whole setup for development and tests: the default provider configuration is a set of
deterministic fakes, so no API keys and no external services are needed to run the suite.

For a database-backed run:

    pnpm local:up        # Postgres + MinIO via Docker Compose
    pnpm db:migrate
    pnpm --filter @gapos/web dev

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js PWA shell and API route handlers |
| `apps/worker` | durable generation worker |
| `packages/domain` | pure business rules: gap lifecycle, mastery, review scheduling |
| `packages/ai-contracts` | versioned zod contracts for every structured model call |
| `packages/provider-adapters` | LLM / speech interfaces plus deterministic fakes |
| `packages/database` | migrations, repositories, ownership enforcement |
| `packages/evaluation` | reference-pack scoring harness |
| `specs/` | OpenAPI and generation schemas — the contract source of truth |
| `docs/` | product, architecture, security and operations documentation |

## Documentation

- [`docs/PRODUCT.md`](docs/PRODUCT.md) — scope, journeys, domain model, success measures
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, pipeline, latency budget
- [`docs/SECURITY.md`](docs/SECURITY.md) — controls, AI-specific threats, data handling
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deployment, telemetry, cost, recovery
- [`AGENTS.md`](AGENTS.md) — the build rules every coding agent follows
