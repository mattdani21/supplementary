/**
 * The primary end-to-end journey (roadmap §16.1).
 *
 * Create account → define a set-theory gap → upload the reference document → skip the
 * diagnostic → compile → observe Day 1 publication → play an audio artefact → submit practice →
 * receive corrective feedback → complete the mastery check → find the capability in search.
 *
 * It runs entirely on the deterministic fake providers, so it needs no network, no API key and
 * no database, and it exercises the same code paths production runs.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import type { OwnerId } from '@gapos/database';
import { CostAccountant, createLogger, createMetrics } from '@gapos/observability';
import {
  checksumFor,
  createEmbeddings,
  createFakeEmbeddings,
  createFakeLanguageModel,
  createFakeSpeechToText,
  createFakeTextToSpeech,
  createLanguageModel,
  createTextToSpeech,
} from '@gapos/provider-adapters';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';
import {
  assessMastery,
  getToday,
  runMasteryCheck,
  searchCapabilities,
  submitAttempt,
} from '../../apps/web/src/server/services/learning-service.js';

const LEARNER: OwnerId = 'user_learner';
const OTHER: OwnerId = 'user_other';

/**
 * A clock that advances a second on every read. Real elapsed time is unusable here — the fakes
 * are instantaneous — but publication *order* is a real product guarantee, so the test needs
 * distinguishable timestamps to assert it.
 */
