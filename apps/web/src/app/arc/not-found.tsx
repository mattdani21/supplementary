import Link from 'next/link';
import { EmptyState } from '@gapos/ui';

export default function ArcNotFound() {
  return (
    <EmptyState
      eyebrow="Route unavailable"
      title="That skill is not in this learner’s map."
      action={
        <Link className="arc-primary" href="/arc/skills">
          Open my skills
        </Link>
      }
    >
      It may have been archived or belong to another learner. Nothing was changed.
    </EmptyState>
  );
}
