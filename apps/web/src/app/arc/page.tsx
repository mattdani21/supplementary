import Link from 'next/link';
import { arcTodayHandler } from '../../server/api';
import { getServerContext } from '../../server/bootstrap';
import { viewerOwner } from '../../lib/viewer';
import { ProgressRing } from '../../components/arc/progress-ring';

export const dynamic = 'force-dynamic';

interface TodayView {
  greeting: { dayLabel: string; partOfDay: string; name: string };
  focus: { plannedMinutes: number; completedMinutes: number; itemsLabel: string };
  continueGap?: {
    gapId: string;
    title: string;
    status: string;
    progress: { done: number; total: number };
    lesson?: { day: number; lessonId: string; title: string };
  };
  mapProgress: { percent: number; cleared: number; total: number };
  suggestions: { gapId: string; title: string; status: string }[];
  momentumDays: number;
  dueReviews: { reviewId: string; gapId: string; objectiveId: string; dueAt: Date }[];
}

const symbolFor = (title: string): string => {
  const words = title.split(/\s+/).filter(Boolean);
  return (words[0] ?? 'S').slice(0, 2);
};

export default async function ArcTodayPage() {
  const owner = await viewerOwner();
  const context = await getServerContext();
  const { today } = (await arcTodayHandler(context, owner)) as { today: TodayView };

  const focusPercent =
    today.focus.plannedMinutes > 0
      ? Math.min(100, Math.round((today.focus.completedMinutes / today.focus.plannedMinutes) * 100))
      : 0;
  const momentumDots = Array.from({ length: 7 }, (_, index) => index < today.momentumDays);

  return (
    <>
      <div className="arc-topbar">
        <Link className="arc-wordmark" href="/arc">
          arc
        </Link>
        <Link className="arc-icon-button" href="/arc/profile" aria-label="Open profile">
          •••
        </Link>
      </div>

      <div className="arc-greeting">
        <div>
          <p className="arc-eyebrow">{today.greeting.dayLabel}</p>
          <h1>
            Good {today.greeting.partOfDay},
            <br />
            <span>{today.greeting.name}</span>.
          </h1>
        </div>
        <Link
          className="arc-avatar"
          href="/arc/profile"
          aria-label={`Open ${today.greeting.name}'s profile`}
        >
          {today.greeting.name.slice(0, 1).toUpperCase()}
        </Link>
      </div>

      <div className="arc-focus" aria-label="Daily learning focus">
        <div>
          <p className="arc-eyebrow">Today’s focus</p>
          <strong>
            {today.focus.completedMinutes} / {today.focus.plannedMinutes} min
          </strong>
        </div>
        <div className="arc-focus-bar" aria-hidden="true">
          <span style={{ width: `${focusPercent}%` }} />
        </div>
        <small>{today.focus.itemsLabel}</small>
      </div>

      {today.continueGap && (
        <Link
          className="arc-continue"
          href={
            today.continueGap.lesson
              ? `/arc/skills/${today.continueGap.gapId}/lesson`
              : `/arc/skills/${today.continueGap.gapId}`
          }
        >
          <p className="arc-eyebrow">Continue · {today.continueGap.title}</p>
          <h2>Keep the proof going.</h2>
          <p>
            {today.continueGap.lesson
              ? `Day ${today.continueGap.lesson.day} is waiting: ${today.continueGap.lesson.title}.`
              : 'A lesson is ready when you are.'}
          </p>
          <div className="arc-continue-meta">
            <div className="arc-track">
              <span
                style={{
                  width: `${
                    today.continueGap.progress.total > 0
                      ? (today.continueGap.progress.done / today.continueGap.progress.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
            <span className="arc-track-copy">
              {today.continueGap.progress.done} of {today.continueGap.progress.total}
            </span>
          </div>
          <span className="arc-card-action">Resume lesson →</span>
        </Link>
      )}

      {today.dueReviews.length > 0 && (
        <div className="arc-section-heading">
          <h2>Due for review</h2>
          <span className="arc-text-button">{today.dueReviews.length} ready</span>
        </div>
      )}

      <div className="arc-section-heading">
        <h2>Your map</h2>
        <Link className="arc-text-button" href="/arc/skills">
          Open skills
        </Link>
      </div>
      <Link className="arc-active-skill" href="/arc/skills">
        <ProgressRing percent={today.mapProgress.percent} label="Overall map" size="large" />
        <div>
          <h3>All your skills</h3>
          <p>
            {today.mapProgress.cleared} of {today.mapProgress.total} objectives cleared
          </p>
        </div>
        <span className="arc-row-arrow" aria-hidden="true">
          ›
        </span>
      </Link>

      {today.suggestions.length > 0 && (
        <>
          <div className="arc-section-heading">
            <h2>Keep exploring</h2>
            <Link className="arc-text-button" href="/arc/skills">
              All skills
            </Link>
          </div>
          <div className="arc-suggested-grid">
            {today.suggestions.map((suggestion, index) => (
              <Link
                key={suggestion.gapId}
                className="arc-suggested"
                href={`/arc/calibrate?subject=${encodeURIComponent(suggestion.title)}`}
              >
                <span className="arc-symbol">{symbolFor(suggestion.title)}</span>
                <h3>{suggestion.title}</h3>
                <p>{index === 0 ? 'New path' : 'In progress'}</p>
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="arc-momentum">
        <span>
          <strong>
            {today.momentumDays} day{today.momentumDays === 1 ? '' : 's'}
          </strong>{' '}
          of momentum
        </span>
        <span className="arc-dots" aria-label={`${today.momentumDays} day momentum`}>
          {momentumDots.map((on, index) => (
            <span key={index} className={on ? 'is-on' : ''} />
          ))}
        </span>
      </div>
    </>
  );
}
