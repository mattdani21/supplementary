/**
 * GAPX-01: the Postgres web bootstrap shares the durable queue with a separately built worker.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import {
  createPool,
  createPostgresJobQueue,
  ensureSchema,
  migrate,
  truncateAll,
  type OwnerId,
} from '@gapos/database';
import { closeServerContext, getServerContext } from '../../apps/web/src/server/bootstrap.js';
import {
  compile,
  createGap,
  createUser,
  registerSourceHandler,
  transitionGap,
} from '../../apps/web/src/server/api.js';
import { bootstrapDaemon } from '../../apps/worker/src/daemon.js';

const LEARNER: OwnerId = 'user_web_bootstrap';
const databaseUrl = process.env.GAPOS_TEST_DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;

describeIfPostgres('GAPX-01 web bootstrap shares the durable queue', () => {
  const SCHEMA = 'test_web_bootstrap';

  afterEach(async () => {
    await closeServerContext();
    delete process.env.GAPOS_DATABASE_URL;
    delete process.env.GAPOS_DATABASE_SCHEMA;
  });

  it('enqueues a job the worker can see after the web context is recreated', async () => {
    process.env.GAPOS_DATABASE_URL = databaseUrl;
    process.env.GAPOS_DATABASE_SCHEMA = SCHEMA;
    process.env.GAPOS_IDENTITY_MODE = 'demo';
    process.env.GAPOS_STORAGE = 'memory';

    const pool = createPool(databaseUrl!, { schema: SCHEMA });
    await ensureSchema(pool, SCHEMA);
    await migrate(pool);
    await truncateAll(pool);

    const web = await getServerContext();
    expect(web.compileTransport).toBe('queue');

    await createUser(web, LEARNER, {
      email: 'bootstrap@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    const created = (await createGap(web, LEARNER, {
      title: 'Bootstrap queue',
      rawStatement: 'I need a durable compile that survives a web restart for this course.',
      dailyMinutes: 35,
    })) as { gap: { id: string } };
    await transitionGap(web, LEARNER, created.gap.id, { type: 'define' });
    await registerSourceHandler(web, LEARNER, {
      gapId: created.gap.id,
      filename: 'notes.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });

    const scheduled = (await compile(web, LEARNER, created.gap.id, {
      idempotencyKey: 'bootstrap-1',
    })) as { run: { status: string; jobId: string } };
    expect(scheduled.run.status).toBe('queued');

    const jobId = scheduled.run.jobId;
    await closeServerContext();

    const restarted = await getServerContext();
    const pending = await restarted.queue.get(LEARNER, jobId);
    expect(pending?.state).toBe('ready');
    expect(pending?.payload).toMatchObject({ gapId: created.gap.id });

    const workerQueue = createPostgresJobQueue(pool);
    const claimed = await workerQueue.claimDue(restarted.now(), 4, 60_000);
    expect(claimed.some((job) => job.id === jobId)).toBe(true);

    await pool.end();
  });
});

describeIfPostgres('GAPX-01 worker can complete a web-enqueued job', () => {
  it('boots a daemon against the same database URL', async () => {
    const daemon = await bootstrapDaemon({
      GAPOS_DATABASE_URL: databaseUrl,
      GAPOS_PROVIDER_MODE: 'fake',
      GAPOS_STORAGE: 'memory',
      GAPOS_LOG_LEVEL: 'error',
    });
    expect(daemon.context.queue).toBeDefined();
    await daemon.worker.stop();
    await daemon.close();
  });
});
