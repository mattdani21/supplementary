/**
 * Traceability invariants (US2, E24).
 *
 * Sources are the spine: every objective, every published lesson and every published practice
 * question must declare a basis, source-grounded items must cite at least one locator, and every
 * cited locator must resolve to a real evidence chunk. `assertTraceability` (T006) is the pure
 * helper the invariant tests run against; T019 extends this file with the compiled-reference-pack
 * assertion (SC-003/SC-006).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { CurriculumPlan, LessonPackage } from '@gapos/ai-contracts';
import type { EvidenceItem } from '@gapos/ai-contracts';
import type { OwnerId } from '@gapos/database';
import { assertTraceability, fixtureById } from '@gapos/evaluation';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';

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

/**
 * T019 (US2, E24): the invariant against the *compiled* reference curriculum. This is the
 * machine-checkable form of FR-008/SC-003 — 100% of published objectives, lessons and questions
 * carry a locator or an explicit general-knowledge label, and every locator resolves to a real
 * evidence chunk of the gap the curriculum was compiled for.
 */
describe('the compiled reference curriculum is fully traceable (E24 US2, T019)', () => {
  let context: ServerContext;
  const LEARNER: OwnerId = 'user_traceability';
  let violations: readonly string[];
  let status: string;

  beforeAll(async () => {
    let counter = 0;
    context = createServerContext({
      newId: (prefix) => `${prefix}_${++counter}`,
      logLevel: 'error',
    });
    await context.uow.users.create({
      id: LEARNER,
      email: 'traceability@example.com',
      locale: 'en',
      timezone: 'UTC',
    });

    const fixture = fixtureById('eval_01_set_operations')!;
    const gap = await createGap(context, LEARNER, {
      title: fixture.title,
      rawStatement: fixture.learnerStatement,
      dailyMinutes: fixture.dailyMinutes,
    });
    if (fixture.source) {
      await registerSource(context, LEARNER, {
        gapId: gap.id,
        filename: fixture.source.filename,
        mediaType: fixture.source.mediaType,
        text: fixture.source.text,
      });
    }
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });
    const outcome = await compile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 't019_traceability',
    });
    status = outcome.status;

    const curriculum = await context.uow.curricula.get(LEARNER, outcome.curriculumId!);
    const lessons = await context.uow.curricula.listLessons(LEARNER, outcome.curriculumId!);
    const evidence: EvidenceItem[] = [];
    for (const source of await context.uow.sources.listForGap(LEARNER, gap.id)) {
      for (const chunk of await context.uow.sources.listChunks(LEARNER, source.id)) {
        evidence.push({
          sourceId: chunk.sourceId,
          chunkId: chunk.id,
          locator: chunk.locator,
          text: chunk.text,
        });
      }
    }

    violations = assertTraceability(
      curriculum!.plan,
      lessons.map((l) => l.package),
      evidence,
    );
  });

  it('compiles to a complete published course', () => {
    // The invariant is only meaningful on what would actually ship.
    expect(status).toBe('complete');
  });

  it('every objective, lesson and question carries a locator or a general-knowledge label, and every locator resolves', () => {
    expect(violations).toEqual([]);
  });
});
