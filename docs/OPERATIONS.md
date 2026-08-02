# OPERATIONS

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
