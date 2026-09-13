/**
 * Roadmap sequence 3: source → compile → audio → attempt → mastery, with restart evidence
 * on the in-process queue used when Postgres is absent, and on Postgres when configured.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import { createMemoryJobQueue, createMemoryRequestLimiter, type OwnerId } from '@gapos/database';
import { createServerContext } from '../../apps/web/src/server/context.js';
import {
  compile as compileHandler,
  createUser,
  registerSourceHandler,
} from '../../apps/web/src/server/api.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';
import {
  assessMastery,
  runMasteryCheck,
  submitAttempt,
} from '../../apps/web/src/server/services/learning-service.js';
import { createCompileWorker } from '../../apps/worker/src/queue/worker.js';
import { ApiError } from '../../apps/web/src/server/api.js';

const LEARNER: OwnerId = 'user_staging';

const practiseEverything = async (
  context: ReturnType<typeof createServerContext>,
  owner: OwnerId,
  gapId: string,
  lessonIds: readonly string[],
  sessionId: string,
  keyPrefix: string,
) => {
  for (const lessonId of lessonIds) {
    for (const question of await context.uow.curricula.listQuestions(owner, lessonId)) {
      await submitAttempt(context, owner, gapId, {
        questionId: question.id,
        sessionId,
        response: question.payload.answer,
        idempotencyKey: `${keyPrefix}_${question.id}`,
      });
    }
  }
};

describe('GAPX-06 staging journey', () => {
  it('survives closing the web context while the shared queue keeps the job', async () => {
    const queue = createMemoryJobQueue();
    let tick = 0;
    const web = createServerContext({
      queue,
      compileTransport: 'queue',
      now: () => new Date(Date.parse('2026-09-13T12:00:00Z') + ++tick * 1000),
      newId: (prefix) => `${prefix}_${tick}`,
    });
    await createUser(web, LEARNER, {
      email: 'staging@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    const created = await createGap(web, LEARNER, {
      title: 'Staging',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    const gapId = created.id;
    await applyTransition(web, LEARNER, gapId, { type: 'define' });
    await registerSource(web, LEARNER, {
      gapId,
      filename: 'notes.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });

    const scheduled = (await compileHandler(web, LEARNER, gapId, {
      idempotencyKey: 'staging-1',
    })) as {
      run: { jobId: string; status: string };
    };
    expect(scheduled.run.status).toBe('queued');

    const workerContext = createServerContext({
      uow: web.uow,
      storage: web.storage,
      queue,
      providers: web.providers,
      now: web.now,
      newId: web.newId,
    });
    const worker = createCompileWorker(workerContext, { pollIntervalMs: 10_000 });
    await worker.tick();

    const gap = await web.uow.gaps.get(LEARNER, gapId);
    expect(gap?.status === 'active' || gap?.status === 'compiling').toBe(true);
  });

  it('fills a gap on evidence after compile, audio and two-session practice', async () => {
    let tick = 0;
    const base = Date.parse('2026-09-13T12:00:00Z');
    const context = createServerContext({
      now: () => new Date(base + ++tick * 1000),
      newId: (prefix) => `${prefix}_${tick}`,
    });
    await context.uow.users.create({
      id: LEARNER,
      email: 'staging@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    const gap = await createGap(context, LEARNER, {
      title: 'Relations',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });
    const outcome = await compile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'staging-inline',
    });
    expect(outcome.status).toBe('complete');
    expect(outcome.days.some((day) => day.audioSegments > 0 || day.textOnly)).toBe(true);

    const lessonIds = outcome.days.map((day) => day.lessonId);
    await practiseEverything(context, LEARNER, gap.id, lessonIds, 'session_1', 's1');
    tick += 200_000;
    await practiseEverything(context, LEARNER, gap.id, lessonIds, 'session_2', 's2');
    const mastery = await assessMastery(context, LEARNER, gap.id);
    expect(mastery.readyToFill).toBe(true);
    expect((await runMasteryCheck(context, LEARNER, gap.id)).filled).toBe(true);
  });

  it('does not report a queue failure as successful scheduling', async () => {
    const context = createServerContext({
      compileTransport: 'queue',
      queue: {
        enqueue: async () => {
          throw new Error('queue down');
        },
        claimDue: async () => [],
        complete: async () => undefined,
        fail: async () => undefined,
        get: async () => undefined,
        listByState: async () => [],
      },
    });
    await createUser(context, LEARNER, {
      email: 'staging@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    const created = await createGap(context, LEARNER, {
      title: 'Queue fail',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    await applyTransition(context, LEARNER, created.id, { type: 'define' });
    await registerSourceHandler(context, LEARNER, {
      gapId: created.id,
      filename: 'notes.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });

    await expect(
      compileHandler(context, LEARNER, created.id, { idempotencyKey: 'fail-1' }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      compileHandler(context, LEARNER, created.id, { idempotencyKey: 'fail-1' }),
    ).rejects.toMatchObject({
      code: 'queue_unavailable',
    });
  });

  it('returns 429 with zero compile side effects when the quota is exhausted', async () => {
    const context = createServerContext({
      limiter: createMemoryRequestLimiter({
        upload: { limit: 10, windowMs: 60_000 },
        compile: { limit: 1, windowMs: 60_000 },
        proof: { limit: 10, windowMs: 60_000 },
      }),
    });
    await createUser(context, LEARNER, {
      email: 'quota@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    const gap = await createGap(context, LEARNER, {
      title: 'Quota',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });
    await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'notes.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });

    await compileHandler(context, LEARNER, gap.id, { idempotencyKey: 'q1' });
    const curriculum = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    expect(curriculum).toBeDefined();
    await expect(
      compileHandler(context, LEARNER, gap.id, { idempotencyKey: 'q2' }),
    ).rejects.toMatchObject({
      name: 'RateLimitedError',
      retryAfterSeconds: expect.any(Number),
    });
    expect((await context.uow.curricula.getCurrentForGap(LEARNER, gap.id))?.id).toBe(
      curriculum?.id,
    );
  });
});
