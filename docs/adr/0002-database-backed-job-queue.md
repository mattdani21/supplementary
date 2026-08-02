# ADR 0002: Database-backed durable job queue

- Status: accepted
- Date: 2026-08-02

## Context

Compilation is a multi-stage pipeline with parallel fan-out, partial publication, retries, and a
strict ten-minute budget. It must survive a worker restart without duplicating lessons, questions,
audio, or provider charges.

The options were a dedicated broker (Redis/SQS/Temporal) or the PostgreSQL instance we already
need for the domain data.

## Decision

Implement the queue in PostgreSQL, using `SELECT ... FOR UPDATE SKIP LOCKED` with leases.

- A job is *leased*, not deleted, when claimed. An expired lease returns the job to the queue.
- Job state changes and domain writes happen in the same transaction, so a published lesson and
  its step record can never disagree.
- Each step is keyed by `(run_id, step_name, input_version)` and is idempotent: re-running finds
  the existing output and returns it.
- Repeated failure moves the job to a dead-letter state carrying the last error.

## Consequences

- One fewer service to run, secure, back up and pay for.
- Exactly-once *effects* without distributed transactions, because effects and bookkeeping share
  a transaction.
- Throughput is bounded by Postgres. That is far above the private-beta workload; if it ever
  binds, the `JobQueue` interface allows a broker-backed implementation without touching pipeline
  code.
- Polling adds a small latency floor. Mitigated with short poll intervals and `LISTEN/NOTIFY`.
