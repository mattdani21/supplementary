/**
 * The Arc application surface (GAP-032), exercised in-process.
 *
 * The acceptance criteria are real here, not stubbed:
 *   - the run-cell endpoint executes learner code server-side and a correct proof records an
 *     attempt and advances the gap state machine, while a wrong proof is state-neutral;
 *   - calibration persists its selections (round-trip through the repository), maps to a real
 *     gap, and adapts on the baseline outcome through the provider adapter;
 *   - preferences persist and the spaced-review toggle gates the real due-review queue;
 *   - the map and progress views reflect real database state.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import type { Gap } from '@gapos/database';
import { createServerContext, type ServerContext } from './context.js';
import {
  arcCalibrateHandler,
  arcCalibrationKitHandler,
  arcCapabilitiesHandler,
  arcLessonHandler,
  arcMapHandler,
  arcPreferencesHandler,
  arcProgressHandler,
  arcRunCellHandler,
  arcReviewsHandler,
  arcSetPreferencesHandler,
  arcSkillsHandler,
  arcSubmitProofHandler,
  arcSubmitReviewHandler,
  arcTodayHandler,
  audioUrl,
  compile,
  createGap,
  createUser,
  getGap,
  registerSourceHandler,
  transitionGap,
} from './api.js';
import { applyTransition } from './services/gap-service.js';
import { submitAttempt } from './services/learning-service.js';

const OWNER = 'arc_user_1';
const OTHER = 'arc_user_2';

const buildContext = (): { context: ServerContext; clock: { set: (at: Date) => void } } => {
  let tick = 0;
  let ids = 0;
  let base = new Date('2026-08-30T09:00:00Z');
  const context = createServerContext({
    now: () => new Date(base.getTime() + (tick += 1) * 1000),
    // A unique id generator: the tick-based one would collide for writes made without an
    // intervening clock read (two scheduled reviews in one attempt).
    newId: (prefix: string) => `${prefix}_${++ids}`,
  });
  return {
    context,
    clock: { set: (at) => void (base = at) },
  };
};

const seedUser = async (context: ServerContext, owner = OWNER) => {
  await createUser(context, owner, {
    email: `${owner}@example.com`,
    locale: 'en',
    timezone: 'UTC',
  });
};

const seedCompiledGap = async (
  context: ServerContext,
  owner = OWNER,
  idempotencyKey = 'arc-compile-1',
): Promise<string> => {
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
  const outcome = (await compile(context, owner, created.gap.id, { idempotencyKey })) as {
    run: { status: string };
  };
  expect(outcome.run.status).toBe('complete');
  return created.gap.id;
};

const firstCodeProof = async (
  context: ServerContext,
  owner: string,
  gapId: string,
): Promise<{ questionId: string; lessonId: string }> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  const lessons = await context.uow.curricula.listLessons(owner, curriculum!.id);
  const published = lessons.filter((l) => l.publicationStatus === 'published')[0]!;
  const questions = await context.uow.curricula.listQuestions(owner, published.id);
  const proof = questions.find((q) => q.payload.type === 'code_proof')!;
  return { questionId: proof.id, lessonId: published.id };
};

describe('Arc calibration', () => {
  it('serves the 3-step kit without leaking the answer key', async () => {
    const { context } = buildContext();
    await seedUser(context);
    const { calibration } = await arcCalibrationKitHandler(context, OWNER, 'Python for data work');
    expect(calibration.subject).toBe('Python for data work');
    expect(calibration.goalOptions.length).toBeGreaterThanOrEqual(3);
    expect(calibration.baselineQuestion.code).toContain('values');
    expect(calibration.baselineQuestion.options).toContain('12');
    expect(JSON.stringify(calibration)).not.toContain('"answer"');
  });

  it('persists the selections, creates a real gap, and maps to real gaps', async () => {
    const { context } = buildContext();
    await seedUser(context);

    const result = await arcCalibrateHandler(context, OWNER, {
      subject: 'Python for data work',
      goal: 'Build a project I can show',
      baselineAnswer: '12',
    });

    expect(result.calibration.baselineCorrect).toBe(true);
    expect(result.calibration.gapsIdentified.length).toBe(3);
    expect(result.calibration.startingDifficulty).toBe(3);
    expect(result.calibration.preview.next).toBeDefined();
    expect(result.calibration.preview.later.length).toBeGreaterThan(0);

    // The gap the route leads to is real and owned.
    const gap = (await getGap(context, OWNER, result.calibration.gapId)) as { gap: Gap };
    expect(gap.gap.status).toBe('draft');
    expect(gap.gap.title).toBe('Python for data work');

    // Persistence round-trip: the calibration row survives a fresh read from the repository.
    const stored = await context.uow.calibrations.get(OWNER, result.calibration.calibrationId);
    expect(stored).toMatchObject({
      subject: 'Python for data work',
      goal: 'Build a project I can show',
      baselineAnswer: '12',
      baselineCorrect: true,
      startingDifficulty: 3,
    });
    expect(stored!.gapsIdentified).toEqual(result.calibration.gapsIdentified);
    expect(await context.uow.calibrations.listForOwner(OWNER)).toHaveLength(1);
  });

  it('persists learner-confirmed time, deadline and source policy on the draft gap', async () => {
    const { context } = buildContext();

    const result = await arcCalibrateHandler(context, OWNER, {
      subject: 'Python for data work',
      goal: 'Build a project I can show',
      baselineAnswer: '12',
      dailyMinutes: 25,
      deadline: '2026-10-03',
      sourcePolicy: 'sources_only',
    });

    const gap = (await getGap(context, OWNER, result.calibration.gapId)) as { gap: Gap };
    expect(gap.gap).toMatchObject({
      dailyMinutes: 25,
      deadline: '2026-10-03',
      sourcePolicy: 'sources_only',
      status: 'draft',
    });
    expect(await context.uow.users.find(OWNER)).toBeDefined();
  });

  it('adapts the placement on a wrong baseline through the provider adapter', async () => {
    const { context } = buildContext();
    await seedUser(context);

    const result = await arcCalibrateHandler(context, OWNER, {
      subject: 'Python for data work',
      goal: 'Understand the foundations',
      baselineAnswer: '24',
    });

    expect(result.calibration.baselineCorrect).toBe(false);
    // A miss widens the gap list and lowers the starting difficulty.
    expect(result.calibration.gapsIdentified.length).toBe(4);
    expect(result.calibration.startingDifficulty).toBe(1);
    const gap = (await getGap(context, OWNER, result.calibration.gapId)) as { gap: Gap };
    expect(gap.gap.rawStatement).toContain('needs support');
  });

  it('surfaces real gaps whose titles share the subject terms', async () => {
    const { context } = buildContext();
    await seedUser(context);
    const existing = (await createGap(context, OWNER, {
      title: 'Python automation at work',
      rawStatement: 'I want to automate my reporting.',
      dailyMinutes: 30,
    })) as { gap: Gap };

    const result = await arcCalibrateHandler(context, OWNER, {
      subject: 'Python for data work',
      goal: 'Build a project I can show',
      baselineAnswer: '12',
    });

    expect(result.calibration.relatedGapIds).toContain(existing.gap.id);
  });

  it('keeps calibrations inside the owner', async () => {
    const { context } = buildContext();
    await seedUser(context);
    const result = await arcCalibrateHandler(context, OWNER, {
      subject: 'Python for data work',
      goal: 'Build a project I can show',
      baselineAnswer: '12',
    });
    expect(
      await context.uow.calibrations.get(OTHER, result.calibration.calibrationId),
    ).toBeUndefined();
    expect(await context.uow.calibrations.listForOwner(OTHER)).toEqual([]);
  });
});

describe('Arc setup telemetry', () => {
  it('records setup, compile result and retry categories without learner content', async () => {
    const { context } = buildContext();
    await seedUser(context);
    const created = (await createGap(context, OWNER, {
      title: 'Relations and proof techniques',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 25,
      sourcePolicy: 'sources_only',
    })) as { gap: Gap };
    await transitionGap(context, OWNER, created.gap.id, { type: 'define' });
    await registerSourceHandler(context, OWNER, {
      gapId: created.gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });

    await compile(context, OWNER, created.gap.id, {
      idempotencyKey: 'arc-setup-initial',
      surface: 'arc_setup',
      retry: false,
    });
    expect(context.metrics.sum('arc_setup_completed_total')).toBe(1);
    expect(context.metrics.sum('arc_compile_started_total', { retry: 'false' })).toBe(1);
    expect(context.metrics.sum('arc_compile_result_total', { status: 'complete' })).toBe(1);

    await compile(context, OWNER, created.gap.id, {
      idempotencyKey: 'arc-setup-retry',
      surface: 'arc_setup',
      retry: true,
    });
    expect(context.metrics.sum('arc_setup_completed_total')).toBe(1);
    expect(context.metrics.sum('arc_compile_started_total', { retry: 'true' })).toBe(1);
    expect(context.metrics.sum('arc_compile_retry_total')).toBe(1);
    expect(JSON.stringify(context.metrics.points.map((point) => point.labels))).not.toContain(
      SET_THEORY_SOURCE,
    );
  });

  it('publishes Day 1 after explicit general-knowledge setup without an upload', async () => {
    const { context } = buildContext();
    const created = (await createGap(context, OWNER, {
      title: 'Relations and proof techniques',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 25,
      sourcePolicy: 'general_knowledge_allowed',
    })) as { gap: Gap };
    await transitionGap(context, OWNER, created.gap.id, { type: 'define' });

    const outcome = (await compile(context, OWNER, created.gap.id, {
      idempotencyKey: 'arc-general-knowledge',
      surface: 'arc_setup',
      retry: false,
    })) as { run: { status: string } };
    expect(outcome.run.status).toBe('complete');
    expect(await context.uow.sources.listForGap(OWNER, created.gap.id)).toEqual([]);
    expect((await arcLessonHandler(context, OWNER, created.gap.id)).lesson.lesson.day).toBe(1);
  });
});

describe('Arc notebook proofs', () => {
  it('runs the cell server-side and records nothing', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);
    const { questionId } = await firstCodeProof(context, OWNER, gapId);

    const passed = await arcRunCellHandler(context, OWNER, gapId, {
      questionId,
      code:
        'function isSubset(a, b) {\n  return a.every((x) => b.includes(x));\n}\n\n' +
        'isSubset([1, 2], [1, 2, 3])',
    });
    expect(passed.run.passed).toBe(true);
    expect(passed.run.output).toBe('true');

    const failed = await arcRunCellHandler(context, OWNER, gapId, {
      questionId,
      code: 'function isSubset(a, b) {\n  return false;\n}',
    });
    expect(failed.run.passed).toBe(false);
    expect(failed.run.failures.length).toBeGreaterThan(0);

    // Running a cell is practice, never evidence.
    const question = await context.uow.curricula.getQuestion(OWNER, questionId);
    expect(await context.uow.attempts.listForObjective(OWNER, question!.objectiveId)).toEqual([]);
  });

  it('makes a wrong proof supportive and state-neutral', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);
    const { questionId } = await firstCodeProof(context, OWNER, gapId);

    const proof = await arcSubmitProofHandler(context, OWNER, gapId, {
      questionId,
      sessionId: 'session_a',
      code: 'function isSubset(a, b) {\n  return a.length === 0;\n}',
      idempotencyKey: 'proof-wrong-1',
    });

    expect(proof.proof.correct).toBe(false);
    expect(proof.proof.passed).toBe(false);
    expect(proof.proof.attemptCreated).toBe(false);
    expect(proof.proof.filled).toBe(false);
    expect(proof.proof.gapStatus).toBe('active');

    // No attempt, no evidence, no state change.
    const question = await context.uow.curricula.getQuestion(OWNER, questionId);
    expect(await context.uow.attempts.listForObjective(OWNER, question!.objectiveId)).toEqual([]);
    expect((await getGap(context, OWNER, gapId)) as { gap: Gap }).toMatchObject({
      gap: { status: 'active' },
    });
  });

  it('records a correct proof as an attempt with mastery evidence (persistence round-trip)', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);
    const { questionId } = await firstCodeProof(context, OWNER, gapId);

    const proof = await arcSubmitProofHandler(context, OWNER, gapId, {
      questionId,
      sessionId: 'session_a',
      code: 'function isSubset(a, b) {\n  return a.every((x) => b.includes(x));\n}',
      idempotencyKey: 'proof-correct-1',
    });

    expect(proof.proof.correct).toBe(true);
    expect(proof.proof.attemptCreated).toBe(true);
    expect(proof.proof.mastery).toBeDefined();

    const question = await context.uow.curricula.getQuestion(OWNER, questionId);
    const attempts = await context.uow.attempts.listForObjective(OWNER, question!.objectiveId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ correct: true, score: 1, hintsUsed: 0 });

    const evidence = await context.uow.mastery.listEvidence(OWNER, question!.objectiveId);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ attemptId: attempts[0]!.id, score: 1, independent: true });

    // A replayed submission is idempotent: the same key cannot double-count evidence.
    const replay = await arcSubmitProofHandler(context, OWNER, gapId, {
      questionId,
      sessionId: 'session_a',
      code: 'function isSubset(a, b) {\n  return a.every((x) => b.includes(x));\n}',
      idempotencyKey: 'proof-correct-1',
    });
    expect(replay.proof.attemptCreated).toBe(false);
    expect(await context.uow.attempts.listForObjective(OWNER, question!.objectiveId)).toHaveLength(
      1,
    );
  });

  it('advances the gap to filled once the proofs and practice satisfy the mastery rule', async () => {
    const { context, clock } = buildContext();
    const gapId = await seedCompiledGap(context);

    const curriculum = await context.uow.curricula.getCurrentForGap(OWNER, gapId);
    const lessons = (await context.uow.curricula.listLessons(OWNER, curriculum!.id)).filter(
      (l) => l.publicationStatus === 'published',
    );
    // The day-3 code proof is the final evidence: everything else first, then the proof itself
    // advances the gap to filled through the state machine.
    const finalProof = await (async () => {
      const dayThree = lessons.find((l) => l.day === 3)!;
      const questions = await context.uow.curricula.listQuestions(OWNER, dayThree.id);
      return questions.find((q) => q.payload.type === 'code_proof')!;
    })();

    const practiseSession = async (sessionId: string, keyPrefix: string, skipProof = false) => {
      for (const lesson of lessons) {
        const questions = await context.uow.curricula.listQuestions(OWNER, lesson.id);
        for (const question of questions) {
          if (question.payload.type === 'code_proof') {
            if (skipProof && question.id === finalProof.id) continue;
            await arcSubmitProofHandler(context, OWNER, gapId, {
              questionId: question.id,
              sessionId,
              code: question.payload.answer,
              idempotencyKey: `${keyPrefix}_${question.id}`,
            });
          } else {
            await submitAttempt(context, OWNER, gapId, {
              questionId: question.id,
              sessionId,
              response: question.payload.answer,
              idempotencyKey: `${keyPrefix}_${question.id}`,
            });
          }
        }
      }
    };

    await practiseSession('session_1', 'arc-k1');
    let gap = (await getGap(context, OWNER, gapId)) as { gap: Gap };
    expect(gap.gap.status).toBe('active');

    // A second, separate session on a later day — everything except the final proof.
    clock.set(new Date('2026-09-02T09:00:00Z'));
    await practiseSession('session_2', 'arc-k2', true);
    gap = (await getGap(context, OWNER, gapId)) as { gap: Gap };
    expect(gap.gap.status).toBe('active');

    // The final proof is the last piece of evidence, so submitting it fills the gap: a correct
    // proof records an attempt and advances the gap state machine.
    const proof = await arcSubmitProofHandler(context, OWNER, gapId, {
      questionId: finalProof.id,
      sessionId: 'session_2',
      code: finalProof.payload.answer,
      idempotencyKey: 'arc-k2_final_proof',
    });
    expect(proof.proof.correct).toBe(true);
    expect(proof.proof.filled).toBe(true);
    gap = (await getGap(context, OWNER, gapId)) as { gap: Gap };
    expect(gap.gap.status).toBe('filled');

    const progress = await arcProgressHandler(context, OWNER);
    expect(progress.progress.clearedGaps).toBe(1);
    expect(progress.progress.proofs.length).toBeGreaterThan(0);
    expect(progress.progress.momentumDays).toBeGreaterThanOrEqual(1);

    const capabilities = await arcCapabilitiesHandler(context, OWNER);
    expect(capabilities.capabilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ gapId, title: expect.any(String) })]),
    );
  });
});

describe('Arc preferences and spaced review', () => {
  it('defaults the preferences and persists a round-trip', async () => {
    const { context } = buildContext();
    await seedUser(context);

    const defaults = await arcPreferencesHandler(context, OWNER);
    expect(defaults.preferences).toMatchObject({
      audioTheory: true,
      gentleHints: true,
      darkMode: false,
      spacedReview: false,
    });

    const updated = await arcSetPreferencesHandler(context, OWNER, {
      audioTheory: false,
      gentleHints: true,
      darkMode: true,
      spacedReview: true,
    });
    expect(updated.preferences.spacedReview).toBe(true);

    const stored = await context.uow.preferences.get(OWNER);
    expect(stored).toMatchObject({
      audioTheory: false,
      darkMode: true,
      spacedReview: true,
    });
  });

  it('gates the real due-review queue on the spaced-review toggle', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);

    // A wrong answer schedules real remediation reviews through the review ladder.
    const curriculum = await context.uow.curricula.getCurrentForGap(OWNER, gapId);
    const dayOne = (await context.uow.curricula.listLessons(OWNER, curriculum!.id)).find(
      (l) => l.day === 1,
    )!;
    const [question] = await context.uow.curricula.listQuestions(OWNER, dayOne.id);
    await submitAttempt(context, OWNER, gapId, {
      questionId: question!.id,
      sessionId: 'review_session',
      response: 'a wrong answer',
      idempotencyKey: 'review-wrong-1',
    });

    const due = await context.uow.mastery.listDueReviews(OWNER, context.now());
    expect(due.length).toBeGreaterThan(0);

    // Toggle off (default): the schedule still exists in the DB, but Today does not surface it.
    const hidden = await arcTodayHandler(context, OWNER);
    expect(hidden.today.dueReviews).toEqual([]);

    // Toggle on: the same real schedule is surfaced.
    await arcSetPreferencesHandler(context, OWNER, {
      audioTheory: true,
      gentleHints: true,
      darkMode: false,
      spacedReview: true,
    });
    const shown = await arcTodayHandler(context, OWNER);
    expect(shown.today.dueReviews.length).toBeGreaterThan(0);
    expect(shown.today.dueReviews[0]!.gapId).toBe(gapId);
  });

  it('makes preferences alter the lesson and grades review responses on the server', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);

    await arcSetPreferencesHandler(context, OWNER, {
      audioTheory: false,
      gentleHints: false,
      darkMode: false,
      spacedReview: true,
    });
    const lesson = await arcLessonHandler(context, OWNER, gapId);
    expect(lesson.lesson.defaultMode).toBe('practice');
    expect(lesson.lesson.notebook?.hint).toBeUndefined();
    expect(lesson.lesson.practice.length).toBeGreaterThan(0);
    expect(lesson.lesson.practice.every((question) => question.hint === undefined)).toBe(true);

    const curriculum = await context.uow.curricula.getCurrentForGap(OWNER, gapId);
    const dayOne = (await context.uow.curricula.listLessons(OWNER, curriculum!.id)).find(
      (entry) => entry.day === 1,
    )!;
    const question = (await context.uow.curricula.listQuestions(OWNER, dayOne.id)).find(
      (entry) => entry.payload.type !== 'code_proof',
    )!;
    await submitAttempt(context, OWNER, gapId, {
      questionId: question.id,
      sessionId: 'review_seed',
      response: 'incorrect',
      idempotencyKey: 'review_seed_wrong',
    });

    const queue = await arcReviewsHandler(context, OWNER);
    expect(queue.reviews.length).toBeGreaterThan(0);
    const review = queue.reviews.find((entry) => entry.questionId === question.id)!;
    expect(review).not.toHaveProperty('answer');

    const submitted = await arcSubmitReviewHandler(context, OWNER, review.reviewId, {
      response: question.payload.answer,
      confidence: 'medium',
      idempotencyKey: `review:${review.reviewId}`,
    });
    expect(submitted.review.correct).toBe(true);
    expect(submitted.review.feedback.answer).toBe(question.payload.answer);
    expect(submitted.review.nextReview).toBeDefined();
  });
});

describe('Arc views reflect real database state', () => {
  it('maps the curriculum sequence from real mastery evidence', async () => {
    const { context } = buildContext();
    const gapId = await seedCompiledGap(context);

    const map = await arcMapHandler(context, OWNER, gapId);
    expect(map.map.progress.total).toBe(4);
    expect(map.map.progress.cleared).toBe(0);
    expect(map.map.sequence.every((s) => s.state === 'later' || s.state === 'current')).toBe(true);
    expect(map.map.hero).toBeDefined();
    expect(map.map.hero!.etaMinutes).toBeGreaterThan(0);

    const skills = await arcSkillsHandler(context, OWNER);
    expect(skills.skills).toHaveLength(1);
    expect(skills.skills[0]).toMatchObject({ started: true, objectivesCleared: 0 });

    const lesson = await arcLessonHandler(context, OWNER, gapId);
    expect(lesson.lesson.lesson.day).toBe(1);
    expect(lesson.lesson.audio).toBeDefined();
    expect(lesson.lesson.audio!.durationSeconds).toBeGreaterThan(0);
    expect(lesson.lesson.transcript.length).toBeGreaterThan(100);
    expect(lesson.lesson.notebook).toBeDefined();
    expect(lesson.lesson.notebook!.starterCode.length).toBeGreaterThan(0);
    expect(lesson.lesson.lesson.script).toContain('arbitrary element');

    // The audio the player drives is the lesson's real compiled TTS artefact: in-memory
    // storage serves the bytes through the API, and they are the synthesised audio.
    const audio = (await audioUrl(context, OWNER, gapId, lesson.lesson.audio!.artefactId)) as {
      bytes?: number[];
      mediaType?: string;
    };
    expect(audio.bytes!.length).toBeGreaterThan(0);
    expect(audio.mediaType).toContain('audio');
  });

  it('shows today data from the real gap state', async () => {
    const { context } = buildContext();
    await seedUser(context);
    const gapId = await seedCompiledGap(context);

    const today = await arcTodayHandler(context, OWNER);
    expect(today.today.continueGap?.gapId).toBe(gapId);
    expect(today.today.mapProgress.total).toBeGreaterThan(0);
    expect(today.today.focus.plannedMinutes).toBe(35);
    expect(today.today.momentumDays).toBe(0);
  });

  it('keeps a failed compile visible with a recovery route', async () => {
    const { context } = buildContext();
    await seedUser(context);
    const created = (await createGap(context, OWNER, {
      title: 'Recoverable skill',
      rawStatement: 'I need a route that demonstrates failed compilation recovery.',
      dailyMinutes: 20,
    })) as { gap: Gap };
    await transitionGap(context, OWNER, created.gap.id, { type: 'define' });
    await applyTransition(context, OWNER, created.gap.id, { type: 'compile' });
    await applyTransition(context, OWNER, created.gap.id, {
      type: 'compilation_failed',
      reason: 'No lesson was publishable.',
    });

    const skills = await arcSkillsHandler(context, OWNER);
    expect(skills.skills).toEqual([
      expect.objectContaining({ gapId: created.gap.id, status: 'failed' }),
    ]);
    const today = await arcTodayHandler(context, OWNER);
    expect(today.today.attention).toEqual([
      { gapId: created.gap.id, title: 'Recoverable skill', state: 'failed' },
    ]);
  });
});
