/**
 * The evaluation gate.
 *
 * Two halves, and the second matters as much as the first:
 *
 *   1. The reference curriculum produced by the real pipeline must clear every score floor.
 *   2. Deliberately degraded curricula must *fail* the dimension that is supposed to catch them.
 *
 * Without (2) a scorer that returned 1.0 for everything would pass this file, and the gate would
 * be decorative. Each degradation below corresponds to a failure trap declared on a fixture.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LessonPackage } from '@gapos/ai-contracts';
import type { OwnerId } from '@gapos/database';
import {
  EVALUATION_FIXTURES,
  SCORE_DIMENSIONS,
  SCORE_FLOORS,
  compareToBaseline,
  fixtureById,
  formatScorecard,
  scoreCurriculum,
  toBaseline,
  type Baseline,
  type ProducedCurriculum,
  type ScoreDimension,
} from '@gapos/evaluation';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';

const LEARNER: OwnerId = 'user_eval';

/** The stored baselines the gate compares against (scripts/record-eval-baselines.ts). */
const loadBaselines = (): Record<string, Baseline> => {
  try {
    const parsed = JSON.parse(readFileSync('tasks/evaluation-baselines.json', 'utf8')) as {
      baselines: Record<string, Baseline>;
    };
    return parsed.baselines;
  } catch {
    return {};
  }
};

/** Compile a fixture through the real pipeline and collect what it produced. */
const compileFixture = async (
  context: ServerContext,
  fixtureId: string,
): Promise<ProducedCurriculum> => {
  const fixture = fixtureById(fixtureId)!;

  const gap = await createGap(context, LEARNER, {
    title: fixture.title,
    rawStatement: fixture.learnerStatement,
    dailyMinutes: fixture.dailyMinutes,
  });

  if (fixture.source) {
    await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: fixture.source.filename,
      mediaType: fixture.source.mediaType,
      text: fixture.source.text,
    });
  }

  await applyTransition(context, LEARNER, gap.id, { type: 'define' });
  const outcome = await compile(context, LEARNER, {
    gapId: gap.id,
    idempotencyKey: `eval_${fixtureId}`,
  });

  const curriculum = await context.uow.curricula.get(LEARNER, outcome.curriculumId!);
  const lessons = await context.uow.curricula.listLessons(LEARNER, outcome.curriculumId!);

  return {
    plan: curriculum!.plan,
    lessons: lessons.map((lesson) => lesson.package),
  };
};

describe('the reference pack', () => {
  it('declares all ten fixtures required by the roadmap', () => {
    expect(EVALUATION_FIXTURES).toHaveLength(10);
  });

  it('covers every required domain', () => {
    const domains = new Set(EVALUATION_FIXTURES.map((f) => f.domain));
    for (const required of [
      'mathematics',
      'programming',
      'professional_policy',
      'conceptual_theory',
      'source_heavy',
      'ambiguous_request',
      'adversarial',
    ] as const) {
      expect(domains, `domain ${required}`).toContain(required);
    }
  });

  it.each(EVALUATION_FIXTURES.map((f) => [f.id, f] as const))(
    '%s declares everything a fixture must declare',
    (_id, fixture) => {
      expect(fixture.learnerStatement.length).toBeGreaterThan(10);
      expect(fixture.dailyMinutes).toBeGreaterThan(0);
      expect(fixture.failureTraps.length).toBeGreaterThan(0);
      expect(fixture.expertRubric.length).toBeGreaterThan(40);
      expect(fixture.latencyClass).toBeTruthy();
      // Every declared trap must name a dimension that can actually catch it.
      for (const trap of fixture.failureTraps) {
        expect(SCORE_DIMENSIONS).toContain(trap.caughtBy);
      }
    },
  );

  it('includes a one-day emergency and a prior-mastery fixture', () => {
    expect(EVALUATION_FIXTURES.some((f) => f.latencyClass === 'single_day')).toBe(true);
    expect(EVALUATION_FIXTURES.some((f) => f.id.includes('prior_mastery'))).toBe(true);
  });
});

