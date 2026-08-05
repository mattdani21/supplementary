# OPERATIONS

## Deployment surface

Three processes, all configured entirely by environment (full table in `README.md`):

| Process | Command | Purpose |
| --- | --- | --- |
| Web | `pnpm --filter @gapos/web start` | UI (PWA) + HTTP API on :3000 |
| Worker | `pnpm --filter @gapos/worker start` | durable compile queue loop |
| CLI | `pnpm --filter @gapos/cli start -- <cmd>` | terminal study client |

**Boot order.** The web and worker processes both run migrations on boot, so a deploy is:
start the worker, start the web app, run a smoke compilation (`gapos compile`), then open the
cohort. `GAPOS_DATABASE_URL` selects Postgres; without it both processes run in-memory with a
loud warning and must never be used for anything but a throwaway trial.

**Worker shutdown.** SIGTERM/SIGINT stops the poller after the in-flight job, releases the
pool, and exits 0. Restart recovery is the lease protocol: a job whose lease expired is
re-claimed and re-enters its run, reusing completed steps (idempotency) instead of duplicating
artefacts or charges.

**Live mode.** `GAPOS_PROVIDER_MODE=live` assembles all four adapters from `GAPOS_*` env
(language model, speech-to-text, text-to-speech, embeddings). The constructors refuse to boot
without keys — configuring the keys *is* the human approval gate. `GAPOS_LLM_MODE=local`
selects the Ollama/llama.cpp preset (localhost:11434/v1, no key); a local model only earns
production use by clearing the evaluation threshold (see Release gates).

**Object storage.** `GAPOS_STORAGE=s3` with `GAPOS_S3_*` env uses the SigV4 client (plain
fetch) against MinIO or any S3 endpoint. Uploads are screened before storage; identical files
are cached by checksum; signed URLs expire server-side.

**HTTP API.** All endpoints under `/api`, owner-scoped by the `X-Owner-Id` header:
users, gaps (create/list/get/transition/compile), sources (register/list), today, curriculum,
lesson, artefact audio URL, attempts, mastery, knowledge map, review queue, voice gap capture.
Bodies are zod-validated; errors map to HTTP statuses (400 validation, 401 owner header, 404
missing, 402 budget, 409 conflict, 422 screening).

**Offline (PWA).** The service worker caches same-origin GETs stale-while-revalidate; after a
first load the current lesson renders with the network cut. Writes never cache — offline they
fail loudly.

## Deploying on Railway

The repo ships `Dockerfile` + `railway.json` (Docker builder, healthcheck `/api/health` on
`$PORT`). The stack is four services in one project:

| Service | Image / source | Command | Notes |
| --- | --- | --- | --- |
| web | this repo (Dockerfile) | default CMD (`next start`) | the UI + API |
| worker | this repo (Dockerfile) | `pnpm --filter @gapos/worker start` | the compile loop; custom start command |
| postgres | Railway Postgres plugin | — | `GAPOS_DATABASE_URL` comes from the plugin |
| minio | `minio/minio` image | `server /data` | shared object storage; add a volume |

Variables on web **and** worker (identical, so either process can be the first boot):

    GAPOS_DATABASE_URL=<from the postgres plugin>
    GAPOS_PROVIDER_MODE=live
    GAPOS_LLM_API_KEY / GAPOS_LLM_MODEL
    GAPOS_STORAGE=s3
    GAPOS_S3_ENDPOINT=http://minio:9000
    GAPOS_S3_REGION=us-east-1
    GAPOS_S3_BUCKET=gapos
    GAPOS_S3_ACCESS_KEY_ID / GAPOS_S3_SECRET_ACCESS_KEY
    GAPOS_BUDGET_PER_RUN_CENTS / GAPOS_BUDGET_PER_USER_DAILY_CENTS

