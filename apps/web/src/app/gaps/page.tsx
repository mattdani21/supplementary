import Link from 'next/link';
import type { Gap } from '@gapos/database';
import { EmptyState } from '../../components/empty-state';
import { GapForm } from '../../components/gap-form';
import { OwnerSwitcher } from '../../components/owner-switcher';
import { VoiceCapture } from '../../components/voice-capture';
import { pillClass } from '../../lib/status-pill';
import { listGaps } from '../../server/api';
import { getServerContext } from '../../server/bootstrap';
import { viewerOwner } from '../../lib/viewer';

export const dynamic = 'force-dynamic';

export default async function GapsPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { gaps } = (await listGaps(context, owner)) as { gaps: Gap[] };

  return (
    <main>
      <header className="page-head">
        <div className="row page-head__row">
          <h1>Gaps</h1>
          <span className="actions">
            <Link href="/review">Review queue</Link>
            <OwnerSwitcher />
          </span>
        </div>
        <p className="page-head__meta">Your learning tracks, one gap at a time.</p>
      </header>

      {gaps.length === 0 ? (
        <EmptyState
          title="No gaps yet."
          body="Name the thing you want to be able to do — GapOS turns it into a source-grounded, audio-first course with verified practice."
          action={
            <Link href="#new-gap" className="btn btn--primary">
              Name your first gap
            </Link>
          }
        />
      ) : (
        <ul className="track-list">
          {gaps.map((gap) => (
            <li key={gap.id}>
              <Link href={`/gaps/${gap.id}`} className="track-row">
                <span className="track-row__main">
                  <span className="track-row__title">{gap.title}</span>
                  {gap.targetCapability && (
                    <span className="track-row__capability">{gap.targetCapability}</span>
                  )}
                </span>
                <span className="track-row__meta">
                  <span className={pillClass(gap.status)}>{gap.status}</span>
                  <span className="track-row__minutes">{gap.dailyMinutes} min/day</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="create-heading" className="today__tracks">
        <h2 id="create-heading">Create</h2>
        <GapForm />
        <VoiceCapture />
      </section>
    </main>
  );
}