describe('the reference curriculum clears every floor', () => {
  let produced: ProducedCurriculum;
  let context: ServerContext;

  beforeAll(async () => {
    let counter = 0;
    context = createServerContext({
      newId: (prefix) => `${prefix}_${++counter}`,
      logLevel: 'error',
    });
    await context.uow.users.create({
      id: LEARNER,
      email: 'eval@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    produced = await compileFixture(context, 'eval_01_set_operations');
  });

  it('passes the gate', () => {
    const scorecard = scoreCurriculum(fixtureById('eval_01_set_operations')!, produced);
    // On failure the formatted report names the dimension and the specific observation.
    expect(scorecard.passed, formatScorecard(scorecard)).toBe(true);
  });

  it.each(SCORE_DIMENSIONS)('meets the floor for %s', (dimension) => {
    const scorecard = scoreCurriculum(fixtureById('eval_01_set_operations')!, produced);
    expect(scorecard.dimensions[dimension].score).toBeGreaterThanOrEqual(SCORE_FLOORS[dimension]);
  });

  it('grounds its claims in the supplied source rather than general knowledge', () => {
    const scorecard = scoreCurriculum(fixtureById('eval_01_set_operations')!, produced);
    expect(scorecard.dimensions.source_faithfulness.score).toBeGreaterThan(0.9);
  });

  it('does not regress beyond tolerance against the recorded baseline (E24 US5, T037)', () => {
    // The gate runs on every verification: the fake-compiled reference curriculum is compared
    // against its stored baseline (scripts/record-eval-baselines.ts --fake, deliberate flow).
    // A slip that still clears the floor is still a regression and names the dimension.
    const baseline = loadBaselines()['eval_01_set_operations'];
    const scorecard = scoreCurriculum(fixtureById('eval_01_set_operations')!, produced);
    const verdict = compareToBaseline(scorecard, baseline);
    if (verdict.status === 'regressed') {
      const dimensions = verdict.dimensions
        .map((d) => `${d.dimension}: ${d.from} → ${d.to}`)
        .join(', ');
      expect(
        false,
        `eval_01 regressed by ${verdict.delta}: ${dimensions}. Record a new baseline only with evidence (scripts/record-eval-baselines.ts --fake).`,
      ).toBe(true);
    }
  });
});

/**
 * The half that proves the gate is real. Each case degrades the reference curriculum in exactly
 * one way and asserts the corresponding dimension notices.
 */
describe('the scorer detects poor education', () => {
  let baseline: ProducedCurriculum;
  const fixture = fixtureById('eval_01_set_operations')!;

  beforeAll(async () => {
    let counter = 0;
    const context = createServerContext({
      newId: (prefix) => `${prefix}_${++counter}`,
      logLevel: 'error',
    });
    await context.uow.users.create({
      id: LEARNER,
      email: 'eval@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    baseline = await compileFixture(context, 'eval_01_set_operations');
  });

  const degrade = (transform: (lesson: LessonPackage) => LessonPackage): ProducedCurriculum => ({
    plan: baseline.plan,
    lessons: baseline.lessons.map(transform),
  });

  it('catches a missing objective', () => {
    // Drop the day that teaches equivalence classes entirely.
    const scorecard = scoreCurriculum(fixture, {
      plan: baseline.plan,
      lessons: baseline.lessons.filter((l) => l.day !== 3),
    });
    expect(scorecard.dimensions.objective_coverage.score).toBeLessThan(1);
    expect(scorecard.failures).toContain('objective_coverage');
  });

  it('catches a curriculum that abandons its source for general knowledge', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        evidence: { basis: 'general_knowledge', locators: [] },
        questions: lesson.questions.map((q) => ({
          ...q,
          evidence: { basis: 'general_knowledge' as const, locators: [] },
        })),
      })),
    );
    expect(scorecard.dimensions.source_faithfulness.score).toBeLessThan(
      SCORE_FLOORS.source_faithfulness,
    );
    expect(scorecard.dimensions.source_faithfulness.observations.join(' ')).toContain(
      'despite a supplied source',
    );
  });

  it('catches teaching that strays into prohibited scope', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) =>
        lesson.day === 1
          ? {
              ...lesson,
              script: `${lesson.script} Let us now discuss cardinality and countable sets.`,
            }
          : lesson,
      ),
    );
    expect(scorecard.dimensions.factual_accuracy.score).toBe(0);
    expect(scorecard.dimensions.factual_accuracy.observations[0]).toContain('cardinality');
  });

  it('catches an unanswerable question', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        questions: lesson.questions.map((q) =>
          q.type === 'multiple_choice' ? { ...q, answer: 'an option that does not exist' } : q,
        ),
      })),
    );
    expect(scorecard.dimensions.question_solvability.score).toBeLessThan(1);
    expect(scorecard.failures).toContain('question_solvability');
  });

  it('catches a free-response item shipped without a rubric', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        questions: lesson.questions.map((q) =>
          q.type === 'multiple_choice' ? q : { ...q, rubric: '' },
        ),
      })),
    );
    expect(scorecard.dimensions.question_solvability.observations.join(' ')).toContain(
      'cannot be graded',
    );
  });

  it('catches a course whose difficulty ramps backwards', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        // Day 1 hard, day 3 trivial: the learner is under-tested exactly when it matters.
        questions: lesson.questions.map((q) => ({ ...q, difficulty: 6 - lesson.day })),
      })),
    );
    expect(scorecard.dimensions.difficulty_progression.score).toBeLessThan(
      SCORE_FLOORS.difficulty_progression,
    );
  });

  it('catches a script written to be read rather than heard', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        script: `## Overview\n\n- first point\n- second point\n\nAs shown in the figure below.`,
      })),
    );
    expect(scorecard.dimensions.audio_suitability.score).toBe(0);
    expect(scorecard.dimensions.audio_suitability.observations[0]).toMatch(
      /bullet list|markdown heading|visual reference/,
    );
  });

  it('catches a duration estimate the script cannot support', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({ ...lesson, estimatedMinutes: 55 })),
    );
    expect(scorecard.dimensions.duration_accuracy.score).toBeLessThan(
      SCORE_FLOORS.duration_accuracy,
    );
  });

  it('catches the same question asked twice', () => {
    const first = baseline.lessons[0]!.questions[0]!;
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        questions: lesson.questions.map((q, index) =>
          index === 0 ? { ...q, prompt: first.prompt } : q,
        ),
      })),
    );
    expect(scorecard.dimensions.duplicate_content.score).toBeLessThan(1);
  });

  it('catches an answer leaked into its own prompt', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        questions: lesson.questions.map((q) => ({ ...q, prompt: `${q.prompt} ${q.answer}` })),
      })),
    );
    expect(scorecard.dimensions.answer_leakage.score).toBeLessThan(1);
    expect(scorecard.failures).toContain('answer_leakage');
  });

  it('catches a lesson teaching an objective the plan never declared', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({ ...lesson, objectiveIds: [...lesson.objectiveIds, 'obj_invented'] })),
    );
    expect(scorecard.dimensions.scope_discipline.score).toBe(0);
    expect(scorecard.dimensions.scope_discipline.observations.join(' ')).toContain('obj_invented');
  });

  it('does not fail a curriculum that is merely different, only one that is worse', () => {
    // Rewording a summary is not a defect; the scorer must not punish it.
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({ ...lesson, summary: `In short: ${lesson.summary}` })),
    );
    expect(scorecard.passed, formatScorecard(scorecard)).toBe(true);
  });
});

