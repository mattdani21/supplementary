/**
 * Baseline recording for the evaluation gate (GAP-014b live; E24 US5/T037 fake).
 *
 * Two deliberate, review-gated flows — never silent:
 *
 *   - **Live** (paid run, human approval gate, AGENTS.md §5): score the nine
 *     `requiresLiveProvider` fixtures against a real model and store the baselines the live
 *     gate compares against. Since E24 US1 the scorer includes the `human_sounding` dimension,
 *     so recorded live baselines carry it automatically.
 *
 *         GAPOS_PROVIDER_MODE=live \
 *         GAPOS_LLM_API_KEY=sk-... \
 *         [GAPOS_LLM_MODEL=deepseek-chat] \
 *         pnpm tsx scripts/record-eval-baselines.ts
 *
 *   - **Fake** (deterministic, no paid resources): compile eval_01 through the fake provider
 *     and record its baseline, including `human_sounding`, so the on-every-verify gate
 *     (tests/evaluation/reference-pack.test.ts) has a stored comparison point.
 *
 *         pnpm tsx scripts/record-eval-baselines.ts --fake
 *
 * Existing baselines are preserved: each run updates only the fixtures it scored. Print the
 * command and its result in tasks/status.json with every recording (SC-008).
 */

import { readFileSync, writeFileSync } from 'node:fs';
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
import { createServerContext } from '../apps/web/src/server/context.js';
import type { OwnerId } from '@gapos/database';
import { fixtureById } from '@gapos/evaluation';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../apps/web/src/server/services/gap-service.js';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/** The underspecified fixture must ask for clarification, never guess a curriculum. */
const CLARIFICATION_FIXTURE = 'eval_08_underspecified';
/** The adversarial fixture must surface its injection attempt as a recorded finding. */
const INJECTION_FIXTURE = 'eval_07_prompt_injection';

const BASELINE_FILE = 'tasks/evaluation-baselines.json';

const loadExisting = (): Record<string, Baseline> => {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as {
      baselines: Record<string, Baseline>;
    };
    return parsed.baselines;
  } catch {
    return {};
  }
};

const writeBaselines = (baselines: Record<string, Baseline>): void => {
  const record = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    baselines,
  };
  writeFileSync(BASELINE_FILE, `${JSON.stringify(record, null, 2)}\n`);
  out(
    `Baselines written to ${BASELINE_FILE} (${Object.keys(baselines).length} fixtures with a scorecard).`,
  );
};

const recordLive = async (): Promise<number> => {
  const context = createLiveEvalContext(createLiveEvalProviders());
  await createEvalUser(context);

  const liveFixtures = EVALUATION_FIXTURES.filter((f) => f.requiresLiveProvider);
  const baselines = loadExisting();
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

  writeBaselines(baselines);
  return failed ? 1 : 0;
};

const recordFake = async (): Promise<number> => {
  const FAKE_OWNER: OwnerId = 'user_baseline_fake';
  let counter = 0;
  const context = createServerContext({
    newId: (prefix) => `${prefix}_${++counter}`,
    logLevel: 'error',
  });
  await context.uow.users.create({
    id: FAKE_OWNER,
    email: 'baseline-fake@example.com',
    locale: 'en',
    timezone: 'UTC',
  });

  const fixture = fixtureById('eval_01_set_operations')!;
  const gap = await createGap(context, FAKE_OWNER, {
    title: fixture.title,
    rawStatement: fixture.learnerStatement,
    dailyMinutes: fixture.dailyMinutes,
  });
  if (fixture.source) {
    await registerSource(context, FAKE_OWNER, {
      gapId: gap.id,
      filename: fixture.source.filename,
      mediaType: fixture.source.mediaType,
      text: fixture.source.text,
    });
  }
  await applyTransition(context, FAKE_OWNER, gap.id, { type: 'define' });
  const outcome = await compile(context, FAKE_OWNER, {
    gapId: gap.id,
    idempotencyKey: 'record_baseline_eval_01',
  });
  if (!outcome.curriculumId) {
    out(
      `eval_01: FAIL — no curriculum (${outcome.status}${outcome.error ? ` / ${outcome.error}` : ''})`,
    );
    return 1;
  }

  const curriculum = await context.uow.curricula.get(FAKE_OWNER, outcome.curriculumId);
  const lessons = await context.uow.curricula.listLessons(FAKE_OWNER, outcome.curriculumId);
  const scorecard = scoreCurriculum(fixture, {
    plan: curriculum!.plan,
    lessons: lessons.map((lesson) => lesson.package),
  });
  out(formatScorecard(scorecard));
  out(`eval_01 human_sounding: ${scorecard.dimensions.human_sounding.score}`);

  const baselines = loadExisting();
  baselines[fixture.id] = toBaseline(scorecard, new Date());
  writeBaselines(baselines);
  return scorecard.passed ? 0 : 1;
};

const main = async (): Promise<void> => {
  const fake = process.argv.includes('--fake');
  process.exit(fake ? await recordFake() : await recordLive());
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
