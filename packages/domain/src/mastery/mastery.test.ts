import { describe, expect, it } from 'vitest';
import {
  MASTERY_THRESHOLD,
  assessCurriculum,
  assessObjective,
  satisfiesPrerequisite,
  retainedStrength,
  type Evidence,
  type ObjectiveNode,
} from './mastery.js';
import { applyHintPenalty, grade, normaliseResponse } from './grading.js';
import {
  buildTodayQueue,
  nextLadderInterval,
  scheduleAfterAttempt,
  scheduleAfterReview,
} from './review-schedule.js';

const objective = (over: Partial<ObjectiveNode> = {}): ObjectiveNode => ({
  id: 'obj_1',
  required: true,
  prerequisiteObjectiveIds: [],
  ...over,
});

const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  objectiveId: 'obj_1',
  sessionId: 'session_1',
  evidenceType: 'retrieval',
  score: 1,
  independent: true,
  difficulty: 2,
  recordedAt: new Date('2026-08-02T10:00:00Z'),
  ...over,
});

/** The evidence set that satisfies every clause, used as the baseline to break one at a time. */
const satisfyingEvidence = (): Evidence[] => [
  evidence({ sessionId: 'session_1', evidenceType: 'retrieval' }),
  evidence({ sessionId: 'session_1', evidenceType: 'retrieval' }),
  evidence({ sessionId: 'session_2', evidenceType: 'application' }),
];

