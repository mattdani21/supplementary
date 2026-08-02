/**
 * The gap lifecycle.
 *
 * This is the only place a gap's status may change. Repositories persist whatever
 * `transitionGap` returns and never compute a status themselves — see AGENTS.md rule 4.
 *
 * The rule that matters most to the product: `filled` is reachable only from `mastery_check`,
 * and only when accompanied by mastery evidence. Consuming lessons can never fill a gap.
 */

import { err, ok, type Result } from '../errors.js';

export const GAP_STATUSES = [
  'draft',
  'ready',
  'compiling',
  'active',
  'mastery_check',
  'filled',
  'review_due',
  'archived',
  'failed',
] as const;

export type GapStatus = (typeof GAP_STATUSES)[number];

/** Statuses from which no further transition is permitted. */
export const TERMINAL_GAP_STATUSES = ['archived'] as const satisfies readonly GapStatus[];

export type GapTransition =
  | { type: 'define' }
  | { type: 'compile' }
  | { type: 'compilation_succeeded' }
  | { type: 'compilation_failed'; reason: string }
  | { type: 'retry_compilation' }
  | { type: 'request_mastery_check' }
  | { type: 'mastery_confirmed'; evidence: MasteryEvidenceSummary }
  | { type: 'mastery_rejected' }
  | { type: 'review_became_due' }
  | { type: 'review_completed' }
  | { type: 'reopen' }
  | { type: 'archive' };

/**
 * The evidence a `mastery_confirmed` transition must carry. The state machine does not compute
 * mastery — `packages/domain/src/mastery` does — but it refuses to record a filled gap that is
 * not backed by a completed evaluation of every required objective.
 */
export interface MasteryEvidenceSummary {
  readonly requiredObjectiveIds: readonly string[];
  readonly masteredObjectiveIds: readonly string[];
}

const ALLOWED: Readonly<Record<GapStatus, readonly GapTransition['type'][]>> = {
  draft: ['define', 'archive'],
  ready: ['compile', 'define', 'archive'],
  compiling: ['compilation_succeeded', 'compilation_failed', 'archive'],
  active: ['request_mastery_check', 'compile', 'archive'],
  mastery_check: ['mastery_confirmed', 'mastery_rejected', 'archive'],
  filled: ['review_became_due', 'reopen', 'archive'],
  review_due: ['review_completed', 'reopen', 'archive'],
  archived: [],
  failed: ['retry_compilation', 'define', 'archive'],
};

const TARGET: Readonly<Record<GapTransition['type'], GapStatus>> = {
  define: 'ready',
  compile: 'compiling',
  compilation_succeeded: 'active',
  compilation_failed: 'failed',
  retry_compilation: 'compiling',
  request_mastery_check: 'mastery_check',
  mastery_confirmed: 'filled',
  mastery_rejected: 'active',
  review_became_due: 'review_due',
  review_completed: 'filled',
  reopen: 'active',
  archive: 'archived',
};

export const isTerminalGapStatus = (status: GapStatus): boolean =>
  (TERMINAL_GAP_STATUSES as readonly GapStatus[]).includes(status);

export const permittedTransitions = (status: GapStatus): readonly GapTransition['type'][] =>
  ALLOWED[status];

/**
 * Apply a transition. Returns the next status, or a typed error explaining the refusal.
 *
 * Nothing here mutates. The caller persists the returned status inside the same transaction that
 * writes whatever caused the transition.
 */
export const transitionGap = (current: GapStatus, transition: GapTransition): Result<GapStatus> => {
  if (isTerminalGapStatus(current)) {
    return err('terminal_state', `Gap is ${current} and cannot transition further.`, {
      current,
      attempted: transition.type,
    });
  }

  if (!ALLOWED[current].includes(transition.type)) {
    return err(
      'invalid_gap_transition',
      `Cannot apply "${transition.type}" to a gap in "${current}".`,
      { current, attempted: transition.type, permitted: ALLOWED[current] },
    );
  }

  if (transition.type === 'mastery_confirmed') {
    const missing = transition.evidence.requiredObjectiveIds.filter(
      (id) => !transition.evidence.masteredObjectiveIds.includes(id),
    );
    if (missing.length > 0) {
      return err(
        'mastery_evidence_insufficient',
        'A gap cannot be filled while required objectives remain unmastered.',
        { unmasteredObjectiveIds: missing },
      );
    }
    if (transition.evidence.requiredObjectiveIds.length === 0) {
      return err(
        'mastery_evidence_insufficient',
        'A gap cannot be filled without at least one required objective.',
        {},
      );
    }
  }

  return ok(TARGET[transition.type]);
};
