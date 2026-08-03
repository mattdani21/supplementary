/**
 * The durable generation worker loop (GAP-015).
 *
 * Polls the job queue, leases due jobs, runs the pipeline for each, and records the outcome.
 * Three properties make this safe under crash and restart (docs/OPERATIONS.md):
 *
 *   - jobs are leased, not deleted — a worker that dies mid-run returns its job to the queue
 *     once the lease expires, and the same job is re-claimed;
 *   - generation steps are idempotent — re-running a job whose run already completed steps
 *     reuses the recorded output instead of duplicating artefacts or charges;
 *   - repeated failures dead-letter the job with its last error, and the payload is the
 *     reproduction context.
 *
 * The worker never decides whether a compile is allowed — that is the domain and the budget
 * check inside the pipeline — and it never touches `Gap.status` directly: the lifecycle helpers
 * go through the state machine, exactly like the synchronous API path.
 */

import type { Job, JobQueue, ObjectStore, UnitOfWork } from '@gapos/database';
import type { Logger, Metrics } from '@gapos/observability';
import type { Providers } from '@gapos/provider-adapters';
import { compileGap } from '../pipeline/compile.js';
import { beginCompilation, finishCompilation } from '../pipeline/lifecycle.js';

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_LEASE_DURATION_MS = 5 * 60_000;
export const DEFAULT_CLAIM_BATCH = 4;

export interface CompileWorkerDeps {
  readonly queue: JobQueue;
  readonly uow: UnitOfWork;
  readonly storage: ObjectStore;
  readonly providers: Providers;
  readonly metrics: Metrics;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly newId: (prefix: string) => string;
}

export interface WorkerOptions {
  readonly pollIntervalMs?: number;
  readonly leaseDurationMs?: number;
  readonly claimBatch?: number;
  /** When aborted, the loop stops after the current tick. */
  readonly signal?: AbortSignal;
}

export interface WorkerHandle {
  /** Run one poll-and-process cycle. Returns when this cycle's jobs are all finished. */
  readonly tick: () => Promise<void>;
  /** Start polling on an interval. Idempotent. */
  readonly start: () => void;
  /** Stop polling; an in-flight tick finishes. */
  readonly stop: () => Promise<void>;
}

export const createCompileWorker = (
  deps: CompileWorkerDeps,
  options: WorkerOptions = {},
): WorkerHandle => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const claimBatch = options.claimBatch ?? DEFAULT_CLAIM_BATCH;

  let timer: NodeJS.Timeout | undefined;
  let tickInFlight: Promise<void> | undefined;
  let stopped = false;

  const processJob = async (job: Job): Promise<void> => {
    const startedAt = deps.now();
    deps.metrics.observe('queue_wait_ms', startedAt.getTime() - job.createdAt.getTime(), {
      kind: job.kind,
    });
    deps.metrics.increment('job_claimed_total', { kind: job.kind });

    try {
      if (job.kind !== 'compile') throw new Error(`Unknown job kind: ${job.kind}`);

      // Each attempt runs under its own idempotency key, so a failed attempt's terminal run
      // never blocks the next attempt (startRun would dedupe to it). Attempt 1 keeps the
      // user's key; later attempts are suffixed, which is also how the run record stays
      // traceable to the job. Re-claiming the SAME attempt (a crash before the failure was
      // recorded) re-enters the same key, and resumeExisting re-enters the in-flight run.
      const attemptKey =
        job.attempts === 0
          ? job.payload.idempotencyKey
          : `${job.payload.idempotencyKey}#attempt-${job.attempts}`;

      // The gap lifecycle mirrors the synchronous path: `compiling` while the run executes
      // (a failed gap retries via retry_compilation), then the outcome moves it to active or
      // failed. The enqueue moved it once; a retried attempt must move it again.
      await beginCompilation(deps.uow, job.ownerId, job.payload.gapId);

      const outcome = await compileGap(
        {
          owner: job.ownerId,
          gapId: job.payload.gapId,
          idempotencyKey: attemptKey,
        },
        {
          uow: deps.uow,
          storage: deps.storage,
          providers: deps.providers,
          metrics: deps.metrics,
          logger: deps.logger,
          now: deps.now,
          newId: deps.newId,
          resumeExisting: true,
          ...(job.payload.concurrency === undefined
            ? {}
            : { concurrency: job.payload.concurrency }),
          ...(job.payload.audioEnabled === undefined
            ? {}
            : { audioEnabled: job.payload.audioEnabled }),
        },
      );

      await finishCompilation(deps.uow, job.ownerId, job.payload.gapId, outcome);

      if (outcome.status === 'failed') {
        await deps.queue.fail(
          job.ownerId,
          job.id,
          outcome.error ?? 'Compilation failed',
          deps.now(),
        );
        deps.metrics.increment('job_failed_total', { kind: job.kind });
        return;
      }

      await deps.queue.complete(job.ownerId, job.id);
      deps.metrics.increment('job_completed_total', { kind: job.kind, status: outcome.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.logger.error('Job failed', { jobId: job.id, error: message });
      await deps.queue.fail(job.ownerId, job.id, message, deps.now());
      deps.metrics.increment('job_failed_total', { kind: job.kind });
    }
  };

  const tick = async (): Promise<void> => {
    if (tickInFlight) return tickInFlight;
    tickInFlight = (async () => {
      try {
        const jobs = await deps.queue.claimDue(deps.now(), claimBatch, leaseDurationMs);
        for (const job of jobs) {
          await processJob(job);
        }
      } catch (error) {
        deps.logger.error('Worker tick failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        tickInFlight = undefined;
      }
    })();
    return tickInFlight;
  };

  const start = (): void => {
    if (timer || stopped) return;
    void tick();
    timer = setInterval(() => void tick(), pollIntervalMs);
    timer.unref?.();
  };

  const stop = async (): Promise<void> => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = undefined;
    if (tickInFlight) await tickInFlight;
  };

  options.signal?.addEventListener('abort', () => void stop(), { once: true });

  return { tick, start, stop };
};
