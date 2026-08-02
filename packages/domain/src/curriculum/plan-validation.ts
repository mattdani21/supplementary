/**
 * Plan validation.
 *
 * A plan that fails any of these checks is rejected before a single lesson is generated. That
 * ordering matters: catching an unassessed objective here costs one planning call, catching it
 * after generation costs seven lesson calls, a verification pass and the audio.
 *
 * The checks encode product invariants from docs/PRODUCT.md, not stylistic preferences:
 *   - the plan must fit the learner's stated daily time;
 *   - every objective must be both taught and assessed;
 *   - every objective must map to source evidence or be explicitly labelled general knowledge;
 *   - the prerequisite graph must be acyclic and fully addressed.
 */

import { DomainError, type DomainErrorCode } from '../errors.js';

export interface PlanObjective {
  readonly id: string;
  readonly capabilityStatement: string;
  readonly required: boolean;
  readonly prerequisiteObjectiveIds: readonly string[];
  readonly externalPrerequisites: readonly string[];
  readonly evidence: {
    readonly basis: 'source' | 'general_knowledge';
    readonly locators: readonly unknown[];
  };
}

export interface PlanActivity {
  readonly kind: 'audio_lesson' | 'retrieval' | 'application' | 'review';
  readonly estimatedMinutes: number;
}

export interface PlanDay {
  readonly day: number;
  readonly objectiveIds: readonly string[];
  readonly activities: readonly PlanActivity[];
}

export interface BlueprintEntry {
  readonly objectiveId: string;
  readonly retrievalItems: number;
  readonly applicationItems: number;
}

export interface PlanToValidate {
  readonly dailyMinutes: number;
  readonly objectives: readonly PlanObjective[];
  readonly days: readonly PlanDay[];
  readonly assessmentBlueprint: readonly BlueprintEntry[];
}

export interface ValidationContext {
  /**
   * Prerequisites the learner is known to hold — from the diagnostic, or from a prior mastered
   * capability. An external prerequisite outside this set is unaddressed.
   */
  readonly satisfiedExternalPrerequisites?: readonly string[];
  /** Allowed overrun before a day is rejected. Zero by default: the stated budget is the budget. */
  readonly toleranceMinutes?: number;
}

