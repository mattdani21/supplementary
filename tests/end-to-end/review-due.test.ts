/**
 * The review-due list is driven by the learner's mastery evidence (E24 US4, T046 — FR-020).
 *
 * `derivePlanInputs` already renders `mastery.reviewDue` into the planner brief as
 * "Due for review: … Schedule review.", but the compile threading hardcoded `reviewDue: []`, so
 * review was never scheduled inside a new curriculum. This test proves the threading:
 *
 *   - when the learner has evidence records behind a prior (filled) curriculum whose most recent
 *     record on an objective scores below the mastery threshold, the `plan_curriculum`
 *     instruction the pipeline sends carries the review-due line for that capability;
 *   - when there is no evidence, the list stays empty and no review-due line appears;
 *   - the pure rule (`reviewDueFromPriorCurricula`) is pinned exactly: an objective is due when
 *     its most recent evidence is below the threshold, never when every recent record clears it.
 *
 * The assertions read the instruction through the guarded adapter into a recording fake
 * backend, so they exercise the real compile threading, not a copy of it.
 */

import { describe, expect, it } from 'vitest';
import type { MasteryEvidenceRecord, OwnerId } from '@gapos/database';
import { fixtureById } from '@gapos/evaluation';
import { referencePlan } from '@gapos/test-fixtures';
import { reviewDueFromPriorCurricula } from '../../apps/worker/src/pipeline/compile.js';
import type { ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';
import { buildRecordingContext } from './recording-provider.js';

const DOUBLE_INCLUSION = 'Prove a set equality by double inclusion.';

const evidenceRecord = (
  over: Partial<Omit<MasteryEvidenceRecord, 'ownerId'>> = {},
): Omit<MasteryEvidenceRecord, 'ownerId'> => ({
  id: 'evidence_1',
  objectiveId: 'obj_double_inclusion',
  curriculumId: 'cur_prior_filled',
  sessionId: 'session_prior',
  evidenceType: 'retrieval',
  score: 0.9,
  independent: true,
  difficulty: 2,
  recordedAt: new Date('2026-08-13T10:00:00Z'),
  ...over,
});

/**
 * Seed the learner with a filled gap whose prior curriculum carries evidence on double
 * inclusion (the reference plan's `obj_double_inclusion`), then compile a new eval_01 gap.
 */
const compileAfterSeedingPriorEvidence = async (params: {
  owner: OwnerId;
  key: string;
  evidence: readonly Omit<MasteryEvidenceRecord, 'ownerId'>[];
}): Promise<{ context: ServerContext; calls: readonly unknown[] }> => {
  const { owner, key, evidence } = params;
  const { context, calls } = buildRecordingContext();
  const at = context.now();

  await context.uow.users.create({
    id: owner,
    email: `${owner}@example.com`,
    locale: 'en',
    timezone: 'UTC',
  });

  const filledGap = await context.uow.gaps.create(owner, {
    id: 'gap_prior_filled',
    title: 'Previously filled gap',
    targetCapability: DOUBLE_INCLUSION,
    rawStatement: 'Previously filled gap.',
    dailyMinutes: 35,
    sourcePolicy: 'general_knowledge_allowed',
    status: 'filled',
    assumptions: [],
    createdAt: at,
    updatedAt: at,
  });
  const plan = referencePlan('gap_prior_filled');
  await context.uow.curricula.create(owner, {
    id: 'cur_prior_filled',
    gapId: filledGap.id,
    runId: 'run_prior_filled',
    version: 1,
    durationDays: plan.days.length,
    dailyMinutes: plan.dailyMinutes,
    status: 'published',
    plan,
    createdAt: at,
  });
  for (const record of evidence) {
    await context.uow.mastery.addEvidence(owner, record);
  }

  const fixture = fixtureById('eval_01_set_operations')!;
  const gap = await createGap(context, owner, {
    title: fixture.title,
    rawStatement: fixture.learnerStatement,
    dailyMinutes: fixture.dailyMinutes,
  });
  if (fixture.source) {
    await registerSource(context, owner, {
      gapId: gap.id,
      filename: fixture.source.filename,
      mediaType: fixture.source.mediaType,
      text: fixture.source.text,
    });
  }
  await applyTransition(context, owner, gap.id, { type: 'define' });
  const outcome = await compile(context, owner, { gapId: gap.id, idempotencyKey: key });
  expect(outcome.status, outcome.error ?? 'compile completes').toBe('complete');
  return { context, calls };
};

const planInstruction = (calls: readonly unknown[]): string => {
  const planCalls = calls.filter(
    (c) => (c as { contractName?: string }).contractName === 'curriculum_plan',
  );
  expect(planCalls.length, 'the run produced a planner call').toBeGreaterThan(0);
  return (planCalls[0] as { instruction: string }).instruction;
};

describe('reviewDue is computed from mastery evidence (E24 T046, FR-020)', () => {
  it('schedules review in the new curriculum when evidence shows a weak recent record', async () => {
    const owner: OwnerId = 'user_review_due';
    const { calls } = await compileAfterSeedingPriorEvidence({
      owner,
      key: 't046-review-due',
      evidence: [
        evidenceRecord({
          id: 'evidence_strong',
          score: 0.95,
          recordedAt: new Date('2026-07-01T10:00:00Z'),
        }),
        // The most recent record on the objective is below the mastery threshold.
        evidenceRecord({
          id: 'evidence_weak',
          score: 0.4,
          recordedAt: new Date('2026-08-13T10:00:00Z'),
        }),
      ],
    });

    const instruction = planInstruction(calls);
    expect(instruction).toContain(`Due for review: ${DOUBLE_INCLUSION}. Schedule review.`);

    // The capability is also still held (fill-time classification), so it is not retaught —
    // review is additive, never a reteach.
    expect(instruction).toContain('Treat these as held');
  });

  it('keeps reviewDue empty when no evidence exists', async () => {
    const owner: OwnerId = 'user_review_due_none';
    const { calls } = await compileAfterSeedingPriorEvidence({
      owner,
      key: 't046-no-evidence',
      evidence: [],
    });

    const instruction = planInstruction(calls);
    expect(instruction).not.toContain('Due for review');
  });
});

describe('reviewDueFromPriorCurricula (the FR-020 rule)', () => {
  const objectives = [
    { id: 'o1', capabilityStatement: DOUBLE_INCLUSION },
    { id: 'o2', capabilityStatement: 'Prove subset by arbitrary element.' },
  ] as const;

  it('flags an objective whose most recent evidence is below the mastery threshold', () => {
    const due = reviewDueFromPriorCurricula({
      curricula: [
        {
          objectives,
          evidence: [
            evidenceRecord({
              objectiveId: 'o1',
              score: 0.95,
              recordedAt: new Date('2026-07-01T10:00:00Z'),
            }),
            evidenceRecord({
              objectiveId: 'o1',
              score: 0.4,
              recordedAt: new Date('2026-08-13T10:00:00Z'),
            }),
            evidenceRecord({
              objectiveId: 'o2',
              score: 0.9,
              recordedAt: new Date('2026-08-13T10:00:00Z'),
            }),
          ],
        },
      ],
    });
    expect(due).toEqual([DOUBLE_INCLUSION]);
  });

  it('stays empty when every most-recent record clears the threshold', () => {
    const due = reviewDueFromPriorCurricula({
      curricula: [
        {
          objectives,
          evidence: [
            evidenceRecord({
              objectiveId: 'o1',
              score: 0.95,
              recordedAt: new Date('2026-08-13T10:00:00Z'),
            }),
            evidenceRecord({
              objectiveId: 'o2',
              score: 0.9,
              recordedAt: new Date('2026-08-13T10:00:00Z'),
            }),
          ],
        },
      ],
    });
    expect(due).toEqual([]);
  });

  it('stays empty when there is no evidence at all', () => {
    expect(reviewDueFromPriorCurricula({ curricula: [{ objectives, evidence: [] }] })).toEqual([]);
  });

  it('ignores objectives that have no evidence records', () => {
    const due = reviewDueFromPriorCurricula({
      curricula: [
        {
          objectives,
          evidence: [
            evidenceRecord({
              objectiveId: 'o1',
              score: 0.4,
              recordedAt: new Date('2026-08-13T10:00:00Z'),
            }),
          ],
        },
      ],
    });
    // o2 has no evidence: it is not called in for review.
    expect(due).toEqual([DOUBLE_INCLUSION]);
  });

  it('dedupes a capability repeated across prior curricula', () => {
    const due = reviewDueFromPriorCurricula({
      curricula: [
        {
          objectives,
          evidence: [
            evidenceRecord({
              objectiveId: 'o1',
              score: 0.4,
              recordedAt: new Date('2026-08-13T10:00:00Z'),
            }),
          ],
        },
        {
          objectives,
          evidence: [
            evidenceRecord({
              objectiveId: 'o1',
              score: 0.3,
              recordedAt: new Date('2026-08-14T10:00:00Z'),
            }),
          ],
        },
      ],
    });
    expect(due).toEqual([DOUBLE_INCLUSION]);
  });
});
