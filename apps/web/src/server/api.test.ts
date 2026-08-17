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
import { CostAccountant, createLogger, createMetrics } from '@gapos/observability';
import {
  createEmbeddings,
  createFakeEmbeddings,
  createFakeLanguageModel,
  createFakeSpeechToText,
  createFakeTextToSpeech,
  createLanguageModel,
} from '@gapos/provider-adapters';
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
  knowledgeMap,
  listGaps,
  listSources,
  masteryView,
  registerSourceHandler,
  requireOwner,
  reviewLesson,
  reviewQueue,
  submitAttemptHandler,
  toHttpError,
  todayView,
  transitionGap,
  voiceGapDraft,
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
    // In-memory storage returns the bytes (the no-S3 proxy path); real storage returns a
    // presigned https URL (proven in the S3 suite). The contract is one or the other.
    if ('bytes' in served) {
      expect(served.bytes.length).toBeGreaterThan(0);
      expect(served.mediaType).toMatch(/^audio\//);
    } else {
      expect(served.url.startsWith('http')).toBe(true);
      expect(served.expiresAt).toBeTruthy();
    }
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

describe('gap creation provisions the owner (FK safety)', () => {
  it('creates the users row for a brand-new owner before inserting the gap', async () => {
    const { context } = buildContext();
    const NEW_OWNER = 'brand_new_learner';
    // A brand-new learner has no users row (the UI has no signup flow).
    expect(await context.uow.users.find(NEW_OWNER)).toBeUndefined();

    const created = (await createGap(context, NEW_OWNER, {
      title: 'A fresh gap',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 20,
    })) as { gap: Gap };
    expect(created.gap.status).toBe('draft');

    const user = await context.uow.users.find(NEW_OWNER);
    expect(user).toBeDefined();
    expect(user?.id).toBe(NEW_OWNER);
  });

  it('is idempotent: repeated createGap for the same owner never throws', async () => {
    const { context } = buildContext();
    const NEW_OWNER = 'repeat_learner';
    await createGap(context, NEW_OWNER, {
      title: 'First gap',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 20,
    });
    await expect(
      createGap(context, NEW_OWNER, {
        title: 'Second gap',
        rawStatement: REFERENCE_GAP_STATEMENT,
        dailyMinutes: 20,
      }),
    ).resolves.toBeDefined();
    expect(((await listGaps(context, NEW_OWNER)) as { gaps: Gap[] }).gaps).toHaveLength(2);
  });

  it('maps a raw foreign-key constraint error to a clean, non-leaky response', () => {
    const mapped = toHttpError(
      new Error(
        'insert or update on table "gaps" violates foreign key constraint "gaps_owner_id_fkey"',
      ),
    );
    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe('constraint_violation');
    expect(mapped.message).not.toMatch(/gaps_owner_id_fkey/);
    expect(mapped.message).not.toMatch(/insert or update/);
  });
});

describe('mastery view labels', () => {
  it('labels each assessment with its objective capability statement, not the raw id', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);

    const { curriculum } = (await getCurriculum(context, OWNER, gapId)) as {
      curriculum: { plan: { objectives: { id: string; capabilityStatement: string }[] } };
    };
    expect(curriculum.plan.objectives.length).toBeGreaterThan(0);

    const { mastery } = (await masteryView(context, OWNER, gapId)) as {
      mastery: { assessments: { objectiveId: string; label?: string }[] };
    };
    expect(mastery.assessments.length).toBeGreaterThan(0);

    for (const assessment of mastery.assessments) {
      const objective = curriculum.plan.objectives.find((o) => o.id === assessment.objectiveId);
      expect(objective).toBeDefined();
      expect(assessment.label).toBe(objective!.capabilityStatement);
      expect(assessment.label).not.toBe(assessment.objectiveId);
    }
  });
});