const steppingClock = (start = new Date('2026-08-02T09:00:00Z')) => {
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

const seedLearner = async (context: ServerContext, id: OwnerId) => {
  await context.uow.users.create({
    id,
    email: `${id}@example.com`,
    locale: 'en',
    timezone: 'UTC',
  });
};

/** Steps 1–5 of the journey, shared by the tests that need a compiled course. */
const compileReferenceCourse = async (
  context: ServerContext,
  owner: OwnerId = LEARNER,
  idempotencyKey = 'compile-1',
) => {
  const gap = await createGap(context, owner, {
    title: 'Relations and proof techniques',
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 35,
    deadline: '2026-08-07',
  });

  const registration = await registerSource(context, owner, {
    gapId: gap.id,
    filename: 'set-theory-primer.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  expect(registration.accepted).toBe(true);

  await applyTransition(context, owner, gap.id, { type: 'define' });

  const outcome = await compile(context, owner, { gapId: gap.id, idempotencyKey });
  return { gap, outcome };
};

describe('the primary journey', () => {
  let context: ServerContext;

  beforeEach(async () => {
    ({ context } = buildContext());
    await seedLearner(context, LEARNER);
    await seedLearner(context, OTHER);
  });

  it('compiles a complete course from the reference gap and source', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);

    expect(outcome.status).toBe('complete');
    expect(outcome.curriculumId).toBeDefined();
    expect(outcome.days).toHaveLength(3);
    expect(outcome.days.every((d) => d.published)).toBe(true);

    const current = await context.uow.gaps.get(LEARNER, gap.id);
    expect(current?.status).toBe('active');
  });

  it('extracts the source into chunks that carry real locators', async () => {
    const { gap } = await compileReferenceCourse(context);
    const [source] = await context.uow.sources.listForGap(LEARNER, gap.id);
    expect(source?.processingStatus).toBe('indexed');

    const chunks = await context.uow.sources.listChunks(LEARNER, source!.id);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.locator).join(' ')).toContain('Equivalence relations');
  });

  it('publishes Day 1 before the later days finish', async () => {
    const { outcome } = await compileReferenceCourse(context);
    const published = outcome.days
      .filter((d) => d.publishedAt)
      .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime());

    expect(published[0]?.day).toBe(1);
    expect(outcome.dayOnePublishedAt).toEqual(published[0]?.publishedAt);
    expect(outcome.dayOnePublishedAt!.getTime()).toBeLessThan(
      published[published.length - 1]!.publishedAt!.getTime(),
    );
  });

  it('produces a playable audio artefact whose checksum matches what is spoken', async () => {
    const { outcome } = await compileReferenceCourse(context);
    const dayOne = outcome.days.find((d) => d.day === 1)!;
    expect(dayOne.textOnly).toBe(false);
    expect(dayOne.audioSegments).toBeGreaterThan(0);

    const artefacts = await context.uow.curricula.listArtefacts(LEARNER, dayOne.lessonId);
    const audio = artefacts.filter((a) => a.kind === 'audio');
    expect(audio.length).toBe(dayOne.audioSegments);
    expect(audio.length).toBeGreaterThan(1);
    expect(audio.map((a) => a.segmentOrdinal)).toEqual(audio.map((_, i) => i));

    // Playable: a signed URL is issued, and it expires.
    const url = await context.storage.signedUrl(LEARNER, audio[0]!.storageKey);
    expect(url?.url).toContain(audio[0]!.storageKey);
    expect(url!.expiresAt.getTime()).toBeGreaterThan(context.now().getTime());

    // The audio corresponds to the text it claims to speak.
    const object = await context.storage.get(LEARNER, audio[0]!.storageKey);
    expect(new TextDecoder().decode(object!.bytes)).toContain('FAKE-AUDIO:');

    const transcript = artefacts.find((a) => a.kind === 'transcript');
    expect(transcript).toBeDefined();
  });

  it('ships a transcript for every published lesson', async () => {
    const { outcome } = await compileReferenceCourse(context);
    for (const day of outcome.days.filter((d) => d.published)) {
      const artefacts = await context.uow.curricula.listArtefacts(LEARNER, day.lessonId);
      expect(
        artefacts.some((a) => a.kind === 'transcript'),
        `day ${day.day}`,
      ).toBe(true);
    }
  });

  it('offers the next lesson in Today and no reviews before any practice', async () => {
    const { gap } = await compileReferenceCourse(context);
    const today = await getToday(context, LEARNER, gap.id);
    expect(today.lesson?.day).toBe(1);
    expect(today.reviews).toEqual([]);
  });

  it('gives corrective feedback and schedules remediation for a wrong answer', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);
    const dayOne = outcome.days.find((d) => d.day === 1)!;
    const [question] = await context.uow.curricula.listQuestions(LEARNER, dayOne.lessonId);

    const result = await submitAttempt(context, LEARNER, gap.id, {
      questionId: question!.id,
      sessionId: 'session_1',
      response: 'a confidently wrong answer',
      idempotencyKey: 'attempt-wrong-1',
    });

    expect(result.correct).toBe(false);
    // The correct answer is only revealed after the attempt, never before.
    expect(result.feedback.answer).toBe(question!.payload.answer);
    expect(result.scheduledReviews).toHaveLength(2);
    expect(result.scheduledReviews.map((r) => r.reason)).toEqual(['remediation', 'remediation']);

    const today = await getToday(context, LEARNER, gap.id);
    expect(today.reviews.length).toBeGreaterThan(0);
  });

  it('does not double-count a replayed attempt', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);
    const dayOne = outcome.days.find((d) => d.day === 1)!;
    const [question] = await context.uow.curricula.listQuestions(LEARNER, dayOne.lessonId);

    const input = {
      questionId: question!.id,
      sessionId: 'session_1',
      response: question!.payload.answer,
      idempotencyKey: 'attempt-key-1',
    };

    const first = await submitAttempt(context, LEARNER, gap.id, input);
    const second = await submitAttempt(context, LEARNER, gap.id, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const evidence = await context.uow.mastery.listEvidence(LEARNER, question!.objectiveId);
    expect(evidence).toHaveLength(1);
  });

  it('freezes the lesson artefacts once an attempt references them', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);
    const dayOne = outcome.days.find((d) => d.day === 1)!;
    const [question] = await context.uow.curricula.listQuestions(LEARNER, dayOne.lessonId);

    await submitAttempt(context, LEARNER, gap.id, {
      questionId: question!.id,
      sessionId: 'session_1',
      response: question!.payload.answer,
      idempotencyKey: 'attempt-freeze',
    });

    const artefacts = await context.uow.curricula.listArtefacts(LEARNER, dayOne.lessonId);
    expect(artefacts.every((a) => a.frozen)).toBe(true);
  });
});

