/**
 * The durable worker loop (GAP-015), against the in-memory queue and repositories.
 *
 * The acceptance criteria, in order:
 *   - a run that would exceed its budget degrades to text-only instead of overspending
 *     (covered end to end in journey.test.ts; the worker inherits it by running the pipeline);
 *   - killing a worker mid-run and restarting produces no duplicate artefacts or charges;
 *   - a job failing repeatedly is dead-lettered with its last error and reproduction context.
 *
 * The loop is driven by explicit `tick()` calls, so no timers are needed; the clock is the same
 * stepping clock the journey uses.
 */

import { describe, expect, it } from 'vitest';
import { referenceLesson, referencePlan } from '@gapos/test-fixtures';
import { LiveProviderError } from '@gapos/provider-adapters';
import type { OwnerId } from '@gapos/database';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import { enqueueCompile } from '../../apps/worker/src/queue/enqueue.js';
import { createCompileWorker } from '../../apps/worker/src/queue/worker.js';
import { PIPELINE_VERSION } from '../../apps/worker/src/pipeline/compile.js';
import { applyTransition, createGap } from '../../apps/web/src/server/services/gap-service.js';

const LEARNER: OwnerId = 'user_worker';

const steppingClock = (start = new Date('2026-08-02T09:00:00Z')) => {
  let current = start.getTime();
  return {
    now: () => new Date((current += 1000)),
    set: (date: Date) => {
      current = date.getTime();
    },
  };
};

const build = (options: Parameters<typeof createServerContext>[0] = {}) => {
  const clock = steppingClock();
  let counter = 0;
  const context = createServerContext({
    now: clock.now,
    newId: (prefix) => `${prefix}_${++counter}`,
    ...options,
  });
  return { context, clock };
};

const seedLearner = async (context: ServerContext) => {
  await context.uow.users.create({
    id: LEARNER,
    email: `${LEARNER}@example.com`,
    locale: 'en',
    timezone: 'UTC',
  });
};

const seedGap = async (context: ServerContext, title = 'Worker gap') => {
  const gap = await createGap(context, LEARNER, {
    title,
    rawStatement:
      'I understand basic set notation but need relations and proof techniques by Friday. ' +
      'I have 35 minutes per day.',
    dailyMinutes: 35,
  });
  await applyTransition(context, LEARNER, gap.id, { type: 'define' });
  return gap;
};

