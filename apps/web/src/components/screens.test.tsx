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
import { SourceLinks } from './source-links';
import { CourseProgress } from './course-progress';
import { getServerContext } from '../server/bootstrap';
import {
  compile,
  createGap,
  createUser,
  registerSourceHandler,
  transitionGap,
} from '../server/api';

// Developer surfaces are gated behind GAPOS_DEV_MODE=1 or ?dev=1 (GAP-088, E27). Every
// render in this file asserts the learner-facing default, so pin the env flag off
// regardless of the host environment.
vi.stubEnv('GAPOS_DEV_MODE', undefined);

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
    // The review queue is an educator-moderation surface, not learner nav (GAP-088).
    expect(html).not.toContain('Review queue');
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
    expect(html).toContain('class="course-progress"');
    expect(html).toContain('days');
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

describe('the course progress surface replaces the raw compile log (E26)', () => {
  it('shows progress ticks and a calm status for a completed course, never the raw step list', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({}),
      }),
    );

    // The learner-facing surface: progress ticks, a count, and a calm status line.
    expect(html).toContain('class="course-progress"');
    expect(html).toMatch(/course-progress__tick--done/);
    expect(html).toMatch(/\d+\/\d+ days/);
    expect(html).toContain('Course complete.');

    // The raw generation log is gone from the overview of a completed course.
    expect(html).not.toContain('class="progress-phase"');
    expect(html).not.toContain('class="log-line"');
    expect(html).not.toContain('Compile progress');
  });

  it('links to the study page from the progress card — review, never Continue, when complete (GAP-090)', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toMatch(/href="\/gaps\/[^"]+\/study"/);
    // The fixture course is fully published, so the card offers review — it must
    // never say "Continue — Day N" pointing back at an already-complete day.
    expect(html).toContain('Review the course');
    expect(html).not.toContain('Continue —');
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

describe('the curriculum tab nests day lessons under objective modules (E26)', () => {
  it('renders each module with its capability statement and the day lessons beneath it', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({ tab: 'curriculum' }),
      }),
    );
    // Modules exist, with kicker + capability title.
    expect(html).toMatch(/Module · obj_/);
    expect(html).toContain('class="module__title"');
    // Day cards still render inside the module sections.
    expect(html).toMatch(/Day \d — /);
    // The flat "Lessons" heading is gone — lessons are grouped under modules now.
    expect(html).not.toContain('>Lessons<');
    expect(html).not.toContain('>Objectives<');
  });

  it('renders a module for every objective that has lessons, in plan order', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({ tab: 'curriculum' }),
      }),
    );
    const modules = html.match(/Module · (obj_[a-z_]+)/g) ?? [];
    expect(modules.length).toBeGreaterThanOrEqual(3);
    // First-listed objective is the earliest one in the plan.
    expect(modules[0]).toMatch(/obj_subset_proof/);
  });
});

/**
 * T022 (US2, E24): traceability is user-visible. Every published lesson and every practice
 * question shows the locator(s) behind it, and the source is one step away — a real link to
 * the Sources tab chunk anchor (C-07, FR-011, SC-006). A general-knowledge item renders the
 * explicit label instead of a link, and the links keep the quality-spec focus-visible rule.
 */
