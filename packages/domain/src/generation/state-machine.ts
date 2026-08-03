/**
 * The compilation pipeline lifecycle, and the idempotency keys that make retries safe.
 *
 * Two properties matter here:
 *
 *  1. A run has exactly one terminal outcome. Once complete, partial, failed or cancelled, no
 *     further transition is accepted — a late worker cannot resurrect a finished run.
 *  2. A step is identified by (run, step name, input version). Re-running a step with the same
 *     key must return the output that already exists rather than producing a second one. That is
 *     what stops a worker restart from duplicating lessons, audio, or provider charges.
 */

import { err, ok, type Result } from '../errors.js';

export const GENERATION_STATUSES = [
  'queued',
  'ingesting',
  'planning',
  'generating_lessons',
  'generating_assessment',
  'auditing',
  'repairing',
  'synthesising_audio',
  'publishing',
  'complete',
  'partial',
  'failed',
  'cancelled',
] as const;

export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const TERMINAL_GENERATION_STATUSES = [
  'complete',
  'partial',
  'failed',
  'cancelled',
] as const satisfies readonly GenerationStatus[];

export const isTerminalGenerationStatus = (status: GenerationStatus): boolean =>
  (TERMINAL_GENERATION_STATUSES as readonly GenerationStatus[]).includes(status);

/**
 * The forward path through the pipeline. `repairing` loops back to `auditing`, which is the only
 * cycle in the graph; `partial` is reachable only from `repairing` or `publishing`, because it
 * means "we published what survived", which cannot be known before those stages.
 */
const ALLOWED: Readonly<Record<GenerationStatus, readonly GenerationStatus[]>> = {
  queued: ['ingesting', 'failed', 'cancelled'],
  ingesting: ['planning', 'failed', 'cancelled'],
  planning: ['generating_lessons', 'failed', 'cancelled'],
  generating_lessons: ['generating_assessment', 'failed', 'cancelled'],
  generating_assessment: ['auditing', 'failed', 'cancelled'],
  auditing: ['repairing', 'synthesising_audio', 'failed', 'cancelled'],
  repairing: ['auditing', 'synthesising_audio', 'partial', 'failed', 'cancelled'],
  // Audio is allowed to fail into publishing: the text-only fallback keeps the curriculum.
  synthesising_audio: ['publishing', 'partial', 'failed', 'cancelled'],
  publishing: ['complete', 'partial', 'failed', 'cancelled'],
  complete: [],
  partial: [],
  failed: [],
  cancelled: [],
};

export const permittedGenerationTransitions = (
  status: GenerationStatus,
): readonly GenerationStatus[] => ALLOWED[status];

export const transitionGeneration = (
  current: GenerationStatus,
  next: GenerationStatus,
): Result<GenerationStatus> => {
  if (isTerminalGenerationStatus(current)) {
    return err('terminal_state', `Generation run is ${current}; it cannot transition again.`, {
      current,
      attempted: next,
    });
  }
  if (!ALLOWED[current].includes(next)) {
    return err(
      'invalid_generation_transition',
      `Cannot move a generation run from "${current}" to "${next}".`,
      { current, attempted: next, permitted: ALLOWED[current] },
    );
  }
  return ok(next);
};

/* ------------------------------------------------------------------ step idempotency */

export const GENERATION_STEPS = [
  'ingest_source',
  'embed_chunk',
  'embed_query',
  'normalise_gap',
  'interpret_diagnostic',
  'plan_curriculum',
  'generate_lesson',
  'generate_assessment',
  'verify_artefact',
  'repair_artefact',
  'synthesise_audio',
  'publish_day',
] as const;

export type GenerationStepName = (typeof GENERATION_STEPS)[number];

export interface StepIdentity {
  readonly runId: string;
  readonly step: GenerationStepName;
  /**
   * Distinguishes concurrent instances of the same step within a run — the day number for a
   * lesson, the artefact id for a verification. Empty for run-wide steps such as planning.
   */
  readonly subject?: string;
  /**
   * A hash of everything the step consumes. If the inputs change, the key changes, and the step
   * legitimately runs again to produce a new output version.
   */
  readonly inputVersion: string;
}

/**
 * A stable key for a unit of pipeline work. The worker writes this to the `generation_step`
 * table with a unique constraint, so two workers racing on the same step cannot both insert.
 */
export const stepKey = (identity: StepIdentity): string =>
  [identity.runId, identity.step, identity.subject ?? '-', identity.inputVersion].join(':');

export type StepState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface StepRecord<T> {
  readonly key: string;
  readonly state: StepState;
  readonly attempt: number;
  readonly output?: T;
  readonly error?: string;
}

export type StepDecision<T> =
  | { action: 'reuse'; output: T }
  | { action: 'run'; attempt: number }
  | { action: 'abandon'; reason: string };

export const MAX_STEP_ATTEMPTS = 3;

/**
 * Decide what to do with a step the worker has just picked up.
 *
 * `reuse` is the property that makes the pipeline restart-safe: a step that already succeeded
 * hands back its recorded output instead of calling a provider again.
 */
export const decideStep = <T>(record: StepRecord<T> | undefined): StepDecision<T> => {
  if (!record) return { action: 'run', attempt: 1 };

  if (record.state === 'succeeded') {
    if (record.output === undefined) {
      // A succeeded step with no output is a bookkeeping bug; re-running is safer than
      // publishing nothing, but it must be visible rather than silent.
      return { action: 'run', attempt: record.attempt + 1 };
    }
    return { action: 'reuse', output: record.output };
  }

  if (record.attempt >= MAX_STEP_ATTEMPTS) {
    return {
      action: 'abandon',
      reason: `Step exhausted ${MAX_STEP_ATTEMPTS} attempts: ${record.error ?? 'unknown error'}`,
    };
  }

  // `running` reaches here only when the previous lease expired, which means the worker holding
  // it is gone. Re-running is safe because the step's effects are keyed by the same identity.
  return { action: 'run', attempt: record.attempt + 1 };
};
