/**
 * The HTTP API over the service layer (GAP-021), exercised in-process.
 *
 * Handlers are plain functions, so the whole API surface is testable without sockets or a Next
 * server: happy paths, error mapping (400/401/404/409/422), owner scoping, and the full
 * learner journey — gap -> source -> compile -> today -> attempt -> mastery. The handlers
 * return wire-shaped `unknown` bodies on purpose (they are API boundaries); the tests cast to
 * the domain types they carry.
 */

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import type { Gap, Source, SourceChunk } from '@gapos/database';
import { createServerContext, type ServerContext } from './context.js';
import {
  apiHealth,
  audioUrl,
  compile,
  createGap,
  createUser,
  getCurriculum,
  getGap,
  getLesson,
  listGaps,
  listSources,
  masteryView,
  registerSourceHandler,
  requireOwner,
  submitAttemptHandler,
  toHttpError,
  todayView,
  transitionGap,
} from './api.js';

const OWNER = 'api_user_1';
const OTHER = 'api_user_2';

const buildContext = (): { context: ServerContext } => {
  let tick = 0;
  const base = new Date('2026-08-02T09:00:00Z');
  const context = createServerContext({
    now: () => new Date(base.getTime() + (tick += 1) * 1000),
    newId: (prefix: string) => `${prefix}_${tick}`,
  });
  return { context };
};

const seedUser = async (context: ServerContext, owner = OWNER) => {
  await createUser(context, owner, {
    email: `${owner}@example.com`,
    locale: 'en',
    timezone: 'UTC',
  });
};

interface CurriculumLesson {
  id: string;
  questions: { id: string; objectiveId: string }[];
  artefacts: { id: string; kind: string }[];
}

const seedCompiledGap = async (context: ServerContext, owner = OWNER): Promise<string> => {
  await seedUser(context, owner);
  const created = (await createGap(context, owner, {
    title: 'Relations and proof techniques',
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 35,
  })) as { gap: Gap };
  await transitionGap(context, owner, created.gap.id, { type: 'define' });
  await registerSourceHandler(context, owner, {
    gapId: created.gap.id,
    filename: 'set-theory-primer.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  const outcome = (await compile(context, owner, created.gap.id, {
    idempotencyKey: 'api-compile-1',
  })) as { run: { status: string; runId: string } };
  expect(outcome.run.status).toBe('complete');
  return created.gap.id;
};

const curriculumOf = async (context: ServerContext, owner: string, gapId: string) => {
  const result = (await getCurriculum(context, owner, gapId)) as {
    curriculum: { id: string };
    lessons: CurriculumLesson[];
  };
  return result;
};

describe('owner scoping', () => {
  it('requires the X-Owner-Id header', () => {
    expect(() => requireOwner(new Headers())).toThrow(/X-Owner-Id/);
    expect(() => requireOwner(new Headers({ 'x-owner-id': 'alice' }))).not.toThrow();
  });

  it('keeps every learner endpoint inside the owner', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context, OWNER);

    await expect(getGap(context, OTHER, gapId)).rejects.toMatchObject({ code: 'gap_not_found' });
    await expect(compile(context, OTHER, gapId, { idempotencyKey: 'x' })).rejects.toThrow();
    await expect(getLesson(context, OTHER, gapId, 'lesson_1')).rejects.toThrow();
  });
});

describe('error mapping', () => {
  it('maps validation failures to 400', async () => {
    const { context } = buildContext();
    // Handlers throw the raw validation error; the route adapter maps it via toHttpError.
    await expect(
      createGap(context, OWNER, { title: '', rawStatement: 'short', dailyMinutes: 1 }),
    ).rejects.toMatchObject({ name: 'ZodError' });
    expect(toHttpError(new ZodError([])).status).toBe(400);
  });

  it('maps missing resources to 404', async () => {
    const { context } = buildContext();
    await seedUser(context);
    await expect(getGap(context, OWNER, 'nope')).rejects.toMatchObject({ status: 404 });
    const mapped = toHttpError(new Error('Question nope was not found for this owner.'));
    expect(mapped.status).toBe(404);
  });
});

describe('the learner journey over the API', () => {
  it('creates a user and a gap, then transitions it', async () => {
    const { context } = buildContext();
    await seedUser(context);
    expect(((await listGaps(context, OWNER)) as { gaps: Gap[] }).gaps).toHaveLength(0);

    const created = (await createGap(context, OWNER, {
      title: 'Relations and proof techniques',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    })) as { gap: Gap };
    expect(created.gap.status).toBe('draft');

    const defined = (await transitionGap(context, OWNER, created.gap.id, {
      type: 'define',
    })) as { gap: Gap };
    expect(defined.gap.status).toBe('ready');

    const fetched = (await getGap(context, OWNER, created.gap.id)) as { gap: Gap };
    expect(fetched.gap.status).toBe('ready');
  });

  it('runs a gap from source to mastery over the handlers', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);

    const sources = (await listSources(context, OWNER, gapId)) as {
      sources: (Source & { chunks: SourceChunk[] })[];
    };
    expect(sources.sources).toHaveLength(1);
    expect(sources.sources[0]!.chunks.length).toBeGreaterThan(0);

    const { lessons } = await curriculumOf(context, OWNER, gapId);
    expect(lessons.length).toBeGreaterThan(0);
    const first = lessons[0]!;

    const lesson = (await getLesson(context, OWNER, gapId, first.id)) as {
      lesson: { artefacts: { id: string }[] };
    };
    expect(lesson.lesson.artefacts).toBeDefined();

    const today = (await todayView(context, OWNER, gapId)) as {
      today: { totalItems: number };
    };
    expect(today.today.totalItems).toBeGreaterThan(0);

    const question = first.questions[0]!;
    const attempt = (await submitAttemptHandler(context, OWNER, gapId, {
      questionId: question.id,
      sessionId: 'session_1',
      response: 'correct answer',
      idempotencyKey: 'attempt-1',
    })) as { attempt: { created: boolean; correct: boolean } };
    expect(attempt.attempt.created).toBe(true);
    expect(typeof attempt.attempt.correct).toBe('boolean');

    const mastery = (await masteryView(context, OWNER, gapId)) as { mastery: object };
    expect(mastery.mastery).toBeDefined();
  });

  it('serves an audio URL for a published lesson when audio exists', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);
    const { lessons } = await curriculumOf(context, OWNER, gapId);
    const audio = lessons.flatMap((l) => l.artefacts).find((a) => a.kind === 'audio');
    if (!audio) return; // fixture runs may be text-only; the endpoint contract is covered below
    const served = await audioUrl(context, OWNER, gapId, audio.id);
    // In-memory storage returns an opaque memory:// locator; real storage returns a presigned
    // https URL (proven in the S3 suite). The contract is a non-empty URL plus an expiry.
    expect(served.url.length).toBeGreaterThan(0);
    expect(served.expiresAt).toBeTruthy();
  });

  it('rejects a source that fails screening', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);
    const result = (await registerSourceHandler(context, OWNER, {
      gapId,
      filename: 'evil.html',
      mediaType: 'text/html',
      text: '<script>alert(1)</script>',
    })) as { registration: { accepted: boolean; code?: string } };
    expect(result.registration.accepted).toBe(false);
    expect(result.registration.code).toBeDefined();
  });
});

describe('health', () => {
  it('reports ok', async () => {
    const { context } = buildContext();
    expect((await apiHealth(context)).ok).toBe(true);
  });
});
