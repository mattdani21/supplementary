/**
 * Personalisation (E24 US4, T031 — C-06, FR-016…FR-020, SC-004).
 *
 * The curriculum is a deterministic function of gap + sources + diagnostic + learner profile +
 * mastery evidence. These tests lock the pure adaptation rules in
 * `packages/domain/src/curriculum/personalisation.ts`:
 *
 *   - two learners differing in only one of (diagnostic, profile, mastery) get measurably
 *     different plans;
 *   - a satisfied prerequisite is at most a 5-minute Day-1 recall check, never retaught;
 *   - a decayed capability is re-demonstrated, never assumed;
 *   - every adapted plan still passes `findPlanViolations` (FR-013).
 *
 * All expectations are on the pure function — the pipeline threading (T034) consumes the same
 * module, so this file is the contract it must satisfy.
 */

import { describe, expect, it } from 'vitest';
import {
  CurriculumPlanContract,
  type CurriculumPlan,
  type DiagnosticInterpretation,
} from '@gapos/ai-contracts';
import { findPlanViolations } from './plan-validation.js';
import { referencePlan } from '@gapos/test-fixtures';
import { derivePlanInputs, personalisePlan, type PlanInputs } from './personalisation.js';

const satisfied = ['set-builder notation', 'union and intersection'];

const diagnostic = (recommendedStartingDifficulty = 2): DiagnosticInterpretation => ({
  schemaVersion: '1.0.0',
  demonstratedCapabilities: ['set-builder notation', 'union and intersection'],
  knowledgeGaps: ['double inclusion', 'relation properties'],
  inferred: false,
  baselineConfidence: 0.72,
  recommendedStartingDifficulty,
});

const inputs = (over: Partial<PlanInputs> = {}): PlanInputs => ({
  gap: { rawStatement: 'I need relations and proof techniques by Friday.', dailyMinutes: 35 },
  diagnostic: diagnostic(),
  profile: { goals: [], preferredLessonLength: 'standard' },
  mastery: { satisfied: [], decayed: [], reviewDue: [], evidenceSummary: 'No prior evidence.' },
  ...over,
});

const DOUBLE_INCLUSION = 'Prove a set equality by double inclusion.';
const SUBSET_PROOF =
  'Prove that one set is a subset of another by taking an arbitrary element and deriving membership.';

describe('derivePlanInputs renders the five inputs into the learner brief', () => {
  it('includes goals, lesson length, mastery and the diagnostic in the brief parts', () => {
    const { learnerBriefParts } = derivePlanInputs({
      normalisation: {
        schemaVersion: '1.0.0',
        topic: 'relations',
        currentState: 'reads set notation',
        targetCapability: 'prove equivalence relations',
        observableSuccessCondition: 'writes correct proofs',
        assumedPrerequisites: ['set-builder notation'],
        ambiguities: [],
        recommendedDiagnostic: { questionCount: 5, focusAreas: [] },
      },
      diagnostic: diagnostic(3),
      profile: { goals: ['prepare for the ML interview'], preferredLessonLength: 'short' },
      mastery: {
        satisfied: ['double inclusion'],
        decayed: ['subset proofs'],
        reviewDue: ['relation properties'],
        evidenceSummary: '12 evidence records; strongest on subset proofs.',
      },
    });

    const brief = learnerBriefParts.join(' ');
    expect(brief).toContain('prepare for the ML interview');
    expect(brief).toContain('short');
    expect(brief).toContain('double inclusion');
    expect(brief).toContain('subset proofs');
    expect(brief).toContain('12 evidence records');
  });

  it('adds satisfied prior capabilities to the held-prerequisites list', () => {
    const { satisfiedExternalPrerequisites } = derivePlanInputs({
      normalisation: {
        schemaVersion: '1.0.0',
        topic: 'relations',
        currentState: 'reads set notation',
        targetCapability: 'prove equivalence relations',
        observableSuccessCondition: 'writes correct proofs',
        assumedPrerequisites: ['set-builder notation'],
        ambiguities: [],
        recommendedDiagnostic: { questionCount: 5, focusAreas: [] },
      },
      diagnostic: diagnostic(),
      profile: { goals: [], preferredLessonLength: 'standard' },
      mastery: { satisfied: ['double inclusion'], decayed: [], reviewDue: [], evidenceSummary: '' },
    });
    expect(satisfiedExternalPrerequisites).toEqual(
      expect.arrayContaining(['set-builder notation', 'double inclusion']),
    );
  });
});

describe('personalisePlan: satisfied prerequisites are recalled, never retaught (FR-018)', () => {
  it('turns the full teaching activity into a <= 5-minute Day-1 recall check and drops later reteaching', () => {
    const plan = referencePlan('gap_p1');
    // The learner already proved double inclusion: the plan must not teach it again.
    const adapted = personalisePlan(
      plan,
      inputs({
        mastery: {
          satisfied: [DOUBLE_INCLUSION],
          decayed: [],
          reviewDue: [],
          evidenceSummary: 'Proved double inclusion last month.',
        },
      }),
    );

    const day2 = adapted.days.find((d) => d.day === 2)!;
    const recall = day2.activities.find((a) => a.kind === 'review');
    expect(recall, 'the satisfied prerequisite becomes a recall check').toBeDefined();
    expect(recall!.estimatedMinutes).toBeLessThanOrEqual(5);
    expect(
      day2.activities.some((a) => a.kind === 'audio_lesson'),
      'no full lesson on it',
    ).toBe(false);

    // Not retaught later: the objective appears on no day after its recall day.
    for (const day of adapted.days.filter((d) => d.day > 2)) {
      expect(day.objectiveIds).not.toContain('obj_double_inclusion');
    }
  });

  it('keeps a satisfied learner’s plan valid', () => {
    const plan = referencePlan('gap_p2');
    const adapted = personalisePlan(
      plan,
      inputs({
        mastery: {
          satisfied: [DOUBLE_INCLUSION, SUBSET_PROOF],
          decayed: [],
          reviewDue: [],
          evidenceSummary: '',
        },
      }),
    );
    expect(findPlanViolations(adapted, { satisfiedExternalPrerequisites: satisfied })).toEqual([]);
  });
});

