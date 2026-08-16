import Link from 'next/link';
import type { Gap } from '@gapos/database';
import { EmptyState } from '../components/empty-state';
import { GenerationProgress, isActiveRunStatus } from '../components/generation-progress';
import { OnboardingGate } from '../components/onboarding';
import { isActionableGap } from '../lib/tab-bar-items';
import { pillClass } from '../lib/status-pill';
import { viewerOwner } from '../lib/viewer';
import { generationLog, listGaps, todayView, type GenerationLog } from '../server/api';
import { getServerContext } from '../server/bootstrap';

export const dynamic = 'force-dynamic';

const greetingFor = (hour: number): string => {
  if (hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

interface TodayView {
  readonly reviews: readonly unknown[];
  readonly lesson?: { day: number; lessonId: string; title: string };
  readonly totalItems: number;
}

export default async function HomePage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { gaps } = (await listGaps(context, owner)) as { gaps: Gap[] };
  const now = context.now();

  // The featured gap: Today leads with its queue, and while Day 1 has not landed it carries the
  // designed compile-in-progress surface (GAP-037) so the home surface is never blank (spec §5).
  const featured = gaps[0] ?? null;
  const [todayResult, logResult] = featured
    ? await Promise.all([
        todayView(context, owner, featured.id) as Promise<{ today: TodayView }>,
        generationLog(context, owner, featured.id),
      ])
    : [
        { today: { reviews: [], totalItems: 0 } as TodayView },
        { log: { run: undefined, steps: [], findings: [] } as GenerationLog },
      ];
  const { today } = todayResult;
  const { log } = logResult;

  const firstActive = gaps.find((gap) => isActionableGap(gap.status));
  const continueTarget = firstActive
    ? {
        href: `/gaps/${firstActive.id}/study`,
        kicker: 'Continue',
        title: firstActive.title,
        meta: `${firstActive.status} · ${firstActive.dailyMinutes} min/day`,
      }
    : featured
      ? {
          href: `/gaps/${featured.id}`,
          kicker: 'Start',
          title: featured.title,
          meta: `${featured.status} · ${featured.dailyMinutes} min/day`,
        }
      : null;

  const dateLine = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(now);

  return (
    <OnboardingGate owner={owner} hasGaps={gaps.length > 0}>
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

        {/* The generation surface only earns its place while the pipeline is actually
            running (or never started — the "add sources" nudge). A finished course —
            complete, partial or failed — gets the calm course-progress card on its
            workspace instead; raw compile steps serve no purpose on Today then. */}
        {featured && !today.lesson && (!log.run || isActiveRunStatus(log.run.status)) && (
          <GenerationProgress
            run={log.run}
            steps={log.steps}
            findingsCount={log.findings.length}
            sourcesHref={`/gaps/${featured.id}?tab=sources`}
          />
        )}

        <section className="today__tracks" aria-labelledby="tracks-heading">
          <h2 id="tracks-heading">Your tracks</h2>

          {gaps.length === 0 ? (
            <EmptyState
              title="No tracks yet."
              body="Name the thing you want to be able to do, and GapOS will build a source-grounded audio course for it."
              action={
                <Link href="/gaps" className="btn btn--primary">
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
        </section>
      </main>
    </OnboardingGate>
  );
}
