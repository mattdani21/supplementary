/**
 * Next-lesson flow (E26 / GAP-087): the study page can advance to the next published
 * lesson after the current one; the last lesson has no next.
 */

import { describe, expect, it } from 'vitest';
import { referenceLesson } from '@gapos/test-fixtures';
import { createServerContext } from '../../apps/web/src/server/context';
import { nextLesson } from '../../apps/web/src/server/api';
import { createGap } from '../../apps/web/src/server/services/gap-service';

const OWNER = 'user_next_test' as const;

const context = async () => {
  const ctx = createServerContext({ logLevel: 'error' });
  await ctx.uow.users.create({
    id: OWNER,
    email: 'next@example.com',
    locale: 'en',
    timezone: 'UTC',
  });
  return ctx;
};

const seedCurriculum = async (ctx: Awaited<ReturnType<typeof context>>, gapId: string) => {
  await createGap(ctx, OWNER, {
    id: gapId,
    title: 'Relations and proof techniques',
    rawStatement: 'I understand basic set notation but need relations and proof techniques.',
    dailyMinutes: 35,
  });
  await ctx.uow.curricula.create(OWNER, {
    id: `cur_${gapId}`,
    gapId,
    runId: `run_${gapId}`,
    version: 1,
    durationDays: 3,
    dailyMinutes: 35,
    status: 'published',
    plan: {
      schemaVersion: '1.0.0',
      gapId,
      dailyMinutes: 35,
      objectives: [],
      days: [],
      assessmentBlueprint: [],
      glossary: [],
      exclusions: [],
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  for (let day = 1; day <= 3; day += 1) {
    const lesson = referenceLesson(day);
    await ctx.uow.curricula.upsertLesson(OWNER, {
      id: `lesson_${gapId}_day${day}`,
      curriculumId: `cur_${gapId}`,
      day,
      ordinal: 0,
      title: lesson.title,
      estimatedMinutes: lesson.estimatedMinutes,
      objectiveIds: [...lesson.objectiveIds],
      package: lesson,
      version: 1,
      publicationStatus: day === 2 ? 'excluded' : 'published',
    });
  }
};

describe('nextLesson', () => {
  it('returns the next published lesson after the current one', async () => {
    const ctx = await context();
    await seedCurriculum(ctx, 'gap_next');
    const { next } = await nextLesson(ctx, OWNER, 'gap_next', 'lesson_gap_next_day1');
    expect(next?.day).toBe(3); // day 2 is excluded
    expect(next?.lessonId).toBe('lesson_gap_next_day3');
  });

  it('returns undefined on the last lesson', async () => {
    const ctx = await context();
    await seedCurriculum(ctx, 'gap_next2');
    const { next } = await nextLesson(ctx, OWNER, 'gap_next2', 'lesson_gap_next2_day3');
    expect(next).toBeUndefined();
  });

  it('returns undefined for a gap with no curriculum', async () => {
    const ctx = await context();
    const { next } = await nextLesson(ctx, OWNER, 'gap_missing', 'lesson_x');
    expect(next).toBeUndefined();
  });
});
