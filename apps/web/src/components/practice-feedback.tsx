import Link from 'next/link';

/**
 * Practice answer feedback (GAP-037, E23 quality spec §3).
 *
 * - Correct: an accent-flash surface with the verified-solution reveal — fast positive feedback
 *   (the flash animation is 200ms, the `--duration-base` motion token).
 * - Incorrect: a correction surface that shows the verified solution and the source link,
 *   framed as repair (warn/neutral tones) — never the red-heavy alarm treatment.
 */

export interface FeedbackLocator {
  readonly sourceId: string;
  readonly chunkId: string;
  /** Human-meaningful position: "p. 12", "§2.3", "00:14:02". */
  readonly locator: string;
  /** Source filename when the page can resolve it, so the link names the material. */
  readonly sourceName?: string;
}

export function PracticeFeedback({
  correct,
  answer,
  locators = [],
  sourcesTabHref,
}: {
  readonly correct: boolean;
  readonly answer: string;
  readonly locators?: readonly FeedbackLocator[];
  /** Where the learner goes to see the source material behind the solution. */
  readonly sourcesTabHref: string;
}) {
  if (correct) {
    return (
      <div className="attempt-feedback attempt-feedback--correct" role="status" aria-live="polite">
        <p className="attempt-feedback__verdict">✓ Correct</p>
        <p className="attempt-feedback__answer">Verified solution: {answer}</p>
      </div>
    );
  }

  const sourceLabel = locators
    .map((locator) =>
      locator.sourceName ? `${locator.sourceName} · ${locator.locator}` : locator.locator,
    )
    .join(', ');

  return (
    <div className="attempt-feedback attempt-feedback--repair" role="status" aria-live="polite">
      <p className="attempt-feedback__verdict">Not quite — here&apos;s the verified solution.</p>
      <p className="attempt-feedback__answer">{answer}</p>
      {sourceLabel && (
        <p className="attempt-feedback__source">
          Source:{' '}
          <Link href={sourcesTabHref} className="attempt-feedback__source-link">
            {sourceLabel}
          </Link>
        </p>
      )}
    </div>
  );
}
