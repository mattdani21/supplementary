/**
 * The mastery rule.
 *
 * The product claim is that a gap fills on evidence, never on consumption. That claim lives here.
 *
 * An objective is mastered when all five conditions hold:
 *   1. at least 80% across a representative item set;
 *   2. evidence from at least two separate sessions;
 *   3. at least one item completed without hints;
 *   4. at least one item requiring application or transfer;
 *   5. no critical prerequisite objective below threshold.
 *
 * Each condition is reported individually, so the UI can say *what is still missing* rather than
 * "not yet mastered", and so a regression names the clause it broke.
 */

export const MASTERY_THRESHOLD = 0.8;
export const MINIMUM_SESSIONS = 2;
export const MINIMUM_ITEMS = 3;

export type EvidenceType =
  'retrieval' | 'application' | 'transfer' | 'delayed_retrieval' | 'cumulative';

export interface Evidence {
  readonly objectiveId: string;
  readonly sessionId: string;
  readonly evidenceType: EvidenceType;
  readonly score: number;
  /** No hints were used. Required by clause 3. */
  readonly independent: boolean;
  readonly difficulty: number;
  readonly recordedAt: Date;
}

/** Evidence types that demonstrate use, not just recall. Clause 4 needs one of these. */
const APPLICATION_TYPES: readonly EvidenceType[] = ['application', 'transfer', 'cumulative'];

export interface MasteryClauses {
  readonly meetsThreshold: boolean;
  readonly hasEnoughSessions: boolean;
  readonly hasUnhintedItem: boolean;
  readonly hasApplicationItem: boolean;
  readonly prerequisitesSatisfied: boolean;
  readonly hasEnoughItems: boolean;
}

export interface MasteryAssessment {
  readonly objectiveId: string;
  readonly mastered: boolean;
  readonly score: number;
  readonly itemCount: number;
  readonly sessionCount: number;
  readonly clauses: MasteryClauses;
  /** Human-readable statements of what is still missing, for the Mastery tab. */
  readonly missing: readonly string[];
}

