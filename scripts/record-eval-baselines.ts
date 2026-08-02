/**
 * GAP-014b recording run: score the nine live-provider fixtures against a real model and store
 * the baselines the gate compares against.
 *
 * This is a paid run and a human approval gate (AGENTS.md §5). Usage:
 *
 *     GAPOS_PROVIDER_MODE=live \
 *     GAPOS_LLM_API_KEY=sk-... \
 *     [GAPOS_LLM_MODEL=deepseek-chat] \
 *     [GAPOS_BUDGET_PER_RUN_CENTS=200 GAPOS_BUDGET_PER_USER_DAILY_CENTS=1000] \
 *     pnpm tsx scripts/record-eval-baselines.ts
 *
 * Prints a formatted scorecard per fixture and exits non-zero if any fixture fails its floors.
 * Baselines are written to tasks/evaluation-baselines.json and should be committed with the
 * run's evidence in tasks/status.json.
 */

import { writeFileSync } from 'node:fs';
import {
  EVALUATION_FIXTURES,
  formatScorecard,
  scoreCurriculum,
  toBaseline,
  type Baseline,
} from '@gapos/evaluation';
import {
  compileFixture,
  createEvalUser,
  createLiveEvalContext,
  createLiveEvalProviders,
} from '../tests/evaluation/live-helpers.js';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const main = async (): Promise<void> => {
  const context = createLiveEvalContext(createLiveEvalProviders());
  await createEvalUser(context);

  const liveFixtures = EVALUATION_FIXTURES.filter((f) => f.requiresLiveProvider);
  const baselines: Record<string, Baseline> = {};
  let failed = false;

  out(
    `Scoring ${liveFixtures.length} live fixtures (model: ${process.env.GAPOS_LLM_MODEL ?? 'deepseek-chat'})...\n`,
  );

  for (const fixture of liveFixtures) {
    const produced = await compileFixture(context, fixture.id);
    const scorecard = scoreCurriculum(fixture, produced);
    out(formatScorecard(scorecard));
    out('');
    baselines[fixture.id] = toBaseline(scorecard, new Date());
    if (!scorecard.passed) failed = true;
  }

  const record = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    baselines,
  };
  writeFileSync('tasks/evaluation-baselines.json', `${JSON.stringify(record, null, 2)}\n`);
  out(`Baselines written to tasks/evaluation-baselines.json (${liveFixtures.length} fixtures).`);

  process.exit(failed ? 1 : 0);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
