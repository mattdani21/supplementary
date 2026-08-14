/**
 * Tab-bar destination resolution (GAP-034, E22). Pure and environment-neutral so the server
 * layout can resolve the four destinations and hand them to the client TabBar as props.
 */

export interface TabItem {
  readonly label: string;
  readonly href: string;
}

/**
 * Statuses where a gap is being actively worked — the learner has a live track worth jumping
 * into. Drafts, compiling gaps, filled gaps and archived gaps are not "active" destinations.
 */
export const ACTIVE_GAP_STATUSES = ['active', 'mastery_check', 'review_due'] as const;

export const isActionableGap = (status: string): boolean =>
  (ACTIVE_GAP_STATUSES as readonly string[]).includes(status);

/** Resolve the four shell destinations from the learner's gaps (pure, deterministic). */
export const tabBarItems = (
  gaps: readonly { readonly id: string; readonly status: string }[],
): readonly TabItem[] => {
  const firstActive = gaps.find((gap) => isActionableGap(gap.status));
  return [
    { label: 'Today', href: '/' },
    { label: 'Gaps', href: '/gaps' },
    { label: 'Learn', href: firstActive ? `/gaps/${firstActive.id}` : '/gaps' },
    { label: 'Map', href: firstActive ? `/gaps/${firstActive.id}/map` : '/gaps' },
  ];
};

/**
 * Which tab is active? An exact destination wins (so /gaps/<id>/map highlights Map, not Gaps);
 * otherwise the tab whose subtree contains the route. The home tab owns only the root, never
 * sub-routes.
 */
export const resolveActiveTab = (
  items: readonly TabItem[],
  activePath: string,
): TabItem | undefined =>
  items.find((item) => item.href === activePath) ??
  items.find((item) => item.href !== '/' && activePath.startsWith(`${item.href}/`));
