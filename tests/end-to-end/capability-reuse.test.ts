/**
 * GAP-013: capability reuse (E10).
 *
 * A filled gap is a reusable capability. When a new curriculum declares an external prerequisite
 * the learner has previously mastered — and the evidence is still strong — the plan is accepted
 * without reteaching it. Once the evidence has decayed below the reuse threshold, the prerequisite
 * is not assumed: the run fails rather than guessing, and the decayed capability is handed to the
 * diagnostic as material to re-demonstrate.
 *
 * The provider is scripted to be strict: the normalisation assumes nothing and the diagnostic
 * demonstrates nothing, while the plan still requires "set-builder notation" as an external
 * prerequisite. Only a prior mastered capability can satisfy it, so the compile succeeds
 * exclusively through the capability-reuse wiring (GAP-013), not through the provider's default
 * assumptions.
 */

import { describe, expect, it } from 'vitest';
import { referenceDiagnostic, referenceNormalisation, referencePlan } from '@gapos/test-fixtures';
import { classifyPriorCapabilities } from '@gapos/domain';
import type { OwnerId } from '@gapos/database';
import type { RawCompletionRequest } from '@gapos/provider-adapters';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
} from '../../apps/web/src/server/services/gap-service.js';

const LEARNER: OwnerId = 'user_learner';

const GAP_B_STATEMENT = 'I need to get faster at double inclusion proofs.';

/** The clock pattern from journey.test.ts: advances a second per read, settable. */
const steppingClock = (start = new Date('2026-01-01T00:00:00Z')) => {
  let current = start.getTime();
  return {
    now: () => new Date((current += 1000)),
    set: (date: Date) => {
      current = date.getTime();
    },
  };
};

const buildContext = (options: Parameters<typeof createServerContext>[0] = {}) => {
  const clock = steppingClock();
  let counter = 0;
  const context = createServerContext({
    now: clock.now,
    newId: (prefix) => `${prefix}_${++counter}`,
    ...options,
  });
  return { context, clock };
};

/** A provider set that assumes nothing: normalisation and diagnostic claim no capabilities. */
const strictScript = () => {
  let diagnosticMentionedDecayed = false;
  const script = {
    gap_normalisation: (request: RawCompletionRequest) =>
      request.instruction.includes(GAP_B_STATEMENT)
        ? {
            ...referenceNormalisation(),
            assumedPrerequisites: [] as string[],
            currentState: 'Not recently assessed.',
          }
        : referenceNormalisation(),
    diagnostic_interpretation: (request: RawCompletionRequest) => {
      if (request.instruction.includes('Not recently assessed')) {
        diagnosticMentionedDecayed = request.instruction.includes('set-builder notation');
        return {
          ...referenceDiagnostic(),
          demonstratedCapabilities: [] as string[],
          inferred: true,
        };
      }
      return referenceDiagnostic();
    },
    // The plan still requires 'set-builder notation' as an external prerequisite — the only
    // way it can validate is a prior mastered capability.
    curriculum_plan: () => referencePlan('gap_reuse'),
  };
  return { script, mentionedDecayed: () => diagnosticMentionedDecayed };
};

const seedLearner = async (context: ServerContext) => {
  await context.uow.users.create({
    id: LEARNER,
    email: `${LEARNER}@example.com`,
    locale: 'en',
    timezone: 'UTC',
  });
};

/** Seed a filled gap whose target capability is a reusable asset for later curricula. */
const seedFilledCapability = async (
  context: ServerContext,
  capabilityText: string,
  filledAt: Date,
) => {
  await context.uow.gaps.create(LEARNER, {
    id: context.newId('gap'),
    title: 'Previously filled gap',
    targetCapability: capabilityText,
    rawStatement: 'Previously filled gap.',
    dailyMinutes: 35,
    sourcePolicy: 'general_knowledge_allowed',
    status: 'filled',
    assumptions: [],
    createdAt: filledAt,
    updatedAt: filledAt,
  });
};

const compileNewGap = async (context: ServerContext, idempotencyKey: string) => {
  const gap = await createGap(context, LEARNER, {
    title: 'Double inclusion speed',
    rawStatement: GAP_B_STATEMENT,
    dailyMinutes: 35,
  });
  await applyTransition(context, LEARNER, gap.id, { type: 'define' });
  const outcome = await compile(context, LEARNER, { gapId: gap.id, idempotencyKey });
  return { gap, outcome };
};

describe('capability reuse (GAP-013)', () => {
  it('refuses a plan whose prerequisite no provider and no prior mastery has established', async () => {
    const strict = strictScript();
    const { context } = buildContext({ fake: { script: strict.script } });
    await seedLearner(context);

    const { outcome } = await compileNewGap(context, 'baseline-compile');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('set-builder notation');
  });

  it('satisfies a prerequisite from a prior mastered capability while the evidence is fresh', async () => {
    const strict = strictScript();
    const { context, clock } = buildContext({ fake: { script: strict.script } });
    await seedLearner(context);
    await seedFilledCapability(context, 'set-builder notation', clock.now());

    const { outcome } = await compileNewGap(context, 'reuse-compile');

    expect(outcome.status).toBe('complete');
    expect(outcome.error).toBeUndefined();
    // The diagnostic had nothing to re-demonstrate: the capability was still strong.
    expect(strict.mentionedDecayed()).toBe(false);
  });

  it('stops assuming a prerequisite once the prior evidence has decayed, and tells the diagnostic', async () => {
    const strict = strictScript();
    const { context, clock } = buildContext({ fake: { script: strict.script } });
    await seedLearner(context);
    // Filled in January…
    await seedFilledCapability(context, 'set-builder notation', clock.now());
    // …attempted again in July: 195 days past a 90-day half-life, well below the 0.6 threshold.
    clock.set(new Date('2026-07-15T00:00:00Z'));

    const { outcome } = await compileNewGap(context, 'decay-compile');

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('set-builder notation');
    // The decayed capability reached the diagnostic as material to re-demonstrate.
    expect(strict.mentionedDecayed()).toBe(true);
  });

  it('keeps a reinforced prior capability reusable past the bare half-life', async () => {
    // Not exercised through the pipeline (reinforcement counts come from the review ladder in
    // the domain); this pins the domain contract the pipeline relies on.
    const result = classifyPriorCapabilities(
      [
        {
          capabilityId: 'set-builder notation',
          masteredAt: new Date('2026-01-01T00:00:00Z'),
          reinforcements: 4,
        },
      ],
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(result.satisfied).toEqual(['set-builder notation']);
  });

  it('is scoped per learner: another learner’s filled gap never satisfies this learner', async () => {
    const strict = strictScript();
    const { context, clock } = buildContext({ fake: { script: strict.script } });
    await seedLearner(context);

    // Someone else's capability…
    await context.uow.users.create({
      id: 'user_other',
      email: 'user_other@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    await context.uow.gaps.create('user_other', {
      id: context.newId('gap'),
      title: 'Other learner',
      targetCapability: 'set-builder notation',
      rawStatement: 'Other learner gap.',
      dailyMinutes: 35,
      sourcePolicy: 'general_knowledge_allowed',
      status: 'filled',
      assumptions: [],
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });

    const { outcome } = await compileNewGap(context, 'tenant-compile');
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('set-builder notation');
  });
});
