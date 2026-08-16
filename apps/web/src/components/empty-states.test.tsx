/**
 * Designed empty states per list surface (GAP-037, E23 quality spec §4): gaps list, sources tab,
 * practice items, review queue and knowledge map each get a one-line explanation and a concrete
 * next action — never a blank surface.
 *
 * Uses a fresh in-memory server context per test file (same bootstrap mock as screens.test.tsx,
 * same reason: the sandbox sets GAPOS_DATABASE_URL, which would otherwise point page renders at a
 * real Postgres database). The first describe runs before any gap exists; the second after one
 * gap with no sources/curriculum/findings exists — which is exactly the state every list surface
 * has to design for.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type * as ServerContextModule from '../server/context';
import { REFERENCE_GAP_STATEMENT } from '@gapos/test-fixtures';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/gaps',
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
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
import KnowledgeMapPage from '../app/gaps/[gapId]/map/page';
import ReviewPage from '../app/review/page';
import StudyPage from '../app/gaps/[gapId]/study/page';
import { createGap, createUser } from '../server/api';
import { getServerContext } from '../server/bootstrap';

const OWNER = 'local-learner';
const GAP_TITLE = 'Empty states fixture gap';

const renderWithShell = async (page: ReactNode): Promise<string> =>
  renderToStaticMarkup(await RootLayout({ children: page }));

describe('the gaps list empty state — runs first, before any gap exists (GAP-037)', () => {
  it('explains what belongs here and gives a concrete next action', async () => {
    const html = await renderWithShell(await GapsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('No gaps yet.');
    expect(html).toContain('Name the thing you want to be able to do');
    expect(html).toMatch(/href="#new-gap"/);
  });
});

describe('per-surface empty states once a gap exists with no content (GAP-037)', () => {
  let gapId: string;

  beforeAll(async () => {
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
  });

  it('sources tab explains and points at the add-source form', async () => {
    const html = await renderWithShell(
      await GapDetailPage({
        params: Promise.resolve({ gapId }),
        searchParams: Promise.resolve({ tab: 'sources' }),
      }),
    );
    expect(html).toContain('No sources yet.');
    expect(html).toContain('The planner needs material to build from');
    expect(html).toMatch(/href="#add-source"/);
  });

  it('knowledge map explains and points back at the workspace', async () => {
    const html = await renderWithShell(
      await KnowledgeMapPage({ params: Promise.resolve({ gapId }) }),
    );
    expect(html).toContain('No map yet.');
    expect(html).toContain('Compile the gap');
    expect(html).toMatch(new RegExp(`href="/gaps/${gapId}"`));
  });

  it('review queue explains and points back at the gaps list', async () => {
    const html = await renderWithShell(await ReviewPage());
    expect(html).toContain('Queue is clear.');
    expect(html).toContain('Nothing waiting');
    expect(html).toMatch(/href="\/gaps"/);
  });

  it('study with nothing due explains and points at the workspace', async () => {
    const html = await renderWithShell(await StudyPage({ params: Promise.resolve({ gapId }) }));
    expect(html).toContain('Nothing due today');
    expect(html).toContain('Come back when a lesson is scheduled');
    expect(html).toMatch(new RegExp(`href="/gaps/${gapId}"`));
  });
});
