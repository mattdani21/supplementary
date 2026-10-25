/**
 * Syllabus placement loop (GAP-038).
 *
 * Catalog libraries and imported outlines share one Syllabus shape. Placement is graded
 * server-side; unmet required objectives spawn supplementary gaps idempotently; re-sit is
 * blocked until those gaps are filled.
 */

import {
  buildPlacementItems,
  canResitPlacement,
  catalogPlacementItems,
  catalogSyllabi,
  DomainError,
  gradePlacement,
  mergeSpawnIdempotently,
  planRemediationSpawns,
  resolveCatalogSyllabus,
  syllabusFromOutline,
  toPlacementKitView,
  type PlacementAnswer,
  type PlacementItem,
  type Syllabus,
  type SyllabusOutlineInput,
} from '@gapos/domain';
import type { OwnerId, SyllabusEnrollment, SyllabusRemediationRecord } from '@gapos/database';
import type { ServerContext } from '../context.js';
import { createGap } from './gap-service.js';

export class PlacementKitUnavailableError extends Error {
  constructor() {
    super('This placement check expired or belongs to another learner. Load a fresh check.');
    this.name = 'PlacementKitUnavailableError';
  }
}

export class PlacementResitBlockedError extends Error {
  readonly unfinishedGapIds: readonly string[];
  constructor(unfinishedGapIds: readonly string[]) {
    super('Clear every supplementary course before re-sitting placement.');
    this.name = 'PlacementResitBlockedError';
    this.unfinishedGapIds = unfinishedGapIds;
  }
}

const ensureUser = async (context: ServerContext, owner: OwnerId): Promise<void> => {
  const existing = await context.uow.users.find(owner);
  if (existing) return;
  const emailPrefix = String(owner)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  await context.uow.users.create({
    id: owner,
    email: `${emailPrefix || 'learner'}@local.gapos`,
    locale: 'en',
    timezone: 'UTC',
  });
};

export const listCatalog = (): {
  readonly syllabi: readonly {
    id: string;
    version: number;
    title: string;
    description: string;
    moduleCount: number;
    objectiveCount: number;
  }[];
} => ({
  syllabi: catalogSyllabi().map((syllabus) => ({
    id: syllabus.id,
    version: syllabus.version,
    title: syllabus.title,
    description: syllabus.description,
    moduleCount: syllabus.modules.length,
    objectiveCount: syllabus.objectives.length,
  })),
});

export const importSyllabusOutline = async (
  context: ServerContext,
  owner: OwnerId,
  input: SyllabusOutlineInput,
): Promise<{ syllabus: Syllabus }> => {
  await ensureUser(context, owner);
  const id = context.newId('syllabus');
  const result = syllabusFromOutline(input, { id });
  if (!result.ok) throw result.error;

  await context.uow.syllabi.createImported(owner, {
    id: result.value.id,
    version: result.value.version,
    title: result.value.title,
    description: result.value.description,
    syllabus: result.value,
    createdAt: context.now(),
  });
  context.metrics.increment('syllabus_import_total');
  return { syllabus: result.value };
};

const resolveSyllabus = async (
  context: ServerContext,
  owner: OwnerId,
  syllabusId: string,
): Promise<Syllabus> => {
  const catalog = resolveCatalogSyllabus(syllabusId);
  if (catalog) return catalog;
  const imported = await context.uow.syllabi.getImported(owner, syllabusId);
  if (!imported) throw new Error(`Syllabus ${syllabusId} was not found for this owner.`);
  return imported.syllabus;
};

export const enrollInSyllabus = async (
  context: ServerContext,
  owner: OwnerId,
  syllabusId: string,
): Promise<{ enrollment: SyllabusEnrollment }> => {
  await ensureUser(context, owner);
  const syllabus = await resolveSyllabus(context, owner, syllabusId);
  const at = context.now();
  const enrollment = await context.uow.syllabi.createEnrollment(owner, {
    id: context.newId('enroll'),
    syllabusId: syllabus.id,
    syllabusVersion: syllabus.version,
    syllabusSource: syllabus.source,
    syllabusSnapshot: syllabus,
    status: 'enrolled',
    unlockedModuleIds: [],
    createdAt: at,
    updatedAt: at,
  });
  context.metrics.increment('syllabus_enroll_total', { source: syllabus.source });
  return { enrollment };
};

