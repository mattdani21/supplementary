/**
 * The durable job queue and worker loop against Postgres (GAP-015).
 *
 * The in-memory worker tests prove the loop's semantics. These prove the SQL layer the
 * production worker actually uses: atomic leasing, lease-expiry re-claim, backoff and
 * dead-lettering, JSONB payload round-trip — plus the resume path re-entering a run's
 * curriculum. Skipped loudly without `GAPOS_TEST_DATABASE_URL`.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { referencePlan } from '@gapos/test-fixtures';
import {
  createMemoryObjectStore,
  createPool,
  createPostgresJobQueue,
  ensureSchema,
  createPostgresUnitOfWork,
  migrate,
  truncateAll,
  type OwnerId,
} from '@gapos/database';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import type { Providers } from '@gapos/provider-adapters';
import { bootstrapDaemon } from '../../apps/worker/src/daemon.js';
import { enqueueCompile } from '../../apps/worker/src/queue/enqueue.js';
import { createCompileWorker } from '../../apps/worker/src/queue/worker.js';
import { PIPELINE_VERSION } from '../../apps/worker/src/pipeline/compile.js';
import { applyTransition, createGap } from '../../apps/web/src/server/services/gap-service.js';

const LEARNER: OwnerId = 'user_pg_worker';
const OTHER: OwnerId = 'user_pg_other';
const databaseUrl = process.env.GAPOS_TEST_DATABASE_URL;

const describeIfPostgres = databaseUrl ? describe : describe.skip;

describeIfPostgres('the durable worker on Postgres (GAP-015)', () => {
  const SCHEMA = 'test_postgres_worker';
  const pool = createPool(databaseUrl!, { max: 4, schema: SCHEMA });
  let context: ServerContext;
  let now: Date;
  let migrated = false;

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    if (!migrated) {
      await ensureSchema(pool, SCHEMA);
      await migrate(pool);
      migrated = true;
    }
    await truncateAll(pool);

    // Mutable clock: lease-expiry scenarios advance `now` past the lease.
    now = new Date('2026-08-02T09:00:00Z');
    context = createServerContext({
      uow: createPostgresUnitOfWork(pool),
      storage: createMemoryObjectStore(),
      queue: createPostgresJobQueue(pool),
      now: () => now,
    });
    await context.uow.users.create({
      id: LEARNER,
      email: `${LEARNER}@example.com`,
      locale: 'en',
      timezone: 'UTC',
    });
  });

  const seedGap = async () => {
    const gap = await createGap(context, LEARNER, {
      title: 'Postgres worker gap',
      rawStatement:
        'I understand basic set notation but need relations and proof techniques by Friday. ' +
        'I have 35 minutes per day.',
      dailyMinutes: 35,
    });
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });
    return gap;
  };

  it('leases a job atomically at the SQL level', async () => {
    const gap = await seedGap();
    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'pg-compile-1a',
    });

    const claimed = await context.queue.claimDue(context.now(), 10, 60_000);
    expect(claimed.map((j) => j.id)).toEqual([job.id]);
    // A second claim in the same tick window must not see the same job: it is leased.
    expect(await context.queue.claimDue(context.now(), 10, 60_000)).toEqual([]);
  });

  it('completes a compile job through the worker pipeline', async () => {
    const gap = await seedGap();
    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'pg-compile-1',
    });

    // The worker's tick claims (atomically) and processes the job end to end.
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    expect(await context.queue.get(LEARNER, job.id)).toMatchObject({ state: 'succeeded' });
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });
  });

  it('re-claims a job whose lease expired (a dead worker) and completes it once', async () => {
    const gap = await seedGap();
    await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'pg-compile-2',
    });

    // Worker A claims and dies. Its lease expires; a restarted worker's tick re-claims.
    await context.queue.claimDue(context.now(), 10, 100); // 100ms lease
    now = new Date('2026-08-02T09:00:00.300Z'); // advance the clock past the lease
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    const done = await context.queue.listByState(LEARNER, 'succeeded');
    expect(done).toHaveLength(1);
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });
  });

  it('dead-letters after max attempts with the last error, payload intact', async () => {
    const gap = await seedGap();
    await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'pg-compile-3',
      maxAttempts: 1,
    });

    // A provider failure dead-letters the job after maxAttempts: the compile
    // must fail, so inject a throwing language model for this scenario.
    const failingProviders: Providers = {
      mode: 'fake',
      languageModel: {
        name: 'fake-throwing',
        generate: async () => {
          throw new Error('provider boom');
        },
      },
      speechToText: {
        name: 'fake',
        transcribe: async () => {
          throw new Error('not used');
        },
      },
      textToSpeech: {
        name: 'fake',
        synthesise: async () => {
          throw new Error('not used');
        },
      },
      embeddings: {
        name: 'fake',
        embed: async () => undefined,
      },
    };
    const failingWorker = createCompileWorker(
      { ...context, providers: failingProviders },
      { leaseDurationMs: 60_000 },
    );
    await failingWorker.tick();

    const dead = (await context.queue.listByState(LEARNER, 'dead_letter'))[0];
    expect(dead?.state).toBe('dead_letter');
    expect(dead?.attempts).toBe(1);
    expect(dead?.lastError?.length).toBeGreaterThan(0);
    // The payload is the reproduction context, round-tripped through JSONB.
    expect(dead?.payload).toEqual({ gapId: gap.id, idempotencyKey: 'pg-compile-3' });
  });

  it('resumes an in-flight run: same run, same curriculum, one course', async () => {
    const gap = await seedGap();
    const idempotencyKey = 'pg-compile-4';

    // A crashed worker left the run in flight, its curriculum created.
    const { run } = await context.uow.generation.startRun(LEARNER, {
      id: context.newId('run'),
      gapId: gap.id,
      pipelineVersion: PIPELINE_VERSION,
      status: 'ingesting',
      idempotencyKey,
      startedAt: context.now(),
      costMillicents: 0,
    });
    const crashedCurriculum = await context.uow.curricula.create(LEARNER, {
      id: context.newId('cur'),
      gapId: gap.id,
      runId: run.id,
      version: 1,
      durationDays: 3,
      dailyMinutes: 35,
      status: 'draft',
      plan: referencePlan('gap_pg_resume'),
      createdAt: context.now(),
    });

    await enqueueCompile(context, LEARNER, { gapId: gap.id, idempotencyKey });
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });
    // The resumed run re-entered its own curriculum: one course, published.
    expect(await context.uow.curricula.get(LEARNER, crashedCurriculum.id)).toMatchObject({
      status: 'published',
    });
    const lessons = await context.uow.curricula.listLessons(LEARNER, crashedCurriculum.id);
    expect(lessons.filter((l) => l.publicationStatus === 'published')).toHaveLength(3);
  });

  it('keeps jobs tenant-scoped at the SQL level', async () => {
    const gap = await seedGap();
    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'pg-compile-5',
    });
    await context.queue.claimDue(context.now(), 10, 60_000);

    expect(await context.queue.get(OTHER, job.id)).toBeUndefined();
    expect(await context.queue.complete(OTHER, job.id)).toBeUndefined();
    expect(await context.queue.get(LEARNER, job.id)).toMatchObject({ state: 'leased' });
  });

  it('boots the daemon against Postgres (GAP-020)', async () => {
    // The daemon bootstraps the PUBLIC schema of the test database (raw URL,
    // no schema search_path) — clear its fixed-id leftovers so repeated runs
    // don't collide (the per-test truncateAll only touches the SCHEMA pool).
    const cleanupPool = createPool(databaseUrl!, { max: 2 });
    await cleanupPool.query('DELETE FROM jobs WHERE id = $1', ['pg-daemon-job-1']);
    await cleanupPool.query('DELETE FROM users WHERE id = $1', [LEARNER]);
    await cleanupPool.end();
    // The daemon's Postgres bootstrap path: pool + migrate + Postgres queue, all wired by env.
    const bundle = await bootstrapDaemon({
      GAPOS_DATABASE_URL: databaseUrl,
      GAPOS_PROVIDER_MODE: 'fake',
      GAPOS_QUEUE_POLL_INTERVAL_MS: '1000',
      GAPOS_LOG_LEVEL: 'error',
    });
    try {
      // The daemon's DB is FK-enforced: register the owner before enqueueing.
      await bundle.context.uow.users.create({
        id: LEARNER,
        email: `${LEARNER}@example.com`,
        locale: 'en',
        timezone: 'UTC',
      });
      const gap = await seedGap();
      const job = await bundle.context.queue.enqueue(
        LEARNER,
        {
          id: 'pg-daemon-job-1',
          kind: 'compile',
          payload: { gapId: gap.id, idempotencyKey: 'pg-daemon-1' },
          maxAttempts: 1,
        },
        bundle.context.now(),
      );
      expect(job).toBeDefined();
      expect(bundle.context.uow).toBeDefined();
      expect(bundle.worker.start).toBeTypeOf('function');
    } finally {
      await bundle.worker.stop();
      await bundle.close();
    }
  });
});

if (!databaseUrl) {
  describe('the durable worker on Postgres (GAP-015)', () => {
    it.skip('was not exercised: set GAPOS_TEST_DATABASE_URL to run against a real database', () => {
      expect.unreachable();
    });
  });
}
