/**
 * Supplementary-course spawn plan and the re-sit gate.
 *
 * Unmet required objectives become bounded personal gaps. Spawn is idempotent by key.
 * Re-sit is allowed only when every spawned gap for the enrollment is `filled`.
 */

import { err, ok, type Result } from '../errors.js';
import type { GapStatus } from '../gap/state-machine.js';
import type { PlacementResult } from './placement.js';
import type { Syllabus } from './syllabus.js';

export interface SpawnGapSpec {
  readonly objectiveId: string;
  readonly title: string;
  readonly rawStatement: string;
  readonly idempotencyKey: string;
}

export interface SpawnPlan {
  readonly syllabusId: string;
  readonly syllabusVersion: number;
  readonly gaps: readonly SpawnGapSpec[];
}

export const remediationIdempotencyKey = (
  ownerId: string,
  syllabusId: string,
  syllabusVersion: number,
  objectiveId: string,
): string => `syllabus-remediation:${ownerId}:${syllabusId}:v${syllabusVersion}:${objectiveId}`;

/**
 * Build the spawn plan for unmet *required* objectives. Optional unmet objectives do not spawn
 * courses. Idempotency keys bind owner + syllabus version + objective so retries cannot duplicate.
 */
export const planRemediationSpawns = (
  ownerId: string,
  syllabus: Syllabus,
  placement: PlacementResult,
): SpawnPlan => {
  const byId = new Map(syllabus.objectives.map((objective) => [objective.id, objective]));
  const unmetRequired = placement.unmetObjectiveIds.filter((objectiveId) => {
    const objective = byId.get(objectiveId);
    return objective?.required === true;
  });

  const gaps: SpawnGapSpec[] = unmetRequired.map((objectiveId) => {
    const objective = byId.get(objectiveId)!;
    return {
      objectiveId,
      title: `Fill: ${objective.statement}`,
      rawStatement:
        `I need to master this objective from "${syllabus.title}" before re-sitting placement: ` +
        `${objective.statement}`,
      idempotencyKey: remediationIdempotencyKey(
        ownerId,
        syllabus.id,
        syllabus.version,
        objectiveId,
      ),
    };
  });

  return {
    syllabusId: syllabus.id,
    syllabusVersion: syllabus.version,
    gaps,
  };
};

export interface SpawnedRemediation {
  readonly objectiveId: string;
  readonly gapId: string;
  readonly gapStatus: GapStatus;
  readonly idempotencyKey: string;
}

/**
 * Merge a new spawn plan with already-persisted remediations. Existing keys win so a retry
 * returns the same gap ids without creating duplicates.
 */
export const mergeSpawnIdempotently = (
  plan: SpawnPlan,
  existing: readonly SpawnedRemediation[],
): {
  readonly toCreate: readonly SpawnGapSpec[];
  readonly reused: readonly SpawnedRemediation[];
} => {
  const byKey = new Map(existing.map((row) => [row.idempotencyKey, row]));
  const toCreate: SpawnGapSpec[] = [];
  const reused: SpawnedRemediation[] = [];

  for (const spec of plan.gaps) {
    const prior = byKey.get(spec.idempotencyKey);
    if (prior) reused.push(prior);
    else toCreate.push(spec);
  }

  return { toCreate, reused };
};

/**
 * Re-sit is allowed only when every spawned remediation gap is `filled`. An empty remediation
 * list (perfect first placement) allows an immediate re-sit / progress check.
 */
export const canResitPlacement = (
  remediations: readonly SpawnedRemediation[],
): Result<{ allowed: true }> => {
  const unfinished = remediations.filter((row) => row.gapStatus !== 'filled');
  if (unfinished.length > 0) {
    return err('placement_resit_blocked', 'Clear every supplementary course before re-sitting.', {
      unfinishedGapIds: unfinished.map((row) => row.gapId),
      unfinishedObjectiveIds: unfinished.map((row) => row.objectiveId),
    });
  }
  return ok({ allowed: true as const });
};
