/**
 * GAPX-07 / GOAL M4: five named agent learners fill a gap on evidence.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import type { OwnerId } from '@gapos/database';
import { createServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';
import {
  runMasteryCheck,
  searchCapabilities,
  submitAttempt,
} from '../../apps/web/src/server/services/learning-service.js';

import { AGENT_LEARNERS } from '../../apps/web/src/server/pilot/agent-learners.js';

const OWNERS = AGENT_LEARNERS.map((agent) => agent.ownerId);

const fillGap = async (owner: OwnerId) => {
  let tick = 0;
  const context = createServerContext({
    now: () => new Date(Date.parse('2026-09-13T09:00:00Z') + ++tick * 1000),
    newId: (prefix) => `${owner}_${prefix}_${tick}`,
  });
  const gap = await createGap(context, owner, {
    title: `${owner} relations`,
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 35,
  });
  await registerSource(context, owner, {
    gapId: gap.id,
    filename: 'set-theory-primer.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  await applyTransition(context, owner, gap.id, { type: 'define' });
  const outcome = await compile(context, owner, {
    gapId: gap.id,
    idempotencyKey: `${owner}-compile`,
  });
  expect(outcome.status).toBe('complete');

  for (const session of ['session_1', 'session_2'] as const) {
    if (session === 'session_2') tick += 200_000;
    for (const day of outcome.days) {
      for (const question of await context.uow.curricula.listQuestions(owner, day.lessonId)) {
        await submitAttempt(context, owner, gap.id, {
          questionId: question.id,
          sessionId: session,
          response: question.payload.answer,
          idempotencyKey: `${owner}_${session}_${question.id}`,
        });
      }
    }
  }

  const result = await runMasteryCheck(context, owner, gap.id);
  expect(result.filled).toBe(true);
  context.metrics.increment('pilot_learner_filled_total', { owner });
  return { context, gapId: gap.id };
};

describe('GOAL M4 five-learner rehearsal', () => {
  it('fills five isolated gaps with no cross-tenant capability leakage', async () => {
    const filled = [];
    for (const owner of OWNERS) {
      filled.push(await fillGap(owner));
    }
    expect(filled).toHaveLength(5);

    for (const [index, owner] of OWNERS.entries()) {
      const { context, gapId } = filled[index]!;
      const mine = await searchCapabilities(context, owner);
      expect(mine.map((item) => item.gapId)).toEqual([gapId]);
      for (const other of filled.filter((_, otherIndex) => otherIndex !== index)) {
        expect(await searchCapabilities(context, owner, other.gapId)).toEqual([]);
        expect(await context.uow.gaps.get(owner, other.gapId)).toBeUndefined();
      }
    }
  });
});
