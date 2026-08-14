/**
 * The first-attempt valid-plan rate harness (US3, E24 — FR-012/FR-014/FR-022, SC-001/SC-008).
 *
 * Reads the `plan_curriculum` generation step output — `{ plan, attempts }` (C-04) — recorded by
 * the real pipeline and reports the share of compiles whose FIRST planner output passed the full
 * validation gate, plus the per-invariant breakdown of the rejections, so the weakest invariant
 * stays diagnosable.
 *
 * Usage:
 *
 *     pnpm tsx scripts/measure-plan-hit-rate.ts            # fake mode: compiles eval_01
 *     GAPOS_PROVIDER_MODE=live GAPOS_LLM_API_KEY=... \
 *       pnpm tsx scripts/measure-plan-hit-rate.ts          # live mode: all ten fixtures
 *
 * A compile that paused for a blocking clarification is excluded from the count (the spec's
 * "first attempt" excludes runs that paused; the underspecified fixture is the known case).
 * The output is the recorded evidence for the hit-rate claim (SC-008).
 */

import { pathToFileURL } from 'node:url';
import { EVALUATION_FIXTURES, fixtureById } from '@gapos/evaluation';
import type { OwnerId } from '@gapos/database';
import type { PlanAttempt, PlanCurriculumResult } from '../apps/worker/src/pipeline/compile.js';
import { createServerContext, type ServerContext } from '../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../apps/web/src/server/services/gap-service.js';
import {
  EVAL_OWNER,
  compileRaw,
  createEvalUser,
  createLiveEvalContext,
  createLiveEvalProviders,
} from '../tests/evaluation/live-helpers.js';

/** The underspecified fixture must clarify, not produce a plan — excluded from the count. */
const CLARIFICATION_FIXTURE = 'eval_08_underspecified';
const FAKE_OWNER: OwnerId = 'user_hitrate_measure';

export interface CompileHit {
  readonly fixtureId: string;
  readonly firstAttemptPassed: boolean;
  readonly attempts: readonly PlanAttempt[];
}

/**
 * Count rejections per invariant across every planner call in a run (FR-014). An attempt
 * recorded before `codes` existed contributes its messages only; a bare-plan step output (old
 * shape) counts as one attempt with no recorded violations.
 */
export const countViolationsByCode = (
  attempts: readonly PlanAttempt[],
): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const attempt of attempts) {
    for (const code of attempt.codes ?? []) {
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return counts;
};

/** The harness report: `first-attempt valid X/Y (Z%)` plus the per-invariant table. */
export const formatHitRateReport = (hits: readonly CompileHit[]): string => {
  const scored = hits.filter((hit) => hit.firstAttemptPassed);
  const lines = [
    `first-attempt valid ${scored.length}/${hits.length} ` +
      `(${Math.round((scored.length / Math.max(1, hits.length)) * 100)}%)`,
  ];

  const byCode = countViolationsByCode(hits.flatMap((hit) => hit.attempts));
  const codes = Object.keys(byCode);
  if (codes.length === 0) {
    lines.push('per-invariant rejections: none across all recorded attempts');
  } else {
    lines.push('per-invariant rejections:');
    for (const code of codes.sort()) {
      lines.push(`  ${code}: ${byCode[code]}`);
    }
  }
  return lines.join('\n');
};

/** Read the `plan_curriculum` step of a completed compile, defensively (old shape = 1 attempt). */
const planHitForRun = async (
  context: ServerContext,
  owner: OwnerId,
  fixtureId: string,
  runId: string,
): Promise<CompileHit> => {
  const planStep = (await context.uow.generation.listSteps(owner, runId)).find(
    (step) => step.step === 'plan_curriculum',
  );

  const output = planStep?.output as PlanCurriculumResult | undefined;
  const attempts: readonly PlanAttempt[] =
    output && Array.isArray(output.attempts) && output.attempts.length > 0
      ? output.attempts
      : [{ attempt: 1, violations: [], passed: true }];

  return { fixtureId, firstAttemptPassed: attempts[0]!.passed, attempts };
};

/** Fake mode: compile eval_01 through the deterministic fake provider. */
const measureFake = async (): Promise<readonly CompileHit[]> => {
  let counter = 0;
  const context = createServerContext({
    newId: (prefix) => `${prefix}_${++counter}`,
    logLevel: 'error',
  });
  await context.uow.users.create({
    id: FAKE_OWNER,
    email: 'hitrate-measure@example.com',
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
    idempotencyKey: 'measure_hit_rate_eval_01',
  });
  if (outcome.status === 'failed' || !outcome.runId) {
    throw new Error(`eval_01 compile failed: ${outcome.error ?? outcome.status}`);
  }
  return [await planHitForRun(context, FAKE_OWNER, fixture.id, outcome.runId)];
};

/** Live mode: compile every fixture that must produce a plan (paid run, human gate). */
const measureLive = async (): Promise<readonly CompileHit[]> => {
  const context = createLiveEvalContext(createLiveEvalProviders());
  await createEvalUser(context);

  const hits: CompileHit[] = [];
  for (const fixture of EVALUATION_FIXTURES) {
    if (fixture.id === CLARIFICATION_FIXTURE) continue;
    process.stdout.write(`compiling ${fixture.id}...\n`);
    const outcome = await compileRaw(context, fixture, `eval_hitrate_${fixture.id}`);
    if (outcome.status === 'failed') {
      process.stderr.write(
        `${fixture.id}: FAILED (${outcome.error ?? 'unknown'}) — counted as not first-attempt valid\n`,
      );
      hits.push({ fixtureId: fixture.id, firstAttemptPassed: false, attempts: [] });
      continue;
    }
    hits.push(await planHitForRun(context, EVAL_OWNER, fixture.id, outcome.runId));
  }
  return hits;
};

const main = async (): Promise<void> => {
  const live = process.env.GAPOS_PROVIDER_MODE === 'live';
  const hits = live ? await measureLive() : await measureFake();
  process.stdout.write(`${formatHitRateReport(hits)}\n`);
  if (live) {
    process.stdout.write(
      `live pack: ${hits.length} fixtures measured (excluded ${CLARIFICATION_FIXTURE}, which must clarify).\n`,
    );
  }
};

// Run only when executed directly, so tests can import the pure helpers.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `MEASURE FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
