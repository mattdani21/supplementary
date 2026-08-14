/**
 * E22 detail-screen restyle (GAP-035): smoke render of the gaps list and the gap detail
 * workspace inside the app shell, plus automated checks for the acceptance criteria.
 *
 * Acceptance covered here:
 *  - a smoke render test covers gaps list and gap detail with the shell;
 *  - every listed screen uses design tokens — no leftover slate-900 / #0f172a family hardcodes;
 *  - keyboard focus is visible on all interactive elements (focus-visible rules for every
 *    interactive pattern the detail screens introduce).
 *
 * The pages are async App Router server components, so they are rendered with the real
 * `react-dom/server` against the in-memory server context (the same code path `pnpm verify`
 * already exercises in-process for the API). Only the request-coupled modules are stubbed:
 * `next/headers` (cookies) and `next/navigation` (router hooks). The full `RootLayout` is
 * rendered so the assertions cover "with the shell": app-frame, tab bar, aria-current.
 *
 * The test lives under apps/web (not tests/end-to-end) because pnpm isolates react-dom to
 * apps/web; the GAP-034 tab-bar render test set the same precedent.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type * as ServerContextModule from '../server/context';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/gaps',
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
/**
 * Pages and the layout bootstrap the server context from env — and this sandbox sets
 * GAPOS_DATABASE_URL, which would make the test read and write a real Postgres database and
 * leak state between runs. Mock the bootstrap to one fresh in-memory context per test file:
 * hermetic, deterministic, and exactly the code path the API journey suite already exercises.
 */
vi.mock('../server/bootstrap', async () => {
  const { createServerContext } =
    await vi.importActual<typeof ServerContextModule>('../server/context');
  const context = createServerContext({ logLevel: 'error' });
  return {
    getServerContext: async () => context,
    closeServerContext: async () => undefined,
  };
});

import RootLayout from '../app/layout';
import GapsPage from '../app/gaps/page';
import GapDetailPage from '../app/gaps/[gapId]/page';
import StudyPage from '../app/gaps/[gapId]/study/page';
import { getServerContext } from '../server/bootstrap';
import {
  compile,
  createGap,
  createUser,
  registerSourceHandler,
  transitionGap,
} from '../server/api';

const OWNER = 'local-learner';
const GAP_TITLE = 'Relations and proof techniques';

/** Render a page inside the real shell layout, exactly as the router would. */
const renderWithShell = async (page: ReactNode): Promise<string> =>
  renderToStaticMarkup(await RootLayout({ children: page }));

/** Extract anchors (href + aria-current) from rendered markup. */
const anchors = (html: string): { href: string; active: boolean }[] =>
  [...html.matchAll(/<a\b([^>]*)>/g)].map((match) => {
    const attrs = match[1] ?? '';
    return {
      href: /href="([^"]+)"/.exec(attrs)?.[1] ?? '',
      active: /aria-current="page"/.test(attrs),
    };
  });

describe('the styled empty state (GAP-035)', () => {
  it('renders the empty-state block with a primary CTA before any gap exists', async () => {
    // Declared first so it runs before the seeded describes populate the shared context.
    const html = await renderWithShell(await GapsPage());

    expect(html).toContain('class="empty-state"');
    expect(html).toMatch(/class="btn btn--primary"/);
  });
});

