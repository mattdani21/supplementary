/**
 * Traceability invariants (US2, E24).
 *
 * Sources are the spine: every objective, every published lesson and every published practice
 * question must declare a basis, source-grounded items must cite at least one locator, and every
 * cited locator must resolve to a real evidence chunk. `assertTraceability` (T006) is the pure
 * helper the invariant tests run against; T019 extends this file with the compiled-reference-pack
 * assertion (SC-003/SC-006).
 */

import { describe, expect, it } from 'vitest';
import type { CurriculumPlan, LessonPackage } from '@gapos/ai-contracts';
import type { EvidenceItem } from '@gapos/ai-contracts';
import { assertTraceability } from '@gapos/evaluation';

const locator = (sourceId: string, chunkId: string) => ({
  sourceId,
  chunkId,
  locator: 'p. 12',
});

const evidence: EvidenceItem[] = [
  { sourceId: 's1', chunkId: 'c1', locator: 'p. 1', text: 'A set is a collection of objects.' },
  { sourceId: 's1', chunkId: 'c2', locator: 'p. 2', text: 'A subset relation is reflexive.' },
];

const plan: CurriculumPlan = {
  schemaVersion: '1.0.0',
  gapId: 'g1',
  dailyMinutes: 35,
  objectives: [
    {
      id: 'o1',
      capabilityStatement: 'state the definition of a set',
      required: true,
      prerequisiteObjectiveIds: [],
      externalPrerequisites: [],
      evidence: { basis: 'source', locators: [locator('s1', 'c1')] },
    },
  ],
  days: [
    {
      day: 1,
      title: 'Day 1',
      objectiveIds: ['o1'],
      activities: [{ kind: 'audio_lesson', description: 'listen', estimatedMinutes: 10 }],
    },
  ],
  glossary: [],
  exclusions: [],
  assessmentBlueprint: [
    { objectiveId: 'o1', retrievalItems: 2, applicationItems: 1, targetDifficulty: 3 },
  ],
};

const question = {
  id: 'q1',
  objectiveId: 'o1',
  type: 'short_answer' as const,
  role: 'retrieval' as const,
  difficulty: 2,
  prompt: 'Define a set.',
  answer: 'A collection of objects.',
  rubric: 'Accept any phrasing requiring a collection of objects.',
  acceptableAlternatives: [],
  evidence: { basis: 'source' as const, locators: [locator('s1', 'c2')] },
};

const lesson: LessonPackage = {
  schemaVersion: '1.0.0',
  day: 1,
  title: 'Sets',
  objectiveIds: ['o1'],
  script: 'Imagine a basket of apples. That basket is a set.',
  transcript: 'Imagine a basket of apples. That basket is a set.',
  summary: 'A set is a collection of objects.',
  examples: ['The basket of apples is a set.'],
  pausePrompts: [{ atSecond: 30, prompt: 'Is the basket a set?', expectedAnswer: 'Yes.' }],
  questions: [question],
  estimatedMinutes: 5,
  evidence: { basis: 'source', locators: [locator('s1', 'c1')] },
};

const traceable = (): { plan: CurriculumPlan; lessons: LessonPackage[] } => ({
  plan,
  lessons: [lesson],
});

describe('assertTraceability', () => {
  it('accepts a curriculum where every item cites a locator that resolves', () => {
    const { plan: p, lessons } = traceable();
    expect(assertTraceability(p, lessons, evidence)).toEqual([]);
  });

  it('fails on a source-grounded item that lacks a locator', () => {
    const { plan: p, lessons } = traceable();
    const degraded: LessonPackage = {
      ...lessons[0]!,
      evidence: { basis: 'source', locators: [] },
    };
    const violations = assertTraceability(p, [degraded], evidence);
    expect(violations.some((v) => v.includes('no locator'))).toBe(true);
  });

  it('fails on an item citing a chunk that does not exist in the evidence', () => {
    const { plan: p, lessons } = traceable();
    const degraded: LessonPackage = {
      ...lessons[0]!,
      evidence: { basis: 'source', locators: [locator('s1', 'missing_chunk')] },
    };
    const violations = assertTraceability(p, [degraded], evidence);
    expect(violations.some((v) => v.includes('missing_chunk'))).toBe(true);
  });

  it('fails on an objective that cites a chunk from a source that is not supplied', () => {
    const { lessons } = traceable();
    const degraded: CurriculumPlan = {
      ...plan,
      objectives: [
        {
          ...plan.objectives[0]!,
          evidence: { basis: 'source', locators: [locator('other_source', 'c1')] },
        },
      ],
    };
    const violations = assertTraceability(degraded, lessons, evidence);
    expect(violations.some((v) => v.includes('other_source'))).toBe(true);
  });

  it('accepts an explicitly labelled general-knowledge item without locators', () => {
    const { plan: p, lessons } = traceable();
    const generalKnowledge: LessonPackage = {
      ...lessons[0]!,
      evidence: { basis: 'general_knowledge', locators: [] },
      questions: lessons[0]!.questions.map((q) => ({
        ...q,
        evidence: { basis: 'general_knowledge' as const, locators: [] },
      })),
    };
    expect(assertTraceability(p, [generalKnowledge], evidence)).toEqual([]);
  });
});
