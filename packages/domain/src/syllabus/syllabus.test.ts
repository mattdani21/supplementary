import { describe, expect, it } from 'vitest';
import { findSyllabusViolations, syllabusFromOutline, validateSyllabus } from './syllabus.js';
import type { Syllabus } from './syllabus.js';

const base = (): Syllabus => ({
  id: 'catalog:machine-learning',
  version: 1,
  title: 'Machine Learning',
  description: 'Core ML foundations',
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
  ],
  objectives: [
    {
      id: 'obj-vectors',
      statement: 'Represent data as feature vectors',
      required: true,
      prerequisiteObjectiveIds: [],
    },
    {
      id: 'obj-loss',
      statement: 'Explain a loss function for supervised learning',
      required: true,
      prerequisiteObjectiveIds: ['obj-vectors'],
    },
    {
      id: 'obj-regression',
      statement: 'Fit and evaluate a linear regression model',
      required: true,
      prerequisiteObjectiveIds: ['obj-loss'],
    },
  ],
});

describe('validateSyllabus', () => {
  it('accepts a well-formed syllabus', () => {
    const result = validateSyllabus(base());
    expect(result.ok).toBe(true);
  });

  it('refuses empty modules, unknown refs, and cycles', () => {
    const broken: Syllabus = {
      ...base(),
      modules: [{ id: 'empty', title: 'Empty', order: 1, objectiveIds: [] }],
      objectives: [
        {
          id: 'a',
          statement: 'A',
          required: true,
          prerequisiteObjectiveIds: ['b'],
        },
        {
          id: 'b',
          statement: 'B',
          required: true,
          prerequisiteObjectiveIds: ['a'],
        },
      ],
    };
    const violations = findSyllabusViolations(broken);
    expect(violations.map((v) => v.code)).toEqual(
      expect.arrayContaining(['empty_module', 'prerequisite_cycle']),
    );
    expect(validateSyllabus(broken).ok).toBe(false);
  });
});

describe('syllabusFromOutline', () => {
  it('builds a validated imported syllabus with cross-module prerequisites', () => {
    const result = syllabusFromOutline(
      {
        title: 'Intro Algorithms',
        description: 'University outline',
        modules: [
          { title: 'Sorting', outcomes: ['Implement mergesort', 'Analyse sorting complexity'] },
          { title: 'Graphs', outcomes: ['Traverse a graph with BFS'] },
        ],
      },
      { id: 'imported_outline_1' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe('imported');
    expect(result.value.modules).toHaveLength(2);
    expect(result.value.objectives).toHaveLength(3);
    const bfs = result.value.objectives.find((o) => o.statement.includes('BFS'));
    expect(bfs?.prerequisiteObjectiveIds.length).toBe(2);
  });

  it('refuses an outline with a blank outcome', () => {
    const result = syllabusFromOutline(
      {
        title: 'Bad',
        modules: [{ title: 'One', outcomes: ['  '] }],
      },
      { id: 'imported_bad' },
    );
    expect(result.ok).toBe(false);
  });
});
