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

interface CourseProgressProps {
  readonly gapId: string;
  readonly lessons: readonly CourseProgressLesson[];
  readonly compileStatus?: string;
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
  failed: 'Compilation stopped — check the Curriculum tab.',
  cancelled: 'Cancelled.',
};

export function CourseProgress({ gapId, lessons, compileStatus }: CourseProgressProps) {
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
          : pct === 0
            ? 'Nothing published yet.'
            : ''}
      </p>

      {published.length > 0 && next && (
        <Link href={`/gaps/${gapId}/study`} className="course-progress__next">
          {streak === 0 && days > 0
            ? `Start — Day ${next.day}: ${next.title}`
            : `Continue — Day ${next.day}: ${next.title}`}
          <span aria-hidden="true">→</span>
        </Link>
      )}
    </section>
  );
}
