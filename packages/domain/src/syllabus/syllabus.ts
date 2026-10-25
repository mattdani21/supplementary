/**
 * Syllabus value object.
 *
 * A versioned, ordered course structure shared by catalog libraries and learner-imported
 * outlines. Validation is pure: values in, typed errors out. Persistence and HTTP live outside
 * this package.
 */

import { err, ok, type Result } from '../errors.js';

export const SYLLABUS_SOURCES = ['catalog', 'imported'] as const;
export type SyllabusSource = (typeof SYLLABUS_SOURCES)[number];

export interface SyllabusObjective {
  readonly id: string;
  /** Measurable capability statement. */
  readonly statement: string;
  readonly required: boolean;
  readonly prerequisiteObjectiveIds: readonly string[];
}

export interface SyllabusModule {
  readonly id: string;
  readonly title: string;
  /** Ascending order within the syllabus. */
  readonly order: number;
  readonly objectiveIds: readonly string[];
}

export interface Syllabus {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly source: SyllabusSource;
  readonly modules: readonly SyllabusModule[];
  readonly objectives: readonly SyllabusObjective[];
}

/** Structured outline a learner pastes; validated into a Syllabus. */
export interface SyllabusOutlineInput {
  readonly title: string;
  readonly description?: string;
  readonly modules: readonly {
    readonly title: string;
    readonly outcomes: readonly string[];
  }[];
}

export type SyllabusViolationCode =
  | 'empty_title'
  | 'invalid_version'
  | 'no_modules'
  | 'no_objectives'
  | 'duplicate_module_id'
  | 'duplicate_objective_id'
  | 'empty_module'
  | 'unknown_objective_ref'
  | 'unknown_prerequisite'
  | 'prerequisite_cycle'
  | 'empty_statement'
  | 'empty_module_title'
  | 'empty_outline_module'
  | 'empty_outcome';

