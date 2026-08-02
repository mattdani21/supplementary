/**
 * Regression comparison.
 *
 * A score that is merely "good" is not enough: the gate has to notice the day a score slips. The
 * baseline records what each fixture scored when it was last accepted, and a run that falls more
 * than the tolerance below it fails, even if it still clears the floor.
 *
 * An improvement is reported too, and is a prompt to update the baseline rather than a failure.
 */

import { REGRESSION_TOLERANCE, type ScoreDimension } from './fixture.js';
import type { Scorecard } from './scorer.js';

export interface Baseline {
  readonly fixtureId: string;
  readonly overall: number;
  readonly dimensions: Readonly<Partial<Record<ScoreDimension, number>>>;
  readonly recordedAt: string;
}

export type RegressionVerdict =
  | { status: 'no_baseline'; fixtureId: string }
  | { status: 'stable'; fixtureId: string; delta: number }
  | { status: 'improved'; fixtureId: string; delta: number; dimensions: readonly string[] }
  | {
      status: 'regressed';
      fixtureId: string;
      delta: number;
      dimensions: readonly { dimension: ScoreDimension; from: number; to: number }[];
    };

export const compareToBaseline = (
  scorecard: Scorecard,
  baseline: Baseline | undefined,
  tolerance = REGRESSION_TOLERANCE,
): RegressionVerdict => {
  if (!baseline) return { status: 'no_baseline', fixtureId: scorecard.fixtureId };

  const regressed: { dimension: ScoreDimension; from: number; to: number }[] = [];
  const improved: string[] = [];

  for (const [dimension, previous] of Object.entries(baseline.dimensions) as [
    ScoreDimension,
    number,
  ][]) {
    const current = scorecard.dimensions[dimension]?.score;
    if (current === undefined) continue;
    if (current < previous - tolerance) {
      regressed.push({ dimension, from: previous, to: current });
    } else if (current > previous + tolerance) {
      improved.push(dimension);
    }
  }

  const delta = Number((scorecard.overall - baseline.overall).toFixed(4));

  if (regressed.length > 0) {
    return { status: 'regressed', fixtureId: scorecard.fixtureId, delta, dimensions: regressed };
  }
  if (improved.length > 0) {
    return { status: 'improved', fixtureId: scorecard.fixtureId, delta, dimensions: improved };
  }
  return { status: 'stable', fixtureId: scorecard.fixtureId, delta };
};

export const toBaseline = (scorecard: Scorecard, at: Date): Baseline => ({
  fixtureId: scorecard.fixtureId,
  overall: scorecard.overall,
  dimensions: Object.fromEntries(
    Object.values(scorecard.dimensions).map((d) => [d.dimension, d.score]),
  ),
  recordedAt: at.toISOString(),
});

/** A human-readable report for a failing evaluation run. */
export const formatScorecard = (scorecard: Scorecard): string => {
  const lines = [
    `${scorecard.fixtureId}: ${scorecard.passed ? 'PASS' : 'FAIL'} (${scorecard.overall})`,
  ];
  for (const dimension of Object.values(scorecard.dimensions)) {
    const failed = scorecard.failures.includes(dimension.dimension);
    lines.push(`  ${failed ? '✗' : '·'} ${dimension.dimension}: ${dimension.score}`);
    for (const observation of dimension.observations) lines.push(`      ${observation}`);
  }
  return lines.join('\n');
};
