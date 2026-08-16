/**
 * Failed-compile surfacing (E27/GAP-089 follow-up): a gap whose latest run failed but
 * that never produced a curriculum must still surface the failure through generationLog,
 * so the course-progress card can explain it instead of showing a blank 0/0 days.
 */

import { describe, expect, it } from 'vitest';
import { createServerContext } from '../../apps/web/src/server/context';
import { generationLog } from '../../apps/web/src/server/api';
import { createGap } from '../../apps/web/src/server/services/gap-service';

const OWNER = 'user_failed_run_test' as const;

const context = async () => {
  const ctx = createServerContext({ logLevel: 'error' });
  await ctx.uow.users.create({
    id: OWNER,
    email: 'failed-run@example.com',
    locale: 'en',
    timezone: 'UTC',
  });
  return ctx;
};

describe('generationLog on a gap with no curriculum', () => {
  it('falls back to the latest run so a failed compile is not blank', async () => {
    const ctx = await context();
    const gap = await createGap(ctx, OWNER, {
      title: 'Failed gap',
      rawStatement: 'Learn something that failed.',
      dailyMinutes: 20,
    });

    // The failed run exists but no curriculum was ever created (the planner rejected the plan).
    await ctx.uow.generation.startRun(OWNER, {
      id: 'run_failed_no_curriculum',
      gapId: gap.id,
      pipelineVersion: 'test',
      status: 'failed',
      idempotencyKey: 'failed-run-key',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      costMillicents: 12,
    });
    await ctx.uow.generation.setRunStatus(
      OWNER,
      'run_failed_no_curriculum',
      'failed',
      'The planner could not produce a valid plan in 2 attempts.',
    );

    const { log } = await generationLog(ctx, OWNER, gap.id);
    expect(log.run?.status).toBe('failed');
    expect(log.run?.error).toContain('planner could not produce');
  });

  it('returns an empty log when there are no runs at all', async () => {
    const ctx = await context();
    const gap = await createGap(ctx, OWNER, {
      title: 'Fresh gap',
      rawStatement: 'Not compiled yet.',
      dailyMinutes: 20,
    });
    const { log } = await generationLog(ctx, OWNER, gap.id);
    expect(log.run).toBeUndefined();
    expect(log.steps).toEqual([]);
  });
});