const remediationViews = async (
  context: ServerContext,
  owner: OwnerId,
  rows: readonly SyllabusRemediationRecord[],
): Promise<
  readonly {
    objectiveId: string;
    gapId: string;
    gapStatus: string;
    title: string;
    idempotencyKey: string;
  }[]
> =>
  Promise.all(
    rows.map(async (row) => {
      const gap = await context.uow.gaps.get(owner, row.gapId);
      return {
        objectiveId: row.objectiveId,
        gapId: row.gapId,
        gapStatus: gap?.status ?? 'archived',
        title: gap?.title ?? row.objectiveId,
        idempotencyKey: row.idempotencyKey,
      };
    }),
  );

export const getEnrollmentView = async (
  context: ServerContext,
  owner: OwnerId,
  enrollmentId: string,
) => {
  const enrollment = await context.uow.syllabi.getEnrollment(owner, enrollmentId);
  if (!enrollment) throw new Error(`Enrollment ${enrollmentId} was not found for this owner.`);
  const remediations = await context.uow.syllabi.listRemediations(owner, enrollmentId);
  const remediationStatus = await remediationViews(context, owner, remediations);
  const attempts = await context.uow.syllabi.listPlacementAttempts(owner, enrollmentId);
  const latest = attempts[0];
  return {
    enrollment: {
      id: enrollment.id,
      syllabusId: enrollment.syllabusId,
      syllabusVersion: enrollment.syllabusVersion,
      syllabusSource: enrollment.syllabusSource,
      title: enrollment.syllabusSnapshot.title,
      description: enrollment.syllabusSnapshot.description,
      status: enrollment.status,
      unlockedModuleIds: enrollment.unlockedModuleIds,
      modules: enrollment.syllabusSnapshot.modules.map((module) => ({
        id: module.id,
        title: module.title,
        order: module.order,
        unlocked: enrollment.unlockedModuleIds.includes(module.id),
        objectiveIds: module.objectiveIds,
      })),
      objectives: enrollment.syllabusSnapshot.objectives.map((objective) => ({
        id: objective.id,
        statement: objective.statement,
        required: objective.required,
        placement: latest?.result.objectiveResults.find((r) => r.objectiveId === objective.id)
          ?.status,
      })),
      remediations: remediationStatus,
      latestPlacement: latest
        ? {
            id: latest.id,
            placedObjectiveIds: latest.result.placedObjectiveIds,
            unmetObjectiveIds: latest.result.unmetObjectiveIds,
            unlockedModuleIds: latest.result.unlockedModuleIds,
            createdAt: latest.createdAt.toISOString(),
          }
        : undefined,
      canResit: canResitPlacement(
        remediationStatus.map((row) => ({
          objectiveId: row.objectiveId,
          gapId: row.gapId,
          gapStatus: row.gapStatus as never,
          idempotencyKey: row.idempotencyKey,
        })),
      ).ok,
    },
  };
};

const placementItemsFor = (syllabus: Syllabus): PlacementItem[] =>
  catalogPlacementItems(syllabus.id) ?? buildPlacementItems(syllabus);

export const issuePlacementKit = async (
  context: ServerContext,
  owner: OwnerId,
  enrollmentId: string,
) => {
  const enrollment = await context.uow.syllabi.getEnrollment(owner, enrollmentId);
  if (!enrollment) throw new Error(`Enrollment ${enrollmentId} was not found for this owner.`);

  const remediations = await context.uow.syllabi.listRemediations(owner, enrollmentId);
  if (remediations.length > 0) {
    const views = await remediationViews(context, owner, remediations);
    const gate = canResitPlacement(
      views.map((row) => ({
        objectiveId: row.objectiveId,
        gapId: row.gapId,
        gapStatus: row.gapStatus as never,
        idempotencyKey: row.idempotencyKey,
      })),
    );
    if (!gate.ok) {
      throw new PlacementResitBlockedError((gate.error.details.unfinishedGapIds as string[]) ?? []);
    }
  }

  const items = placementItemsFor(enrollment.syllabusSnapshot);
  const kitId = context.placementKits.issue(owner, enrollmentId, items);
  await context.uow.syllabi.updateEnrollment(owner, enrollmentId, {
    status: 'placing',
    updatedAt: context.now(),
  });
  return {
    placement: toPlacementKitView(kitId, enrollment.syllabusSnapshot, items),
  };
};