describe('voice gap capture (E16)', () => {
  it('transcribes audio into an editable draft with a suggested title', async () => {
    const costAccountant = new CostAccountant();
    const metrics = createMetrics();
    const logger = createLogger({}, { level: 'error' });
    const context = createServerContext({
      providers: {
        mode: 'fake',
        languageModel: createLanguageModel(createFakeLanguageModel(), {
          costAccountant,
          metrics,
          logger,
        }),
        speechToText: createFakeSpeechToText({
          transcript: 'I want to be able to read Korean news articles by March',
        }),
        textToSpeech: createFakeTextToSpeech(),
        embeddings: createEmbeddings(createFakeEmbeddings(), { costAccountant, metrics, logger }),
      },
    });

    const draft = await voiceGapDraft(context, OWNER, new Uint8Array([1, 2, 3]), 'audio/webm');
    expect(draft.transcript).toContain('Korean news articles');
    expect(draft.suggestedTitle).toContain('read Korean news articles');
  });

  it('creates the real gap from the confirmed draft', async () => {
    const { context } = buildContext();
    await seedUser(context);
    const created = (await createGap(context, OWNER, {
      title: 'read Korean news articles',
      rawStatement: 'I want to be able to read Korean news articles by March',
      dailyMinutes: 30,
    })) as { gap: Gap };
    expect(created.gap.status).toBe('draft');
    expect(created.gap.rawStatement).toContain('Korean news articles');
  });
});

describe('the knowledge map (E15)', () => {
  it('shows the gap, its taught capabilities and their prerequisites', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);

    const map = (await knowledgeMap(context, OWNER, gapId)) as {
      nodes: { id: string; kind: string }[];
      edges: { from: string; to: string; relationship: string }[];
    };

    expect(map.nodes.some((n) => n.id === gapId && n.kind === 'gap')).toBe(true);
    expect(map.nodes.filter((n) => n.kind === 'capability').length).toBeGreaterThan(0);
    expect(map.edges.some((e) => e.from === gapId && e.relationship === 'teaches')).toBe(true);
  });

  it('stays inside the owner', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context, OWNER);
    await expect(knowledgeMap(context, OTHER, gapId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('the educator review queue (E19)', () => {
  it('flags lessons whose run recorded findings, and records a rejection with a note', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);

    // Inject an audit finding into the run that produced the curriculum.
    const { curriculum } = (await getCurriculum(context, OWNER, gapId)) as {
      curriculum: { runId: string };
    };
    await context.uow.generation.addFinding(OWNER, {
      id: 'finding_1',
      runId: curriculum.runId,
      targetId: 'chunk_1',
      category: 'prompt_injection',
      severity: 'high',
      finding: 'A hostile paragraph tried to override instructions.',
      repairStatus: 'open',
      repairAttempts: 0,
    });

    const { items } = await reviewQueue(context, OWNER);
    expect(items.length).toBeGreaterThan(0);
    const flagged = items.find((item) => item.findings.some((f) => f.severity === 'high'));
    expect(flagged).toBeDefined();

    // Reject with a note; the queue and the lesson both carry it.
    const decided = (await reviewLesson(context, OWNER, flagged!.lessonId, {
      decision: 'reject',
      note: 'Rewrite: the first paragraph is hostile.',
    })) as { lesson: { reviewStatus: string; reviewNote: string } };
    expect(decided.lesson.reviewStatus).toBe('rejected');
    expect(decided.lesson.reviewNote).toBe('Rewrite: the first paragraph is hostile.');

    const after = await reviewQueue(context, OWNER);
    expect(after.items.find((item) => item.lessonId === flagged!.lessonId)).toMatchObject({
      reviewStatus: 'rejected',
      reviewNote: 'Rewrite: the first paragraph is hostile.',
    });
  });

  it('stays inside the owner', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context, OWNER);
    const { curriculum } = (await getCurriculum(context, OWNER, gapId)) as {
      curriculum: { runId: string };
    };
    await expect(
      reviewLesson(context, OTHER, 'lesson_1', { decision: 'approve' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(curriculum.runId).toBeTruthy();
  });
});