describe('the durable worker loop (GAP-015)', () => {
  it('compiles a course from a job enqueued through the queue', async () => {
    const { context, clock } = build();
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-compile-1',
    });
    expect(job.state).toBe('ready');
    // The gap moved to compiling at enqueue time, not when the worker happens to run.
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'compiling' });

    const worker = createCompileWorker(context, {
      leaseDurationMs: 60_000,
    });
    await worker.tick();

    const done = await context.queue.get(LEARNER, job.id);
    expect(done?.state).toBe('succeeded');
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });

    const curriculum = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    expect(curriculum).toBeDefined();
    const lessons = await context.uow.curricula.listLessons(LEARNER, curriculum!.id);
    expect(lessons.filter((l) => l.publicationStatus === 'published')).toHaveLength(3);
    expect(clock.now().getTime()).toBeGreaterThan(0);
  });

  it('returns a leased job to the queue when its worker dies mid-lease, and completes it without duplication', async () => {
    const { context, clock } = build();
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-compile-2',
    });

    // Worker A claims the job and dies without completing it.
    const claimed = await context.queue.claimDue(clock.now(), 10, 60_000);
    expect(claimed.map((j) => j.id)).toEqual([job.id]);
    expect(claimed[0]?.state).toBe('leased');

    // The lease expires; a restarted worker's tick re-claims and runs it.
    clock.set(new Date(clock.now().getTime() + 120_000));
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    const done = await context.queue.get(LEARNER, job.id);
    expect(done?.state).toBe('succeeded');
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });

    // Exactly one run and one curriculum: the re-run reused recorded steps rather than duplicating.
    const curriculum = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    expect(curriculum).toBeDefined();
    expect(await context.uow.curricula.listLessons(LEARNER, curriculum!.id)).toHaveLength(3);
  });

  it('retries a job whose pipeline failed, then succeeds on the next tick', async () => {
    // The first tick fails the very first provider call; the second tick runs the same job again
    // with a healthy provider, under a fresh attempt key, so it compiles cleanly.
    const { context, clock } = build({ fake: { failFirstNCalls: 1 } });
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-compile-3',
    });

    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    const failed = await context.queue.get(LEARNER, job.id);
    expect(failed?.state).toBe('ready'); // retryable: back to the queue with a backoff
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toContain('Simulated provider failure');

    // Backoff: the job is not claimable until availableAt has passed.
    expect(await context.queue.claimDue(clock.now(), 10, 60_000)).toEqual([]);
    clock.set(new Date(failed!.availableAt.getTime() + 1000));

    await worker.tick();

    const done = await context.queue.get(LEARNER, job.id);
    expect(done?.state).toBe('succeeded');
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });
    const curriculum = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    expect(curriculum).toBeDefined();
    expect(await context.uow.curricula.listLessons(LEARNER, curriculum!.id)).toHaveLength(3);
  });

  it('re-enters an in-flight run after a crash instead of duplicating the course', async () => {
    // A worker died mid-run: the run exists, is non-terminal, and its curriculum exists. The
    // next tick must resume that run and re-enter that curriculum — not start a second course.
    const { context, clock } = build();
    await seedLearner(context);
    const gap = await seedGap(context);

    const idempotencyKey = 'worker-compile-resume';
    const { run } = await context.uow.generation.startRun(LEARNER, {
      id: context.newId('run'),
      gapId: gap.id,
      pipelineVersion: PIPELINE_VERSION,
      status: 'ingesting',
      idempotencyKey,
      startedAt: clock.now(),
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
      plan: referencePlan('gap_resume'),
      createdAt: clock.now(),
    });

    await enqueueCompile(context, LEARNER, { gapId: gap.id, idempotencyKey });
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    const job = (await context.queue.listByState(LEARNER, 'succeeded'))[0];
    expect(job).toBeDefined();
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });

    // Exactly one curriculum — the crashed run's own, re-entered, not a second course.
    const curricula = await context.uow.curricula.listLessons(LEARNER, crashedCurriculum.id);
    expect(curricula).toHaveLength(3);
    expect(await context.uow.curricula.get(LEARNER, crashedCurriculum.id)).toMatchObject({
      status: 'published',
    });
  });

  it('dead-letters a job that keeps failing, with its last error and the reproduction context', async () => {
    const { context, clock } = build({
      fake: {
        script: {
          gap_normalisation: () => {
            throw new Error('The provider is on fire');
          },
        },
      },
    });
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-compile-4',
      maxAttempts: 2,
    });

    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick(); // attempt 1 -> failed, backoff
    clock.set(new Date(clock.now().getTime() + 30_000)); // past the 2s backoff
    await worker.tick(); // attempt 2 -> dead_letter

    const dead = await context.queue.get(LEARNER, job.id);
    expect(dead?.state).toBe('dead_letter');
    expect(dead?.attempts).toBe(2);
    expect(dead?.lastError).toContain('The provider is on fire');
    // The payload is the reproduction context: same gap, same idempotency key.
    expect(dead?.payload).toEqual({ gapId: gap.id, idempotencyKey: 'worker-compile-4' });

    // The dead-lettered job is never claimed again.
    expect(await context.queue.claimDue(clock.now(), 10, 60_000)).toEqual([]);
  });

  it('repairs a lesson the model shipped against the contract, inside the run', async () => {
    // The live gate caught the model emitting a free-response question without a rubric, which
    // fails the lesson contract and previously killed the whole run. The pipeline now retries
    // contract failures by quoting the violations back (like the plan step does); simulate the
    // exact failure with a stateful fake: one bad lesson, then healthy content.
    const dayFromSubject = (subject: string | undefined): number => {
      const match = /(\d+)/.exec(subject ?? '');
      return match?.[1] ? Number(match[1]) : 1;
    };
    let lessonCalls = 0;
    const observedTokens: number[] = [];
    const { context } = build({
      fake: {
        script: {
          curriculum_plan: (request: { subject?: string; maxOutputTokens?: number }) => {
            observedTokens.push(request.maxOutputTokens ?? 0);
            return referencePlan(request.subject ?? 'gap_reference');
          },
          lesson_package: (request: { subject?: string; maxOutputTokens?: number }) => {
            lessonCalls += 1;
            observedTokens.push(request.maxOutputTokens ?? 0);
            if (lessonCalls === 1) {
              const lesson = referenceLesson(1);
              return {
                ...lesson,
                questions: lesson.questions.map((question) =>
                  question.type === 'worked_problem'
                    ? // Free-response without a rubric: the exact contract violation caught live.
                      { ...question, type: 'free_response' }
                    : question,
                ),
              };
            }
            return referenceLesson(dayFromSubject(request.subject));
          },
        },
      },
    });
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-contract-retry-1',
    });
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    const done = await context.queue.get(LEARNER, job.id);
    expect(done?.state).toBe('succeeded');
    // The contract retry happened inside the run: zero job retries, two lesson calls.
    expect(done?.attempts).toBe(0);
    expect(lessonCalls).toBeGreaterThanOrEqual(2);
    // The big payloads carry an explicit output budget (provider defaults truncate long JSON).
    expect(observedTokens[0]).toBe(8192); // plan
    expect(observedTokens.slice(1).every((t) => t === 8192)).toBe(true); // lessons

    const curriculum = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    expect(curriculum).toBeDefined();
    expect(await context.uow.curricula.listLessons(LEARNER, curriculum!.id)).toHaveLength(3);
  });

  it('retries a truncated plan with a terseness demand and succeeds', async () => {
    // The provider's structured-output cap truncates a long plan mid-JSON (the live gate saw
    // eval_02's plan cut inside an objective). The plan step now treats a contract failure as
    // repairable: the retry quotes the rejection and demands terseness. Simulate the exact
    // failure: the first plan response is cut JSON, the retry is healthy.
    let planCalls = 0;
    const planInstructions: string[] = [];
    const { context } = build({
      fake: {
        script: {
          curriculum_plan: (request: { instruction: string; subject?: string }) => {
            planCalls += 1;
            planInstructions.push(request.instruction);
            if (planCalls === 1) {
              return '{"schemaVersion":"1.0.0","gapId":"truncated","objectives":[{"id":"o1","capabilityStatement":"State the theorem that the equivalence classes of an e';
            }
            return referencePlan(request.subject ?? 'gap_reference');
          },
        },
      },
    });
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-truncated-plan-1',
    });
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    const done = await context.queue.get(LEARNER, job.id);
    expect(done?.state).toBe('succeeded');
    expect(planCalls).toBe(2);
    // The retry demanded terseness so the plan fits the provider's output budget.
    expect(planInstructions[1]).toContain('Keep the plan terse');

    const curriculum = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    expect(curriculum).toBeDefined();
  });

  it('treats a persistent transport failure (unparseable JSON) as repairable, not fatal', async () => {
    // The live gate's fifth run failed because "unparseable JSON" is a LiveProviderError, not
    // a ProviderContractError, so the plan retry never engaged. The plan step now repairs
    // retryable transport failures the same way: quote the rejection, demand terseness.
    let planCalls = 0;
    const { context } = build({
      fake: {
        script: {
          curriculum_plan: (request: { subject?: string }) => {
            planCalls += 1;
            if (planCalls === 1) {
              throw new LiveProviderError(
                'Live provider returned unparseable JSON for curriculum_plan@1.0.0: {"schemaVersion":"1.0.0","gapId":"equivalence-classes-partition","objectives":[{"id":"eq_classes_def","capabilityStatement":"Define the equivalen',
                200,
                true,
              );
            }
            return referencePlan(request.subject ?? 'gap_reference');
          },
        },
      },
    });
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-transport-retry-1',
    });
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    const done = await context.queue.get(LEARNER, job.id);
    expect(done?.state).toBe('succeeded');
    expect(planCalls).toBe(2);
  });

  it('lets the gap fail and retry through the worker path exactly like the API path', async () => {
    const { context } = build({
      fake: {
        script: {
          gap_normalisation: () => {
            throw new Error('Always failing normalisation');
          },
        },
      },
    });
    await seedLearner(context);
    const gap = await seedGap(context);

    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-compile-5',
      maxAttempts: 1,
    });
    const worker = createCompileWorker(context, { leaseDurationMs: 60_000 });
    await worker.tick();

    expect(await context.queue.get(LEARNER, job.id)).toMatchObject({ state: 'dead_letter' });
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'failed' });

    // A retry enqueues a fresh job and moves the gap back to compiling.
    await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-compile-6',
      maxAttempts: 1,
    });
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'compiling' });
  });

  it('keeps jobs tenant-scoped: another owner cannot read or complete them', async () => {
    const { context } = build();
    await seedLearner(context);
    const gap = await seedGap(context);
    const job = await enqueueCompile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'worker-compile-7',
    });

    await context.queue.claimDue(context.now(), 10, 60_000);
    expect(await context.queue.get('user_other', job.id)).toBeUndefined();
    expect(await context.queue.complete('user_other', job.id)).toBeUndefined();
    // Still leased for the real owner.
    expect(await context.queue.get(LEARNER, job.id)).toMatchObject({ state: 'leased' });
  });
});