export interface ObjectiveNode {
  readonly id: string;
  readonly required: boolean;
  /** Objectives that must themselves be mastered first. */
  readonly prerequisiteObjectiveIds: readonly string[];
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Assess one objective. `prerequisiteMastery` carries the already-computed verdict for each
 * prerequisite, so this function stays pure and cycle-free; `assessCurriculum` supplies it in
 * dependency order.
 */
export const assessObjective = (
  objective: ObjectiveNode,
  evidence: readonly Evidence[],
  prerequisiteMastery: ReadonlyMap<string, boolean> = new Map(),
): MasteryAssessment => {
  const relevant = evidence.filter((e) => e.objectiveId === objective.id);
  const sessions = new Set(relevant.map((e) => e.sessionId));
  const score = mean(relevant.map((e) => e.score));

  const clauses: MasteryClauses = {
    meetsThreshold: relevant.length > 0 && score >= MASTERY_THRESHOLD,
    hasEnoughSessions: sessions.size >= MINIMUM_SESSIONS,
    hasUnhintedItem: relevant.some((e) => e.independent && e.score >= MASTERY_THRESHOLD),
    hasApplicationItem: relevant.some(
      (e) => APPLICATION_TYPES.includes(e.evidenceType) && e.score >= MASTERY_THRESHOLD,
    ),
    prerequisitesSatisfied: objective.prerequisiteObjectiveIds.every(
      (id) => prerequisiteMastery.get(id) === true,
    ),
    hasEnoughItems: relevant.length >= MINIMUM_ITEMS,
  };

  const missing: string[] = [];
  if (!clauses.hasEnoughItems) {
    missing.push(`Needs ${MINIMUM_ITEMS - relevant.length} more practice items.`);
  }
  if (!clauses.meetsThreshold) {
    missing.push(
      `Scoring ${Math.round(score * 100)}%, needs ${Math.round(MASTERY_THRESHOLD * 100)}%.`,
    );
  }
  if (!clauses.hasEnoughSessions) {
    missing.push('Needs evidence from a second, separate session.');
  }
  if (!clauses.hasUnhintedItem) {
    missing.push('Needs one item answered correctly without hints.');
  }
  if (!clauses.hasApplicationItem) {
    missing.push('Needs one application or transfer item, not only recall.');
  }
  if (!clauses.prerequisitesSatisfied) {
    const unmet = objective.prerequisiteObjectiveIds.filter(
      (id) => prerequisiteMastery.get(id) !== true,
    );
    missing.push(`Blocked by unmastered prerequisites: ${unmet.join(', ')}.`);
  }

  return {
    objectiveId: objective.id,
    mastered: Object.values(clauses).every(Boolean),
    score: Number(score.toFixed(4)),
    itemCount: relevant.length,
    sessionCount: sessions.size,
    clauses,
    missing,
  };
};

export interface CurriculumMastery {
  readonly assessments: readonly MasteryAssessment[];
  readonly masteredObjectiveIds: readonly string[];
  readonly requiredObjectiveIds: readonly string[];
  /** True when every *required* objective is mastered. Optional objectives never block. */
  readonly readyToFill: boolean;
}

/**
 * Assess a whole curriculum, resolving prerequisites in dependency order.
 *
 * A prerequisite cycle would make "in dependency order" meaningless. Rather than looping, an
 * objective still unresolved after the graph stops making progress is assessed with its
 * prerequisites treated as unmet — so a cycle blocks mastery loudly instead of hanging.
 */
export const assessCurriculum = (
  objectives: readonly ObjectiveNode[],
  evidence: readonly Evidence[],
): CurriculumMastery => {
  const resolved = new Map<string, MasteryAssessment>();
  const pending = new Map(objectives.map((o) => [o.id, o]));

  let progressed = true;
  while (pending.size > 0 && progressed) {
    progressed = false;
    for (const objective of [...pending.values()]) {
      const ready = objective.prerequisiteObjectiveIds.every(
        (id) => resolved.has(id) || !pending.has(id),
      );
      if (!ready) continue;
      const prerequisiteMastery = new Map(
        objective.prerequisiteObjectiveIds.map((id) => [id, resolved.get(id)?.mastered === true]),
      );
      resolved.set(objective.id, assessObjective(objective, evidence, prerequisiteMastery));
      pending.delete(objective.id);
      progressed = true;
    }
  }

  // Anything still pending sits in a cycle; assess it with prerequisites treated as unmet.
  for (const objective of pending.values()) {
    resolved.set(
      objective.id,
      assessObjective(
        objective,
        evidence,
        new Map(objective.prerequisiteObjectiveIds.map((id) => [id, false])),
      ),
    );
  }

  const assessments = objectives.map((o) => resolved.get(o.id)!);
  const masteredObjectiveIds = assessments.filter((a) => a.mastered).map((a) => a.objectiveId);
  const requiredObjectiveIds = objectives.filter((o) => o.required).map((o) => o.id);

  return {
    assessments,
    masteredObjectiveIds,
    requiredObjectiveIds,
    readyToFill:
      requiredObjectiveIds.length > 0 &&
      requiredObjectiveIds.every((id) => masteredObjectiveIds.includes(id)),
  };
};

/**
 * Whether a prior capability still satisfies a prerequisite, or has decayed enough that the
 * learner should be re-diagnosed. Used when a new gap reuses earlier learning.
 */
export const DECAY_HALF_LIFE_DAYS = 90;

export const retainedStrength = (masteredAt: Date, now: Date, reinforcements = 0): number => {
  const days = Math.max(0, (now.getTime() - masteredAt.getTime()) / 86_400_000);
  // Each later reinforcement extends the half-life, which is the whole point of the review ladder.
  const halfLife = DECAY_HALF_LIFE_DAYS * (1 + 0.5 * reinforcements);
  return Number(Math.pow(0.5, days / halfLife).toFixed(4));
};

export const PREREQUISITE_REUSE_THRESHOLD = 0.6;

export const satisfiesPrerequisite = (masteredAt: Date, now: Date, reinforcements = 0): boolean =>
  retainedStrength(masteredAt, now, reinforcements) >= PREREQUISITE_REUSE_THRESHOLD;

/** A capability the learner demonstrated by filling a gap. */
export interface PriorCapability {
  /** Matches the capability text a new plan may declare as an external prerequisite. */
  readonly capabilityId: string;
  /** When the gap filled. The evidence decays from this point. */
  readonly masteredAt: Date;
  /** Later review passes extend the half-life. Zero by default: the conservative reading. */
  readonly reinforcements?: number;
}

export interface PrerequisiteReuse {
  /** Capabilities still strong enough to assume without reteaching. */
  readonly satisfied: readonly string[];
  /** Capabilities that have decayed below the reuse threshold and must be re-demonstrated. */
  readonly decayed: readonly string[];
}

/**
 * Classify the learner's prior mastered capabilities for a new curriculum.
 *
 * A capability above the reuse threshold can be handed to the planner as already held; one
 * below it must not be assumed — the learner has to re-demonstrate it, which is the decay that
 * forces a diagnostic rather than a silent reteach-or-skip decision.
 */
export const classifyPriorCapabilities = (
  prior: readonly PriorCapability[],
  now: Date,
): PrerequisiteReuse => {
  const satisfied: string[] = [];
  const decayed: string[] = [];
  for (const capability of prior) {
    const target = satisfiesPrerequisite(capability.masteredAt, now, capability.reinforcements ?? 0)
      ? satisfied
      : decayed;
    target.push(capability.capabilityId);
  }
  return { satisfied, decayed };
};
