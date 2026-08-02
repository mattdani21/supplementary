/**
 * The reference evaluation pack.
 *
 * Every other test in this repository asks "does the software work". These fixtures ask "does it
 * teach", which is a different question and the one the product actually lives or dies on. A
 * pipeline can be green on every unit test and still produce a curriculum that omits an
 * objective, cites nothing, leaks its answers, or ramps difficulty backwards.
 *
 * Each fixture declares what a good curriculum for it looks like *and* the specific ways a bad
 * one fails, so a regression names the pedagogical property it broke.
 */

export const EVALUATION_DOMAINS = [
  'mathematics',
  'programming',
  'professional_policy',
  'conceptual_theory',
  'source_heavy',
  'ambiguous_request',
  'adversarial',
] as const;

export type EvaluationDomain = (typeof EVALUATION_DOMAINS)[number];

/** Governs which latency budget from docs/ARCHITECTURE.md the fixture is measured against. */
export const LATENCY_CLASSES = ['single_day', 'standard_week', 'large_source_pack'] as const;
export type LatencyClass = (typeof LATENCY_CLASSES)[number];

export interface FailureTrap {
  /** What a careless generator is likely to do here. */
  readonly description: string;
  /** The scoring dimension that should catch it. */
  readonly caughtBy: ScoreDimension;
}

export interface EvaluationFixture {
  readonly id: string;
  readonly title: string;
  readonly domain: EvaluationDomain;
  readonly latencyClass: LatencyClass;
  readonly learnerStatement: string;
  readonly dailyMinutes: number;
  /** Copyright-safe source material written for this repository, or empty for general knowledge. */
  readonly source?: {
    readonly filename: string;
    readonly mediaType: string;
    readonly text: string;
  };
  /** Capability statements a correct curriculum must cover, matched loosely on keywords. */
  readonly expectedObjectiveKeywords: readonly (readonly string[])[];
  /** Content that must not appear: out of scope, or actively wrong for this learner. */
  readonly prohibitedContent: readonly string[];
  /** Questions a correct curriculum could plausibly ask, used as a sanity anchor. */
  readonly sampleValidQuestions: readonly string[];
  readonly failureTraps: readonly FailureTrap[];
  /** What an expert would look for, in prose. Read by humans reviewing a regression. */
  readonly expertRubric: string;
  /**
   * True when the fixture cannot be meaningfully scored against the deterministic fake provider,
   * because the fake returns the set-theory reference content regardless of the request. These
   * are declared, not skipped silently: see GAP-014b in tasks/backlog.yaml.
   */
  readonly requiresLiveProvider: boolean;
}

export const SCORE_DIMENSIONS = [
  'objective_coverage',
  'source_faithfulness',
  'factual_accuracy',
  'question_solvability',
  'difficulty_progression',
  'audio_suitability',
  'duration_accuracy',
  'duplicate_content',
  'answer_leakage',
  'scope_discipline',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/**
 * Minimum acceptable score per dimension. A dimension below its floor fails the evaluation gate.
 * These are deliberately not all 1.0: a curriculum may legitimately paraphrase a source, and
 * demanding perfection would make the gate noise rather than signal.
 */
export const SCORE_FLOORS: Readonly<Record<ScoreDimension, number>> = {
  objective_coverage: 1.0,
  source_faithfulness: 0.7,
  factual_accuracy: 1.0,
  question_solvability: 1.0,
  difficulty_progression: 0.75,
  audio_suitability: 0.8,
  duration_accuracy: 0.7,
  duplicate_content: 0.9,
  answer_leakage: 1.0,
  scope_discipline: 1.0,
};

/** How far a score may fall below a stored baseline before it counts as a regression. */
export const REGRESSION_TOLERANCE = 0.05;
