/**
 * Typed domain errors.
 *
 * Domain failures are values with a stable machine-readable code, not thrown strings. The API
 * layer maps `code` onto an HTTP status and returns it verbatim to the client, so these codes are
 * part of the public contract: renaming one is a breaking change.
 */

export type DomainErrorCode =
  | 'invalid_gap_transition'
  | 'invalid_generation_transition'
  | 'terminal_state'
  | 'mastery_evidence_insufficient'
  | 'plan_exceeds_time_budget'
  | 'objective_not_assessed'
  | 'objective_not_taught'
  | 'planning_failed'
  | 'prerequisite_cycle'
  | 'prerequisite_unmet'
  | 'unsupported_source'
  | 'artefact_frozen'
  | 'glossary_violation'
  | 'answer_leakage'
  | 'repair_attempts_exhausted'
  | 'budget_exceeded'
  | 'not_found'
  | 'forbidden';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const isDomainError = (value: unknown): value is DomainError => value instanceof DomainError;

/** A result that carries a typed failure instead of throwing. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = <T = never>(
  code: DomainErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): Result<T> => ({ ok: false, error: new DomainError(code, message, details) });

/** Unwrap a result, throwing the domain error. Use at boundaries, never inside domain logic. */
export const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw result.error;
  return result.value;
};