describe('the gaps list with the shell (GAP-035)', () => {
  let gapId: string;

  beforeAll(async () => {
    // Seed the shared in-memory server context exactly like the API journey test does, so the
    // pages render against real data: one compiled gap with a source and a generation run.
    const context = await getServerContext();
    await createUser(context, OWNER, {
      email: `${OWNER}@example.com`,
      locale: 'en',
      timezone: 'UTC',
    });
    const created = (await createGap(context, OWNER, {
      title: GAP_TITLE,
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    })) as { gap: { id: string } };
    gapId = created.gap.id;
    await transitionGap(context, OWNER, gapId, { type: 'define' });
    await registerSourceHandler(context, OWNER, {
      gapId,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    const outcome = (await compile(context, OWNER, gapId, {
      idempotencyKey: 'screens-compile-1',
    })) as { run: { status: string } };
    expect(outcome.run.status).toBe('complete');
  });

  it('renders the shell around the gaps list: app-frame, tab bar, one aria-current', async () => {
    const html = await renderWithShell(await GapsPage());

    expect(html).toContain('class="app-frame"');
    expect(html).toContain('<nav class="tab-bar"');
    expect(html).toContain('aria-label="Primary"');

    const links = anchors(html);
    const tabHrefs = links.map((link) => link.href);
    expect(tabHrefs).toEqual(
      expect.arrayContaining(['/', '/gaps', `/gaps/${gapId}`, `/gaps/${gapId}/map`]),
    );
    expect(links.filter((link) => link.active)).toHaveLength(1);
  });

  it('lists the seeded gap as a card row with status pill and minutes per day', async () => {
    const html = await renderWithShell(await GapsPage());

    expect(html).toContain(GAP_TITLE);
    expect(html).toMatch(/class="track-row/);
    expect(html).toMatch(/class="pill/);
    expect(html).toContain('min/day');
  });

  it('keeps the inline creation surfaces styled on the page', async () => {
    const html = await renderWithShell(await GapsPage());

    expect(html).toContain('New gap');
    expect(html).toContain('Speak a gap');
    expect(html).toContain('Review queue');
  });
});

/** The compiled gap the GAP-037 progress-surface describe reuses. */
let compiledGapId = '';

describe('the gap detail workspace with the shell (GAP-035)', () => {
  let gapId: string;

  beforeAll(async () => {
    const context = await getServerContext();
    const created = (await createGap(context, OWNER, {
      title: `${GAP_TITLE} II`,
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    })) as { gap: { id: string } };
    gapId = created.gap.id;
    compiledGapId = gapId;
    await transitionGap(context, OWNER, gapId, { type: 'define' });
    await registerSourceHandler(context, OWNER, {
      gapId,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    await compile(context, OWNER, gapId, { idempotencyKey: 'screens-compile-2' });
  });

  it('renders the workspace tabs as a segmented control with the shell', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('class="app-frame"');
    expect(html).toContain('<nav class="tab-bar"');

    // The workspace segmented control carries the six destinations.
    expect(html).toContain('class="segmented"');
    for (const label of ['Overview', 'Sources', 'Curriculum', 'Learn', 'Practice', 'Mastery']) {
      expect(html).toContain(`>${label}<`);
    }
    // Exactly one tab is active, and it is the one the URL selects.
    const activeTabs = [
      ...html.matchAll(/class="segmented__item[^"]*segmented__item--active[^"]*"[^>]*>/g),
    ];
    expect(activeTabs).toHaveLength(1);
    expect(html).toMatch(/segmented__item--active[^>]*aria-current="page"/);
  });

  it('renders the overview: statement, status pill, today lesson and a readable generation log', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain(GAP_TITLE);
    expect(html).toContain(REFERENCE_GAP_STATEMENT);
    expect(html).toMatch(/class="pill/);
    expect(html).toContain('Today');
    expect(html).toContain('Compile progress');
    expect(html).toContain('class="log-line"');
    expect(html).toContain('complete'); // the run status pill
  });

  it('renders the sources tab with locator chips', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId }),
        searchParams: Promise.resolve({ tab: 'sources' }),
      }),
    );

    expect(html).toContain('set-theory-primer.md');
    expect(html).toMatch(/class="chip/); // locator chips
    expect(html).toContain('chunks');
    expect(html).toContain('Add a source');
  });
});

describe('the generation progress surface (GAP-037)', () => {
  it('renders a phase label, per-step status chips and a collapsible debug toggle', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({}),
      }),
    );

    // The designed surface: a phase label for the run, not the raw step list.
    expect(html).toMatch(/class="progress-phase"/);
    expect(html).toContain('Complete'); // phase label for a finished run

    // Per-step status chips carry the four pipeline states.
    expect(html).toContain('class="progress-steps"');
    expect(html).toContain('progress-chip--succeeded');
    expect(html).toContain('>succeeded<');

    // The raw generation log lives behind a debug toggle, closed by default.
    expect(html).toMatch(/<details class="progress-debug"[^>]*>/); // no `open` attribute
    expect(html).toContain('<summary>Debug log</summary>');
    const detailsStart = html.indexOf('class="progress-debug"');
    const rawLogIndex = html.indexOf('class="log"');
    expect(rawLogIndex).toBeGreaterThan(detailsStart); // raw log is inside the toggle
  });

  it('keeps the raw log lines inside the debug view only', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({}),
      }),
    );
    // Every raw log line lives within the debug <details> element.
    const detailsStart = html.indexOf('<details class="progress-debug"');
    const detailsEnd = html.indexOf('</details>', detailsStart);
    expect(detailsStart).toBeGreaterThan(-1);
    expect(detailsEnd).toBeGreaterThan(detailsStart);
    const inside = html.slice(detailsStart, detailsEnd);
    const outside = html.slice(0, detailsStart) + html.slice(detailsEnd);
    expect(inside).toContain('class="log-line"');
    expect(outside).not.toContain('class="log-line"');
  });
});