/**
 * US1 (E24): the human-sounding rubric must be real. A model-dump script — meta-opening,
 * list-like prose, no worked example, no checkpoint — must score below the floor with the
 * failing element named. Each case degrades every lesson in the reference curriculum in exactly
 * one way (FR-006, SC-002).
 */
describe('the human-sounding rubric is not decorative (E24 US1)', () => {
  let baseline: ProducedCurriculum;
  const fixture = fixtureById('eval_01_set_operations')!;

  beforeAll(async () => {
    let counter = 0;
    const context = createServerContext({
      newId: (prefix) => `${prefix}_${++counter}`,
      logLevel: 'error',
    });
    await context.uow.users.create({
      id: LEARNER,
      email: 'eval@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    baseline = await compileFixture(context, 'eval_01_set_operations');
  });

  const degrade = (transform: (lesson: LessonPackage) => LessonPackage): ProducedCurriculum => ({
    plan: baseline.plan,
    lessons: baseline.lessons.map(transform),
  });

  /** The lesson's own checkpoint question, so the degraded scripts keep the other elements. */
  const promptText = (lesson: LessonPackage): string => lesson.pausePrompts[0]?.prompt ?? '';

  it('catches a meta-opening that talks about the lesson instead of the subject', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        script: `In this lesson we will cover the subset definition. ${promptText(lesson)} The proof follows the definition.`,
      })),
    );
    expect(scorecard.dimensions.human_sounding.score).toBeLessThan(SCORE_FLOORS.human_sounding);
    expect(scorecard.dimensions.human_sounding.observations.join(' ')).toMatch(/concrete opening/i);
  });

  it('catches list-like bulleted prose instead of taught segments', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        script: `${promptText(lesson)} - point one - point two - point three`,
      })),
    );
    expect(scorecard.dimensions.human_sounding.score).toBeLessThan(SCORE_FLOORS.human_sounding);
    expect(scorecard.dimensions.human_sounding.observations.join(' ')).toMatch(/segment/i);
  });

  it('catches a script that never works an example', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({
        ...lesson,
        examples: [],
        script: `Some sets contain elements and the subset definition is straightforward. ${promptText(lesson)} The proof follows the definition.`,
      })),
    );
    expect(scorecard.dimensions.human_sounding.score).toBeLessThan(SCORE_FLOORS.human_sounding);
    expect(scorecard.dimensions.human_sounding.observations.join(' ')).toMatch(/worked example/i);
  });

  it('catches a script with no checkpoint question', () => {
    const scorecard = scoreCurriculum(
      fixture,
      degrade((lesson) => ({ ...lesson, pausePrompts: [] })),
    );
    expect(scorecard.dimensions.human_sounding.score).toBeLessThan(SCORE_FLOORS.human_sounding);
    expect(scorecard.dimensions.human_sounding.observations.join(' ')).toMatch(/checkpoint/i);
  });
});