describe('source links on the study surface (E24 US2, T022)', () => {
  it('renders lesson locator links in Listen and per-question locators before answering', async () => {
    const html = await renderWithShell(
      await StudyPage({ params: Promise.resolve({ gapId: compiledGapId }) }),
    );

    // Every source-grounded link targets the Sources tab chunk anchor, one step from the
    // content (SC-006).
    const sourceLinks = [...html.matchAll(/href="(\/gaps\/[^"]*\?tab=sources#chunk-[^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(sourceLinks.length).toBeGreaterThanOrEqual(2); // Listen lesson + at least one question
    for (const href of sourceLinks) {
      expect(href).toMatch(new RegExp(`^/gaps/${compiledGapId}\\?tab=sources#chunk-`));
    }

    // The links are real anchors with accessible names, not bare text.
    expect(html).toMatch(/<a[^>]*aria-label="Open source[^"]*"/);
  });

  it('renders the explicit general-knowledge label instead of a link', () => {
    const html = renderToStaticMarkup(
      <SourceLinks gapId={compiledGapId} basis="general_knowledge" locators={[]} />,
    );
    expect(html).toContain('General knowledge');
    expect(html).not.toMatch(/<a\b/);
  });

  it('renders a source locator as a one-step link with an accessible name', () => {
    const html = renderToStaticMarkup(
      <SourceLinks
        gapId={compiledGapId}
        basis="source"
        locators={[
          { sourceId: 's1', chunkId: 'c2', locator: '§2 Subsets', sourceName: 'primer.md' },
        ]}
      />,
    );
    expect(html).toContain(`href="/gaps/${compiledGapId}?tab=sources#chunk-c2"`);
    expect(html).toMatch(/aria-label="Open source[^"]*§2 Subsets/);
    expect(html).toContain('primer.md');
  });

  it('keeps a visible focus-visible rule for source links', () => {
    const css = readFileSync(join(process.cwd(), 'apps/web/src/app/globals.css'), 'utf8');
    expect(css).toMatch(/a:focus-visible/);
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

describe('the course progress surface (E26)', () => {
  const lessons = [
    { id: 'l1', day: 1, title: 'Sets', publicationStatus: 'published' },
    { id: 'l2', day: 2, title: 'Functions', publicationStatus: 'published' },
    { id: 'l3', day: 3, title: 'Vectors', publicationStatus: 'excluded' },
    { id: 'l4', day: 4, title: 'Matrices', publicationStatus: 'published' },
  ];

  it('renders a progress rule with a tick per day, filled for published days', () => {
    const html = renderToStaticMarkup(<CourseProgress gapId="gap_cp" lessons={lessons} />);
    expect(html).toContain('Progress');
    expect(html).toContain('3/4 days');
    expect(html).toMatch(/tick--done/);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="75"');
  });

  it('links to the study page with the next lesson', () => {
    const html = renderToStaticMarkup(<CourseProgress gapId="gap_cp" lessons={lessons} />);
    // Days 1–2 are done (consecutive from day 1), day 3 excluded, day 4 published →
    // the streak breaks at 2, so Continue points at Day 4.
    expect(html).toContain('Continue — Day 4: Matrices');
    expect(html).toContain('href="/gaps/gap_cp/study"');
  });

  it('renders a completion state for a fully published course — never "Continue — Day N" (GAP-090)', () => {
    // The real bug: with every planned day published, the streak reaches `days`,
    // `published.find((lesson) => lesson.day > streak)` is undefined, and the
    // `?? published[0]` fallback pointed back at the already-complete Day 1.
    const complete = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      id: `c${day}`,
      day,
      title: `Lesson ${day}`,
      publicationStatus: 'published',
    }));
    const html = renderToStaticMarkup(<CourseProgress gapId="gap_cp" lessons={complete} />);
    expect(html).toContain('7/7 days');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('Course complete.');
    expect(html).toContain('Review the course');
    expect(html).toContain('href="/gaps/gap_cp/study"');
    expect(html).not.toContain('Continue — Day');
    expect(html).not.toContain('Start — Day');
  });

  it('shows a calm status line while compiling', () => {
    const html = renderToStaticMarkup(
      <CourseProgress gapId="gap_cp" lessons={[]} compileStatus="auditing" />,
    );
    expect(html).toContain('Your course is being written.');
    expect(html).toContain('0/0 days');
  });
});

describe('the failed compile state explains why and what to do (GAP-089, E27)', () => {
  it('renders an explanatory line for a failed compile — never the raw error string', () => {
    const html = renderToStaticMarkup(
      <CourseProgress
        gapId="gap_cp"
        lessons={[]}
        compileStatus="failed"
        compileFailure={{
          error: 'Simulated provider failure for gap_normalisation (0 remaining)',
          findings: [
            { category: 'grounding', severity: 'high', finding: 'Objective O2 lacks locators' },
          ],
        }}
      />,
    );

    // The count alone is useless; the card must say why it failed and what to do.
    expect(html).toContain('0/0 days');
    expect(html).toContain('The course could not be finished.');
    expect(html).toContain('course-progress__explanation');
    expect(html).toContain('Retry');
    // The raw run error is a debugging string, never the learner-facing explanation.
    expect(html).not.toContain('Simulated provider failure');
    expect(html).not.toContain('gap_normalisation');
  });

  it('uses the pipeline’s own reason when the run error is learner-addressable', () => {
    const html = renderToStaticMarkup(
      <CourseProgress
        gapId="gap_cp"
        lessons={[]}
        compileStatus="failed"
        compileFailure={{ error: 'clarification_required', findings: [] }}
      />,
    );
    expect(html).toContain('clarification');
    expect(html).not.toContain('clarification_required'); // the code, never verbatim
  });

  it('still explains a failed compile with no error or findings on record', () => {
    const html = renderToStaticMarkup(
      <CourseProgress gapId="gap_cp" lessons={[]} compileStatus="failed" />,
    );
    expect(html).toContain('The course could not be finished.');
    expect(html).toContain('Retry');
    expect(html).toMatch(/course-progress__explanation[^>]*>.*Retry/);
  });
});

describe('developer surfaces are gated off the learner gaps page (GAP-088, E27)', () => {
  const renderGaps = async (
    searchParams: Record<string, string | string[] | undefined> = {},
  ): Promise<string> =>
    renderWithShell(await GapsPage({ searchParams: Promise.resolve(searchParams) }));

  it('renders no owner switcher and no review-queue link under the default env', async () => {
    const html = await renderGaps();

    // The dev surfaces must not exist in the learner-facing markup at all — not hidden
    // via CSS, not present-but-disabled.
    expect(html).not.toContain('>Learner<');
    expect(html).not.toContain('>Switch<');
    expect(html).not.toContain('name="owner"');
    expect(html).not.toContain('Review queue');
    expect(html).not.toContain('href="/review"');
  });

  it('renders the owner switcher and the review-queue link under ?dev=1', async () => {
    const html = await renderGaps({ dev: '1' });

    expect(html).toContain('>Learner<');
    expect(html).toContain('>Switch<');
    expect(html).toContain('name="owner"');
    expect(html).toContain('Review queue');
    expect(html).toContain('href="/review"');
  });

  it('renders the transition actions on an active gap overview without the raw header error', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId: compiledGapId }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain('Check mastery');
    expect(html).toContain('Archive');
    // The raw owner-required message must never reach the learner surface.
    expect(html).not.toContain('Set the X-Owner-Id header.');
    expect(html).not.toContain('owner_required');
  });
});
