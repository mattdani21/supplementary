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

Everything is configured by environment (see the table below) — three processes, no config
files. With Postgres + MinIO up (`pnpm local:up`):

    GAPOS_DATABASE_URL=<dsn> pnpm --filter @gapos/web dev        # UI (PWA) + HTTP API on :3000
    GAPOS_DATABASE_URL=<dsn> pnpm --filter @gapos/worker start   # the durable compile daemon
    GAPOS_DATABASE_URL=<dsn> pnpm --filter @gapos/cli start -- gap list   # the CLI, optional

Both the web app and the worker migrate the database on boot, so `pnpm db:migrate` is only
needed to run migrations on their own. Without a database the same commands run against
in-memory repositories (throwaway data, with a loud warning) — enough to try the UI and the
CLI immediately.

### The command line

    GAPOS_OWNER=<learner-id> pnpm --filter @gapos/cli start -- gap new --title "..." --statement "..."
    pnpm --filter @gapos/cli start -- gap list
    pnpm --filter @gapos/cli start -- gap <gapId>
    pnpm --filter @gapos/cli start -- source add <gapId> --file notes.md
    pnpm --filter @gapos/cli start -- source add <gapId> --text "one line of notes"
    pnpm --filter @gapos/cli start -- compile <gapId>
    pnpm --filter @gapos/cli start -- plan <gapId>
    pnpm --filter @gapos/cli start -- study <gapId>
    pnpm --filter @gapos/cli start -- mastery <gapId>

### Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `GAPOS_DATABASE_URL` | Postgres DSN; the web app and worker migrate on boot | in-memory (throwaway) |
| `GAPOS_TEST_DATABASE_URL` | Postgres DSN for the Postgres-backed test suites (skipped unless set) | — |
| `GAPOS_PROVIDER_MODE` | `fake` or `live` (live refuses to boot without keys) | `fake` |
| `GAPOS_LLM_API_KEY` / `_BASE_URL` / `_MODEL` | live language model | DeepSeek |
| `GAPOS_LLM_PRICE_INPUT_MILLICENTS_PER_MT` / `_OUTPUT_MILLICENTS_PER_MT` | live LLM price overrides (millicents per million tokens) | deepseek-chat list prices |
| `GAPOS_LLM_MODE=local` | local preset (Ollama/llama.cpp, no key) | — |
| `GAPOS_MODEL_ROUTING` | per-purpose routing, e.g. `planning:model-a,teaching:model-b` | — |
| `GAPOS_STT_API_KEY` / `_BASE_URL` / `_MODEL` | live speech-to-text | OpenAI-compatible |
| `GAPOS_STT_PRICE_MILLICENTS_PER_MINUTE` | live speech-to-text price override | — |
| `GAPOS_EMBEDDINGS_API_KEY` / `_BASE_URL` / `_MODEL` / `_DIMENSIONS` | live embeddings | OpenAI-compatible |
| `GAPOS_EMBEDDINGS_PRICE_MILLICENTS_PER_MT` | live embeddings price override | — |
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
