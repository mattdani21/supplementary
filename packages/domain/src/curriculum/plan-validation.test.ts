import { describe, expect, it } from 'vitest';
import {
  PlanRejected,
  findPlanViolations,
  isPlanValid,
  validatePlan,
  type PlanToValidate,
} from './plan-validation.js';

const sourced = { basis: 'source' as const, locators: [{ chunkId: 'c1' }] };

/** A valid two-day plan. Individual tests break exactly one property of it. */
const validPlan = (): PlanToValidate => ({
  dailyMinutes: 35,
  objectives: [
    {
      id: 'a',
      capabilityStatement: 'Prove a subset claim.',
      required: true,
      prerequisiteObjectiveIds: [],
      externalPrerequisites: [],
      evidence: sourced,
    },
    {
      id: 'b',
      capabilityStatement: 'Prove a set equality by double inclusion.',
      required: true,
      prerequisiteObjectiveIds: ['a'],
      externalPrerequisites: [],
      evidence: sourced,
    },
  ],
  days: [
    {
      day: 1,
      objectiveIds: ['a'],
      activities: [
        { kind: 'audio_lesson', estimatedMinutes: 12 },
        { kind: 'retrieval', estimatedMinutes: 8 },
        { kind: 'application', estimatedMinutes: 15 },
      ],
    },
    {
      day: 2,
      objectiveIds: ['b'],
      activities: [
        { kind: 'review', estimatedMinutes: 5 },
        { kind: 'audio_lesson', estimatedMinutes: 13 },
        { kind: 'application', estimatedMinutes: 17 },
      ],
    },
  ],
  assessmentBlueprint: [
    { objectiveId: 'a', retrievalItems: 2, applicationItems: 1 },
    { objectiveId: 'b', retrievalItems: 2, applicationItems: 1 },
  ],
});

const codes = (plan: PlanToValidate, context = {}) =>
  findPlanViolations(plan, context).map((v) => v.code);

