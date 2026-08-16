/**
 * Explain layer (E25 / GAP-085): the explain handler goes through the contract-validated
 * language model (fake provider in-process), and annotations persist per owner + lesson.
 */

import { describe, expect, it } from 'vitest';
import { createServerContext } from '../../apps/web/src/server/context';
import { explainSelection, listAnnotations, pinAnnotation } from '../../apps/web/src/server/api';

const OWNER = 'user_explain_test' as const;

const context = async () => {
  const ctx = createServerContext({ logLevel: 'error' });
  await ctx.uow.users.create({
    id: OWNER,
    email: 'explain@example.com',
    locale: 'en',
    timezone: 'UTC',
  });
  return ctx;
};

describe('explainSelection', () => {
  it('returns a contract-validated explanation for a selection', async () => {
    const ctx = await context();
    const result = await explainSelection(ctx, OWNER, 'gap_1', {
      lessonId: 'lesson_1',
      selection: 'scaled dot-product attention',
      context: 'The attention scores are divided by the square root of the key dimension.',
    });
    expect(result.explanation.selection).toBe('scaled dot-product attention');
    expect(result.explanation.explanation.length).toBeGreaterThan(10);
  });

  it('rejects an empty selection', async () => {
    const ctx = await context();
    await expect(
      explainSelection(ctx, OWNER, 'gap_1', { lessonId: 'lesson_1', selection: '' }),
    ).rejects.toThrow();
  });
});

describe('pinAnnotation + listAnnotations', () => {
  it('persists a pinned explanation and lists it back', async () => {
    const ctx = await context();
    await pinAnnotation(ctx, OWNER, {
      lessonId: 'lesson_1',
      selection: 'variance',
      explanation: 'A measure of how spread out the values are.',
    });
    const { annotations } = await listAnnotations(ctx, OWNER, 'lesson_1');
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.selection).toBe('variance');
  });

  it('upserts a repeated pin for the same selection instead of duplicating', async () => {
    const ctx = await context();
    await pinAnnotation(ctx, OWNER, {
      lessonId: 'lesson_2',
      selection: 'entropy',
      explanation: 'First version.',
    });
    await pinAnnotation(ctx, OWNER, {
      lessonId: 'lesson_2',
      selection: 'entropy',
      explanation: 'Second version.',
    });
    const { annotations } = await listAnnotations(ctx, OWNER, 'lesson_2');
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.explanation).toBe('Second version.');
  });

  it('keeps annotations isolated per owner', async () => {
    const ctx = await context();
    await ctx.uow.users.create({
      id: 'user_other',
      email: 'other@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    await pinAnnotation(ctx, OWNER, {
      lessonId: 'lesson_3',
      selection: 'gradient',
      explanation: 'Mine.',
    });
    const { annotations } = await listAnnotations(ctx, 'user_other', 'lesson_3');
    expect(annotations).toHaveLength(0);
  });
});