/**
 * T038 (US5, E24 — FR-021): the degradation suite is audited, not assumed. Every dimension —
 * including the new `human_sounding` — must have a defect case that actually fails it below its
 * floor. If a dimension ever has no case, this test names it and the gate becomes decorative.
 */
describe('every dimension has a defect case that fails it (E24 US5, T038)', () => {
  let baseline: ProducedCurriculum;
  const fixture = fixtureById('eval_01_set_operations')!;

  beforeAll(async () => {
    let counter = 0;
    const context = createServerContext({
      newId: (prefix) => `${prefix}_${++counter}`,
      logLevel: 'error',
    });
    await context.uow.users.create({
      id: LEARNER,
      email: 'eval@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    baseline = await compileFixture(context, 'eval_01_set_operations');
  });

  const degrade = (transform: (lesson: LessonPackage) => LessonPackage): ProducedCurriculum => ({
    plan: baseline.plan,
    lessons: baseline.lessons.map(transform),
  });

  /** The lesson's own checkpoint question, kept so other elements survive the degradation. */
  const promptText = (lesson: LessonPackage): string => lesson.pausePrompts[0]?.prompt ?? '';

  /** One defect per dimension. Each produced curriculum must score below that dimension's floor. */
  const DEFECTS: readonly { dimension: ScoreDimension; produced: () => ProducedCurriculum }[] = [
    {
      dimension: 'objective_coverage',
      produced: () => ({
        plan: baseline.plan,
        lessons: baseline.lessons.filter((l) => l.day !== 3),
      }),
    },
    {
      dimension: 'source_faithfulness',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          evidence: { basis: 'general_knowledge', locators: [] },
          questions: lesson.questions.map((q) => ({
            ...q,
            evidence: { basis: 'general_knowledge' as const, locators: [] },
          })),
        })),
    },
    {
      dimension: 'factual_accuracy',
      produced: () =>
        degrade((lesson) =>
          lesson.day === 1
            ? { ...lesson, script: `${lesson.script} Cardinality counts the elements of a set.` }
            : lesson,
        ),
    },
    {
      dimension: 'question_solvability',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          questions: lesson.questions.map((q) =>
            q.type === 'multiple_choice' ? { ...q, answer: 'an option that does not exist' } : q,
          ),
        })),
    },
    {
      dimension: 'difficulty_progression',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          questions: lesson.questions.map((q) => ({ ...q, difficulty: 6 - lesson.day })),
        })),
    },
    {
      dimension: 'audio_suitability',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          script: `## Overview\n\n- first point\n- second point\n\nAs shown in the figure below.`,
        })),
    },
    {
      dimension: 'duration_accuracy',
      produced: () => degrade((lesson) => ({ ...lesson, estimatedMinutes: 55 })),
    },
    {
      dimension: 'duplicate_content',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          questions: lesson.questions.map((q, index, all) =>
            index === 0 && all[1] ? { ...q, prompt: all[1].prompt } : q,
          ),
        })),
    },
    {
      dimension: 'answer_leakage',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          questions: lesson.questions.map((q) => ({ ...q, prompt: `${q.prompt} ${q.answer}` })),
        })),
    },
    {
      dimension: 'scope_discipline',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          objectiveIds: [...lesson.objectiveIds, 'obj_invented'],
        })),
    },
    {
      dimension: 'human_sounding',
      produced: () =>
        degrade((lesson) => ({
          ...lesson,
          script: `In this lesson we will cover the subset definition. ${promptText(lesson)} The proof follows the definition.`,
        })),
    },
  ];

  it.each(DEFECTS.map((d) => [d.dimension, d] as const))(
    'a defect in %s scores below its floor',
    (dimension, { produced }) => {
      const scorecard = scoreCurriculum(fixture, produced());
      expect(
        scorecard.dimensions[dimension].score,
        `${dimension}: ${formatScorecard(scorecard)}`,
      ).toBeLessThan(SCORE_FLOORS[dimension]);
    },
  );

  it('covers every dimension of the pack', () => {
    const audited = new Set(DEFECTS.map((d) => d.dimension));
    for (const dimension of SCORE_DIMENSIONS) {
      expect(audited, `dimension ${dimension} has a defect case`).toContain(dimension);
    }
  });
});

