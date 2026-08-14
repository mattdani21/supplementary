import Link from 'next/link';
import type { Gap } from '@gapos/database';
import { isActionableGap } from '../lib/tab-bar-items';
import { pillClass } from '../lib/status-pill';
import { viewerOwner } from '../lib/viewer';
import { listGaps } from '../server/api';
import { getServerContext } from '../server/bootstrap';

export const dynamic = 'force-dynamic';

const greetingFor = (hour: number): string => {
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export default async function HomePage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { gaps } = (await listGaps(context, owner)) as { gaps: Gap[] };
  const now = context.now();

  const firstActive = gaps.find((gap) => isActionableGap(gap.status));
  const continueTarget = firstActive
    ? {
        href: `/gaps/${firstActive.id}/study`,
        kicker: 'Continue',
        title: firstActive.title,
        meta: `${firstActive.status} · ${firstActive.dailyMinutes} min/day`,
      }
    : gaps[0]
      ? {
          href: `/gaps/${gaps[0].id}`,
          kicker: 'Start',
          title: gaps[0].title,
          meta: `${gaps[0].status} · ${gaps[0].dailyMinutes} min/day`,
        }
      : null;

  const dateLine = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);

  return (
    <main className="today">
      <header className="today__header">
        <p className="today__date">{dateLine}</p>
        <h1 className="today__greeting">{greetingFor(now.getHours())}.</h1>
        <p className="today__subtitle">Close one gap at a time.</p>
      </header>

      {continueTarget && (
        <Link href={continueTarget.href} className="continue-card">
          <span className="continue-card__body">
            <span className="continue-card__kicker">{continueTarget.kicker}</span>
            <span className="continue-card__title">{continueTarget.title}</span>
            <span className="continue-card__meta">{continueTarget.meta}</span>
          </span>
          <span className="continue-card__chevron" aria-hidden="true">
            →
          </span>
        </Link>
      )}

      <section className="today__tracks" aria-labelledby="tracks-heading">
        <h2 id="tracks-heading">Your tracks</h2>

        {gaps.length === 0 ? (
          <div className="empty-state">
            <p className="empty-state__title">No tracks yet.</p>
            <p className="empty-state__body">
              Name the thing you want to be able to do, and GapOS will build a source-grounded audio
              course for it.
            </p>
            <Link href="/gaps" className="btn btn--primary">
              Name your first gap
            </Link>
          </div>
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
      </section>
    </main>
  );
}