export interface SyllabusViolation {
  readonly code: SyllabusViolationCode;
  readonly message: string;
  readonly path?: string;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'module';

const findPrerequisiteCycle = (objectives: readonly SyllabusObjective[]): string | undefined => {
  const byId = new Map(objectives.map((objective) => [objective.id, objective]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string, stack: string[]): string | undefined => {
    if (visiting.has(id)) return [...stack, id].join(' → ');
    if (visited.has(id)) return undefined;
    visiting.add(id);
    const objective = byId.get(id);
    if (objective) {
      for (const prerequisite of objective.prerequisiteObjectiveIds) {
        const cycle = visit(prerequisite, [...stack, id]);
        if (cycle) return cycle;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return undefined;
  };

  for (const objective of objectives) {
    const cycle = visit(objective.id, []);
    if (cycle) return cycle;
  }
  return undefined;
};

/** Collect every structural violation without short-circuiting, so a repair can fix them together. */
export const findSyllabusViolations = (syllabus: Syllabus): SyllabusViolation[] => {
  const violations: SyllabusViolation[] = [];

  if (!syllabus.title.trim()) {
    violations.push({ code: 'empty_title', message: 'A syllabus needs a title.', path: 'title' });
  }
  if (!Number.isInteger(syllabus.version) || syllabus.version < 1) {
    violations.push({
      code: 'invalid_version',
      message: 'Syllabus version must be a positive integer.',
      path: 'version',
    });
  }
  if (syllabus.modules.length === 0) {
    violations.push({
      code: 'no_modules',
      message: 'A syllabus needs at least one module.',
      path: 'modules',
    });
  }
  if (syllabus.objectives.length === 0) {
    violations.push({
      code: 'no_objectives',
      message: 'A syllabus needs at least one objective.',
      path: 'objectives',
    });
  }

  const moduleIds = new Set<string>();
  for (const module of syllabus.modules) {
    if (moduleIds.has(module.id)) {
      violations.push({
        code: 'duplicate_module_id',
        message: `Module id "${module.id}" is duplicated.`,
        path: `modules.${module.id}`,
      });
    }
    moduleIds.add(module.id);
    if (!module.title.trim()) {
      violations.push({
        code: 'empty_module_title',
        message: `Module "${module.id}" needs a title.`,
        path: `modules.${module.id}.title`,
      });
    }
    if (module.objectiveIds.length === 0) {
      violations.push({
        code: 'empty_module',
        message: `Module "${module.id}" needs at least one objective.`,
        path: `modules.${module.id}`,
      });
    }
  }

  const objectiveIds = new Set<string>();
  for (const objective of syllabus.objectives) {
    if (objectiveIds.has(objective.id)) {
      violations.push({
        code: 'duplicate_objective_id',
        message: `Objective id "${objective.id}" is duplicated.`,
        path: `objectives.${objective.id}`,
      });
    }
    objectiveIds.add(objective.id);
    if (!objective.statement.trim()) {
      violations.push({
        code: 'empty_statement',
        message: `Objective "${objective.id}" needs a measurable statement.`,
        path: `objectives.${objective.id}.statement`,
      });
    }
  }

  for (const module of syllabus.modules) {
    for (const objectiveId of module.objectiveIds) {
      if (!objectiveIds.has(objectiveId)) {
        violations.push({
          code: 'unknown_objective_ref',
          message: `Module "${module.id}" references unknown objective "${objectiveId}".`,
          path: `modules.${module.id}`,
        });
      }
    }
  }

  for (const objective of syllabus.objectives) {
    for (const prerequisite of objective.prerequisiteObjectiveIds) {
      if (!objectiveIds.has(prerequisite)) {
        violations.push({
          code: 'unknown_prerequisite',
          message: `Objective "${objective.id}" depends on unknown prerequisite "${prerequisite}".`,
          path: `objectives.${objective.id}`,
        });
      }
    }
  }

  const cycle = findPrerequisiteCycle(syllabus.objectives);
  if (cycle) {
    violations.push({
      code: 'prerequisite_cycle',
      message: `Objective prerequisites form a cycle: ${cycle}.`,
      path: 'objectives',
    });
  }

  return violations;
};

export const validateSyllabus = (syllabus: Syllabus): Result<Syllabus> => {
  const violations = findSyllabusViolations(syllabus);
  if (violations.length > 0) {
    return err('syllabus_invalid', 'Syllabus failed validation.', { violations });
  }
  return ok(syllabus);
};

/**
 * Turn a learner-pasted outline into a Syllabus. Module order follows the input array;
 * outcomes become required objectives whose prerequisites are the previous module's outcomes.
 */
export const syllabusFromOutline = (
  input: SyllabusOutlineInput,
  options: { id: string; version?: number },
): Result<Syllabus> => {
  const violations: SyllabusViolation[] = [];
  if (!input.title.trim()) {
    violations.push({
      code: 'empty_title',
      message: 'An imported outline needs a title.',
      path: 'title',
    });
  }
  if (input.modules.length === 0) {
    violations.push({
      code: 'no_modules',
      message: 'An imported outline needs at least one module.',
      path: 'modules',
    });
  }
  for (const [index, module] of input.modules.entries()) {
    if (!module.title.trim()) {
      violations.push({
        code: 'empty_module_title',
        message: 'Every imported module needs a title.',
        path: `modules.${index}.title`,
      });
    }
    if (module.outcomes.length === 0) {
      violations.push({
        code: 'empty_outline_module',
        message: 'Every imported module needs at least one outcome.',
        path: `modules.${index}`,
      });
    }
    for (const [outcomeIndex, outcome] of module.outcomes.entries()) {
      if (!outcome.trim()) {
        violations.push({
          code: 'empty_outcome',
          message: 'Outcomes cannot be blank.',
          path: `modules.${index}.outcomes.${outcomeIndex}`,
        });
      }
    }
  }
  if (violations.length > 0) {
    return err('syllabus_invalid', 'Imported outline failed validation.', { violations });
  }

  const objectives: SyllabusObjective[] = [];
  const modules: SyllabusModule[] = [];
  let previousModuleObjectiveIds: string[] = [];

  input.modules.forEach((module, moduleIndex) => {
    const moduleId = `mod-${moduleIndex + 1}-${slugify(module.title)}`;
    const objectiveIds: string[] = [];
    module.outcomes.forEach((outcome, outcomeIndex) => {
      const objectiveId = `${moduleId}-obj-${outcomeIndex + 1}`;
      objectiveIds.push(objectiveId);
      objectives.push({
        id: objectiveId,
        statement: outcome.trim(),
        required: true,
        prerequisiteObjectiveIds: [...previousModuleObjectiveIds],
      });
    });
    modules.push({
      id: moduleId,
      title: module.title.trim(),
      order: moduleIndex + 1,
      objectiveIds,
    });
    previousModuleObjectiveIds = objectiveIds;
  });

  return validateSyllabus({
    id: options.id,
    version: options.version ?? 1,
    title: input.title.trim(),
    description: (input.description ?? input.title).trim(),
    source: 'imported',
    modules,
    objectives,
  });
};
