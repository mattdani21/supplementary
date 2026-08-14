/**
 * The plan gate guard (US3, E24 — FR-015, SC-001).
 *
 * The hit-rate work must never raise the first-attempt valid-plan rate by weakening the gate.
 * This file locks every known-bad plan shape to the validation gate: a plan over the daily
 * budget, an untaught or unassessed objective, a prerequisite cycle or unmet prerequisite, and
 * a source-grounded objective with no locator must ALL still be rejected — and all violations
 * must come back together in one result, so a repair round can fix them in one pass (FR-014).
 *
 * If this file ever needs editing to make the harness green, that is the smell the epic exists
 * to catch: the gate does not develop a tolerance for bad plans.
 */

import { describe, expect, it } from 'vitest';
import { findPlanViolations, type PlanToValidate } from '@gapos/domain';
import { referencePlan } from '@gapos/test-fixtures';

/** A valid reference plan, degraded in exactly one way per test. */
const basePlan = (): PlanToValidate => referencePlan('gap_guard');

const satisfied = ['set-builder notation', 'union and intersection'];

describe('the plan gate rejects every known-bad shape (E24 US3, T028)', () => {
  it('rejects a day over the learner’s daily time budget', () => {
    const plan = basePlan();
    const overBudget = {
      ...plan,
      days: [
        {
          ...plan.days[0]!,
          activities: [
            ...plan.days[0]!.activities,
            { kind: 'application' as const, estimatedMinutes: 60 },
          ],
        },
        ...plan.days.slice(1),
      ],
    };
    const violations = findPlanViolations(overBudget, {
      satisfiedExternalPrerequisites: satisfied,
    });
    expect(violations.map((v) => v.code)).toContain('plan_exceeds_time_budget');
  });

  it('rejects an objective that is never scheduled on any day', () => {
    const plan = basePlan();
    const untaught = {
      ...plan,
      days: plan.days.map((d) => ({
        ...d,
        objectiveIds: d.objectiveIds.filter((id) => id !== 'obj_double_inclusion'),
      })),
    };
    const violations = findPlanViolations(untaught, {
      satisfiedExternalPrerequisites: satisfied,
    });
    expect(violations.map((v) => v.code)).toContain('objective_not_taught');
  });

  it('rejects a day that teaches an objective the plan never declared', () => {
    const plan = basePlan();
    const stray = {
      ...plan,
      days: [
        { ...plan.days[0]!, objectiveIds: [...plan.days[0]!.objectiveIds, 'obj_invented'] },
        ...plan.days.slice(1),
      ],
    };
    const violations = findPlanViolations(stray, { satisfiedExternalPrerequisites: satisfied });
    expect(violations.map((v) => v.code)).toContain('objective_not_taught');
  });

  it('rejects an objective with no assessment blueprint entry', () => {
    const plan = basePlan();
    const unassessed = {
      ...plan,
      objectives: [
        ...plan.objectives,
        {
          id: 'obj_unassessed',
          capabilityStatement: 'State the definition of a power set.',
          required: true,
          prerequisiteObjectiveIds: [],
          externalPrerequisites: [],
          evidence: { basis: 'general_knowledge' as const, locators: [] },
        },
      ],
      days: [
        ...plan.days,
        {
          day: 4,
          title: 'Power sets',
          objectiveIds: ['obj_unassessed'],
          activities: [
            { kind: 'audio_lesson' as const, description: 'listen', estimatedMinutes: 5 },
          ],
        },
      ],
    };
    const violations = findPlanViolations(unassessed, {
      satisfiedExternalPrerequisites: satisfied,
    });
    expect(violations.map((v) => v.code)).toContain('objective_not_assessed');
  });

  it('rejects a blueprint entry promising fewer items than the product invariant', () => {
    const plan = basePlan();
    const thin = {
      ...plan,
      assessmentBlueprint: [
        { objectiveId: 'obj_subset_proof', retrievalItems: 1, applicationItems: 0 },
        ...plan.assessmentBlueprint.slice(1),
      ],
    };
    const violations = findPlanViolations(thin, { satisfiedExternalPrerequisites: satisfied });
    expect(violations.map((v) => v.code)).toContain('objective_not_assessed');
  });

  it('rejects a blueprint entry for an objective the plan never declared', () => {
    const plan = basePlan();
    const phantom = {
      ...plan,
      assessmentBlueprint: [
        ...plan.assessmentBlueprint,
        { objectiveId: 'obj_ghost', retrievalItems: 2, applicationItems: 1 },
      ],
    };
    const violations = findPlanViolations(phantom, { satisfiedExternalPrerequisites: satisfied });
    expect(violations.map((v) => v.code)).toContain('objective_not_assessed');
  });

  it('rejects a prerequisite cycle, naming it', () => {
    const plan = basePlan();
    const cyclic = {
      ...plan,
      objectives: plan.objectives.map((o) =>
        o.id === 'obj_relation_properties'
          ? { ...o, prerequisiteObjectiveIds: ['obj_equivalence_classes'] }
          : o.id === 'obj_equivalence_classes'
            ? { ...o, prerequisiteObjectiveIds: ['obj_relation_properties'] }
            : o,
      ),
    };
    const violations = findPlanViolations(cyclic, { satisfiedExternalPrerequisites: satisfied });
    const cycle = violations.find((v) => v.code === 'prerequisite_cycle');
    expect(cycle, 'the cycle is named').toBeDefined();
  });

  it('rejects a dependency on an objective the plan never teaches', () => {
    const plan = basePlan();
    const dangling = {
      ...plan,
      objectives: plan.objectives.map((o) =>
        o.id === 'obj_double_inclusion'
          ? { ...o, prerequisiteObjectiveIds: ['obj_missing_prereq'] }
          : o,
      ),
    };
    const violations = findPlanViolations(dangling, {
      satisfiedExternalPrerequisites: satisfied,
    });
    expect(violations.map((v) => v.code)).toContain('prerequisite_unmet');
  });

  it('rejects an unmet external prerequisite that the learner has not been shown to hold', () => {
    const plan = basePlan();
    const unmet = {
      ...plan,
      objectives: plan.objectives.map((o) =>
        o.id === 'obj_relation_properties'
          ? { ...o, externalPrerequisites: ['topological spaces'] }
          : o,
      ),
    };
    const violations = findPlanViolations(unmet, { satisfiedExternalPrerequisites: satisfied });
    expect(violations.map((v) => v.code)).toContain('prerequisite_unmet');
  });

  it('accepts an external prerequisite the learner is known to hold', () => {
    const plan = basePlan();
    expect(findPlanViolations(plan, { satisfiedExternalPrerequisites: satisfied })).toEqual([]);
  });

  it('rejects a source-grounded objective that cites no locator', () => {
    const plan = basePlan();
    const ungrounded = {
      ...plan,
      objectives: plan.objectives.map((o) =>
        o.id === 'obj_subset_proof'
          ? { ...o, evidence: { basis: 'source' as const, locators: [] } }
          : o,
      ),
    };
    const violations = findPlanViolations(ungrounded, {
      satisfiedExternalPrerequisites: satisfied,
    });
    expect(violations.some((v) => v.message.includes('cites no locator'))).toBe(true);
  });

  it('returns every violation together so one repair round fixes them all (FR-014)', () => {
    // A plan with three independent defects: over budget, one objective unassessed, and one
    // unmet external prerequisite. The gate must report all three at once, not throw on the
    // first.
    const plan = basePlan();
    const triple = {
      ...plan,
      days: [
        {
          ...plan.days[0]!,
          activities: [
            ...plan.days[0]!.activities,
            { kind: 'application' as const, estimatedMinutes: 90 },
          ],
        },
        ...plan.days.slice(1),
      ],
      assessmentBlueprint: [
        { objectiveId: 'obj_double_inclusion', retrievalItems: 0, applicationItems: 0 },
        ...plan.assessmentBlueprint.slice(1),
      ],
      objectives: plan.objectives.map((o) =>
        o.id === 'obj_equivalence_classes'
          ? { ...o, externalPrerequisites: ['category theory'] }
          : o,
      ),
    };
    const violations = findPlanViolations(triple, {
      satisfiedExternalPrerequisites: satisfied,
    });
    const codes = new Set(violations.map((v) => v.code));
    expect(codes).toContain('plan_exceeds_time_budget');
    expect(codes).toContain('objective_not_assessed');
    expect(codes).toContain('prerequisite_unmet');
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });
});
