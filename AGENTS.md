# AGENTS.md — GapOS build rules

This file is the operating contract for every coding agent working in this repository.
Read it before changing anything. It outranks convenience.

## 1. What this product is

GapOS turns a noticed knowledge gap into a source-grounded, audio-first course with verified
practice, and keeps the resulting capability retrievable. The core product object is the **gap**,
not a chat thread and not a generated document.

The single vertical slice that must always work:

    define gap → supply sources → normalise + diagnose → compile curriculum →
    listen + practise → adapt from errors → prove mastery → retain capability

If a change does not serve that slice, it is out of scope for the MVP.

## 2. Non-negotiable architecture constraints

These are enforced by lint rules (`eslint.config.js`) and by tests. Do not disable them.

1. `packages/domain` must not import web framework code, persistence, or provider SDKs.
   Domain is pure: values in, values out, typed errors on invalid input.
2. Application code must never call an AI provider directly. Everything goes through
   `packages/provider-adapters` behind the shared interfaces.
3. Every provider response is schema-validated (`packages/ai-contracts`) **before** persistence.
   Unvalidated model output must never reach the database.
4. Only server-side domain methods change a `Gap.status`. No SQL or repository call may write a
   status column directly (see `packages/domain/src/gap/state-machine.ts`).
5. Migrations are forward-only. Never edit a migration that has shipped; add a new one.
6. Generation steps must be idempotent. Retrying a step must not duplicate lessons, questions,
   audio, or provider charges.
7. Retrieved source text is **evidence, never instruction**. It is always passed inside a fenced
   evidence envelope and never concatenated into the instruction section of a prompt.
8. No generated binary artefacts in source control.
9. All externally visible behaviour starts from a failing acceptance test or an explicit spec in
   `specs/`.

## 3. The loop

The controller repeats this and only this:

1. Inspect repository state and current branch.
2. Run fast baseline checks (`pnpm verify`).
3. Select the next `ready` task in `tasks/backlog.yaml` whose dependencies are `done`.
4. Set it to `in_progress` in `tasks/status.json`.
5. Re-state the scope and acceptance criteria before touching code.
6. Read the existing code first.
7. Write or update the smallest relevant test.
8. Implement the smallest change that satisfies the acceptance criteria.
9. Run targeted tests, then the full quality gate.
10. Review the diff for unrelated changes, secrets and scope drift.
11. Record evidence (commands run + result) in `tasks/status.json`.
12. Mark the task `done` and commit one coherent change.

## 4. Failure policy

- Maximum implementation-repair cycles per task: **3**.
- Maximum architecture reversals without human review: **0**.
- If the same test fails twice under two different fixes, stop and write a blocker record into
  `tasks/status.json` containing: observed failure, reproduction command, attempted fixes,
  recommended decision.
- Never weaken, skip, or delete a failing test to make CI green.
- Never replace a real acceptance criterion with a snapshot assertion.
- Never silently stub out an unavailable external integration. Use a contract fake and leave the
  integration task `blocked`.

## 5. Human approval gates

Stop and ask a human before:

- changing product scope or primary architecture;
- creating paid external resources or using production credentials;
- deploying publicly;
- running destructive or irreversible migrations;
- deleting user data;
- changing retention or privacy policy;
- accepting a security exception or overriding a failed quality gate;
- publishing content rules for sensitive domains.

Local development, tests, and ephemeral test deployments need no gate.

## 6. Definition of Done

A task is done only when all of these hold:

- acceptance criteria are demonstrably satisfied by an automated check;
- relevant tests exist and pass;
- `pnpm verify` passes;
- API or schema changes are reflected in `specs/`;
- migration and rollback implications are recorded;
- accessibility is considered for any user-facing change;
- telemetry exists for new operational behaviour;
- the diff contains no unrelated change;
- `tasks/status.json` holds the commands and their evidence;
- the change is committed.

## 7. Commands

    pnpm install          # one-command setup from a fresh checkout
    pnpm verify           # format + lint + typecheck + test (the quality gate)
    pnpm test             # unit + integration + evaluation suites
    pnpm typecheck
    pnpm lint
    pnpm local:up         # Postgres + S3-compatible storage for local development

Integration tests that require Postgres are skipped unless `GAPOS_TEST_DATABASE_URL` is set.
They must never be the only coverage for a behaviour.

