import type { ReactNode } from 'react';

/**
 * The crafted empty state every list surface uses (GAP-037, E23 quality spec §4): one line on
 * what belongs here, one line teaching what to do next, and a concrete action. Empty states
 * teach the product — they are never a blank surface.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__body">{body}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
