/**
 * Grading.
 *
 * Deterministic wherever the question type permits it, because a deterministic grade is free,
 * instant, reproducible, and cannot hallucinate. A model-assisted rubric grade is requested only
 * when the response cannot be settled by comparison — and even then the domain decides *that* a
 * rubric grade is needed, it never performs one.
 */

export type GradableType = 'multiple_choice' | 'short_answer' | 'worked_problem';

export interface GradableQuestion {
  readonly id: string;
  readonly type: GradableType;
  readonly answer: string;
  readonly acceptableAlternatives: readonly string[];
  readonly options?: readonly string[];
  readonly rubric?: string;
}

export interface Response {
  readonly text: string;
  readonly hintsUsed: number;
}

export type Grade =
  | { method: 'deterministic'; correct: boolean; score: number }
  /**
   * The domain cannot settle this one. The caller obtains a rubric grade through the provider
   * adapter and records the result; `expected` and `rubric` are what it must send.
   */
  | { method: 'rubric_required'; rubric: string; expected: string };

/**
 * Normalisation for free-text comparison: case, surrounding whitespace, internal run-length,
 * terminal punctuation and curly quotes. Deliberately conservative — it must not turn a wrong
 * answer into a right one, so it never touches word order or content words.
 */
export const normaliseResponse = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,]+$/g, '');

export const grade = (question: GradableQuestion, response: Response): Grade => {
  const given = normaliseResponse(response.text);

  if (question.type === 'multiple_choice') {
    // An option match is exact by construction: the learner selected from a fixed list.
    return {
      method: 'deterministic',
      correct: given === normaliseResponse(question.answer),
      score: given === normaliseResponse(question.answer) ? 1 : 0,
    };
  }

  const accepted = [question.answer, ...question.acceptableAlternatives].map(normaliseResponse);
  if (accepted.includes(given)) {
    return { method: 'deterministic', correct: true, score: 1 };
  }

  if (question.type === 'short_answer' && !question.rubric) {
    // No rubric and no match: the contract guarantees a rubric exists for free response, so this
    // is only reachable for a malformed item. Fail closed rather than guessing in the learner's
    // favour.
    return { method: 'deterministic', correct: false, score: 0 };
  }

  return {
    method: 'rubric_required',
    rubric: question.rubric ?? '',
    expected: question.answer,
  };
};

/**
 * Hints reduce the credit an item earns but never make it wrong. An item completed with hints
 * cannot satisfy the "one unhinted item" clause of the mastery rule, which is enforced in
 * `mastery.ts` rather than by discounting the score to zero here.
 */
export const applyHintPenalty = (score: number, hintsUsed: number): number => {
  if (hintsUsed <= 0) return score;
  return Math.max(0, Number((score * Math.max(0.4, 1 - 0.3 * hintsUsed)).toFixed(4)));
};
