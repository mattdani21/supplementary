/**
 * Differentiation (E24 US4, T035 — FR-017/FR-018, SC-004).
 *
 * The curriculum is a deterministic function of gap + sources + diagnostic + learner profile +
 * mastery evidence. Two learners with the same gap and the same sources but different
 * diagnostics, profiles or mastery evidence must receive measurably different curricula —
 * identical output here is the specific failure the personalization promise forbids.
 *
 * This runs through the REAL pipeline (fake provider) with the personalisation threading from
 * T034, so the assertion is on what would actually be stored, not on the pure function. The
 * eval_10 prior-mastery behaviour (a mastered prerequisite is at most a Day-1 recall check,
 * never retaught) is exercised with the same gap statement and a seeded filled capability.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { CurriculumPlanContract, type CurriculumPlan } from '@gapos/ai-contracts';
import type { OwnerId } from '@gapos/database';
import { findPlanViolations } from '@gapos/domain';
import { fixtureById } from '@gapos/evaluation';
import { referenceDiagnostic, referencePlan } from '@gapos/test-fixtures';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';

const FIXTURE = fixtureById('eval_01_set_operations')!;

/** Compile eval_01 for one learner with a scripted fake and an optional pre-seeded profile. */
const compileFor = async (params: {
  owner: OwnerId;
  profile?: { preferredLessonLength: 'short' | 'standard' | 'long'; goals?: string[] };
  script?: Record<string, (request: { subject?: string }) => unknown>;
  seedFilledCapability?: string;
}): Promise<{ context: ServerContext; plan: CurriculumPlan; runId: string }> => {
  let counter = 0;
  const context = createServerContext({
    newId: (prefix) => `${prefix}_${++counter}`,
    logLevel: 'error',
    ...(params.script ? { fake: { script: params.script } } : {}),
  });
  await context.uow.users.create({
    id: params.owner,
    email: `${params.owner}@example.com`,
    locale: 'en',
    timezone: 'UTC',
    ...(params.profile ?? {}),
  });

  if (params.seedFilledCapability) {
    const at = context.now();
    await context.uow.gaps.create(params.owner, {
      id: context.newId('gap'),
      title: 'Previously filled gap',
      targetCapability: params.seedFilledCapability,
      rawStatement: 'Previously filled gap.',
      dailyMinutes: 35,
      sourcePolicy: 'general_knowledge_allowed',
      status: 'filled',
      assumptions: [],
      createdAt: at,
      updatedAt: at,
    });
  }

  const gap = await createGap(context, params.owner, {
    title: FIXTURE.title,
    rawStatement: FIXTURE.learnerStatement,
    dailyMinutes: FIXTURE.dailyMinutes,
  });
  if (FIXTURE.source) {
    await registerSource(context, params.owner, {
      gapId: gap.id,
      filename: FIXTURE.source.filename,
      mediaType: FIXTURE.source.mediaType,
      text: FIXTURE.source.text,
    });
  }
  await applyTransition(context, params.owner, gap.id, { type: 'define' });
  const outcome = await compile(context, params.owner, {
    gapId: gap.id,
    idempotencyKey: `diff_${params.owner}`,
  });
  if (outcome.status !== 'complete') {
    throw new Error(`compile for ${params.owner} failed: ${outcome.error ?? outcome.status}`);
  }
  const curriculum = await context.uow.curricula.get(params.owner, outcome.curriculumId!);
  return { context, plan: curriculum!.plan, runId: outcome.runId };
};

/** A plan whose Day-1 objective starts easy and later days start hard, so the start shift shows. */
const rampScript = (): Record<string, (request: { subject?: string }) => unknown> => ({
  curriculum_plan: () => {
    const plan = referencePlan('gap_ramp');
    return {
      ...plan,
      assessmentBlueprint: plan.assessmentBlueprint.map((entry) =>
        entry.objectiveId === 'obj_subset_proof'
          ? { ...entry, targetDifficulty: 1 }
          : { ...entry, targetDifficulty: 4 },
      ),
    };
  },
});

