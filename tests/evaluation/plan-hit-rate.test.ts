/**
 * The first-attempt valid-plan rate (US3, E24).
 *
 * Reads the `plan_curriculum` generation step output — `{ plan, attempts }` (C-04) — recorded by
 * the real pipeline and asserts the reference pack's first planner attempt passes the full
 * validation gate. A bare-plan step output (old shape) counts as one attempt with no recorded
 * violations for backward-compatible resume reads; the harness in
 * `scripts/measure-plan-hit-rate.ts` reports the per-invariant breakdown.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { OwnerId } from '@gapos/database';
import { fixtureById } from '@gapos/evaluation';
import type { PlanCurriculumResult } from '../../apps/worker/src/pipeline/compile.js';
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
  });
});
