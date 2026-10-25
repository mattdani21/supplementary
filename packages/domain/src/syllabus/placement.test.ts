import { describe, expect, it } from 'vitest';
import {
  buildPlacementItems,
  gradePlacement,
  toPlacementKitView,
  unlockedModules,
} from './placement.js';
import type { Syllabus } from './syllabus.js';

const syllabus = (): Syllabus => ({
  id: 'catalog:machine-learning',
  version: 1,
  title: 'Machine Learning',
  description: 'Core ML',
  source: 'catalog',
  modules: [
    { id: 'mod-a', title: 'A', order: 1, objectiveIds: ['obj-a'] },
    { id: 'mod-b', title: 'B', order: 2, objectiveIds: ['obj-b'] },
  ],
  objectives: [
    {
      id: 'obj-a',
      statement: 'Represent data as feature vectors',
      required: true,
      prerequisiteObjectiveIds: [],
    },
    {
      id: 'obj-b',
      statement: 'Fit a linear regression model',
      required: true,
      prerequisiteObjectiveIds: ['obj-a'],
    },
  ],
});

describe('gradePlacement', () => {
  it('marks correct answers placed and wrong answers unmet', () => {
    const items = buildPlacementItems(syllabus());
    const result = gradePlacement(syllabus(), items, [
      { itemId: items[0]!.id, response: items[0]!.answer },
      { itemId: items[1]!.id, response: 'totally wrong' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.placedObjectiveIds).toEqual(['obj-a']);
    expect(result.value.unmetObjectiveIds).toEqual(['obj-b']);
    expect(result.value.unlockedModuleIds).toEqual(['mod-a']);
  });

  it('does not unlock a later module when a prerequisite is unmet', () => {
    const s = syllabus();
    expect(unlockedModules(s, new Set(['obj-b']))).toEqual([]);
    expect(unlockedModules(s, new Set(['obj-a', 'obj-b']))).toEqual(['mod-a', 'mod-b']);
  });

  it('strips the answer key from the kit view', () => {
    const items = buildPlacementItems(syllabus());
    const view = toPlacementKitView('kit_1', syllabus(), items);
    expect(view.items.every((item) => !('answer' in item))).toBe(true);
    expect(Object.keys(view.items[0] ?? {})).not.toContain('answer');
  });
});