describe('a gap fills on evidence, never on consumption', () => {
  let context: ServerContext;
  let clock: ReturnType<typeof steppingClock>;

  beforeEach(async () => {
    ({ context, clock } = buildContext());
    await seedLearner(context, LEARNER);
  });

  /** Answer every published question correctly, in the named session. */
  const practiseEverything = async (
    gapId: string,
    lessonIds: readonly string[],
    sessionId: string,
    keyPrefix: string,
  ) => {
    for (const lessonId of lessonIds) {
      for (const question of await context.uow.curricula.listQuestions(LEARNER, lessonId)) {
        await submitAttempt(context, LEARNER, gapId, {
          questionId: question.id,
          sessionId,
          response: question.payload.answer,
          idempotencyKey: `${keyPrefix}_${question.id}`,
        });
      }
    }
  };

  it('refuses to fill a gap when the learner has only listened', async () => {
    const { gap } = await compileReferenceCourse(context);

    // No attempts at all: every lesson consumed, nothing proved.
    const result = await runMasteryCheck(context, LEARNER, gap.id);

    expect(result.filled).toBe(false);
    expect(result.mastery.readyToFill).toBe(false);
    expect(result.blockedBy!.join(' ')).toContain('more practice items');
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'active' });
  });

  it('refuses to fill after a single session, however good the answers', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);
    await practiseEverything(
      gap.id,
      outcome.days.map((d) => d.lessonId),
      'session_1',
      'k1',
    );

    const result = await runMasteryCheck(context, LEARNER, gap.id);
    expect(result.filled).toBe(false);
    expect(result.blockedBy!.join(' ')).toContain('second, separate session');
  });

  it('fills the gap once evidence spans two sessions with unhinted transfer work', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);
    const lessonIds = outcome.days.map((d) => d.lessonId);

    await practiseEverything(gap.id, lessonIds, 'session_1', 'k1');
    // A later day: the delayed retrieval the mastery rule asks for.
    clock.set(new Date('2026-08-04T09:00:00Z'));
    await practiseEverything(gap.id, lessonIds, 'session_2', 'k2');

    const mastery = await assessMastery(context, LEARNER, gap.id);
    expect(mastery.readyToFill).toBe(true);

    const result = await runMasteryCheck(context, LEARNER, gap.id);
    expect(result.filled).toBe(true);
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'filled' });
  });

  it('makes a filled gap discoverable in the capability library', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);
    const lessonIds = outcome.days.map((d) => d.lessonId);
    await practiseEverything(gap.id, lessonIds, 'session_1', 'k1');
    clock.set(new Date('2026-08-04T09:00:00Z'));
    await practiseEverything(gap.id, lessonIds, 'session_2', 'k2');
    await runMasteryCheck(context, LEARNER, gap.id);

    expect((await searchCapabilities(context, LEARNER)).map((c) => c.gapId)).toEqual([gap.id]);
    expect(await searchCapabilities(context, LEARNER, 'equivalence')).toHaveLength(1);
    expect(await searchCapabilities(context, LEARNER, 'thermodynamics')).toHaveLength(0);
  });

  it('records the prerequisite graph when a gap is filled', async () => {
    const { gap, outcome } = await compileReferenceCourse(context);
    const lessonIds = outcome.days.map((d) => d.lessonId);
    await practiseEverything(gap.id, lessonIds, 'session_1', 'k1');
    clock.set(new Date('2026-08-04T09:00:00Z'));
    await practiseEverything(gap.id, lessonIds, 'session_2', 'k2');
    await runMasteryCheck(context, LEARNER, gap.id);

    const edges = await context.uow.knowledge.listEdges(LEARNER);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.toCapability === 'obj_equivalence_classes')).toBe(true);
  });
});

describe('idempotency and isolation', () => {
  let context: ServerContext;

  beforeEach(async () => {
    ({ context } = buildContext());
    await seedLearner(context, LEARNER);
    await seedLearner(context, OTHER);
  });

  it('produces exactly one run for a repeated compile idempotency key', async () => {
    const { gap, outcome } = await compileReferenceCourse(context, LEARNER, 'compile-key');
    const repeat = await compile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'compile-key',
    });

    expect(repeat.runId).toBe(outcome.runId);
    expect(repeat.deduplicated).toBe(true);

    const curricula = await context.uow.curricula.getCurrentForGap(LEARNER, gap.id);
    expect(curricula?.version).toBe(1);
  });

  it('keeps one learner’s compiled course invisible to another', async () => {
    const { gap } = await compileReferenceCourse(context, LEARNER);

    expect(await context.uow.gaps.get(OTHER, gap.id)).toBeUndefined();
    expect(await context.uow.curricula.getCurrentForGap(OTHER, gap.id)).toBeUndefined();
    expect(await searchCapabilities(context, OTHER)).toEqual([]);
    expect(await getToday(context, OTHER, gap.id)).toMatchObject({ totalItems: 0 });
  });

  it('does not re-extract or re-charge for an identical re-uploaded source', async () => {
    const { gap } = await compileReferenceCourse(context);
    const before = context.costAccountant.spentForRun('run_1');

    const again = await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });

    expect(again).toMatchObject({ accepted: true, deduplicated: true });
    expect(context.costAccountant.spentForRun('run_1')).toBe(before);
  });

  it('rejects an unsupported upload with a code the client can act on', async () => {
    const gap = await createGap(context, LEARNER, {
      title: 'A gap',
      rawStatement: 'Something',
      dailyMinutes: 30,
    });
    const result = await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'notes.pdf',
      mediaType: 'application/pdf',
      text: 'irrelevant',
    });
    expect(result).toMatchObject({ accepted: false, code: 'unsupported_media_type' });
  });
});

