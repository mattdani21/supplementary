/**
 * The Arc surface (GAP-032) against Postgres.
 *
 * The memory suite proves the handlers behave correctly; this proves the SQL rows survive the
 * same flows — calibration selections, preference toggles and notebook-proof evidence are
 * written and re-read through the Postgres repositories, and the gap state machine advances on
 * real evidence exactly as it does in memory.
 *
 * Skipped without `GAPOS_TEST_DATABASE_URL` — loudly, via a skipped test.
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
import { submitAttempt, submitProof } from '../../apps/web/src/server/services/learning-service.js';
import { runCalibration, setPreferences } from '../../apps/web/src/server/services/arc-service.js';

const LEARNER: OwnerId = 'user_arc_pg_learner';
const OTHER: OwnerId = 'user_arc_pg_other';
const databaseUrl = process.env.GAPOS_TEST_DATABASE_URL;

const describeIfPostgres = databaseUrl ? describe : describe.skip;

describeIfPostgres('the Arc surface on Postgres', () => {
  const SCHEMA = 'test_arc_postgres';
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

    let current = new Date('2026-08-30T09:00:00Z').getTime();
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

  it('round-trips calibration selections and preferences through SQL', async () => {
    const calibration = await runCalibration(context, LEARNER, {
      subject: 'Python for data work',
      goal: 'Build a project I can show',
      baselineAnswer: '12',
    });

    const stored = await context.uow.calibrations.get(LEARNER, calibration.calibrationId);
    expect(stored).toMatchObject({
      gapId: calibration.gapId,
      subject: 'Python for data work',
      goal: 'Build a project I can show',
      baselineCorrect: true,
      startingDifficulty: 3,
    });
    expect(stored!.gapsIdentified.length).toBe(3);

    // Ownership is enforced at the SQL level: another owner sees nothing.
    expect(await context.uow.calibrations.get(OTHER, calibration.calibrationId)).toBeUndefined();
    expect(await context.uow.calibrations.listForOwner(OTHER)).toEqual([]);

    const preferences = await setPreferences(context, LEARNER, {
      audioTheory: false,
      gentleHints: true,
      darkMode: true,
      spacedReview: true,
    });
    const reRead = await context.uow.preferences.get(LEARNER);
    expect(reRead).toMatchObject({
      audioTheory: false,
      darkMode: true,
      spacedReview: true,
    });
    expect(preferences.ownerId).toBe(LEARNER);
  });

  it('executes proofs server-side and advances the state machine on Postgres', async () => {
    const gap = await createGap(context, LEARNER, {
      title: 'Relations and proof techniques',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });
    await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    const outcome = await compile(context, LEARNER, { gapId: gap.id, idempotencyKey: 'arc-pg-1' });
    expect(outcome.status).toBe('complete');

    const curriculum = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    const lessons = (await context.uow.curricula.listLessons(LEARNER, curriculum!.id)).filter(
      (l) => l.publicationStatus === 'published',
    );
    const dayThree = lessons.find((l) => l.day === 3)!;
    const questions = await context.uow.curricula.listQuestions(LEARNER, dayThree.id);
    const finalProof = questions.find((q) => q.payload.type === 'code_proof')!;

    const practise = async (sessionId: string, keyPrefix: string, skipFinal = false) => {
      for (const lesson of lessons) {
        for (const question of await context.uow.curricula.listQuestions(LEARNER, lesson.id)) {
          if (question.payload.type === 'code_proof') {
            if (skipFinal && question.id === finalProof.id) continue;
            await submitProof(context, LEARNER, gap.id, {
              questionId: question.id,
              sessionId,
              code: question.payload.answer,
              idempotencyKey: `${keyPrefix}_${question.id}`,
            });
          } else {
            await submitAttempt(context, LEARNER, gap.id, {
              questionId: question.id,
              sessionId,
              response: question.payload.answer,
              idempotencyKey: `${keyPrefix}_${question.id}`,
            });
          }
        }
      }
    };

    await practise('s1', 'pg-k1');
    clock.set(new Date('2026-09-02T09:00:00Z'));
    await practise('s2', 'pg-k2', true);

    // A wrong proof is state-neutral on Postgres too: no new attempt row appears.
    const beforeWrong = (
      await context.uow.attempts.listForObjective(LEARNER, finalProof.objectiveId)
    ).length;
    const wrong = await submitProof(context, LEARNER, gap.id, {
      questionId: finalProof.id,
      sessionId: 's2',
      code: 'function sameMod5() { return false; }',
      idempotencyKey: 'pg-wrong',
    });
    expect(wrong.correct).toBe(false);
    expect(
      await context.uow.attempts.listForObjective(LEARNER, finalProof.objectiveId),
    ).toHaveLength(beforeWrong);

    // The correct final proof records the attempt and fills the gap.
    const proof = await submitProof(context, LEARNER, gap.id, {
      questionId: finalProof.id,
      sessionId: 's2',
      code: finalProof.payload.answer,
      idempotencyKey: 'pg-final',
    });
    expect(proof.correct).toBe(true);
    expect(proof.filled).toBe(true);
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'filled' });

    // Persistence round-trip: the evidence row is in Postgres.
    const attempts = await context.uow.attempts.listForObjective(LEARNER, finalProof.objectiveId);
    const recorded = attempts.find((a) => a.correct);
    expect(recorded).toBeDefined();
    const evidence = await context.uow.mastery.listEvidence(LEARNER, finalProof.objectiveId);
    expect(evidence.some((e) => e.attemptId === recorded!.id)).toBe(true);
  });
});
