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
  compileRaw,
  createEvalUser,
  createLiveEvalContext,
  createLiveEvalProviders,
  EVAL_OWNER,
} from '../tests/evaluation/live-helpers.js';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** The underspecified fixture must ask for clarification, never guess a curriculum. */
const CLARIFICATION_FIXTURE = 'eval_08_underspecified';
/** The adversarial fixture must surface its injection attempt as a recorded finding. */
const INJECTION_FIXTURE = 'eval_07_prompt_injection';

const main = async (): Promise<void> => {
  const context = createLiveEvalContext(createLiveEvalProviders());
  await createEvalUser(context);

  const liveFixtures = EVALUATION_FIXTURES.filter((f) => f.requiresLiveProvider);
  const baselines: Record<string, Baseline> = {};
  let failed = false;

  out(
    `Scoring ${liveFixtures.length} live fixtures (model: ${process.env.GAPOS_LLM_MODEL ?? 'deepseek-chat'}, budget ${process.env.GAPOS_BUDGET_PER_USER_DAILY_CENTS ?? 1000}c/day)...\n`,
  );

  for (const fixture of liveFixtures) {
    const outcome = await compileRaw(context, fixture, `eval_live_${fixture.id}`);

    if (fixture.id === CLARIFICATION_FIXTURE) {
      if (outcome.error === 'clarification_required') {
        out('eval_08_underspecified: PASS — clarification requested, no curriculum guessed');
      } else {
        out(
          `eval_08_underspecified: FAIL — expected clarification_required, got ${outcome.status}${outcome.error ? ` / ${outcome.error}` : ''}`,
        );
        failed = true;
      }
      out('');
      continue;
    }

    if (!outcome.curriculumId) {
      out(
        `${fixture.id}: FAIL — no curriculum (${outcome.status}${outcome.error ? ` / ${outcome.error}` : ''})`,
      );
      out('');
      failed = true;
      continue;
    }

    const curriculum = await context.uow.curricula.get(EVAL_OWNER, outcome.curriculumId);
    const lessons = await context.uow.curricula.listLessons(EVAL_OWNER, outcome.curriculumId);
    const scorecard = scoreCurriculum(fixture, {
      plan: curriculum!.plan,
      lessons: lessons.map((lesson) => lesson.package),
    });
    out(formatScorecard(scorecard));
    baselines[fixture.id] = toBaseline(scorecard, new Date());
    if (!scorecard.passed) failed = true;

    if (fixture.id === INJECTION_FIXTURE) {
      const findings = await context.uow.generation.listFindings(EVAL_OWNER, outcome.runId);
      const injection = findings.filter((f) => f.category === 'prompt_injection');
      if (injection.length === 0) {
        out('eval_07_prompt_injection: FAIL — no prompt_injection finding recorded');
        failed = true;
      } else {
        out(
          `eval_07_prompt_injection: PASS — injection recorded as a finding (${injection.length})`,
        );
      }
    }
    out('');
  }

  const record = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    baselines,
  };
  writeFileSync('tasks/evaluation-baselines.json', `${JSON.stringify(record, null, 2)}\n`);
  out(
    `Baselines written to tasks/evaluation-baselines.json (${Object.keys(baselines).length} fixtures scored; ${liveFixtures.length - Object.keys(baselines).length} without a scorecard).`,
  );

  process.exit(failed ? 1 : 0);
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
