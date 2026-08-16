/**
 * Export (E25 / GAP-086): the export handler returns the notebook (or transcript
 * fallback) as markdown plus the learner's pinned annotations. Uses the reference
 * lesson fixture so the package shape is the real one.
 */

import { describe, expect, it } from 'vitest';
import { referenceLesson } from '@gapos/test-fixtures';
import { createServerContext } from '../../apps/web/src/server/context';
import { exportLessonMarkdown, pinAnnotation } from '../../apps/web/src/server/api';
import { createGap } from '../../apps/web/src/server/services/gap-service';

const OWNER = 'user_export_test' as const;

const context = async () => {
  const ctx = createServerContext({ logLevel: 'error' });
  await ctx.uow.users.create({
    id: OWNER,
    email: 'export@example.com',
    locale: 'en',
    timezone: 'UTC',
  });
  return ctx;
};

const seedLesson = async (ctx: Awaited<ReturnType<typeof context>>, gapId: string) => {
  await createGap(ctx, OWNER, {
    id: gapId,
    title: 'Relations and proof techniques',
    rawStatement: 'I understand basic set notation but need relations and proof techniques.',
    dailyMinutes: 35,
  });
  const at = new Date('2026-01-01T00:00:00Z');
  await ctx.uow.curricula.create(OWNER, {
    id: `cur_${gapId}`,
    gapId,
    runId: `run_${gapId}`,
    version: 1,
    durationDays: 1,
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
    createdAt: at,
  });
  const lesson = referenceLesson(1);
  await ctx.uow.curricula.upsertLesson(OWNER, {
    id: `lesson_${gapId}`,
    curriculumId: `cur_${gapId}`,
    day: 1,
    ordinal: 0,
    title: lesson.title,
    estimatedMinutes: lesson.estimatedMinutes,
    objectiveIds: [...lesson.objectiveIds],
    package: lesson,
    version: 1,
    publicationStatus: 'published',
  });
};

describe('exportLessonMarkdown', () => {
  it('returns the lesson as markdown with a filename', async () => {
    const ctx = await context();
    await seedLesson(ctx, 'gap_export');
    const { markdown, filename } = await exportLessonMarkdown(
      ctx,
      OWNER,
      'gap_export',
      'lesson_gap_export',
    );
    expect(filename).toMatch(/\.md$/);
    expect(markdown).toContain('# ' + referenceLesson(1).title);
    expect(markdown).toContain(referenceLesson(1).transcript.slice(0, 40));
  });

  it('falls back to the transcript when the lesson has no notebook', async () => {
    const ctx = await context();
    await seedLesson(ctx, 'gap_export2');
    const lesson = referenceLesson(1);
    const noNotebook = { ...lesson, notebook: undefined as string | undefined };
    await ctx.uow.curricula.upsertLesson(OWNER, {
      id: 'lesson_gap_export2',
      curriculumId: 'cur_gap_export2',
      day: 1,
      ordinal: 0,
      title: noNotebook.title,
      estimatedMinutes: noNotebook.estimatedMinutes,
      objectiveIds: [...noNotebook.objectiveIds],
      package: noNotebook,
      version: 1,
      publicationStatus: 'published',
    });
    const { markdown } = await exportLessonMarkdown(
      ctx,
      OWNER,
      'gap_export2',
      'lesson_gap_export2',
    );
    expect(markdown).toContain(noNotebook.transcript.slice(0, 40));
  });

  it('appends pinned annotations to the export', async () => {
    const ctx = await context();
    await seedLesson(ctx, 'gap_export3');
    await pinAnnotation(ctx, OWNER, {
      lessonId: 'lesson_gap_export3',
      selection: 'variance',
      explanation: 'Spread of values.',
    });
    const { markdown } = await exportLessonMarkdown(
      ctx,
      OWNER,
      'gap_export3',
      'lesson_gap_export3',
    );
    expect(markdown).toContain('## Your notes');
    expect(markdown).toContain('variance');
    expect(markdown).toContain('Spread of values.');
  });
});
