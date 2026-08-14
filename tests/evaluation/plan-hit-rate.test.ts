/**
 * The first-attempt valid-plan rate (US3, E24 — T027).
 *
 * Reads the `plan_curriculum` generation step output — `{ plan, attempts }` (C-04) — recorded by
 * the real pipeline and asserts the reference pack's first planner attempt passes the full
 * validation gate. A bare-plan step output (old shape) counts as one attempt with no recorded
 * violations for backward-compatible resume reads; the harness in
 * `scripts/measure-plan-hit-rate.ts` reports the per-invariant breakdown, whose pure helpers
 * are locked here too (FR-012/FR-014).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { OwnerId } from '@gapos/database';
import { fixtureById } from '@gapos/evaluation';
import type { PlanAttempt, PlanCurriculumResult } from '../../apps/worker/src/pipeline/compile.js';
import {
  countViolationsByCode,
  formatHitRateReport,
  type CompileHit,
} from '../../scripts/measure-plan-hit-rate.js';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';

const LEARNER: OwnerId = 'user_hitrate';

describe('plan hit rate', () => {
  let context: ServerContext;
  let runId: string;

  beforeAll(async () => {
    let counter = 0;
    context = createServerContext({
      newId: (prefix) => `${prefix}_${++counter}`,
      logLevel: 'error',
    });
    await context.uow.users.create({
      id: LEARNER,
      email: 'hitrate@example.com',
      locale: 'en',
      timezone: 'UTC',
    });

    const fixture = fixtureById('eval_01_set_operations')!;
    const gap = await createGap(context, LEARNER, {
      title: fixture.title,
      rawStatement: fixture.learnerStatement,
      dailyMinutes: fixture.dailyMinutes,
    });
    if (fixture.source) {
      await registerSource(context, LEARNER, {
        gapId: gap.id,
        filename: fixture.source.filename,
        mediaType: fixture.source.mediaType,
        text: fixture.source.text,
      });
    }
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });
    const outcome = await compile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'hitrate_eval_01',
    });
    runId = outcome.runId;
  });

  it('records every planner call as an attempt in the plan_curriculum step output', async () => {
    const steps = await context.uow.generation.listSteps(LEARNER, runId);
    const planStep = steps.find((s) => s.step === 'plan_curriculum');
    expect(planStep, 'the plan_curriculum step is recorded').toBeDefined();
    const output = planStep!.output as PlanCurriculumResult;
    expect(output.attempts.length).toBeGreaterThanOrEqual(1);
    expect(output.attempts[0]!.attempt).toBe(1);
    expect(output.attempts[0]!.passed).toBe(true);
    // A passing first attempt carries no recorded violations and no codes.
    expect(output.attempts[0]!.violations).toEqual([]);
    expect(output.attempts[0]!.codes ?? []).toEqual([]);
  });
});

/**
 * The harness's per-invariant breakdown (T027/T029): rejections are countable per invariant so
 * the hit-rate diagnosis names the weakest invariant, and the report prints the share of
 * compiles whose first attempt passed plus the table.
 */
describe('the hit-rate breakdown names the weakest invariant (E24 US3, T027)', () => {
  it('counts rejections per invariant code across attempts', () => {
    const attempts: PlanAttempt[] = [
      {
        attempt: 1,
        violations: [
          'Day 1 needs 60 minutes but the learner has 35.',
          'Objective o2 has no entry in the assessment blueprint.',
        ],
        codes: ['plan_exceeds_time_budget', 'objective_not_assessed'],
        passed: false,
      },
      {
        attempt: 2,
        violations: ['Day 1 needs 60 minutes but the learner has 35.'],
        codes: ['plan_exceeds_time_budget'],
        passed: false,
      },
    ];
    const byCode = countViolationsByCode(attempts);
    expect(byCode.plan_exceeds_time_budget).toBe(2);
    expect(byCode.objective_not_assessed).toBe(1);
  });

  it('handles attempts recorded before codes existed (backward-compatible reads)', () => {
    const legacy: PlanAttempt[] = [
      { attempt: 1, violations: ['Day 1 needs 60 minutes but the learner has 35.'], passed: false },
    ];
    expect(countViolationsByCode(legacy)).toEqual({});
  });

  it('reports first-attempt valid X/Y (Z%) and the per-invariant table', () => {
    const hits: CompileHit[] = [
      {
        fixtureId: 'eval_01',
        firstAttemptPassed: true,
        attempts: [{ attempt: 1, violations: [], codes: [], passed: true }],
      },
      {
        fixtureId: 'eval_02',
        firstAttemptPassed: false,
        attempts: [
          {
            attempt: 1,
            violations: ['Day 1 needs 60 minutes but the learner has 35.'],
            codes: ['plan_exceeds_time_budget'],
            passed: false,
          },
        ],
      },
    ];
    const report = formatHitRateReport(hits);
    expect(report).toContain('first-attempt valid 1/2 (50%)');
    expect(report).toContain('plan_exceeds_time_budget: 1');
  });
});
