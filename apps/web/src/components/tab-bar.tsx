'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { resolveActiveTab, type TabItem } from '../lib/tab-bar-items';

/**
 * The shell tab bar (GAP-034, E22). Four destinations over the existing routes: Today (/),
 * Gaps (/gaps), Learn (the first actively-worked gap's detail, or /gaps) and Map (that gap's
 * knowledge map, or /gaps).
 *
 * Destination resolution lives in lib/tab-bar-items (server-safe); this file is the client
 * view: `TabBar` renders items + an active path to markup (pure, SSR-able), and `AppTabBar`
 * is the thin bridge that feeds usePathname in.
 */

/** Presentational tab bar: four labelled destinations, aria-current on the active tab. */
export function TabBar({
  items,
  activePath,
}: {
  readonly items: readonly TabItem[];
  readonly activePath: string;
}) {
  const activeItem = resolveActiveTab(items, activePath);

  return (
    <nav className="tab-bar" aria-label="Primary">
      <ul className="tab-bar__list">
        {items.map((item) => {
          const active = item === activeItem;
          return (
            <li key={item.href} className="tab-bar__item">
              <Link
                href={item.href}
                className={active ? 'tab-bar__link tab-bar__link--active' : 'tab-bar__link'}
                aria-current={active ? 'page' : undefined}
              >
                <span className="tab-bar__label">{item.label}</span>
                {active && <span className="tab-bar__indicator" aria-hidden="true" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Client bridge: feeds the current pathname into the presentational TabBar. */
export function AppTabBar({ items }: { readonly items: readonly TabItem[] }) {
  const pathname = usePathname();
  return <TabBar items={items} activePath={pathname ?? '/'} />;
}