export interface PlanViolation {
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

/** Minimum coverage per the product invariant: one lesson, two retrieval, one application. */
export const MINIMUM_RETRIEVAL_ITEMS = 2;
export const MINIMUM_APPLICATION_ITEMS = 1;

const findCycle = (objectives: readonly PlanObjective[]): string[] | undefined => {
  const edges = new Map(objectives.map((o) => [o.id, o.prerequisiteObjectiveIds]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | undefined => {
    const current = state.get(id);
    if (current === 'done') return undefined;
    if (current === 'visiting') return [...stack.slice(stack.indexOf(id)), id];

    state.set(id, 'visiting');
    stack.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return undefined;
  };

  for (const objective of objectives) {
    const cycle = visit(objective.id);
    if (cycle) return cycle;
  }
  return undefined;
};

/**
 * Collect every violation rather than failing on the first. A planner repair prompt that receives
 * all four problems at once fixes them in one attempt; one at a time costs four round trips
 * against a ten-minute budget.
 */
export const findPlanViolations = (
  plan: PlanToValidate,
  context: ValidationContext = {},
): PlanViolation[] => {
  const violations: PlanViolation[] = [];
  const tolerance = context.toleranceMinutes ?? 0;
  const objectiveIds = new Set(plan.objectives.map((o) => o.id));

  for (const day of plan.days) {
    const total = day.activities.reduce((sum, a) => sum + a.estimatedMinutes, 0);
    if (total > plan.dailyMinutes + tolerance) {
      violations.push({
        code: 'plan_exceeds_time_budget',
        message: `Day ${day.day} needs ${total} minutes but the learner has ${plan.dailyMinutes}.`,
        details: { day: day.day, requiredMinutes: total, availableMinutes: plan.dailyMinutes },
      });
    }
  }

  const taught = new Set(plan.days.flatMap((d) => d.objectiveIds));
  for (const objective of plan.objectives) {
    if (!taught.has(objective.id)) {
      violations.push({
        code: 'objective_not_taught',
        message: `Objective "${objective.id}" is never scheduled on any day.`,
        details: { objectiveId: objective.id },
      });
    }
  }

  for (const day of plan.days) {
    for (const id of day.objectiveIds) {
      if (!objectiveIds.has(id)) {
        violations.push({
          code: 'objective_not_taught',
          message: `Day ${day.day} teaches "${id}", which is not an objective of this plan.`,
          details: { day: day.day, objectiveId: id },
        });
      }
    }
  }

  const blueprint = new Map(plan.assessmentBlueprint.map((entry) => [entry.objectiveId, entry]));
  for (const objective of plan.objectives) {
    const entry = blueprint.get(objective.id);
    if (!entry) {
      violations.push({
        code: 'objective_not_assessed',
        message: `Objective "${objective.id}" has no entry in the assessment blueprint.`,
        details: { objectiveId: objective.id },
      });
      continue;
    }
    if (
      entry.retrievalItems < MINIMUM_RETRIEVAL_ITEMS ||
      entry.applicationItems < MINIMUM_APPLICATION_ITEMS
    ) {
      violations.push({
        code: 'objective_not_assessed',
        message:
          `Objective "${objective.id}" needs at least ${MINIMUM_RETRIEVAL_ITEMS} retrieval and ` +
          `${MINIMUM_APPLICATION_ITEMS} application items.`,
        details: {
          objectiveId: objective.id,
          retrievalItems: entry.retrievalItems,
          applicationItems: entry.applicationItems,
        },
      });
    }
  }

  for (const entry of plan.assessmentBlueprint) {
    if (!objectiveIds.has(entry.objectiveId)) {
      violations.push({
        code: 'objective_not_assessed',
        message: `The blueprint assesses "${entry.objectiveId}", which is not an objective.`,
        details: { objectiveId: entry.objectiveId },
      });
    }
  }

  const cycle = findCycle(plan.objectives);
  if (cycle) {
    violations.push({
      code: 'prerequisite_cycle',
      message: `Prerequisite cycle: ${cycle.join(' → ')}.`,
      details: { cycle },
    });
  }

  const satisfied = new Set(context.satisfiedExternalPrerequisites ?? []);
  for (const objective of plan.objectives) {
    for (const id of objective.prerequisiteObjectiveIds) {
      if (!objectiveIds.has(id)) {
        violations.push({
          code: 'prerequisite_unmet',
          message: `Objective "${objective.id}" depends on "${id}", which the plan never teaches.`,
          details: { objectiveId: objective.id, prerequisiteId: id },
        });
      }
    }
    for (const external of objective.externalPrerequisites) {
      if (!satisfied.has(external)) {
        violations.push({
          code: 'prerequisite_unmet',
          message:
            `Objective "${objective.id}" assumes "${external}", which the learner has not been ` +
            'shown to hold.',
          details: { objectiveId: objective.id, externalPrerequisite: external },
        });
      }
    }
  }

  // Not a rejection on its own: general knowledge is permitted. The check is that the basis is
  // declared, which the contract already enforces — this catches a source basis with no locator
  // slipping through a hand-built plan.
  for (const objective of plan.objectives) {
    if (objective.evidence.basis === 'source' && objective.evidence.locators.length === 0) {
      violations.push({
        code: 'objective_not_taught',
        message: `Objective "${objective.id}" claims source grounding but cites no locator.`,
        details: { objectiveId: objective.id },
      });
    }
  }

  return violations;
};

export class PlanRejected extends DomainError {
  constructor(readonly violations: readonly PlanViolation[]) {
    super(
      violations[0]?.code ?? 'objective_not_assessed',
      `The plan was rejected with ${violations.length} violation(s): ` +
        violations.map((v) => v.message).join(' '),
      { violations: violations.map((v) => ({ code: v.code, message: v.message, ...v.details })) },
    );
    this.name = 'PlanRejected';
  }
}

export const validatePlan = (plan: PlanToValidate, context: ValidationContext = {}): void => {
  const violations = findPlanViolations(plan, context);
  if (violations.length > 0) throw new PlanRejected(violations);
};

export const isPlanValid = (plan: PlanToValidate, context: ValidationContext = {}): boolean =>
  findPlanViolations(plan, context).length === 0;
