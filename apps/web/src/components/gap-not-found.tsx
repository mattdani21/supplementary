'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { EmptyState } from './empty-state';
import { OWNER_COOKIE } from '../lib/owner';

/**
 * The designed surface for a gap the viewer cannot see (GAP-095): the gap belongs to a
 * different learner (or no longer exists). The single-learner deploy keys everything off
 * the `gapos_owner` cookie — a stale or empty value from the owner switcher used to crash
 * the page with a raw server error. Now the learner gets one line on what happened and a
 * one-tap reset back to the default learner, never a dead error page.
 */
export function GapNotFound() {
  const router = useRouter();

  const resetOwner = () => {
    // Clear the stale learner cookie and land on the default owner's workspace.
    document.cookie = `${OWNER_COOKIE}=; path=/; max-age=0; samesite=lax`;
    router.replace('/gaps');
    router.refresh();
  };

  return (
    <EmptyState
      title="This gap isn't available for this learner."
      body="It may belong to a different learner account, or it may no longer exist. Reset the learner cookie to return to your gaps."
      action={
        <>
          <button type="button" className="btn btn--primary" onClick={resetOwner}>
            Reset learner
          </button>
          <Link href="/gaps" className="btn">
            Go to gaps
          </Link>
        </>
      }
    />
  );
}
