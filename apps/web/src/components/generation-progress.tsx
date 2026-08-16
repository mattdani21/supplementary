import Link from 'next/link';
import { EmptyState } from './empty-state';

/**
 * The generation progress surface (GAP-037, E23 quality spec §3): compile-in-progress is a
 * designed surface — a phase label, a step list with per-step status chips, and the raw
 * generation log tucked behind a collapsible debug toggle. The raw log is the debugging view,
 * never the user-facing surface.
 */

export interface GenerationProgressStep {
  readonly step: string;
  readonly state: string;
  readonly attempt: number;
  readonly error?: string;
}

export interface GenerationProgressRun {
  readonly status: string;
}

/** Human phase label per pipeline status, so the learner sees progress in plain words. */
const PHASE_LABELS: Record<string, string> = {
  queued: 'Queued — waiting to start',
  ingesting: 'Ingesting your sources',
  planning: 'Planning the curriculum',
  generating_lessons: 'Writing lessons',
  generating_assessment: 'Writing practice items',
  auditing: 'Verifying against the sources',
  repairing: 'Repairing flagged content',
  synthesising_audio: 'Producing audio',
  publishing: 'Publishing your course',
  complete: 'Complete — your course is ready',
  partial: 'Complete with flagged gaps',
  failed: 'Compilation stopped — see the audit findings',
  cancelled: 'Cancelled',
};

/** Statuses where the pipeline is actively running — the only ones that render the
 * generation surface. Terminal states (complete / partial / failed / cancelled) show the
 * calm course-progress card instead; the raw compile steps serve no purpose then. */
const ACTIVE_RUN_STATUSES: readonly string[] = [
  'queued',
  'ingesting',
  'planning',
  'generating_lessons',
  'generating_assessment',
  'auditing',
  'repairing',
  'synthesising_audio',
  'publishing',
];

export const isActiveRunStatus = (status?: string | null): boolean =>
  ACTIVE_RUN_STATUSES.includes(status ?? '');

const RUN_TONE: Record<string, string> = {
  complete: 'pill--ok',
  partial: 'pill--warn',
  failed: 'pill--error',
};

/** Step state → chip tone and label (the spec's queued/running/succeeded/failed). */
const STEP_CHIP: Record<string, string> = {
  pending: 'progress-chip--queued',
  running: 'progress-chip--running',
  succeeded: 'progress-chip--succeeded',
  failed: 'progress-chip--failed',
};

const STEP_LABELS: Record<string, string> = {
  pending: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
};

export function GenerationProgress({
  run,
  steps,
  findingsCount,
  sourcesHref,
}: {
  readonly run?: GenerationProgressRun;
  readonly steps: readonly GenerationProgressStep[];
  readonly findingsCount: number;
  /** Where the learner goes to add the material the pipeline builds from. */
  readonly sourcesHref: string;
}) {
  if (!run) {
    return (
      <section className="card progress-card" aria-labelledby="progress-heading">
        <div className="progress-card__head">
          <h2 id="progress-heading">Compile progress</h2>
        </div>
        <EmptyState
          title="Not compiled yet."
          body="Add sources and compile the gap — the pipeline steps appear here as they run."
          action={
            <Link href={sourcesHref} className="btn">
              Add sources
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section className="card progress-card" aria-labelledby="progress-heading">
      <div className="progress-card__head">
        <h2 id="progress-heading">Compile progress</h2>
        <span className={`pill ${RUN_TONE[run.status] ?? ''}`}>{run.status}</span>
      </div>

      <p className="progress-phase" role="status">
        {PHASE_LABELS[run.status] ?? run.status}
      </p>

      {steps.length === 0 ? (
        <p className="muted">No steps recorded yet — the pipeline is warming up.</p>
      ) : (
        <ol className="progress-steps">
          {steps.map((step) => (
            <li key={`${step.step}-${step.attempt}`} className="progress-step">
              <span className="progress-step__name">{step.step}</span>
              <span className={`progress-chip ${STEP_CHIP[step.state] ?? ''}`}>
                {STEP_LABELS[step.state] ?? step.state}
              </span>
            </li>
          ))}
        </ol>
      )}

      {findingsCount > 0 && (
        <p className="muted">
          {findingsCount} audit finding{findingsCount === 1 ? '' : 's'} — see the review queue.
        </p>
      )}

      <details className="progress-debug">
        <summary>Debug log</summary>
        <ul className="log">
          {steps.map((step) => (
            <li key={`${step.step}-${step.attempt}`} className="log-line">
              <span className="log-line__step">{step.step}</span>
              <span
                className={
                  step.error ? 'log-line__state log-line__state--error' : 'log-line__state'
                }
              >
                {step.state}
                {step.attempt > 1 ? ` (attempt ${step.attempt})` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
