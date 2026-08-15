/**
 * The `generateLesson` instruction targets the human_sounding contract on the first pass
 * (E24 US1/US5, T044 — FR-007) and the free-response rubric contract (E24 T049, the
 * lesson-hit-rate follow-up).
 *
 * The verifier (`checkLessonStructure`) repairs or excludes a script that misses a structural
 * element, but repair is the backstop, not the design: a live-mode lesson costs a provider
 * round-trip, so generation should demand the four elements — concrete opening, one idea per
 * segment, a worked example worked inside the script, and a checkpoint via `pausePrompts` —
 * from the very first prompt. The same logic applies to free-response questions: the
 * `lesson_package` contract rejects a free-response question whose `rubric` is missing, and
 * the live hit-rate harness (scripts/measure-plan-hit-rate.ts) measured four of nine compiles
 * failing on exactly that field, so the first-pass prompt must also demand a concrete rubric —
 * grading criteria with explicit checkpoints, a model answer, and partial-credit rules —
 * rather than a bare non-empty string. This test reads the instruction the pipeline actually
 * sends for the `lesson_package` contract (through the guarded adapter into a recording fake
 * backend) and asserts all the demands are present in the first-pass prompt.
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

const OWNER: OwnerId = 'user_lesson_instruction';

/** Compile the eval_01 reference gap end-to-end against the recording fake. */
const compileEvalOne = async (context: ServerContext, key: string): Promise<void> => {
  await context.uow.users.create({
    id: OWNER,
    email: 'lesson-instruction@example.com',
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

const firstLessonInstruction = (calls: readonly unknown[]): string => {
  const lessonCalls = calls.filter(
    (c) => (c as { contractName?: string }).contractName === 'lesson_package',
  );
  expect(lessonCalls.length, 'the run generated at least one lesson').toBeGreaterThan(0);
  return (lessonCalls[0] as { instruction: string }).instruction;
};

describe('the generateLesson instruction demands the four structural elements (E24 T044, FR-007)', () => {
  it('demands a concrete opening in the first-pass lesson prompt', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't044-concrete-opening');

    const instruction = firstLessonInstruction(calls);
    expect(instruction).toMatch(/concrete opening/i);
    expect(instruction).toMatch(/never open with a statement about the lesson/i);
  });

  it('demands one idea per segment in the first-pass lesson prompt', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't044-one-idea');

    const instruction = firstLessonInstruction(calls);
    expect(instruction).toMatch(/one idea per segment/i);
    expect(instruction).toMatch(/no bullet or list markers/i);
  });

  it('demands a worked example worked inside the script, not merely referenced', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't044-worked-example');

    const instruction = firstLessonInstruction(calls);
    expect(instruction).toMatch(/worked example/i);
    expect(instruction).toMatch(/step by step/i);
    expect(instruction).toMatch(/inside the script/i);
    expect(instruction).toMatch(/examples/i);
  });

  it('demands a checkpoint question declared in pausePrompts', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't044-checkpoint');

    const instruction = firstLessonInstruction(calls);
    expect(instruction).toMatch(/checkpoint/i);
    expect(instruction).toContain('pausePrompts');
    expect(instruction).toMatch(/before the lesson continues/i);
  });
});

describe('the generateLesson instruction demands a concrete rubric for every free-response question (E24 T049)', () => {
  it('demands grading criteria with explicit checkpoints in the free-response rubric', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't049-rubric-grading-criteria');

    const instruction = firstLessonInstruction(calls);
    expect(instruction).toMatch(/free-response/i);
    expect(instruction).toMatch(/rubric/i);
    expect(instruction).toMatch(/grading criteria/i);
    expect(instruction).toMatch(/explicit checkpoints?/i);
  });

  it('demands a model answer inside the free-response rubric', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't049-rubric-model-answer');

    const instruction = firstLessonInstruction(calls);
    expect(instruction).toMatch(/model answer/i);
  });

  it('demands partial-credit rules inside the free-response rubric', async () => {
    const { context, calls } = buildRecordingContext();
    await compileEvalOne(context, 't049-rubric-partial-credit');

    const instruction = firstLessonInstruction(calls);
    expect(instruction).toMatch(/partial[- ]credit/i);
  });
});
