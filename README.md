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

### Run it

Everything is configured by environment (see the table below). With Postgres + MinIO up
(`pnpm local:up`):

    pnpm db:migrate
    GAPOS_DATABASE_URL=<dsn> pnpm --filter @gapos/web dev       # the web app + HTTP API on :3000
    GAPOS_DATABASE_URL=<dsn> pnpm --filter @gapos/worker start  # the durable compile worker

Without a database the same commands run against in-memory repositories (throwaway data, with a
loud warning) — enough to try the UI and the CLI immediately.

### The command line

    GAPOS_DATABASE_URL=<dsn> pnpm --filter @gapos/cli start -- gap new --title "..." --statement "..."
    pnpm --filter @gapos/cli start -- source add <gapId> --file notes.md
    pnpm --filter @gapos/cli start -- compile <gapId>
    pnpm --filter @gapos/cli start -- study <gapId>

### Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `GAPOS_DATABASE_URL` | Postgres DSN; the API, daemon and CLI migrate on boot | in-memory |
| `GAPOS_PROVIDER_MODE` | `fake` or `live` (live refuses to boot without keys) | `fake` |
| `GAPOS_LLM_API_KEY` / `_BASE_URL` / `_MODEL` | live language model | DeepSeek |
| `GAPOS_LLM_MODE=local` | local preset (Ollama/llama.cpp, no key) | — |
| `GAPOS_MODEL_ROUTING` | per-purpose routing, e.g. `planning:model-a,teaching:model-b` | — |
| `GAPOS_STT_API_KEY` / `_BASE_URL` / `_MODEL` | live speech-to-text | OpenAI-compatible |
| `GAPOS_EMBEDDINGS_API_KEY` / `_BASE_URL` / `_MODEL` / `_DIMENSIONS` | live embeddings | OpenAI-compatible |
| `GAPOS_STORAGE` | `memory` or `s3` (requires the `GAPOS_S3_*` vars) | `memory` |
| `GAPOS_S3_ENDPOINT` / `_REGION` / `_BUCKET` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | S3-compatible object storage (MinIO) | — |
| `GAPOS_QUEUE_POLL_INTERVAL_MS` / `_LEASE_DURATION_MS` / `_CLAIM_BATCH` | worker loop tuning | 2000 / 300000 / 4 |
| `GAPOS_BUDGET_PER_RUN_MILLICENTS` / `GAPOS_BUDGET_DAILY_MILLICENTS` | cost ceilings | unlimited |
| `GAPOS_OWNER` | learner id for the CLI | `cli-learner` |
| `GAPOS_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` | `info` |

## Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js PWA shell and API route handlers |
| `apps/worker` | durable generation worker |
| `apps/cli` | `gapos` command-line study client |
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
