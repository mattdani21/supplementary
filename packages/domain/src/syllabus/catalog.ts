/**
 * Built-in catalog libraries. Authored placement items ship with the syllabus so the first
 * placement kit does not depend on a live model.
 */

import { validateSyllabus, type Syllabus } from './syllabus.js';
import type { PlacementItem } from './placement.js';

export const MACHINE_LEARNING_SYLLABUS_ID = 'catalog:machine-learning';

export const machineLearningSyllabus = (): Syllabus => {
  const syllabus: Syllabus = {
    id: MACHINE_LEARNING_SYLLABUS_ID,
    version: 1,
    title: 'Machine Learning',
    description:
      'A short foundation track: feature vectors, loss, linear models, and evaluation before you place into later modules.',
    source: 'catalog',
    modules: [
      {
        id: 'mod-foundations',
        title: 'Foundations',
        order: 1,
        objectiveIds: ['obj-vectors', 'obj-loss'],
      },
      {
        id: 'mod-models',
        title: 'Models',
        order: 2,
        objectiveIds: ['obj-regression'],
      },
      {
        id: 'mod-evaluation',
        title: 'Evaluation',
        order: 3,
        objectiveIds: ['obj-metrics'],
      },
    ],
    objectives: [
      {
        id: 'obj-vectors',
        statement: 'Represent tabular data as feature vectors',
        required: true,
        prerequisiteObjectiveIds: [],
      },
      {
        id: 'obj-loss',
        statement: 'Explain a supervised loss function and what minimising it means',
        required: true,
        prerequisiteObjectiveIds: ['obj-vectors'],
      },
      {
        id: 'obj-regression',
        statement: 'Fit and interpret a linear regression model',
        required: true,
        prerequisiteObjectiveIds: ['obj-loss'],
      },
      {
        id: 'obj-metrics',
        statement: 'Choose and report a metric that matches the prediction goal',
        required: true,
        prerequisiteObjectiveIds: ['obj-regression'],
      },
    ],
  };
  const result = validateSyllabus(syllabus);
  if (!result.ok) throw result.error;
  return result.value;
};

export const machineLearningPlacementItems = (): PlacementItem[] => {
  const syllabus = machineLearningSyllabus();
  return syllabus.objectives.map((objective) => {
    const authored: Record<string, Omit<PlacementItem, 'id' | 'objectiveId'>> = {
      'obj-vectors': {
        type: 'multiple_choice',
        prompt: 'A row of measurements becomes a model input as…',
        options: ['a feature vector', 'a loss schedule', 'a random seed', 'a confusion matrix'],
        answer: 'a feature vector',
      },
      'obj-loss': {
        type: 'multiple_choice',
        prompt: 'Minimising a supervised loss means…',
        options: [
          'reducing the measured gap between predictions and labels',
          'increasing the number of optional modules',
          'shuffling the catalog order',
          'deleting unmet prerequisites',
        ],
        answer: 'reducing the measured gap between predictions and labels',
      },
      'obj-regression': {
        type: 'multiple_choice',
        prompt: 'Linear regression primarily learns…',
        options: [
          'weights that map features to a continuous target',
          'a clustering of unlabeled documents',
          'a syllabus module order',
          'an audio waveform',
        ],
        answer: 'weights that map features to a continuous target',
      },
      'obj-metrics': {
        type: 'multiple_choice',
        prompt: 'You should pick an evaluation metric that…',
        options: [
          'matches the prediction goal and decision cost',
          'always maximises model size',
          'ignores the validation set',
          'equals the number of modules',
        ],
        answer: 'matches the prediction goal and decision cost',
      },
    };
    const item = authored[objective.id];
    if (!item) throw new Error(`Missing authored placement item for ${objective.id}`);
    return { id: `ml-place-${objective.id}`, objectiveId: objective.id, ...item };
  });
};

export const catalogSyllabi = (): Syllabus[] => [machineLearningSyllabus()];

export const catalogPlacementItems = (syllabusId: string): PlacementItem[] | undefined => {
  if (syllabusId === MACHINE_LEARNING_SYLLABUS_ID) return machineLearningPlacementItems();
  return undefined;
};

export const resolveCatalogSyllabus = (syllabusId: string): Syllabus | undefined =>
  catalogSyllabi().find((syllabus) => syllabus.id === syllabusId);