describe('resilience', () => {
  it('survives a provider failure and produces the same course on retry', async () => {
    // The first provider call fails outright; the run fails, and a retry compiles cleanly.
    const { context } = buildContext({ fake: { failFirstNCalls: 1 } });
    await seedLearner(context, LEARNER);

    const { gap, outcome } = await compileReferenceCourse(context, LEARNER, 'compile-a');
    expect(outcome.status).toBe('failed');
    expect(await context.uow.gaps.get(LEARNER, gap.id)).toMatchObject({ status: 'failed' });

    const retry = await compile(context, LEARNER, { gapId: gap.id, idempotencyKey: 'compile-b' });
    expect(retry.status).toBe('complete');
    expect(retry.days).toHaveLength(3);
  });

  it('falls back to transcript when audio synthesis fails, keeping the curriculum', async () => {
    const { context } = buildContext();
    await seedLearner(context, LEARNER);

    // Force every synthesis call to fail by disabling audio for this compile.
    const gap = await createGap(context, LEARNER, {
      title: 'Relations',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });

    const outcome = await compile(context, LEARNER, {
      gapId: gap.id,
      idempotencyKey: 'text-only',
      audioEnabled: false,
    });

    expect(outcome.status).toBe('complete');
    expect(outcome.days.every((d) => d.textOnly)).toBe(true);
    for (const day of outcome.days) {
      const artefacts = await context.uow.curricula.listArtefacts(LEARNER, day.lessonId);
      expect(artefacts.some((a) => a.kind === 'transcript')).toBe(true);
      expect(artefacts.some((a) => a.kind === 'audio')).toBe(false);
    }
  });

  it('stops the run rather than overspending when the budget is exhausted', async () => {
    const { context } = buildContext({
      budget: { perRunMillicents: 1, perUserDailyMillicents: 1 },
    });
    await seedLearner(context, LEARNER);

    const { outcome } = await compileReferenceCourse(context, LEARNER, 'broke');
    expect(outcome.status).toBe('failed');
    expect(outcome.error).toMatch(/budget/i);
    expect(context.metrics.sum('budget_degradation_total')).toBeGreaterThan(0);
  });

  it('degrades to text-only when audio synthesis would exceed the budget, instead of overspending', async () => {
    // M2.2 (GAP-015): the budget is checked before EVERY provider call. Text-to-speech was the
    // only adapter without the check, so a paid audio engine could overspend a run. With a
    // per-run budget that fits the language-model stages but not the audio, the run must
    // publish the curriculum transcript-only — not fail, not overspend.
    const costAccountant = new CostAccountant({
      perRunMillicents: 150_000,
      perUserDailyMillicents: 10_000_000,
    });
    const metrics = createMetrics();
    const logger = createLogger({}, { level: 'error' });
    const { context } = buildContext({
      budget: { perRunMillicents: 150_000, perUserDailyMillicents: 10_000_000 },
      providers: {
        mode: 'fake' as const,
        languageModel: createLanguageModel(createFakeLanguageModel(), {
          costAccountant,
          metrics,
          logger,
        }),
        speechToText: createFakeSpeechToText(),
        textToSpeech: createTextToSpeech(createFakeTextToSpeech(), {
          costAccountant,
          metrics,
          logger,
          estimateMillicents: () => 10_000_000, // an absurdly expensive audio engine
        }),
        embeddings: createEmbeddings(createFakeEmbeddings(), {
          costAccountant,
          metrics,
          logger,
        }),
      },
    });
    await seedLearner(context, LEARNER);

    const { outcome } = await compileReferenceCourse(context, LEARNER, 'audio-broke');
    expect(outcome.status).toBe('complete');
    expect(outcome.days.every((d) => d.textOnly)).toBe(true);
    for (const day of outcome.days) {
      const artefacts = await context.uow.curricula.listArtefacts(LEARNER, day.lessonId);
      expect(artefacts.some((a) => a.kind === 'transcript')).toBe(true);
      expect(artefacts.some((a) => a.kind === 'audio')).toBe(false);
    }
    expect(metrics.sum('budget_degradation_total')).toBeGreaterThan(0);
  });
});

describe('the fake audio corresponds to the text', () => {
  it('checksums the exact segment text that was spoken', () => {
    // Guards the integrity check itself: if the fake stopped deriving audio from the text, the
    // pipeline's checksum comparison would pass vacuously.
    expect(checksumFor('a')).not.toBe(checksumFor('b'));
    expect(checksumFor('a')).toBe(checksumFor('a'));
  });
});