describe('regression comparison', () => {
  const scorecard = {
    fixtureId: 'eval_01_set_operations',
    overall: 0.95,
    passed: true,
    failures: [],
    dimensions: {
      objective_coverage: { dimension: 'objective_coverage' as const, score: 1, observations: [] },
      source_faithfulness: {
        dimension: 'source_faithfulness' as const,
        score: 0.9,
        observations: [],
      },
    },
  } as unknown as Parameters<typeof compareToBaseline>[0];

  it('reports no baseline the first time a fixture is scored', () => {
    expect(compareToBaseline(scorecard, undefined).status).toBe('no_baseline');
  });

  it('is stable when the score has not moved', () => {
    const baseline = toBaseline(scorecard, new Date('2026-08-01T00:00:00Z'));
    expect(compareToBaseline(scorecard, baseline).status).toBe('stable');
  });

  it('fails on a regression beyond tolerance and names the dimension', () => {
    const baseline = toBaseline(scorecard, new Date('2026-08-01T00:00:00Z'));
    const worse = {
      ...scorecard,
      overall: 0.7,
      dimensions: {
        ...scorecard.dimensions,
        source_faithfulness: {
          dimension: 'source_faithfulness' as const,
          score: 0.5,
          observations: [],
        },
      },
    } as typeof scorecard;

    const verdict = compareToBaseline(worse, baseline);
    expect(verdict.status).toBe('regressed');
    if (verdict.status === 'regressed') {
      expect(verdict.dimensions[0]?.dimension).toBe('source_faithfulness');
      expect(verdict.delta).toBeLessThan(0);
    }
  });

  it('tolerates noise below the threshold rather than failing the build on it', () => {
    const baseline = toBaseline(scorecard, new Date('2026-08-01T00:00:00Z'));
    const jittered = {
      ...scorecard,
      dimensions: {
        ...scorecard.dimensions,
        source_faithfulness: {
          dimension: 'source_faithfulness' as const,
          score: 0.88,
          observations: [],
        },
      },
    } as typeof scorecard;
    expect(compareToBaseline(jittered, baseline).status).toBe('stable');
  });

  it('reports an improvement as a prompt to update the baseline, not a failure', () => {
    const baseline = toBaseline(scorecard, new Date('2026-08-01T00:00:00Z'));
    const better = {
      ...scorecard,
      overall: 0.99,
      dimensions: {
        ...scorecard.dimensions,
        source_faithfulness: {
          dimension: 'source_faithfulness' as const,
          score: 1,
          observations: [],
        },
      },
    } as typeof scorecard;
    expect(compareToBaseline(better, baseline).status).toBe('improved');
  });
});
