import Link from 'next/link';

/**
 * The workspace segmented control (GAP-035, E22): six destinations over the existing routes.
 * Overview / Sources / Curriculum are sections of the gap detail page (selected by ?tab=);
 * Learn / Practice / Mastery are the dedicated screens. A pure server component — items and
 * the active tab in, markup out — so it stays SSR-able and keyboard/screen-reader reachable
 * through semantic links with aria-current.
 */

export type WorkspaceTab = 'overview' | 'sources' | 'curriculum' | 'learn' | 'practice' | 'mastery';

export function WorkspaceTabs({
  gapId,
  active,
}: {
  readonly gapId: string;
  readonly active?: WorkspaceTab;
}) {
  const items: readonly {
    readonly tab: WorkspaceTab;
    readonly label: string;
    readonly href: string;
  }[] = [
    { tab: 'overview', label: 'Overview', href: `/gaps/${gapId}` },
    { tab: 'sources', label: 'Sources', href: `/gaps/${gapId}?tab=sources` },
    { tab: 'curriculum', label: 'Curriculum', href: `/gaps/${gapId}?tab=curriculum` },
    { tab: 'learn', label: 'Learn', href: `/gaps/${gapId}/study` },
    { tab: 'practice', label: 'Practice', href: `/gaps/${gapId}/study#questions` },
    { tab: 'mastery', label: 'Mastery', href: `/gaps/${gapId}/mastery` },
  ];

  return (
    <nav className="segmented" aria-label="Workspace">
      {items.map((item) => {
        const isActive = item.tab === active;
        return (
          <Link
            key={item.tab}
            href={item.href}
            className={isActive ? 'segmented__item segmented__item--active' : 'segmented__item'}
            aria-current={isActive ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
