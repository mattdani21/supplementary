/**
 * Feedback moments + designed states (GAP-037, E23 quality spec §3–§4), asserted at the markup
 * level.
 *
 * Acceptance covered here:
 *  - correct-answer feedback: accent flash surface + verified-solution reveal;
 *  - incorrect-answer correction: verified solution + source link, framed as repair and never
 *    red-heavy;
 *  - confidence capture is a single-tap segmented control (low/medium/high), not three radios;
 *  - designed empty states: one-line explanation + concrete next action;
 *  - the study audio fallback renders a designed message pointing at the transcript, never a raw
 *    error string.
 *
 * Same pattern as tab-bar.test.tsx and screens.test.tsx: pure presentational components under
 * `renderToStaticMarkup` — no browser, no jsdom, deterministic by construction.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AudioFallback } from './audio-fallback';
import { ConfidenceControl } from './confidence-control';
import { EmptyState } from './empty-state';
import { PracticeFeedback } from './practice-feedback';

const ANSWER =
  'A relation R on A is an equivalence relation iff it is reflexive, symmetric and transitive.';

describe('correct-answer feedback (GAP-037)', () => {
  it('renders the accent-flash surface and the verified-solution reveal', () => {
    const html = renderToStaticMarkup(
      <PracticeFeedback correct answer={ANSWER} sourcesTabHref="/gaps/gap_1?tab=sources" />,
    );
    expect(html).toContain('attempt-feedback--correct');
    expect(html).toContain('✓ Correct');
    expect(html).toContain(`Verified solution: ${ANSWER}`);
  });

  it('never frames a correct answer as a repair or as red-heavy', () => {
    const html = renderToStaticMarkup(
      <PracticeFeedback correct answer={ANSWER} sourcesTabHref="/gaps/gap_1?tab=sources" />,
    );
    expect(html).not.toContain('attempt-feedback--repair');
    expect(html).not.toContain('attempt-feedback--danger');
  });
});

describe('incorrect-answer correction (GAP-037)', () => {
  it('renders the verified solution and a source link, framed as repair', () => {
    const html = renderToStaticMarkup(
      <PracticeFeedback
        correct={false}
        answer={ANSWER}
        locators={[
          { sourceId: 's1', chunkId: 'c1', locator: 'p. 12', sourceName: 'set-theory-primer.md' },
        ]}
        sourcesTabHref="/gaps/gap_1?tab=sources"
      />,
    );
    expect(html).toContain('attempt-feedback--repair');
    expect(html).toContain('Not quite');
    expect(html).toContain(ANSWER);
    expect(html).toContain('Source');
    expect(html).toContain('set-theory-primer.md');
    expect(html).toContain('p. 12');
    expect(html).toMatch(/<a [^>]*href="[^"]*\?tab=sources"/);
  });

  it('never uses the red-heavy danger treatment for a wrong answer', () => {
    const html = renderToStaticMarkup(
      <PracticeFeedback correct={false} answer={ANSWER} sourcesTabHref="/gaps/gap_1?tab=sources" />,
    );
    expect(html).not.toContain('attempt-feedback--danger');
    expect(html).not.toContain('attempt-feedback--error');
  });
});

describe('confidence capture (GAP-037)', () => {
  it('is a single segmented control with three one-tap options — not three radios', () => {
    const html = renderToStaticMarkup(<ConfidenceControl value="medium" />);
    expect(html).toContain('role="radiogroup"');
    // Segments, not a form: no radio inputs and no fieldset/legend wrappers.
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<fieldset');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    for (const label of ['low', 'medium', 'high']) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('marks exactly the selected segment aria-checked', () => {
    const html = renderToStaticMarkup(<ConfidenceControl value="high" />);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(2);
  });
});

describe('designed empty states (GAP-037)', () => {
  it('renders a one-line explanation and a concrete next action', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No tracks yet."
        body="Name the thing you want to be able to do — GapOS builds a course for it."
        action={
          <a href="/gaps#new-gap" className="btn btn--primary">
            Name your first gap
          </a>
        }
      />,
    );
    expect(html).toContain('class="empty-state"');
    expect(html).toContain('No tracks yet.');
    expect(html).toContain('Name the thing you want to be able to do');
    expect(html).toMatch(/href="[^"]*#new-gap"/);
  });
});

describe('study audio fallback (GAP-037)', () => {
  it('renders a designed message pointing at the transcript, never a raw error string', () => {
    const html = renderToStaticMarkup(<AudioFallback />);
    expect(html).toContain('Audio unavailable');
    expect(html.toLowerCase()).toContain('transcript');
    // The fallback takes no error string, so a raw error can never be echoed: no error wording,
    // no "Failed to fetch", no HTTP status codes.
    expect(html).not.toMatch(/Error|Failed|\([45]\d\d\)/i);
  });
});

describe('feedback motion + tone tokens (GAP-037)', () => {
  const css = readFileSync(join(process.cwd(), 'apps/web/src/app/globals.css'), 'utf8');

  it('the correct-answer flash is an accent animation within the 200ms motion token', () => {
    expect(css).toMatch(/@keyframes accent-flash/);
    expect(css).toMatch(/accent-flash\s+var\(--duration-base\)/); // 200ms — well within the spec's 200ms
    expect(css).toContain('--duration-base: 200ms');
  });

  it('the repair surface is warn/neutral, never the red-heavy danger tone', () => {
    expect(css).toMatch(/\.attempt-feedback--repair/);
    // The danger tone is reserved for the severity/error palette; a wrong answer must not wear it.
    expect(css).not.toMatch(/\.attempt-feedback--danger/);
  });
});
