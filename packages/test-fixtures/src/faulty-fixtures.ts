/**
 * Deliberately faulty provider output.
 *
 * The verifier and repair loop are only worth anything if they are exercised against content
 * that is actually wrong. These fixtures produce the specific failure modes the pipeline claims
 * to catch, so "a faulty provider fixture is rejected and repaired" is a test rather than a hope.
 */

import type { LessonPackage, RepairResult, VerificationReport } from '@gapos/ai-contracts';
import { referenceLesson } from './reference-curriculum.js';

/** The answer is visible inside the prompt, so the item measures reading, not knowledge. */
export const lessonWithAnswerLeakage = (day = 1): LessonPackage => {
  const lesson = referenceLesson(day);
  const [first, ...rest] = lesson.questions;
  if (!first) throw new Error('fixture lesson has no questions');
  return {
    ...lesson,
    questions: [
      {
        ...first,
        prompt: `${first.prompt} (Hint: the answer is "${first.answer}".)`,
      },
      ...rest,
    ],
  };
};

/** A distractor that is also correct, so the item has two right answers. */
export const lessonWithInvalidDistractor = (): LessonPackage => {
  const lesson = referenceLesson(1);
  const [first, ...rest] = lesson.questions;
  if (!first || first.type !== 'multiple_choice' || !first.options) {
    throw new Error('fixture question 1 is expected to be multiple choice');
  }
  return {
    ...lesson,
    questions: [
      {
        ...first,
        options: [...first.options.slice(0, 3), 'each element of A also belongs to B'],
      },
      ...rest,
    ],
  };
};

/** A worked problem whose published answer is mathematically wrong. */
export const lessonWithWrongAnswer = (): LessonPackage => {
  const lesson = referenceLesson(3);
  return {
    ...lesson,
    questions: lesson.questions.map((q) =>
      q.id === 'q_d3_r1' ? { ...q, answer: 'reflexive, symmetric and transitive' } : q,
    ),
  };
};

/** Uses a term the plan's glossary does not define, drifting from the other days. */
export const lessonWithGlossaryDrift = (): LessonPackage => {
  const lesson = referenceLesson(2);
  return {
    ...lesson,
    script: lesson.script.replace('double inclusion', 'bidirectional containment'),
  };
};

/** Malformed output: a multiple-choice answer that is not among its own options. */
export const structurallyInvalidLesson = (): unknown => {
  const lesson = referenceLesson(1);
  return {
    ...lesson,
    questions: lesson.questions.map((q) =>
      q.type === 'multiple_choice' ? { ...q, answer: 'a completely different string' } : q,
    ),
  };
};

export const verificationWithFindings = (
  artefactId: string,
  overrides: Partial<VerificationReport> = {},
): VerificationReport => ({
  schemaVersion: '1.0.0',
  artefactId,
  independentSolutions: [
    {
      questionId: 'q_d1_r1',
      answer: 'every element of A is an element of B',
      agrees: false,
      reasoningSummary:
        'Solved independently. Two options state the subset condition, so the published key is ' +
        'not uniquely correct.',
    },
  ],
  findings: [
    {
      category: 'distractor_validity',
      severity: 'critical',
      targetId: 'q_d1_r1',
      finding: 'Option 4 restates the correct answer, so the item has two correct options.',
      suggestedRepair: 'Replace option 4 with a genuinely incorrect condition.',
    },
  ],
  ...overrides,
});

export const repairForDistractor = (targetId = 'q_d1_r1'): RepairResult => {
  const lesson = referenceLesson(1);
  const question = lesson.questions.find((q) => q.id === targetId);
  if (!question) throw new Error(`no fixture question ${targetId}`);
  return {
    schemaVersion: '1.0.0',
    targetId,
    repairedQuestions: [question],
    addressedFindings: [
      'Option 4 restates the correct answer, so the item has two correct options.',
    ],
  };
};

/** A repair that does not actually fix anything, used to exercise the attempt ceiling. */
export const ineffectiveRepair = (targetId = 'q_d1_r1'): RepairResult => ({
  schemaVersion: '1.0.0',
  targetId,
  repairedQuestions: lessonWithInvalidDistractor().questions.filter((q) => q.id === targetId),
  addressedFindings: ['Attempted to rewrite the distractor.'],
});
