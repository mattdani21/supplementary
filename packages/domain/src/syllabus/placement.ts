/**
 * Placement exam grading and module unlock rules.
 *
 * The answer key stays on the server. This module grades submitted answers against a kit and
 * computes which modules the learner may enter. It never invents curriculum content.
 */

import { err, ok, type Result } from '../errors.js';
import type { Syllabus, SyllabusObjective } from './syllabus.js';

export type PlacementItemType = 'multiple_choice' | 'short_answer';

export interface PlacementItem {
  readonly id: string;
  readonly objectiveId: string;
  readonly type: PlacementItemType;
  readonly prompt: string;
  /** Present for multiple-choice items. */
  readonly options?: readonly string[];
  /** Server-only. Never projected to the client. */
  readonly answer: string;
}

export interface PlacementAnswer {
  readonly itemId: string;
  readonly response: string;
}

export type ObjectivePlacementStatus = 'placed' | 'unmet';

export interface ObjectivePlacement {
  readonly objectiveId: string;
  readonly status: ObjectivePlacementStatus;
  readonly score: number;
  readonly itemCount: number;
}

export interface PlacementResult {
  readonly placedObjectiveIds: readonly string[];
  readonly unmetObjectiveIds: readonly string[];
  readonly objectiveResults: readonly ObjectivePlacement[];
  readonly unlockedModuleIds: readonly string[];
}

const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const gradeItem = (item: PlacementItem, response: string | undefined): number => {
  if (response === undefined) return 0;
  return normalise(response) === normalise(item.answer) ? 1 : 0;
};

const PLACE_THRESHOLD = 0.8;

/**
 * Grade a placement attempt. Missing answers count as wrong. An objective is `placed` when its
 * mean item score is at least 80%; otherwise `unmet`. Required unmet objectives drive spawn.
 */
export const gradePlacement = (
  syllabus: Syllabus,
  items: readonly PlacementItem[],
  answers: readonly PlacementAnswer[],
): Result<PlacementResult> => {
  if (items.length === 0) {
    return err('placement_invalid', 'A placement kit needs at least one item.');
  }

  const objectiveIds = new Set(syllabus.objectives.map((objective) => objective.id));
  for (const item of items) {
    if (!objectiveIds.has(item.objectiveId)) {
      return err(
        'placement_invalid',
        `Placement item targets unknown objective "${item.objectiveId}".`,
      );
    }
  }

  const byItem = new Map(answers.map((answer) => [answer.itemId, answer.response]));
  const scoresByObjective = new Map<string, number[]>();

  for (const item of items) {
    const score = gradeItem(item, byItem.get(item.id));
    const list = scoresByObjective.get(item.objectiveId) ?? [];
    list.push(score);
    scoresByObjective.set(item.objectiveId, list);
  }

  const objectiveResults: ObjectivePlacement[] = syllabus.objectives.map((objective) => {
    const scores = scoresByObjective.get(objective.id) ?? [];
    const mean = scores.length === 0 ? 0 : scores.reduce((a, b) => a + b, 0) / scores.length;
    const status: ObjectivePlacementStatus =
      scores.length > 0 && mean >= PLACE_THRESHOLD ? 'placed' : 'unmet';
    return {
      objectiveId: objective.id,
      status,
      score: mean,
      itemCount: scores.length,
    };
  });

  const placed = new Set(
    objectiveResults
      .filter((result) => result.status === 'placed')
      .map((result) => result.objectiveId),
  );

  return ok({
    placedObjectiveIds: [...placed],
    unmetObjectiveIds: objectiveResults
      .filter((result) => result.status === 'unmet')
      .map((result) => result.objectiveId),
    objectiveResults,
    unlockedModuleIds: unlockedModules(syllabus, placed),
  });
};

/**
 * A module unlocks when every required objective on it — and every prerequisite of those
 * objectives — is placed. Optional unmet objectives do not block unlock.
 */
export const unlockedModules = (
  syllabus: Syllabus,
  placedObjectiveIds: ReadonlySet<string> | readonly string[],
): string[] => {
  const placed =
    placedObjectiveIds instanceof Set ? placedObjectiveIds : new Set(placedObjectiveIds);
  const byId = new Map(syllabus.objectives.map((objective) => [objective.id, objective]));

  const isSatisfied = (objective: SyllabusObjective): boolean => {
    if (objective.required && !placed.has(objective.id)) return false;
    return objective.prerequisiteObjectiveIds.every((prerequisiteId) => {
      const prerequisite = byId.get(prerequisiteId);
      if (!prerequisite) return false;
      return isSatisfied(prerequisite);
    });
  };

  return syllabus.modules
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((module) =>
      module.objectiveIds.every((objectiveId) => {
        const objective = byId.get(objectiveId);
        return objective ? isSatisfied(objective) : false;
      }),
    )
    .map((module) => module.id);
};

/**
 * Build deterministic multiple-choice placement items from a syllabus. Each required objective
 * gets one item whose options are the correct statement plus up to two distractors from sibling
 * objectives. Catalog fixtures may replace this with authored items.
 */
export const buildPlacementItems = (syllabus: Syllabus): PlacementItem[] => {
  const required = syllabus.objectives.filter((objective) => objective.required);
  const statements = required.map((objective) => objective.statement);

  return required.map((objective, index) => {
    const distractors = statements
      .filter((statement) => statement !== objective.statement)
      .slice(0, 2);
    const options = [objective.statement, ...distractors];
    // Rotate so the correct answer is not always first.
    const rotated = [
      ...options.slice(index % options.length),
      ...options.slice(0, index % options.length),
    ];
    const unique = [...new Set(rotated)];
    return {
      id: `place-${objective.id}`,
      objectiveId: objective.id,
      type: 'multiple_choice' as const,
      prompt: `Which capability are you ready to demonstrate?`,
      options: unique,
      answer: objective.statement,
    };
  });
};

/** Client-safe projection: strips answers. */
export const toPlacementKitView = (
  kitId: string,
  syllabus: Syllabus,
  items: readonly PlacementItem[],
): {
  kitId: string;
  syllabusId: string;
  syllabusVersion: number;
  title: string;
  items: readonly {
    id: string;
    objectiveId: string;
    type: PlacementItemType;
    prompt: string;
    options?: readonly string[];
  }[];
} => ({
  kitId,
  syllabusId: syllabus.id,
  syllabusVersion: syllabus.version,
  title: syllabus.title,
  items: items.map((item) => ({
    id: item.id,
    objectiveId: item.objectiveId,
    type: item.type,
    prompt: item.prompt,
    ...(item.options ? { options: item.options } : {}),
  })),
});
