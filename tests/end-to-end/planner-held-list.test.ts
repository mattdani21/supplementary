/**
 * The `planCurriculum` instruction treats the learner's own stated current state as HELD
 * (E24 T053).
 *
 * T052 measured deepseek-v4-flash publishing 0 lessons: its planner listed the learner's OWN
 * normalisation currentState phrase ("Understands basic set notation: ...") as an external
 * prerequisite for every objective, and the held list (normalisation.assumedPrerequisites +
 * diagnostic.demonstratedCapabilities + mastery.satisfied) does not contain that phrase
 * verbatim, so the validation gate rejected every plan with prerequisite_unmet. The gate is
 * correct — a prerequisite that is not on the held list must not be assumed. The bug is the
 * planner instruction: checklist item (5) told the model to copy externalPrerequisites
 * VERBATIM from the held list but never told it that the learner's own stated current state
 * counts as held. The learner's own words are a self-reported baseline, not an unmet
 * prerequisite.
 *
 * This test reads the instruction the pipeline actually sends for the `curriculum_plan`
 * contract (through the guarded adapter into a recording fake backend) and asserts the
 * instruction carries the held-list guidance: the learner's own current-state capabilities
 * are HELD, they may be reworded inside the plan, they must never be listed as unmet
 * prerequisites, and genuinely unmet external prerequisites are still rejected (the VERBATIM
 * copy rule stays).
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

const OWNER: OwnerId = 'user_planner_held_list';

/** Compile the eval_01 reference gap end-to-end against the recording fake. */
const compileEvalOne = async (context: ServerContext, key: string): Promise<void> => {
  await context.uow.users.create({
    id: OWNER,
    email: 'planner-held-list@example.com',
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

const firstPlanInstruction = (calls: readonly unknown[]): string => {
  const planCalls = calls.filter(
    (c) => (c as { contractName?: string }).contractName === 'curriculum_plan',
  );
  expect(planCalls.length, 'the planner ran at least once').toBeGreaterThan(0);
  return (planCalls[0] as { instruction: string }).instruction;
};

describe("the planCurriculum instruction treats the learner's own stated current state as HELD (E24 T053)", () => {
  it("tells the planner the learner's own normalisation current-state capabilities are held", async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't053-current-state-held');

    const instruction = firstPlanInstruction(calls);
    // The learner's own current state must be framed as a self-reported baseline that counts
    // as HELD — not as an unmet prerequisite the planner may invent. ("held" is the
    // discriminating word: the current text only says the learner is "assumed to already
    // hold" the VERBATIM list, never that the current state itself is held.)
    expect(instruction).toMatch(/current state/i);
    expect(instruction).toMatch(/self[- ]reported/i);
    expect(instruction).toMatch(/held/i);
  });

  it('allows the current-state capabilities to be reworded inside the plan', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't053-rewordable');

    const instruction = firstPlanInstruction(calls);
    // "may be reworded" is the new permission. The current text's "reword" is the opposite —
    // the VERBATIM rule forbids rewording the held list — so the assertion must pin the
    // permission, not the prohibition.
    expect(instruction).toMatch(/may (be )?reword(ed)?/i);
  });

  it("forbids listing the learner's own current-state capabilities as unmet prerequisites", async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't053-never-unmet');

    const instruction = firstPlanInstruction(calls);
    expect(instruction).toMatch(/never list/i);
    expect(instruction).toMatch(/unmet/i);
    expect(instruction).toMatch(/externalPrerequisites/i);
  });

  it('still rejects genuinely unmet external prerequisites: the VERBATIM copy rule survives', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't053-verbatim-survives');

    const instruction = firstPlanInstruction(calls);
    // The pre-existing gate guidance — copy externalPrerequisites VERBATIM from the held list,
    // never invent — must remain in force for genuinely unmet prerequisites.
    expect(instruction).toMatch(/copy externalPrerequisites VERBATIM/i);
    expect(instruction).toMatch(/never invent/i);
  });
});