describe('the mastery rule', () => {
  it('masters an objective when every clause is satisfied', () => {
    const result = assessObjective(objective(), satisfyingEvidence());
    expect(result.mastered).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('cannot be mastered by consumption alone: no evidence, no mastery', () => {
    const result = assessObjective(objective(), []);
    expect(result.mastered).toBe(false);
    expect(result.score).toBe(0);
    expect(result.missing.join(' ')).toContain('more practice items');
  });

  it('refuses when the score is below the threshold', () => {
    const weak = satisfyingEvidence().map((e) => ({ ...e, score: 0.7 }));
    const result = assessObjective(objective(), weak);
    expect(result.mastered).toBe(false);
    expect(result.clauses.meetsThreshold).toBe(false);
    expect(result.missing.join(' ')).toContain('70%');
  });

  it('refuses when all the evidence comes from a single session', () => {
    const oneSession = satisfyingEvidence().map((e) => ({ ...e, sessionId: 'session_1' }));
    const result = assessObjective(objective(), oneSession);
    expect(result.mastered).toBe(false);
    expect(result.clauses.hasEnoughSessions).toBe(false);
    expect(result.clauses.meetsThreshold).toBe(true);
  });

  it('refuses when every correct item was hinted', () => {
    const hinted = satisfyingEvidence().map((e) => ({ ...e, independent: false }));
    const result = assessObjective(objective(), hinted);
    expect(result.mastered).toBe(false);
    expect(result.clauses.hasUnhintedItem).toBe(false);
  });

  it('refuses when the learner has only ever done recall', () => {
    const recallOnly = satisfyingEvidence().map((e) => ({
      ...e,
      evidenceType: 'retrieval' as const,
    }));
    const result = assessObjective(objective(), recallOnly);
    expect(result.mastered).toBe(false);
    expect(result.clauses.hasApplicationItem).toBe(false);
    expect(result.missing.join(' ')).toContain('not only recall');
  });

  it('accepts a transfer or cumulative item as the application clause', () => {
    for (const type of ['transfer', 'cumulative'] as const) {
      const set = [
        evidence({ sessionId: 's1' }),
        evidence({ sessionId: 's1' }),
        evidence({ sessionId: 's2', evidenceType: type }),
      ];
      expect(assessObjective(objective(), set).mastered, type).toBe(true);
    }
  });

  it('does not count a failed application item as satisfying the application clause', () => {
    const set = [
      evidence({ sessionId: 's1' }),
      evidence({ sessionId: 's1' }),
      evidence({ sessionId: 's2', evidenceType: 'application', score: 0.3 }),
    ];
    const result = assessObjective(objective(), set);
    expect(result.clauses.hasApplicationItem).toBe(false);
  });

  it('blocks on an unmastered prerequisite', () => {
    const result = assessObjective(
      objective({ prerequisiteObjectiveIds: ['obj_prereq'] }),
      satisfyingEvidence(),
      new Map([['obj_prereq', false]]),
    );
    expect(result.mastered).toBe(false);
    expect(result.missing.join(' ')).toContain('obj_prereq');
  });

  it('ignores evidence belonging to a different objective', () => {
    const foreign = satisfyingEvidence().map((e) => ({ ...e, objectiveId: 'obj_other' }));
    expect(assessObjective(objective(), foreign).itemCount).toBe(0);
  });
});

describe('curriculum mastery', () => {
  const objectives: ObjectiveNode[] = [
    { id: 'a', required: true, prerequisiteObjectiveIds: [] },
    { id: 'b', required: true, prerequisiteObjectiveIds: ['a'] },
    { id: 'c', required: false, prerequisiteObjectiveIds: [] },
  ];

  const evidenceFor = (id: string): Evidence[] =>
    satisfyingEvidence().map((e) => ({ ...e, objectiveId: id }));

  it('is ready to fill when every required objective is mastered', () => {
    const result = assessCurriculum(objectives, [...evidenceFor('a'), ...evidenceFor('b')]);
    expect(result.readyToFill).toBe(true);
    expect([...result.masteredObjectiveIds].sort()).toEqual(['a', 'b']);
  });

  it('does not let an optional objective block completion', () => {
    const result = assessCurriculum(objectives, [...evidenceFor('a'), ...evidenceFor('b')]);
    expect(result.requiredObjectiveIds).toEqual(['a', 'b']);
    expect(result.assessments.find((a) => a.objectiveId === 'c')?.mastered).toBe(false);
    expect(result.readyToFill).toBe(true);
  });

  it('resolves prerequisites in order, so b cannot pass while a fails', () => {
    const result = assessCurriculum(objectives, evidenceFor('b'));
    expect(result.assessments.find((a) => a.objectiveId === 'b')?.mastered).toBe(false);
    expect(result.readyToFill).toBe(false);
  });

  it('is never ready to fill with no required objectives at all', () => {
    const optionalOnly: ObjectiveNode[] = [
      { id: 'x', required: false, prerequisiteObjectiveIds: [] },
    ];
    expect(assessCurriculum(optionalOnly, evidenceFor('x')).readyToFill).toBe(false);
  });

  it('blocks rather than hangs on a prerequisite cycle', () => {
    const cyclic: ObjectiveNode[] = [
      { id: 'p', required: true, prerequisiteObjectiveIds: ['q'] },
      { id: 'q', required: true, prerequisiteObjectiveIds: ['p'] },
    ];
    const result = assessCurriculum(cyclic, [...evidenceFor('p'), ...evidenceFor('q')]);
    expect(result.readyToFill).toBe(false);
    expect(result.assessments).toHaveLength(2);
  });
});

describe('decay and prerequisite reuse', () => {
  const mastered = new Date('2026-01-01T00:00:00Z');

  it('lets recent mastery satisfy a prerequisite without reteaching', () => {
    expect(satisfiesPrerequisite(mastered, new Date('2026-02-01T00:00:00Z'))).toBe(true);
  });

  it('stops satisfying the prerequisite once the evidence has decayed', () => {
    expect(satisfiesPrerequisite(mastered, new Date('2026-06-01T00:00:00Z'))).toBe(false);
  });

  it('extends retention when the objective was reinforced by later reviews', () => {
    const later = new Date('2026-05-01T00:00:00Z');
    expect(retainedStrength(mastered, later, 0)).toBeLessThan(retainedStrength(mastered, later, 2));
    expect(satisfiesPrerequisite(mastered, later, 2)).toBe(true);
  });

  it('is full strength at the moment of mastery', () => {
    expect(retainedStrength(mastered, mastered)).toBe(1);
  });
});

describe('grading', () => {
  const mcq = {
    id: 'q1',
    type: 'multiple_choice' as const,
    answer: 'every element of A is an element of B',
    acceptableAlternatives: [],
    options: ['every element of A is an element of B', 'A and B have the same elements'],
  };

  const shortAnswer = {
    id: 'q2',
    type: 'short_answer' as const,
    answer: 'Only that it belongs to the left-hand set.',
    acceptableAlternatives: ['Nothing except that it is a member of the left set.'],
    rubric: 'Accept any answer stating that no property beyond membership may be assumed.',
  };

  it('grades multiple choice deterministically', () => {
    expect(grade(mcq, { text: mcq.answer, hintsUsed: 0 })).toEqual({
      method: 'deterministic',
      correct: true,
      score: 1,
    });
    expect(grade(mcq, { text: 'A and B have the same elements', hintsUsed: 0 })).toMatchObject({
      correct: false,
    });
  });

  it('accepts a listed alternative phrasing without asking a model', () => {
    const result = grade(shortAnswer, {
      text: '  nothing except that it is a member of the left set  ',
      hintsUsed: 0,
    });
    expect(result).toEqual({ method: 'deterministic', correct: true, score: 1 });
  });

  it('escalates to a rubric grade only when comparison cannot settle it', () => {
    const result = grade(shortAnswer, {
      text: 'that it is in the first set and nothing else about it',
      hintsUsed: 0,
    });
    expect(result.method).toBe('rubric_required');
    if (result.method === 'rubric_required') expect(result.rubric).toBe(shortAnswer.rubric);
  });

  it('normalises only formatting, never content', () => {
    expect(normaliseResponse('  It   is  REFLEXIVE. ')).toBe('it is reflexive');
    expect(normaliseResponse('reflexive symmetric')).not.toBe(
      normaliseResponse('symmetric reflexive'),
    );
  });

  it('reduces credit for hints without making a correct answer wrong', () => {
    expect(applyHintPenalty(1, 0)).toBe(1);
    expect(applyHintPenalty(1, 1)).toBe(0.7);
    expect(applyHintPenalty(1, 5)).toBe(0.4);
    expect(applyHintPenalty(1, 5)).toBeGreaterThan(0);
  });
});

describe('review scheduling', () => {
  const at = new Date('2026-08-02T10:00:00Z');

  it('schedules a same-session correction and a next-day check after a wrong answer', () => {
    const scheduled = scheduleAfterAttempt({
      objectiveId: 'obj_1',
      questionId: 'q1',
      correct: false,
      at,
    });
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]).toMatchObject({ intervalDays: 0, reason: 'remediation', dueAt: at });
    expect(scheduled[1]).toMatchObject({ intervalDays: 1, reason: 'remediation' });
  });

  it('brings the review forward when a correct answer was unconfident', () => {
    const [scheduled] = scheduleAfterAttempt({
      objectiveId: 'obj_1',
      questionId: 'q1',
      correct: true,
      confidence: 'low',
      at,
    });
    expect(scheduled?.reason).toBe('confidence_drop');
  });

  it('walks the ladder 0 → 1 → 3 → 7 and then graduates', () => {
    expect(nextLadderInterval(0)).toBe(1);
    expect(nextLadderInterval(1)).toBe(3);
    expect(nextLadderInterval(3)).toBe(7);
    expect(nextLadderInterval(7)).toBeUndefined();
  });

  it('drops back to the bottom when a review is failed', () => {
    const next = scheduleAfterReview({ objectiveId: 'obj_1', intervalDays: 7 }, false, at);
    expect(next).toMatchObject({ intervalDays: 1, reason: 'remediation' });
  });

  it('advances a rung when a review is passed', () => {
    const next = scheduleAfterReview({ objectiveId: 'obj_1', intervalDays: 3 }, true, at);
    expect(next?.intervalDays).toBe(7);
    expect(next?.dueAt).toEqual(new Date('2026-08-09T10:00:00Z'));
  });

  it('puts due reviews ahead of new material in the Today queue', () => {
    const queue = buildTodayQueue({
      now: at,
      dueReviews: [
        { id: 'r2', objectiveId: 'obj_2', dueAt: new Date('2026-08-02T09:00:00Z') },
        { id: 'r1', objectiveId: 'obj_1', dueAt: new Date('2026-08-01T09:00:00Z') },
        { id: 'r3', objectiveId: 'obj_3', dueAt: new Date('2026-08-05T09:00:00Z') },
      ],
      nextLessonDay: { day: 2, lessonId: 'lesson_2' },
    });
    // Oldest first, and the not-yet-due review is excluded.
    expect(queue.reviews.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(queue.lesson?.day).toBe(2);
    expect(queue.totalItems).toBe(3);
  });
});

describe('threshold constants', () => {
  it('keeps the documented 80% threshold', () => {
    expect(MASTERY_THRESHOLD).toBe(0.8);
  });
});