export const submitPlacement = async (
  context: ServerContext,
  owner: OwnerId,
  enrollmentId: string,
  input: { kitId: string; answers: readonly PlacementAnswer[] },
) => {
  const enrollment = await context.uow.syllabi.getEnrollment(owner, enrollmentId);
  if (!enrollment) throw new Error(`Enrollment ${enrollmentId} was not found for this owner.`);

  const items = context.placementKits.get(owner, input.kitId, enrollmentId);
  if (!items) throw new PlacementKitUnavailableError();

  const graded = gradePlacement(enrollment.syllabusSnapshot, items, input.answers);
  if (!graded.ok) throw graded.error;

  const attempt = await context.uow.syllabi.createPlacementAttempt(owner, {
    id: context.newId('place'),
    enrollmentId,
    kitId: input.kitId,
    answers: input.answers,
    result: graded.value,
    createdAt: context.now(),
  });

  const plan = planRemediationSpawns(owner, enrollment.syllabusSnapshot, graded.value);
  const existing = await context.uow.syllabi.listRemediations(owner, enrollmentId);
  const existingViews = await remediationViews(context, owner, existing);
  const merged = mergeSpawnIdempotently(
    plan,
    existingViews.map((row) => ({
      objectiveId: row.objectiveId,
      gapId: row.gapId,
      gapStatus: row.gapStatus as never,
      idempotencyKey: row.idempotencyKey,
    })),
  );

  const spawned: { objectiveId: string; gapId: string; created: boolean }[] = [
    ...merged.reused.map((row) => ({
      objectiveId: row.objectiveId,
      gapId: row.gapId,
      created: false,
    })),
  ];

  for (const spec of merged.toCreate) {
    const prior = await context.uow.syllabi.findRemediationByKey(owner, spec.idempotencyKey);
    if (prior) {
      spawned.push({ objectiveId: prior.objectiveId, gapId: prior.gapId, created: false });
      continue;
    }
    const gap = await createGap(context, owner, {
      title: spec.title,
      rawStatement: spec.rawStatement,
      dailyMinutes: 35,
      sourcePolicy: 'general_knowledge_allowed',
    });
    const { remediation, created } = await context.uow.syllabi.createRemediation(owner, {
      id: context.newId('rem'),
      enrollmentId,
      placementAttemptId: attempt.id,
      objectiveId: spec.objectiveId,
      gapId: gap.id,
      idempotencyKey: spec.idempotencyKey,
      createdAt: context.now(),
    });
    spawned.push({ objectiveId: remediation.objectiveId, gapId: remediation.gapId, created });
  }

  const status =
    plan.gaps.length > 0
      ? 'remediating'
      : graded.value.unlockedModuleIds.length > 0
        ? 'placed'
        : 'placing';

  await context.uow.syllabi.updateEnrollment(owner, enrollmentId, {
    status,
    unlockedModuleIds: graded.value.unlockedModuleIds,
    updatedAt: context.now(),
  });

  context.metrics.increment('syllabus_placement_total', {
    unmet: String(graded.value.unmetObjectiveIds.length),
  });

  return {
    placement: {
      attemptId: attempt.id,
      placedObjectiveIds: graded.value.placedObjectiveIds,
      unmetObjectiveIds: graded.value.unmetObjectiveIds,
      unlockedModuleIds: graded.value.unlockedModuleIds,
      objectiveResults: graded.value.objectiveResults,
      spawnedGaps: spawned,
    },
  };
};

export const requestResit = async (
  context: ServerContext,
  owner: OwnerId,
  enrollmentId: string,
) => {
  const enrollment = await context.uow.syllabi.getEnrollment(owner, enrollmentId);
  if (!enrollment) throw new Error(`Enrollment ${enrollmentId} was not found for this owner.`);
  const remediations = await context.uow.syllabi.listRemediations(owner, enrollmentId);
  const views = await remediationViews(context, owner, remediations);
  const gate = canResitPlacement(
    views.map((row) => ({
      objectiveId: row.objectiveId,
      gapId: row.gapId,
      gapStatus: row.gapStatus as never,
      idempotencyKey: row.idempotencyKey,
    })),
  );
  if (!gate.ok) {
    throw new PlacementResitBlockedError((gate.error.details.unfinishedGapIds as string[]) ?? []);
  }
  return issuePlacementKit(context, owner, enrollmentId);
};

export const isDomainSyllabusError = (error: unknown): error is DomainError =>
  error instanceof DomainError &&
  (error.code === 'syllabus_invalid' ||
    error.code === 'placement_invalid' ||
    error.code === 'placement_resit_blocked');
