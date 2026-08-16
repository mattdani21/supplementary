import Link from 'next/link';
import { GapNotFound, isGapNotFoundError } from '../../../../components/gap-not-found';
import { WorkspaceTabs } from '../../../../components/workspace-tabs';
import { masterySchedule, masteryView } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';
import { viewerOwner } from '../../../../lib/viewer';

export const dynamic = 'force-dynamic';

interface MasteryAssessment {
  objectiveId: string;
  label?: string;
  mastered: boolean;
  score: number;
  itemCount: number;
  sessionCount: number;
  missing: readonly string[];
}

interface MasterySummary {
  assessments: MasteryAssessment[];
  masteredObjectiveIds: string[];
  requiredObjectiveIds: string[];
  readyToFill: boolean;
}

interface ScheduleItem {
  id: string;
  objectiveId: string;
  dueAt: string;
  intervalDays: number;
  reason: string;
}

const formatDue = (iso: string): string =>
  new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(iso));

export default async function MasteryPage({ params }: { params: Promise<{ gapId: string }> }) {
  const { gapId } = await params;
  const owner = await viewerOwner();
  const context = await getServerContext();

  // A stale learner cookie (or a deleted gap) must never crash mastery with a raw server
  // error — the designed not-found surface offers a one-tap reset (GAP-095).
  let mastery: MasterySummary;
  let reviews: ScheduleItem[];
  try {
    ({ mastery } = (await masteryView(context, owner, gapId)) as { mastery: MasterySummary });
    ({ reviews } = (await masterySchedule(context, owner, gapId)) as { reviews: ScheduleItem[] });
  } catch (error) {
    if (isGapNotFoundError(error)) {
      return (
        <main>
          <Link href={`/gaps/${gapId}`} className="back-link">
            ← Workspace
          </Link>
          <GapNotFound />
        </main>
      );
    }
    throw error;
  }

  const required = mastery.requiredObjectiveIds.length;
  const mastered = mastery.masteredObjectiveIds.length;
  const percent = required === 0 ? 0 : Math.round((mastered / required) * 100);

  return (
    <main>
      <Link href={`/gaps/${gapId}`} className="back-link">
        ← Workspace
      </Link>
      <WorkspaceTabs gapId={gapId} active="mastery" />

      <header className="page-head">
        <h1>Mastery</h1>
        <p className="page-head__meta">
          {mastered}/{required} required objectives
        </p>
      </header>

      <div className="card mastery-summary">
        <p>
          {mastery.readyToFill
            ? '🎉 Ready to fill — every required objective is mastered.'
            : 'Still learning — keep going.'}
        </p>
        <div
          className="mastery-summary__progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Required objectives mastered"
        >
          <span className="mastery-summary__fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {mastery.assessments.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No mastery evidence yet.</p>
          <p className="empty-state__body">
            Compile the gap first — mastery is measured from the lessons you practise.
          </p>
        </div>
      ) : (
        <ul className="objective-list">
          {mastery.assessments.map((assessment) => (
            <li key={assessment.objectiveId} className="card objective-row">
              <div className="objective-row__head">
                <span
                  className={
                    assessment.mastered
                      ? 'objective-row__mark objective-row__mark--mastered'
                      : 'objective-row__mark objective-row__mark--open'
                  }
                  aria-hidden="true"
                >
                  {assessment.mastered ? '✓' : '○'}
                </span>
                <span className="objective-row__label">
                  {assessment.label ?? assessment.objectiveId}
                </span>
                <span className={assessment.mastered ? 'pill pill--ok' : 'pill'}>
                  {assessment.mastered ? 'mastered' : 'learning'}
                </span>
              </div>
              <div
                className="objective-bar"
                role="progressbar"
                aria-valuenow={Math.round(assessment.score * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${assessment.objectiveId} score`}
              >
                <span
                  className="objective-bar__fill"
                  style={{ width: `${Math.round(assessment.score * 100)}%` }}
                />
              </div>
              <p className="objective-row__meta">
                {assessment.itemCount} items · {assessment.sessionCount} sessions ·{' '}
                {Math.round(assessment.score * 100)}% score
              </p>
              {!assessment.mastered && assessment.missing.length > 0 && (
                <p className="objective-row__missing">{assessment.missing.join(' ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="schedule-heading">
        <h2 id="schedule-heading">Review schedule</h2>
        {reviews.length === 0 ? (
          <p className="muted">
            No reviews due — answering practice items schedules spaced reviews.
          </p>
        ) : (
          <ul className="card review-schedule">
            {reviews.map((review) => (
              <li key={review.id} className="review-row">
                <span>
                  <strong>{review.objectiveId}</strong>{' '}
                  <span className="muted">· due {formatDue(review.dueAt)}</span>
                </span>
                <span className="chip">
                  {review.intervalDays}d · {review.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