const DOUBLE_INCLUSION = 'Prove a set equality by double inclusion.';

describe('differentiation (E24 US4, T035)', () => {
  describe('a differing profile yields a measurably different curriculum (FR-017)', () => {
    let shortPlan: CurriculumPlan;
    let longPlan: CurriculumPlan;

    beforeAll(async () => {
      const short = await compileFor({
        owner: 'user_diff_short',
        profile: { preferredLessonLength: 'short' },
      });
      const long = await compileFor({
        owner: 'user_diff_long',
        profile: { preferredLessonLength: 'long' },
      });
      shortPlan = short.plan;
      longPlan = long.plan;
    });

    it('rescales the daily structure differently', () => {
      const minutes = (p: CurriculumPlan) =>
        p.days.map((d) => d.activities.reduce((sum, a) => sum + a.estimatedMinutes, 0));
      expect(minutes(shortPlan)).not.toEqual(minutes(longPlan));
    });

    it('keeps both adapted plans valid', () => {
      for (const p of [shortPlan, longPlan]) {
        expect(
          findPlanViolations(p, {
            satisfiedExternalPrerequisites: ['set-builder notation', 'union and intersection'],
          }),
        ).toEqual([]);
      }
    });
  });

  describe('a differing diagnostic shifts the Day-1 difficulty (FR-017/FR-019)', () => {
    let easyPlan: CurriculumPlan;
    let hardPlan: CurriculumPlan;

    beforeAll(async () => {
      const easy = await compileFor({
        owner: 'user_diff_easy',
        script: {
          ...rampScript(),
          diagnostic_interpretation: () =>
            referenceDiagnostic({ recommendedStartingDifficulty: 1 }),
        },
      });
      const hard = await compileFor({
        owner: 'user_diff_hard',
        script: {
          ...rampScript(),
          diagnostic_interpretation: () =>
            referenceDiagnostic({ recommendedStartingDifficulty: 3 }),
        },
      });
      easyPlan = easy.plan;
      hardPlan = hard.plan;
    });

    it('raises the Day-1 blueprint difficulty for the harder diagnostic', () => {
      const day1 = (p: CurriculumPlan) =>
        p.assessmentBlueprint.find((e) => e.objectiveId === 'obj_subset_proof')!.targetDifficulty;
      expect(day1(hardPlan)).toBeGreaterThan(day1(easyPlan));
    });
  });

  describe('a differing mastery record changes what is taught (FR-017/FR-018)', () => {
    let retainedPlan: CurriculumPlan;
    let freshPlan: CurriculumPlan;

    beforeAll(async () => {
      // The eval_10 prior-mastery shape: the learner already proved double inclusion (a
      // prerequisite for the new material), so it must not be retaught.
      const retained = await compileFor({
        owner: 'user_diff_retained',
        seedFilledCapability: DOUBLE_INCLUSION,
      });
      const fresh = await compileFor({ owner: 'user_diff_fresh' });
      retainedPlan = retained.plan;
      freshPlan = fresh.plan;
    });

    it('produces measurably different curricula', () => {
      expect(CurriculumPlanContract.schema.parse(retainedPlan)).not.toEqual(
        CurriculumPlanContract.schema.parse(freshPlan),
      );
    });

    it('treats the mastered prerequisite as at most a Day-1 recall check, never retaught', () => {
      // The objective the learner already holds is taught on day 2 in the reference plan; with
      // prior mastery it becomes a <= 5-minute recall check with no full lesson.
      const day2 = retainedPlan.days.find((d) => d.day === 2)!;
      const recall = day2.activities.find((a) => a.kind === 'review');
      expect(recall, 'a recall check replaces the full lesson').toBeDefined();
      expect(recall!.estimatedMinutes).toBeLessThanOrEqual(5);
      expect(day2.activities.some((a) => a.kind === 'audio_lesson')).toBe(false);

      // While a learner without that mastery gets the full lesson.
      const freshDay2 = freshPlan.days.find((d) => d.day === 2)!;
      expect(freshDay2.activities.some((a) => a.kind === 'audio_lesson')).toBe(true);
    });
  });
});
