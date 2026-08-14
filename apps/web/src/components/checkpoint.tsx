'use client';

import { PracticeFeedback, type FeedbackLocator } from './practice-feedback';

/**
 * The checkpoint surface (E24 US1, FR-004, US1 AS3).
 *
 * When playback reaches a pause prompt the audio stops and this form requires a response before
 * the lesson continues. The response is graded like any practice answer: correct → confirm;
 * incorrect → the correction surface with the verified answer and source link
 * (`PracticeFeedback`, unchanged).
 *
 * Controlled component: the parent (the audio player) owns the response/result state, so the
 * pause behaviour and the grading can be asserted at the markup level and the pure helpers in
 * `lib/checkpoint` hold the position/grading logic.
 */
export function Checkpoint({
  prompt,
  expectedAnswer,
  answerLabel = 'Your answer',
  locators = [],
  sourcesTabHref,
  result,
  onAnswer,
  onComplete,
}: {
  readonly prompt: string;
  readonly expectedAnswer: string;
  readonly answerLabel?: string;
  readonly locators?: readonly FeedbackLocator[];
  readonly sourcesTabHref: string;
  /** The grading outcome once submitted; null while the question is open. */
  readonly result: { correct: boolean } | null;
  readonly onAnswer: (response: string) => void;
  readonly onComplete: () => void;
}) {
  if (result) {
    return (
      <div className="checkpoint" role="region" aria-label="Checkpoint">
        <p className="checkpoint__prompt">{prompt}</p>
        <PracticeFeedback
          correct={result.correct}
          answer={expectedAnswer}
          locators={result.correct ? [] : locators}
          sourcesTabHref={sourcesTabHref}
        />
        <button type="button" className="btn" onClick={onComplete}>
          {result.correct ? 'Continue' : 'Continue after reviewing'}
        </button>
      </div>
    );
  }

  return (
    <form
      className="checkpoint"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onAnswer(String(form.get('response') ?? ''));
      }}
    >
      <p className="checkpoint__prompt">{prompt}</p>
      <label>
        {answerLabel}
        <textarea name="response" rows={2} required aria-label={answerLabel} />
      </label>
      <button type="submit" className="btn btn--primary">
        Answer
      </button>
    </form>
  );
}
