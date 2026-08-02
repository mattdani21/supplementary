/**
 * The primary journey, against Postgres.
 *
 * The repository suite proves each method behaves correctly in isolation. This proves the
 * *product* works on the SQL implementation: a whole compile, practice, mastery and search
 * cycle, driven by the same application services the memory-backed journey uses.
 *
 * Skipped without `GAPOS_TEST_DATABASE_URL` — loudly, via a skipped test, because a suite that
 * silently vanishes reads exactly like one that passed.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import {
  createMemoryObjectStore,
  createPool,
  ensureSchema,
  createPostgresUnitOfWork,
  migrate,
  truncateAll,
  type OwnerId,
} from '@gapos/database';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';
import {
  assessMastery,
  getToday,
  runMasteryCheck,
  searchCapabilities,
  submitAttempt,
} from '../../apps/web/src/server/services/learning-service.js';

const LEARNER: OwnerId = 'user_pg_learner';
const OTHER: OwnerId = 'user_pg_other';
const databaseUrl = process.env.GAPOS_TEST_DATABASE_URL;

const describeIfPostgres = databaseUrl ? describe : describe.skip;

describeIfPostgres('the primary journey on Postgres', () => {
  // Its own schema: this file and the repository contract suite run in parallel.
  const SCHEMA = 'test_postgres_journey';
  const pool = createPool(databaseUrl!, { max: 4, schema: SCHEMA });
  let context: ServerContext;
  let clock: { now: () => Date; set: (date: Date) => void };
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

    let current = new Date('2026-08-02T09:00:00Z').getTime();
    clock = {
      now: () => new Date((current += 1000)),
      set: (date) => {
        current = date.getTime();
      },
    };

    let counter = 0;
    context = createServerContext({
      uow: createPostgresUnitOfWork(pool),
      storage: createMemoryObjectStore(clock.now),
      now: clock.now,
      newId: (prefix) => `${prefix}_${++counter}`,
      logLevel: 'error',
    });

    for (const id of [LEARNER, OTHER]) {
      await context.uow.users.create({
        id,
        email: `${id}@example.com`,
        locale: 'en',
        timezone: 'UTC',
      });
    }
  });

  const compileReference = async (owner: OwnerId = LEARNER, key = 'pg-compile-1') => {
    const gap = await createGap(context, owner, {
      title: 'Relations and proof techniques',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
      deadline: '2026-08-07',
    });
    await registerSource(context, owner, {
      gapId: gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    await applyTransition(context, owner, gap.id, { type: 'define' });
    const outcome = await compile(context, owner, { gapId: gap.id, idempotencyKey: key });
    return { gap, outcome };
  };

  it('compiles a complete course end to end', async () => {
    const { gap, outcome } = await compileReference();

    expect(outcome.status).toBe('complete');
    expect(outcome.days).toHaveLength(3);
    expect(outcome.days.every((d) => d.published)).toBe(true);
    expect((await context.uow.gaps.get(LEARNER, gap.id))?.status).toBe('active');
  });

  it('persists the deadline as the calendar day it was given', async () => {
    // DATE columns come back as a Date in the session timezone; a naive mapping shifts the day.
    const { gap } = await compileReference();
    expect((await context.uow.gaps.get(LEARNER, gap.id))?.deadline).toBe('2026-08-07');
  });

  it('extracts the source into chunks that keep their locators', async () => {
    const { gap } = await compileReference();
    const [source] = await context.uow.sources.listForGap(LEARNER, gap.id);
    expect(source?.processingStatus).toBe('indexed');

    const chunks = await context.uow.sources.listChunks(LEARNER, source!.id);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.locator).join(' ')).toContain('Equivalence relations');
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it('publishes Day 1 before the later days', async () => {
    const { outcome } = await compileReference();
    const published = outcome.days
      .filter((d) => d.publishedAt)
      .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime());
    expect(published[0]?.day).toBe(1);
  });

  it('round-trips the lesson package through JSONB unchanged', async () => {
    const { outcome } = await compileReference();
    const lessons = await context.uow.curricula.listLessons(LEARNER, outcome.curriculumId!);
    expect(lessons).toHaveLength(3);
    for (const lesson of lessons) {
      expect(lesson.package.day).toBe(lesson.day);
      expect(lesson.package.questions.length).toBeGreaterThan(0);
      expect(lesson.package.transcript).toBe(lesson.package.script);
    }
  });

  it('returns exactly one run for a repeated compile idempotency key', async () => {
    const { gap, outcome } = await compileReference(LEARNER, 'pg-dedupe');
    const repeat = await compile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'pg-dedupe',
    });
    expect(repeat.runId).toBe(outcome.runId);
    expect(repeat.deduplicated).toBe(true);
  });

  it('gives corrective feedback and schedules remediation for a wrong answer', async () => {
    const { gap, outcome } = await compileReference();
    const dayOne = outcome.days.find((d) => d.day === 1)!;
    const [question] = await context.uow.curricula.listQuestions(LEARNER, dayOne.lessonId);

    const result = await submitAttempt(context, LEARNER, gap.id, {
      questionId: question!.id,
      sessionId: 'session_1',
      response: 'a confidently wrong answer',
      idempotencyKey: 'pg-attempt-wrong',
    });

    expect(result.correct).toBe(false);
    expect(result.feedback.answer).toBe(question!.payload.answer);
    expect(result.scheduledReviews).toHaveLength(2);

    const today = await getToday(context, LEARNER, gap.id);
    expect(today.reviews.length).toBeGreaterThan(0);
  });

  it('fills the gap only on evidence spanning two sessions, then makes it searchable', async () => {
    const { gap, outcome } = await compileReference();
    const lessonIds = outcome.days.map((d) => d.lessonId);

    const practise = async (sessionId: string, keyPrefix: string) => {
      for (const lessonId of lessonIds) {
        for (const question of await context.uow.curricula.listQuestions(LEARNER, lessonId)) {
          await submitAttempt(context, LEARNER, gap.id, {
            questionId: question.id,
            sessionId,
            response: question.payload.answer,
            idempotencyKey: `${keyPrefix}_${question.id}`,
          });
        }
      }
    };

    await practise('session_1', 'pg_k1');
    // One session is not enough, however good the answers.
    expect((await runMasteryCheck(context, LEARNER, gap.id)).filled).toBe(false);

    clock.set(new Date('2026-08-04T09:00:00Z'));
    await practise('session_2', 'pg_k2');

    expect((await assessMastery(context, LEARNER, gap.id)).readyToFill).toBe(true);
    expect((await runMasteryCheck(context, LEARNER, gap.id)).filled).toBe(true);
    expect((await context.uow.gaps.get(LEARNER, gap.id))?.status).toBe('filled');

    expect((await searchCapabilities(context, LEARNER)).map((c) => c.gapId)).toEqual([gap.id]);
    expect(await searchCapabilities(context, LEARNER, 'equivalence')).toHaveLength(1);
    expect((await context.uow.knowledge.listEdges(LEARNER)).length).toBeGreaterThan(0);
  });

  it('keeps one learner’s compiled course invisible to another', async () => {
    const { gap, outcome } = await compileReference();

    expect(await context.uow.gaps.get(OTHER, gap.id)).toBeUndefined();
    expect(await context.uow.curricula.get(OTHER, outcome.curriculumId!)).toBeUndefined();
    expect(await context.uow.curricula.listLessons(OTHER, outcome.curriculumId!)).toEqual([]);
    expect(await context.uow.generation.getRun(OTHER, outcome.runId)).toBeUndefined();
    expect(await searchCapabilities(context, OTHER)).toEqual([]);
  });

  it('records the generation steps that make a restart safe', async () => {
    const { outcome } = await compileReference();
    const steps = await context.uow.generation.listSteps(LEARNER, outcome.runId);

    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.state === 'succeeded')).toBe(true);
    // The recorded output is what a re-entering worker reuses instead of calling a provider.
    expect(steps.some((s) => s.step === 'plan_curriculum' && s.output !== undefined)).toBe(true);
  });
});

if (!databaseUrl) {
  describe('the primary journey on Postgres', () => {
    it.skip('was not exercised: set GAPOS_TEST_DATABASE_URL to run against a real database', () => {
      expect.unreachable();
    });
  });
}
