/**
 * The worker daemon (GAP-020).
 *
 * Bootstrap is config resolution, so it is tested directly: memory mode, s3 misconfiguration,
 * invalid intervals. The signal path is proven by spawning the real entrypoint and sending
 * SIGTERM — the child must finish, log a clean stop, and exit 0.
 *
 * The acceptance criteria are proven end to end: the daemon booted against the in-memory queue
 * completes an enqueued compile and shuts down cleanly, and stopping it during a run finishes
 * the in-flight job, releases its lease, and never claims again (the SIGTERM handler in
 * daemon-main.ts is exactly `worker.stop()` + `bundle.close()`, whose signal wiring the spawned
 * process test above covers).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OwnerId } from '@gapos/database';
import { createServerContext, type ServerContext } from '../../web/src/server/context.js';
import { applyTransition, createGap } from '../../web/src/server/services/gap-service.js';
import { bootstrapDaemon, DaemonConfigurationError } from './daemon.js';
import { enqueueCompile } from './queue/enqueue.js';
import { createCompileWorker } from './queue/worker.js';

/** The repo's tsx CLI, resolved from this test file. Spawned directly (not via pnpm) so
 * SIGTERM reaches the daemon process rather than the pnpm wrapper. */
const TSX_BIN = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const DAEMON_MAIN = fileURLToPath(new URL('./daemon-main.ts', import.meta.url));

const BASE_ENV: Record<string, string> = {
  GAPOS_PROVIDER_MODE: 'fake',
  GAPOS_LOG_LEVEL: 'silent',
};

const LEARNER: OwnerId = 'user_daemon';

const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
  label = 'condition',
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
};

const seedDaemonGap = async (context: ServerContext) => {
  await context.uow.users.create({
    id: LEARNER,
    email: `${LEARNER}@example.com`,
    locale: 'en',
    timezone: 'UTC',
  });
  const gap = await createGap(context, LEARNER, {
    title: 'Daemon gap',
    rawStatement:
      'I understand basic set notation but need relations and proof techniques by Friday. ' +
      'I have 35 minutes per day.',
    dailyMinutes: 35,
  });
  await applyTransition(context, LEARNER, gap.id, { type: 'define' });
  return gap;
};

describe('bootstrapDaemon', () => {
  it('boots in-memory repositories when GAPOS_DATABASE_URL is absent', async () => {
    const bundle = await bootstrapDaemon(BASE_ENV);
    expect(bundle.worker.start).toBeTypeOf('function');
    expect(bundle.worker.stop).toBeTypeOf('function');
    expect(bundle.context.uow.gaps).toBeDefined();
    await bundle.close();
  });

  it('refuses s3 storage without the S3 keys', async () => {
    await expect(bootstrapDaemon({ ...BASE_ENV, GAPOS_STORAGE: 's3' })).rejects.toBeInstanceOf(
      DaemonConfigurationError,
    );
  });

  it('refuses an invalid poll interval', async () => {
    await expect(
      bootstrapDaemon({ ...BASE_ENV, GAPOS_QUEUE_POLL_INTERVAL_MS: 'soon' }),
    ).rejects.toBeInstanceOf(DaemonConfigurationError);
  });

  it('rejects an unknown storage kind', async () => {
    await expect(bootstrapDaemon({ ...BASE_ENV, GAPOS_STORAGE: 'tape' })).rejects.toBeInstanceOf(
      DaemonConfigurationError,
    );
  });
});

describe('the daemon process', () => {
  it('starts, and stops cleanly on SIGTERM with exit code 0', async () => {
    const child = spawn(TSX_BIN, [DAEMON_MAIN], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GAPOS_PROVIDER_MODE: 'fake',
        GAPOS_QUEUE_POLL_INTERVAL_MS: '200',
        GAPOS_LOG_LEVEL: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    const started = new Promise<void>((resolve) => {
      child.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('gapos-worker started')) resolve();
      });
    });

    await Promise.race([
      started,
      new Promise((_, reject) =>
        child.once('exit', (code) => reject(new Error(`daemon exited early with code ${code}`))),
      ),
    ]);

    child.kill('SIGTERM');

    const exitCode = await new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    // Drain anything still in flight before asserting on the captured output.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(exitCode).toBe(0);
    expect(output).toContain('gapos-worker started');
    expect(output).toContain('gapos-worker stopped cleanly');
  }, 30_000);
});

describe('GAP-020 acceptance: the daemon against the in-memory queue', () => {
  it('completes an enqueued compile and shuts down cleanly', async () => {
    const bundle = await bootstrapDaemon({
      ...BASE_ENV,
      GAPOS_QUEUE_POLL_INTERVAL_MS: '25',
    });
    try {
      const gap = await seedDaemonGap(bundle.context);
      const job = await enqueueCompile(bundle.context, LEARNER, {
        gapId: gap.id,
        idempotencyKey: 'daemon-compile-1',
      });

      bundle.worker.start();

      // The daemon's own loop claims the job and runs the pipeline to completion.
      await waitFor(
        async () => (await bundle.context.queue.get(LEARNER, job.id))?.state === 'succeeded',
        10_000,
        'the daemon to complete the compile',
      );
      expect(await bundle.context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({
        status: 'active',
      });
      const curriculum = await bundle.context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
      expect(curriculum).toBeDefined();

      // The daemon's shutdown path: stop the loop, then release pooled resources.
      await bundle.worker.stop();
    } finally {
      await bundle.close();
    }
  });

  it('stops claiming and releases the lease when stopped during a run', async () => {
    // SIGTERM reaches worker.stop() (daemon-main.ts); the spawned process test proves the
    // wiring. Here a slow fake provider keeps a run in flight, so stop() must finish the
    // in-flight job, release its lease, and never claim the jobs parked behind it.
    const context = createServerContext({ fake: { latencyMs: 250 } });
    const gap = await seedDaemonGap(context);
    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'daemon-sigterm-1',
    });

    const worker = createCompileWorker(context, {
      pollIntervalMs: 25,
      leaseDurationMs: 60_000,
    });
    worker.start();

    // The job is claimed and the slow run is in flight.
    await waitFor(
      async () => (await context.queue.get(LEARNER, job.id))?.state === 'leased',
      5_000,
      'the run to be claimed',
    );

    // A second job enqueued behind the run must not be claimed once the worker stops.
    const parked = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'daemon-sigterm-2',
    });

    // Stop resolves only after the in-flight tick finished — the run completed, so the
    // job's lease was released by the completion rather than left held.
    await worker.stop();
    const done = await context.queue.get(LEARNER, job.id);
    expect(done?.state).toBe('succeeded');
    expect(done?.leasedUntil).toBeUndefined();
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });

    // Claiming stopped: the parked job is untouched well past several poll intervals.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await context.queue.get(LEARNER, parked.id))?.state).toBe('ready');
  }, 30_000);
});
