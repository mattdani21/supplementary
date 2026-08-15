/**
 * Per-step reasoning effort (E24 T051/T052).
 *
 * DeepSeek v4 models take a per-call `reasoning_effort` ('low' | 'medium' | 'high'). The
 * pipeline's contract-first steps — normalise_gap, audit_claims, diagnose (and the
 * independent-solutions verifier, which is also a contract step) — need direct, compliant
 * output, so they run at 'low' and their reasoning cannot eat the shared max_tokens budget.
 * The lesson generator benefits from deeper reasoning, so it runs at 'high' with the larger
 * output budget (32768) so reasoning AND content both fit. The planner (plan_curriculum) is
 * a reasoning task: at 'low' the live hit-rate run measured 0/9 (T052) — it stopped reasoning
 * about the learner's knowledge and fabricated external prerequisites, with zero recorded
 * invariant rejections — so it runs at 'medium'.
 *
 * This test reads the raw requests the pipeline actually sends for each contract (through the
 * guarded adapter into a recording fake backend) and asserts the wiring: 'low' on the
 * contract-first steps, 'medium' on plan_curriculum, 'high' on lesson generation, and the
 * per-step budgets (plan 16384, lesson 32768).
 */

import { describe, expect, it } from 'vitest';
import type { OwnerId } from '@gapos/database';
import { fixtureById } from '@gapos/evaluation';
import type { ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';
import { buildRecordingContext } from './recording-provider.js';

const OWNER: OwnerId = 'user_reasoning_effort';

/** Compile the eval_01 reference gap end-to-end against the recording fake. */
const compileEvalOne = async (context: ServerContext, key: string): Promise<void> => {
  await context.uow.users.create({
    id: OWNER,
    email: 'reasoning-effort@example.com',
    locale: 'en',
    timezone: 'UTC',
  });

  const fixture = fixtureById('eval_01_set_operations')!;
  const gap = await createGap(context, OWNER, {
    title: fixture.title,
    rawStatement: fixture.learnerStatement,
    dailyMinutes: fixture.dailyMinutes,
  });
  if (fixture.source) {
    await registerSource(context, OWNER, {
      gapId: gap.id,
      filename: fixture.source.filename,
      mediaType: fixture.source.mediaType,
      text: fixture.source.text,
    });
  }
  await applyTransition(context, OWNER, gap.id, { type: 'define' });
  const outcome = await compile(context, OWNER, { gapId: gap.id, idempotencyKey: key });
  expect(outcome.status, outcome.error ?? 'compile completes').toBe('complete');
};

/**
 * The contract-first steps whose output must be direct and compliant: their reasoning must
 * never consume the shared max_tokens budget at the expense of the JSON. (T051 names
 * normalise_gap, audit_claims and diagnose; verify_artefact is the same family —
 * independent solutions for a verification contract. plan_curriculum is deliberately absent:
 * T052 raises it to 'medium', tested separately.)
 */
const CONTRACT_STEPS = [
  'gap_normalisation',
  'diagnostic_interpretation',
  'verification_report',
  'claim_audit',
] as const;

describe('per-step reasoning effort (E24 T051/T052)', () => {
  it('runs every contract-first step at low reasoning effort', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't052-contract-low');

    for (const contractName of CONTRACT_STEPS) {
      const requests = calls.filter((c) => c.contractName === contractName);
      expect(requests.length, `${contractName} ran at least once`).toBeGreaterThan(0);
      for (const request of requests) {
        expect(request.reasoningEffort, `${contractName} runs at low effort`).toBe('low');
      }
    }
  });

  it('runs plan_curriculum at medium reasoning effort', async () => {
    // T052: the planner is a reasoning task, not a direct extraction. At 'low' the live
    // hit-rate run measured 0/9 — the planner stopped reasoning about the learner's
    // knowledge and fabricated external prerequisites ("assumes X, which the learner has
    // not been shown to hold"), with zero recorded invariant rejections.
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't052-plan-medium');

    const planRequests = calls.filter((c) => c.contractName === 'curriculum_plan');
    expect(planRequests.length, 'the planner ran at least once').toBeGreaterThan(0);
    for (const request of planRequests) {
      expect(request.reasoningEffort, 'plan_curriculum runs at medium effort').toBe('medium');
    }

    // The budget is unchanged: medium effort still leaves room in 16384 for the plan JSON
    // (only the lesson generator needs 32768 for high-effort reasoning + content).
    expect(planRequests[0]!.maxOutputTokens).toBe(16384);
  });

  it('runs lesson generation at high reasoning effort with the larger budget', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't052-lesson-high');

    const lessonRequests = calls.filter((c) => c.contractName === 'lesson_package');
    expect(lessonRequests.length, 'the run generated at least one lesson').toBeGreaterThan(0);
    for (const request of lessonRequests) {
      expect(request.reasoningEffort, 'lesson generation runs at high effort').toBe('high');
    }

    // The budgets follow the effort: the plan step stays at 16384 with 'low'; the lesson
    // generator gets 32768 so high-effort reasoning + content both fit.
    const planRequests = calls.filter((c) => c.contractName === 'curriculum_plan');
    expect(planRequests.length).toBeGreaterThan(0);
    expect(planRequests[0]!.maxOutputTokens).toBe(16384);
    expect(lessonRequests[0]!.maxOutputTokens).toBe(32768);
  });
});