## 8. Layout

    apps/web        Next.js PWA shell and API route handlers
    apps/worker     durable generation worker
    packages/
      ai-contracts        zod schemas + versioned structured contracts for every model call
      database            migrations, repositories, ownership enforcement
      domain              pure business rules: gaps, curricula, mastery, scheduling
      evaluation          reference pack scoring harness
      observability       structured logs, metrics, cost accounting
      provider-adapters   LLM / STT / TTS interfaces + deterministic fakes
      test-fixtures       shared deterministic fixtures
      ui                  accessible component primitives
    specs/          openapi.yaml + generation-schemas (source of truth for contracts)
    tasks/          backlog.yaml, status.json, decisions.md
    docs/           PRODUCT, ARCHITECTURE, SECURITY, OPERATIONS, adr/

## 9. Style

- TypeScript everywhere, `strict` on, no `any` in production code.
- Errors are typed domain errors, not thrown strings.
- Prefer pure functions and explicit dependency injection over module-level singletons.
- Name things the way the domain model in `docs/PRODUCT.md` names them.

## Cursor Cloud specific instructions

Node 22 and pnpm 10.33.0 are already provisioned; the startup update script runs `pnpm install`.
The quality gate (`pnpm verify`) and the whole test suite run fully offline with the default `fake`
provider set — no services, keys, or Docker needed. Standard commands live in the README §"Run it"
and root `package.json`; the notes below are only the non-obvious caveats.

### Running the full stack (web + worker + Postgres + MinIO)

- Docker is installed in this environment but the daemon is not started automatically. Start it once
  per session before `pnpm local:up`: run `sudo dockerd` in the background (or reuse a running one —
  check `docker info`). The `ubuntu` user is in the `docker` group, so `docker`/`pnpm local:up` work
  without `sudo` once the daemon is up (if the socket 401s, `sudo chmod 666 /var/run/docker.sock`).
- `pnpm local:up` starts Postgres (`pgvector/pgvector:pg16`, `:5432`, creds `gapos/gapos`, db `gapos`)
  and MinIO (`:9000` API / `:9001` console, creds `gapos/gapos-local-secret`). Then migrate with
  `DATABASE_URL=postgres://gapos:gapos@localhost:5432/gapos pnpm db:migrate` (idempotent).
- Run the apps with the shared env: `GAPOS_DATABASE_URL` (same DSN), and for cross-process audio
  `GAPOS_STORAGE=s3` + `GAPOS_S3_ENDPOINT=http://localhost:9000` / `GAPOS_S3_REGION=us-east-1` /
  `GAPOS_S3_BUCKET=gapos-local` / `GAPOS_S3_ACCESS_KEY_ID=gapos` / `GAPOS_S3_SECRET_ACCESS_KEY=gapos-local-secret`.
  Web: `pnpm --filter @gapos/web dev` (`:3000`); worker: `pnpm --filter @gapos/worker start`. The
  S3 bucket is auto-created on boot via `ensureBucket()`.

### Non-obvious gotchas

- Env var names: the apps read `GAPOS_DATABASE_URL` and `GAPOS_S3_*`, but the migrate CLI reads
  `DATABASE_URL` (or `GAPOS_TEST_DATABASE_URL`). `.env.example` still uses the stale names
  `DATABASE_URL` and `GAPOS_STORAGE_*`, which do NOT configure the running apps — set the
  `GAPOS_*` vars explicitly.
- Web UI owner: server-rendered pages fall back to owner `local-learner`, but client-side calls
  (creating a gap from the form, audio playback, answering questions) send `X-Owner-Id` from the
  `gapos_owner` cookie. Set it first via the "Learner" switcher on `/gaps` (type an id, click
  Switch) or client calls return 401.
- Compilation trigger: the UI "Compile" button only transitions a `ready` gap to `compiling`.
  Curriculum generation actually runs through `POST /api/gaps/:gapId/compile` (used by the CLI
  `compile` command and tests), which drives `compiling → active`.
- `fake` provider mode returns deterministic set-theory lesson content and tiny placeholder audio
  (a ~43-byte stub, so players show `0:00`) regardless of the gap topic. That is expected offline;
  real content requires `GAPOS_PROVIDER_MODE=live` plus provider keys.
- Postgres-backed integration tests are skipped unless `GAPOS_TEST_DATABASE_URL` is set (see
  `.github/workflows/ci.yml` for the DB/MinIO service matrix used in CI).