Both processes migrate on boot and self-provision the bucket (`ensureBucket`), so the
deploy order is: postgres + minio up, then web and worker (either first). The worker polls
the Postgres queue, so compiles enqueued through the web run in the worker and audio lands
in MinIO where the web's signed URLs reach it. No-S3 trial deploys work too: leave
`GAPOS_STORAGE` unset and audio is proxied through the API (bytes are served from the same
container that generated them — fine for one replica, not for horizontal scale).

The gate before flipping a deployed instance to real learners is the live-provider
evaluation (GAP-014b): `GAPOS_PROVIDER_MODE=live GAPOS_LLM_API_KEY=… pnpm test
tests/evaluation/live-provider.test.ts` against the exact model the instance runs.

## Environments

| Environment | Providers | Data |
| --- | --- | --- |
| Local | deterministic fakes by default | throwaway |
| Test | contract fixtures | isolated database and storage |
| Staging | real providers, strict budgets | synthetic or consented |
| Production | real providers | private beta only, after release acceptance |

`GAPOS_PROVIDER_MODE` selects the provider set. It defaults to `fake`; a real provider must be
opted into explicitly, so no test run can accidentally spend money.

## Release strategy

1. Deploy database migrations.
2. Deploy the worker.
3. Deploy the web application.
4. Run a smoke compilation.
5. Enable a small user cohort.
6. Monitor latency, failure rate and cost.
7. Expand gradually.

Feature flags gate real generation, audio, remediation and provider routing. Web and worker
versions have a tested rollback. A database is never rolled back by destructive guesswork —
forward-only migrations, with a compensating migration if a change must be undone.

## Release gates

A release candidate ships only when all of these pass:

- formatting, linting and static type checks;
- unit and integration suites;
- migration test from an empty database *and* from the prior release;
- no critical or high security finding outstanding;
- all P0 acceptance journeys;
- the evaluation suite, with no regression beyond the agreed tolerance;
- a reference compilation inside the ten-minute service target;
- accessibility smoke tests.

## Telemetry

Required signals:

- compilation duration by stage;
- model calls, tokens, audio characters, estimated cost;
- queue wait time;
- source extraction failures;
- schema-validation failures;
- audit findings by category;
- repair attempts and their success rate;
- audio generation failures;
- attempt correctness by objective;
- Day 1 and full-course publication latency.

Every log line is structured and carries `run_id`, `gap_id` and `step` where applicable. No user
content and no prompt bodies are logged.

## Cost controls

- Per-run budget and per-user daily budget, both enforced before the call is made.
- Source extraction and embeddings cached by checksum, so re-compiling a gap with the same
  sources costs nothing to re-ingest.
- Prompt and response version hashes recorded, so a cost regression can be attributed.
- Small capable models for classification and formatting; stronger models reserved for planning,
  complex teaching and verification.
- Only failed artefacts are regenerated.
- Text-only fallback when audio synthesis would exceed the budget — the curriculum survives, the
  audio degrades.

## Failure recovery

- Jobs are leased, not deleted, so a worker crash returns the job to the queue after the lease
  expires rather than losing it.
- Steps are idempotent, so a returned job re-runs safely.
- Repeated failures move a job to a dead-letter state with the last error and reproduction
  context; dead-lettered runs are visible in the operations view and can be replayed.
- A failed provider can be retried or substituted by policy without code changes.

## Runbooks

**Compilation stuck.** Check `GET /api/runs/:id` and the `generation_step` rows for the run. A
step in `running` past its lease is reclaimed automatically; if a step is `failed` three times,
the run is dead-lettered — read the error, fix or substitute the provider, then replay.

**Latency regression.** Compare stage durations against the budget table in `ARCHITECTURE.md`.
The usual causes are unbounded lesson concurrency, a slow provider, or an oversized source pack.

**Cost spike.** Check cost per run grouped by prompt version hash. A spike after a deploy is
almost always a prompt or model-routing change.

**Backup and restore.** Database backups are taken daily with point-in-time recovery. Restore is
rehearsed against staging before each release: restore the snapshot, run migrations, run the smoke
compilation.