describe('plan validation', () => {
  it('accepts a plan that fits, teaches and assesses everything', () => {
    expect(findPlanViolations(validPlan())).toEqual([]);
    expect(isPlanValid(validPlan())).toBe(true);
    expect(() => validatePlan(validPlan())).not.toThrow();
  });

  it('rejects a day that exceeds the learner’s stated time', () => {
    const plan = validPlan();
    const over: PlanToValidate = {
      ...plan,
      days: [
        {
          ...plan.days[0]!,
          activities: [{ kind: 'audio_lesson', estimatedMinutes: 50 }],
        },
        plan.days[1]!,
      ],
    };
    expect(codes(over)).toContain('plan_exceeds_time_budget');
    const violation = findPlanViolations(over)[0];
    expect(violation?.details).toMatchObject({ requiredMinutes: 50, availableMinutes: 35 });
  });

  it('accepts an overrun within an explicit tolerance', () => {
    const plan = validPlan();
    const slightlyOver: PlanToValidate = {
      ...plan,
      days: [
        { ...plan.days[0]!, activities: [{ kind: 'audio_lesson', estimatedMinutes: 38 }] },
        plan.days[1]!,
      ],
    };
    expect(codes(slightlyOver)).toContain('plan_exceeds_time_budget');
    expect(codes(slightlyOver, { toleranceMinutes: 5 })).not.toContain('plan_exceeds_time_budget');
  });

  it('rejects an objective that is never taught', () => {
    const plan = validPlan();
    const orphaned: PlanToValidate = { ...plan, days: [plan.days[0]!] };
    expect(codes(orphaned)).toContain('objective_not_taught');
  });

  it('rejects a day that teaches an objective the plan does not declare', () => {
    const plan = validPlan();
    const ghost: PlanToValidate = {
      ...plan,
      days: [{ ...plan.days[0]!, objectiveIds: ['a', 'ghost'] }, plan.days[1]!],
    };
    expect(codes(ghost)).toContain('objective_not_taught');
  });

  it('rejects an objective with no assessment blueprint entry', () => {
    const plan = validPlan();
    const unassessed: PlanToValidate = {
      ...plan,
      assessmentBlueprint: [plan.assessmentBlueprint[0]!],
    };
    expect(codes(unassessed)).toContain('objective_not_assessed');
  });

  it('rejects an objective assessed by too few items', () => {
    const plan = validPlan();
    const thin: PlanToValidate = {
      ...plan,
      assessmentBlueprint: [
        { objectiveId: 'a', retrievalItems: 1, applicationItems: 0 },
        plan.assessmentBlueprint[1]!,
      ],
    };
    const violation = findPlanViolations(thin).find((v) => v.code === 'objective_not_assessed');
    expect(violation?.message).toContain('at least 2 retrieval and 1 application');
  });

  it('rejects a prerequisite cycle and names it', () => {
    const plan = validPlan();
    const cyclic: PlanToValidate = {
      ...plan,
      objectives: [
        { ...plan.objectives[0]!, prerequisiteObjectiveIds: ['b'] },
        { ...plan.objectives[1]!, prerequisiteObjectiveIds: ['a'] },
      ],
    };
    const violation = findPlanViolations(cyclic).find((v) => v.code === 'prerequisite_cycle');
    expect(violation).toBeDefined();
    expect(violation?.details.cycle).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('rejects a dependency on an objective the plan never teaches', () => {
    const plan = validPlan();
    const dangling: PlanToValidate = {
      ...plan,
      objectives: [
        plan.objectives[0]!,
        { ...plan.objectives[1]!, prerequisiteObjectiveIds: ['a', 'never_taught'] },
      ],
    };
    expect(codes(dangling)).toContain('prerequisite_unmet');
  });

  it('rejects an assumed external prerequisite the learner has not been shown to hold', () => {
    const plan = validPlan();
    const assuming: PlanToValidate = {
      ...plan,
      objectives: [
        { ...plan.objectives[0]!, externalPrerequisites: ['set-builder notation'] },
        plan.objectives[1]!,
      ],
    };
    expect(codes(assuming)).toContain('prerequisite_unmet');
    expect(
      codes(assuming, { satisfiedExternalPrerequisites: ['set-builder notation'] }),
    ).not.toContain('prerequisite_unmet');
  });

  it('rejects an objective claiming source grounding with no locator', () => {
    const plan = validPlan();
    const unsupported: PlanToValidate = {
      ...plan,
      objectives: [
        { ...plan.objectives[0]!, evidence: { basis: 'source', locators: [] } },
        plan.objectives[1]!,
      ],
    };
    expect(codes(unsupported)).toContain('objective_not_taught');
  });

  it('permits an objective explicitly labelled general knowledge', () => {
    const plan = validPlan();
    const general: PlanToValidate = {
      ...plan,
      objectives: [
        { ...plan.objectives[0]!, evidence: { basis: 'general_knowledge', locators: [] } },
        plan.objectives[1]!,
      ],
    };
    expect(findPlanViolations(general)).toEqual([]);
  });

  it('reports every violation at once rather than failing on the first', () => {
    const broken: PlanToValidate = {
      dailyMinutes: 20,
      objectives: [
        {
          id: 'a',
          capabilityStatement: 'x',
          required: true,
          prerequisiteObjectiveIds: ['missing'],
          externalPrerequisites: [],
          evidence: sourced,
        },
        {
          id: 'b',
          capabilityStatement: 'y',
          required: true,
          prerequisiteObjectiveIds: [],
          externalPrerequisites: [],
          evidence: sourced,
        },
      ],
      days: [
        {
          day: 1,
          objectiveIds: ['a'],
          activities: [{ kind: 'audio_lesson', estimatedMinutes: 45 }],
        },
      ],
      assessmentBlueprint: [{ objectiveId: 'a', retrievalItems: 2, applicationItems: 1 }],
    };

    const found = new Set(codes(broken));
    expect(found).toContain('plan_exceeds_time_budget');
    expect(found).toContain('objective_not_taught');
    expect(found).toContain('objective_not_assessed');
    expect(found).toContain('prerequisite_unmet');
  });

  it('throws a typed rejection carrying every violation', () => {
    const plan = validPlan();
    const broken: PlanToValidate = { ...plan, days: [plan.days[0]!] };
    try {
      validatePlan(broken);
      expect.unreachable('expected the plan to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(PlanRejected);
      expect((error as PlanRejected).violations.length).toBeGreaterThan(0);
      expect((error as PlanRejected).code).toBe('objective_not_taught');
    }
  });
});
