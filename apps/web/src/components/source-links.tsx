import Link from 'next/link';

/**
 * The source-link affordance (E24 US2, C-07, FR-011, SC-006).
 *
 * Traceability is user-visible: next to every published lesson and every practice question the
 * learner sees the locator(s) behind it, and reaches the supporting source in one step — a real
 * link to the Sources tab's chunk anchor (`/gaps/{gapId}?tab=sources#chunk-{chunkId}`). An item
 * explicitly labelled general knowledge renders the label instead of a link (FR-008's labelling
 * is user-visible too).
 *
 * Accessibility: real `<a>` elements with visible focus (the shared `a:focus-visible` rule) and
 * an accessible name that tells the learner what the link opens.
 */

export interface SourceLinkLocator {
  readonly sourceId: string;
  readonly chunkId: string;
  /** Human-meaningful position: "p. 12", "§2.3", "00:14:02". */
  readonly locator: string;
  /** Source filename when the page can resolve it, so the link names the material. */
  readonly sourceName?: string;
}

export function SourceLinks({
  gapId,
  basis = 'source',
  locators,
  label = 'Source',
}: {
  readonly gapId: string;
  readonly basis?: 'source' | 'general_knowledge';
  readonly locators: readonly SourceLinkLocator[];
  /** Fallback label when a locator's source filename is not resolvable. */
  readonly label?: string;
}) {
  if (basis === 'general_knowledge') {
    return (
      <p className="source-link source-link--general">
        <strong>General knowledge</strong> — not drawn from the supplied sources.
      </p>
    );
  }
  if (locators.length === 0) return null;

  return (
    <ul className="source-links" aria-label="Supporting sources">
      {locators.map((locator) => (
        <li key={`${locator.sourceId}:${locator.chunkId}`} className="source-links__item">
          <Link
            href={`/gaps/${gapId}?tab=sources#chunk-${locator.chunkId}`}
            className="source-link"
            aria-label={`Open source ${locator.locator} in the Sources tab`}
          >
            {locator.sourceName ?? label} · {locator.locator}
          </Link>
        </li>
      ))}
    </ul>
  );
}
