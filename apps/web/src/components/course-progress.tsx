import Link from 'next/link';

/**
 * Course progress (E26): a minimal, intellectual replacement for the raw compile-step
 * debug list on the gap overview. Shows how far the learner is through the course —
 * published days as filled ticks on a thin rule, a one-line status, and a next-lesson
 * affordance. The raw generation log remains behind the Curriculum tab; learners never
 * need to read "audit_claims succeeded".
 */

export interface CourseProgressLesson {
  readonly id: string;
  readonly day: number;
  readonly title: string;
  readonly publicationStatus: string;
}

export interface CourseProgressFinding {
  readonly category: string;
  readonly severity: string;
  readonly finding: string;
}

/**
 * What a failed run recorded about why it stopped (GAP-089): the run error and the audit
 * findings summary. Both are debugging-grade detail; the card derives plain words from them
 * and never renders them raw.
 */
export interface CourseFailure {
  readonly error?: string;
  readonly findings: readonly CourseProgressFinding[];
}

interface CourseProgressProps {
  readonly gapId: string;
  readonly lessons: readonly CourseProgressLesson[];
  readonly compileStatus?: string;
  /** Failure details for the failed state (GAP-089): the run error and audit findings. */
  readonly compileFailure?: CourseFailure;
}

const STATUS_LINE: Record<string, string> = {
  queued: 'Your course is being prepared.',
  ingesting: 'Your course is being written.',
  planning: 'Your course is being written.',
  generating_lessons: 'Your course is being written.',
  generating_assessment: 'Your course is being written.',
  auditing: 'Your course is being written.',
  repairing: 'Your course is being written.',
  synthesising_audio: 'Your course is being written.',
  publishing: 'Your course is being written.',
  complete: 'Course complete.',
  partial: 'Course complete — a few days were set aside.',
  failed: 'The course could not be finished.',
  cancelled: 'Cancelled.',
};

/**
 * Run errors the pipeline writes as learner-addressable sentinels. Anything else is a
 * debugging string (provider exceptions, validation output) and stays out of the card.
 */
const KNOWN_FAILURE_REASONS: Record<string, string> = {
  clarification_required:
    'It needs a clarification from you — update your gap statement, then retry.',
};

/**
 * A short plain-words why + next step for a failed compile (GAP-089, E27): derived from the
 * run error (only known learner-addressable reasons) and the audit findings summary, with a
 * calm fallback. The raw error string never reaches the learner here — the developer-facing
 * detail lives in the generation log.
 */
export const failedExplanation = (failure: CourseFailure | undefined): string => {
  const reason = failure?.error ? KNOWN_FAILURE_REASONS[failure.error] : undefined;
  if (reason) return reason;
  if ((failure?.findings.length ?? 0) > 0) {
    return 'Some days were set aside after repeated quality checks. Retry to regenerate them.';
  }
  return 'Something went wrong while writing it. Retry to regenerate it.';
};

export function CourseProgress({
  gapId,
  lessons,
  compileStatus,
  compileFailure,
}: CourseProgressProps) {
  const published = lessons
    .filter((lesson) => lesson.publicationStatus === 'published')
    .sort((a, b) => a.day - b.day);
  const days = Math.max(...lessons.map((l) => l.day), 0);
  const completed = published.length;
  const pct = days > 0 ? Math.round((completed / days) * 100) : 0;

  // Continue points at the first published day after the longest consecutive run of
  // completed days from day 1 (i.e. the next thing the learner has not yet done).
  const doneDays = new Set(published.map((l) => l.day));
  let streak = 0;
  while (doneDays.has(streak + 1)) streak += 1;
  // A complete course: the streak covers every planned day (equivalently completed ===
  // days). Continue must never point back at an already-complete day — the card renders
  // a review affordance instead (GAP-090).
  const done = days > 0 && streak === days;
  const next = published.find((lesson) => lesson.day > streak) ?? published[0];

  return (
    <section className="course-progress" aria-label="Course progress">
      <div className="course-progress__head">
        <span className="course-progress__label">Progress</span>
        <span className="course-progress__count">
          {completed}/{days} days
        </span>
      </div>

      <div
        className="course-progress__rule"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% complete`}
      >
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const lesson = published.find((l) => l.day === day);
          const state = lesson ? 'done' : 'todo';
          return (
            <span
              key={day}
              className={`course-progress__tick course-progress__tick--${state}`}
              title={lesson ? `Day ${day} — ${lesson.title}` : `Day ${day}`}
            />
          );
        })}
      </div>

      <p className="course-progress__status">
        {compileStatus
          ? (STATUS_LINE[compileStatus] ?? '')
          : done
            ? 'Course complete.'
            : pct === 0
              ? 'Nothing published yet.'
              : ''}
      </p>

      {compileStatus === 'failed' && (
        <p className="course-progress__explanation" role="status">
          {failedExplanation(compileFailure)}
        </p>
      )}

      {done ? (
        <Link href={`/gaps/${gapId}/study`} className="course-progress__next">
          Review the course
          <span aria-hidden="true">→</span>
        </Link>
      ) : (
        published.length > 0 &&
        next && (
          <Link href={`/gaps/${gapId}/study`} className="course-progress__next">
            {streak === 0 && days > 0
              ? `Start — Day ${next.day}: ${next.title}`
              : `Continue — Day ${next.day}: ${next.title}`}
            <span aria-hidden="true">→</span>
          </Link>
        )
      )}
    </section>
  );
}