describe('the study surface (GAP-037)', () => {
  it('renders the transcript text and the single-tap confidence control', async () => {
    const html = await renderWithShell(
      await StudyPage({ params: Promise.resolve({ gapId: compiledGapId }) }),
    );

    // The transcript is rendered as readable text below the player — the audio fallback's
    // "text below" promise (E23 quality spec §8).
    expect(html).toContain('class="transcript"');
    expect(html).not.toContain('transcript__id'); // placeholder id display is gone

    // Practice items carry the segmented confidence control (not three radios).
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/role="radio"/g);
    expect(html).not.toContain('type="radio"');
  });
});

describe('the checkpoint on the study page (E24 US1, T010)', () => {
  it('renders the lesson checkpoint question inside the Listen section', async () => {
    const html = await renderWithShell(
      await StudyPage({ params: Promise.resolve({ gapId: compiledGapId }) }),
    );

    // The published lesson carries a pause prompt; the study page surfaces the checkpoint
    // question next to the player so the learner knows what they will be asked to respond to.
    expect(html).toContain('Checkpoint');
    expect(html).toMatch(/say out loud what[^<]*arbitrary[^<]*protecting you from/i);
  });
});

describe('duration estimates on Day cards and the lesson header (GAP-038)', () => {
  it('shows the formatted audio duration on curriculum Day cards', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({ tab: 'curriculum' }),
      }),
    );
    // The Day card (lesson row) carries the audio duration estimate before play.
    expect(html).toMatch(/· \d+:\d{2} audio/);
  });

  it('shows the formatted audio duration in the study lesson header', async () => {
    const html = await renderWithShell(
      await StudyPage({ params: Promise.resolve({ gapId: compiledGapId }) }),
    );
    expect(html).toMatch(/minutes · \d+:\d{2} audio/);
  });
});

describe('design tokens replace the slate palette (GAP-035)', () => {
  const SCREEN_FILES = [
    'apps/web/src/app/gaps/page.tsx',
    'apps/web/src/app/gaps/[gapId]/page.tsx',
    'apps/web/src/app/gaps/[gapId]/study/page.tsx',
    'apps/web/src/app/gaps/[gapId]/mastery/page.tsx',
    'apps/web/src/app/gaps/[gapId]/map/page.tsx',
    'apps/web/src/app/review/page.tsx',
  ];

  it('leaves no slate-900-family hardcodes in the restyled screens', () => {
    const FORBIDDEN = [
      '#0f172a', // slate-900
      '#1e293b', // slate-800
      '#334155', // slate-700
      '#475569', // slate-600
      '#64748b', // slate-500
      '#94a3b8', // slate-400
      'slate-',
    ];
    for (const file of SCREEN_FILES) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      for (const token of FORBIDDEN) {
        expect(source, `${file} must not hardcode ${token}`).not.toContain(token);
      }
    }
  });

  it('defines focus-visible rules for every interactive pattern the screens introduce', () => {
    const css = readFileSync(join(process.cwd(), 'apps/web/src/app/globals.css'), 'utf8');

    expect(css).toMatch(/a:focus-visible/);
    expect(css).toMatch(/button:focus-visible/);
    expect(css).toMatch(/summary:focus-visible/); // source chunk disclosure + debug toggle
    // Confidence capture (GAP-037) is a segmented control of buttons, so the shared
    // button:focus-visible rule covers it — no separate selector needed.
    expect(css).toMatch(/button:focus-visible/);
  });
});