describe('personalisePlan: decayed capabilities are re-demonstrated (FR-018/FR-020)', () => {
  it('replaces the lesson with a re-demonstration retrieval activity', () => {
    const plan = referencePlan('gap_p3');
    const adapted = personalisePlan(
      plan,
      inputs({
        mastery: {
          satisfied: [],
          decayed: [SUBSET_PROOF],
          reviewDue: [],
          evidenceSummary: 'Decayed after 195 days.',
        },
      }),
    );

    const day1 = adapted.days.find((d) => d.day === 1)!;
    const redemo = day1.activities.find((a) =>
      a.description.toLowerCase().includes('re-demonstrate'),
    );
    expect(redemo, 'a re-demonstration activity is scheduled').toBeDefined();
    expect(['retrieval', 'application']).toContain(redemo!.kind);
    expect(
      day1.activities.some((a) => a.kind === 'audio_lesson'),
      'not assumed via a passive lesson',
    ).toBe(false);
    expect(findPlanViolations(adapted, { satisfiedExternalPrerequisites: satisfied })).toEqual([]);
  });
});

describe('personalisePlan: differing inputs yield measurably different plans (FR-017, SC-004)', () => {
  /** A plan with a Day-1 objective at difficulty 1 and later days at 4, so the start shift shows. */
  const rampPlan = (): CurriculumPlan => {
    const plan = referencePlan('gap_diff');
    return {
      ...plan,
      assessmentBlueprint: plan.assessmentBlueprint.map((entry) =>
        entry.objectiveId === 'obj_subset_proof'
          ? { ...entry, targetDifficulty: 1 }
          : { ...entry, targetDifficulty: 4 },
      ),
    };
  };

  it('a different diagnostic starting difficulty shifts the Day-1 blueprint', () => {
    const easy = personalisePlan(rampPlan(), inputs({ diagnostic: diagnostic(1) }));
    const hard = personalisePlan(rampPlan(), inputs({ diagnostic: diagnostic(3) }));

    const day1 = (p: CurriculumPlan) =>
      p.assessmentBlueprint.find((e) => e.objectiveId === 'obj_subset_proof')!.targetDifficulty;
    expect(day1(hard)).toBeGreaterThan(day1(easy));
    expect(day1(hard)).toBeLessThanOrEqual(5);
    // The progression stays non-decreasing: nothing later falls below the raised Day-1 level.
    for (const p of [easy, hard]) {
      const maxDay1 = day1(p);
      for (const entry of p.assessmentBlueprint) {
        if (entry.objectiveId !== 'obj_subset_proof') {
          expect(entry.targetDifficulty).toBeGreaterThanOrEqual(maxDay1);
        }
      }
    }
  });

  it('a different preferred lesson length rescales the daily structure', () => {
    const short = personalisePlan(
      referencePlan('gap_diff'),
      inputs({ profile: { goals: [], preferredLessonLength: 'short' } }),
    );
    const long = personalisePlan(
      referencePlan('gap_diff'),
      inputs({ profile: { goals: [], preferredLessonLength: 'long' } }),
    );

    const minutes = (p: CurriculumPlan) =>
      p.days.map((d) => d.activities.reduce((sum, a) => sum + a.estimatedMinutes, 0));
    expect(minutes(short)).not.toEqual(minutes(long));
    // Both stay within the learner's daily budget.
    for (const p of [short, long]) {
      expect(findPlanViolations(p, { satisfiedExternalPrerequisites: satisfied })).toEqual([]);
    }
  });

  it('a different mastery record changes what is taught', () => {
    const retained = personalisePlan(
      referencePlan('gap_diff'),
      inputs({
        mastery: { satisfied: [DOUBLE_INCLUSION], decayed: [], reviewDue: [], evidenceSummary: '' },
      }),
    );
    const fresh = personalisePlan(
      referencePlan('gap_diff'),
      inputs({ mastery: { satisfied: [], decayed: [], reviewDue: [], evidenceSummary: '' } }),
    );

    const day2 = (p: CurriculumPlan) => p.days.find((d) => d.day === 2)!;
    expect(day2(retained).activities.map((a) => a.kind)).not.toEqual(
      day2(fresh).activities.map((a) => a.kind),
    );
  });

  it('keeps identical inputs identical (idempotency preserved)', () => {
    const a = personalisePlan(referencePlan('gap_diff'), inputs());
    const b = personalisePlan(referencePlan('gap_diff'), inputs());
    expect(CurriculumPlanContract.schema.parse(a)).toEqual(CurriculumPlanContract.schema.parse(b));
  });
});
