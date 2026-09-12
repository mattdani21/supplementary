'use client';

import Link from 'next/link';
import { StatusMessage } from '@gapos/ui';

export default function ArcError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusMessage
      tone="error"
      title="This step did not load."
      action={
        <div className="arc-action-row">
          <button className="arc-primary" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="arc-secondary" href="/arc">
            Return to Today
          </Link>
        </div>
      }
    >
      Your saved work is still available. Retry the request or return to Today.
    </StatusMessage>
  );
}
