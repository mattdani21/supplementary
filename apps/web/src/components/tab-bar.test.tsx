/**
 * The shell tab bar (GAP-034, E22), asserted at the markup level.
 *
 * Acceptance: four labelled destinations in a semantic <nav>, keyboard/screen-reader reachable,
 * with aria-current tracking exactly the active tab. The bar is pure presentational — items and
 * the active path in, markup out — so renderToStaticMarkup is enough: no browser, no jsdom,
 * deterministic by construction.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TabBar } from './tab-bar';
import { resolveActiveTab, tabBarItems } from '../lib/tab-bar-items';

const ACTIVE_GAP = { id: 'gap_math_to_ml', status: 'active' };
const DRAFT_GAP = { id: 'gap_topik_korean', status: 'draft' };

/** Parse the anchors out of the rendered markup, order-independent. */
const anchors = (html: string): { href: string; active: boolean }[] =>
  [...html.matchAll(/<a\b([^>]*)>/g)].map((match) => {
    const attrs = match[1] ?? '';
    return {
      href: /href="([^"]+)"/.exec(attrs)?.[1] ?? '',
      active: /aria-current="page"/.test(attrs),
    };
  });

describe('tabBarItems (GAP-034)', () => {
  it('always resolves the four shell destinations', () => {
    expect(tabBarItems([])).toEqual([
      { label: 'Today', href: '/' },
      { label: 'Gaps', href: '/gaps' },
      { label: 'Learn', href: '/gaps' },
      { label: 'Map', href: '/gaps' },
    ]);
  });

  it('points Learn and Map at the first active gap when one exists', () => {
    expect(tabBarItems([DRAFT_GAP, ACTIVE_GAP]).map((item) => item.href)).toEqual([
      '/',
      '/gaps',
      '/gaps/gap_math_to_ml',
      '/gaps/gap_math_to_ml/map',
    ]);
  });

  it('does not treat draft gaps as active destinations', () => {
    expect(tabBarItems([DRAFT_GAP]).map((item) => item.href)).toEqual([
      '/',
      '/gaps',
      '/gaps',
      '/gaps',
    ]);
  });
});

describe('resolveActiveTab (GAP-034)', () => {
  const items = tabBarItems([ACTIVE_GAP]);

  it('picks the exact destination first', () => {
    expect(resolveActiveTab(items, '/gaps/gap_math_to_ml')?.href).toBe('/gaps/gap_math_to_ml');
    expect(resolveActiveTab(items, '/gaps/gap_math_to_ml/map')?.href).toBe(
      '/gaps/gap_math_to_ml/map',
    );
    expect(resolveActiveTab(items, '/gaps')?.href).toBe('/gaps');
    expect(resolveActiveTab(items, '/')?.href).toBe('/');
  });

  it('falls back to the containing tab for nested routes', () => {
    expect(resolveActiveTab(items, '/gaps/gap_topik_korean')?.href).toBe('/gaps');
  });

  it('only Today is active at the root — the home tab never owns sub-routes', () => {
    expect(resolveActiveTab(items, '/gaps')?.href).not.toBe('/');
  });
});

describe('TabBar markup (GAP-034)', () => {
  const items = tabBarItems([ACTIVE_GAP]);

  it('renders a semantic nav with exactly four labelled links', () => {
    const html = renderToStaticMarkup(<TabBar items={items} activePath="/" />);
    expect(html).toContain('<nav');
    expect(html).toContain('aria-label="Primary"');
    const links = anchors(html);
    expect(links.map((link) => link.href)).toEqual([
      '/',
      '/gaps',
      '/gaps/gap_math_to_ml',
      '/gaps/gap_math_to_ml/map',
    ]);
    for (const label of ['Today', 'Gaps', 'Learn', 'Map']) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('marks exactly one tab aria-current and switches it with the active path', () => {
    for (const [activePath, expectedHref] of [
      ['/', '/'],
      ['/gaps', '/gaps'],
      ['/gaps/gap_math_to_ml', '/gaps/gap_math_to_ml'],
      ['/gaps/gap_math_to_ml/map', '/gaps/gap_math_to_ml/map'],
    ] as const) {
      const html = renderToStaticMarkup(<TabBar items={items} activePath={activePath} />);
      const links = anchors(html);
      expect(links.filter((link) => link.active)).toHaveLength(1);
      expect(links.find((link) => link.active)?.href).toBe(expectedHref);
    }
  });

  it('keeps exactly one tab active while browsing a gap detail (prefix tracking)', () => {
    const html = renderToStaticMarkup(
      <TabBar items={tabBarItems([DRAFT_GAP])} activePath="/gaps/gap_topik_korean" />,
    );
    const links = anchors(html);
    expect(links.filter((link) => link.active)).toHaveLength(1);
    expect(links.find((link) => link.active)?.href).toBe('/gaps');
  });
});
