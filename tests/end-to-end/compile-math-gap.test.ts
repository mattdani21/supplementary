/**
 * Compile the seeded math track end-to-end (GAP-033, E21).
 *
 * Runs the same function scripts/compile-math-gap.ts exposes — the script that drives
 * gap_math_to_ml through the full slice (sources -> normalise -> diagnose -> plan -> lessons)
 * via the CLI service layer — against the in-memory repositories with the deterministic fake
 * provider, and asserts the acceptance criteria:
 *
 *   1. compiling the seeded math gap yields a valid plan (the plan-validation pattern);
 *   2. every objective maps to >= 1 lesson, >= 2 retrieval items and >= 1 application item;
 *   3. the Day-1 package publishes with an audio stub and a transcript;
 *   4. the compile is idempotent: a second run with the same idempotency key does not duplicate
 *      lessons or charges.
 *
 * No network, no live provider, no database — deterministic by construction, exactly like the
 * seed test (GAP-032) it sits beside.
 */

import { describe, expect, it } from 'vitest';
import {
  lessonMissingCheckpoint,
  referenceDiagnostic,
  referenceLesson,
  referenceNormalisation,
} from '@gapos/test-fixtures';
import { findPlanViolations } from '@gapos/domain';
import type { OwnerId } from '@gapos/database';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import { applyTransition, compile } from '../../apps/web/src/server/services/gap-service.js';
import { compileSeededMathGap, MATH_GAP_ID } from '../../scripts/compile-math-gap.js';
import { seedCurriculum } from '../../scripts/seed-curriculum.js';

const OWNER: OwnerId = 'user_math_compile';
/** A fixed key so the acceptance's idempotency claim is exercised, not assumed. */
const IDEMPOTENCY_KEY = 'gap-033-math-compile';

/** The day number the fake provider encodes in a lesson request's subject ("day-2"). */
const dayFromSubject = (subject: string | undefined): number => {
  const match = /(\d+)/.exec(subject ?? '');
  return match?.[1] ? Number(match[1]) : 1;
};

const buildContext = (): ServerContext => createServerContext({ logLevel: 'error' });

/**
 * The external prerequisites the compile treats as held: stage A's normalisation assumptions
 * plus stage C's demonstrated capabilities, exactly what compile.ts passes as
 * satisfiedExternalPrerequisites. Mirrored here so the stored plan is validated the way the
 * pipeline validated it.
 */
const satisfiedPrerequisites = (): string[] => [
  ...referenceNormalisation().assumedPrerequisites,
  ...referenceDiagnostic().demonstratedCapabilities,
];

describe('compile the seeded math gap (GAP-033)', () => {
  it('compiles gap_math_to_ml to a complete course whose plan passes validation', async () => {
    const context = buildContext();
    const summary = await compileSeededMathGap(context, OWNER, IDEMPOTENCY_KEY);

    expect(summary.gapId).toBe(MATH_GAP_ID);
    expect(summary.status).toBe('complete');
    expect(summary.curriculumId).toBeDefined();
    expect(summary.lessonCount).toBeGreaterThan(0);

    const curriculum = await context.uow.curricula.get(OWNER, summary.curriculumId);
    expect(curriculum, 'the run produced a curriculum').toBeDefined();
    expect(curriculum!.status).toBe('published');

    // Acceptance 1: the plan passes the same validation the plan-validation suite checks.
    expect(
      findPlanViolations(curriculum!.plan, {
        satisfiedExternalPrerequisites: satisfiedPrerequisites(),
      }),
    ).toEqual([]);

    // The seeded sources were already ingested with structural locators (GAP-032), so the
    // compile found evidence without re-extracting.
    const sources = await context.uow.sources.listForGap(OWNER, MATH_GAP_ID);
    expect(sources.length).toBeGreaterThanOrEqual(2);
    for (const source of sources) {
      expect(source.processingStatus).toBe('indexed');
    }
  });

  it('maps every objective to at least one lesson, two retrieval items and one application item', async () => {
    const context = buildContext();
    const summary = await compileSeededMathGap(context, OWNER, IDEMPOTENCY_KEY);

    const curriculum = await context.uow.curricula.get(OWNER, summary.curriculumId);
    const lessons = await context.uow.curricula.listLessons(OWNER, summary.curriculumId);
    const questions = (
      await Promise.all(
        lessons.map((lesson) => context.uow.curricula.listQuestions(OWNER, lesson.id)),
      )
    ).flat();

    expect(curriculum!.plan.objectives.length).toBeGreaterThan(0);
    for (const objective of curriculum!.plan.objectives) {
      const teachingLessons = lessons.filter((lesson) =>
        lesson.objectiveIds.includes(objective.id),
      );
      const items = questions.filter((question) => question.objectiveId === objective.id);
      const retrieval = items.filter((question) => question.payload.role === 'retrieval').length;
      const application = items.filter(
        (question) =>
          question.payload.role === 'application' || question.payload.role === 'transfer',
      ).length;

      expect(
        teachingLessons.length,
        `objective ${objective.id} is taught by >= 1 lesson`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        retrieval,
        `objective ${objective.id} has >= 2 retrieval items`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        application,
        `objective ${objective.id} has >= 1 application item`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('publishes the Day-1 package with an audio stub and a transcript', async () => {
    const context = buildContext();
    const summary = await compileSeededMathGap(context, OWNER, IDEMPOTENCY_KEY);

    expect(summary.dayOne.published).toBe(true);
    expect(summary.dayOne.textOnly).toBe(false);
    expect(summary.dayOne.audioSegments).toBeGreaterThan(0);
    expect(summary.dayOnePublishedAt).toBeDefined();

    const [dayOne] = await context.uow.curricula.listLessons(OWNER, summary.curriculumId);
    expect(dayOne?.day).toBe(1);
    expect(dayOne?.publicationStatus).toBe('published');
    // The published package carries the spoken script and its transcript together.
    expect(dayOne!.package.script.length).toBeGreaterThan(0);
    expect(dayOne!.package.transcript).toBe(dayOne!.package.script);

    const artefacts = await context.uow.curricula.listArtefacts(OWNER, dayOne!.id);
    const audio = artefacts.filter((artefact) => artefact.kind === 'audio');
    const transcript = artefacts.find((artefact) => artefact.kind === 'transcript');
    expect(audio.length).toBe(summary.dayOne.audioSegments);
    expect(transcript, 'Day 1 ships a transcript artefact').toBeDefined();

    // The audio stub is playable bytes tied to the spoken text (the fake's FAKE-AUDIO envelope).
    const object = await context.storage.get(OWNER, audio[0]!.storageKey);
    expect(object, 'the audio stub is retrievable from storage').toBeDefined();
    expect(new TextDecoder().decode(object!.bytes)).toContain('FAKE-AUDIO:');
  });

  it('is idempotent: a repeated compile duplicates neither lessons nor charges', async () => {
    const context = buildContext();
    const summary = await compileSeededMathGap(context, OWNER, IDEMPOTENCY_KEY);

    // The script's own repeat (same key) deduplicated to the original run.
    expect(summary.idempotentRepeat).toBe(true);
    expect(summary.lessonsUnchanged).toBe(true);
    expect(summary.chargesUnchanged).toBe(true);

    // A further repeat from the outside behaves the same way, without touching the run.
    const gap = await context.uow.gaps.get(OWNER, MATH_GAP_ID);
    const again = await compile(context, OWNER, {
      gapId: gap!.id,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(again.deduplicated).toBe(true);
    expect(again.runId).toBe(summary.runId);

    const lessons = await context.uow.curricula.listLessons(OWNER, summary.curriculumId);
    expect(lessons).toHaveLength(summary.lessonCount);
    expect(context.costAccountant.spentForRun(summary.runId)).toBe(
      summary.costMillicentsAfterCompile,
    );
  });

  it('is safe to re-run the whole script: the second run compiles against the existing course', async () => {
    const context = buildContext();
    const first = await compileSeededMathGap(context, OWNER, IDEMPOTENCY_KEY);

    // The second run of the script returns the same run and the same curriculum, and the
    // repo still holds exactly one course with the same lessons.
    const second = await compileSeededMathGap(context, OWNER, IDEMPOTENCY_KEY);
    expect(second.runId).toBe(first.runId);
    expect(second.curriculumId).toBe(first.curriculumId);
    expect(second.status).toBe('complete');
    expect(second.lessonCount).toBe(first.lessonCount);
    expect(second.dayOne.audioSegments).toBe(first.dayOne.audioSegments);

    const lessons = await context.uow.curricula.listLessons(OWNER, first.curriculumId);
    expect(lessons).toHaveLength(first.lessonCount);
    expect(context.costAccountant.spentForRun(first.runId)).toBe(first.costMillicentsAfterCompile);
  });
});

describe('a lesson missing a structural element is never published (E24 US1, T009)', () => {
  it('repairs or excludes a scripted lesson without a checkpoint', async () => {
    // Script the fake provider: the first lesson package is faulty (no checkpoint question),
    // every later one — including the repair — is the clean reference content.
    let faultyServed = false;
    const context = createServerContext({
      logLevel: 'error',
      fake: {
        script: {
          lesson_package: (request) => {
            const day = dayFromSubject(request.subject);
            if (!faultyServed) {
              faultyServed = true;
              return lessonMissingCheckpoint(day);
            }
            return referenceLesson(day);
          },
        },
      },
    });

    await seedCurriculum(context, OWNER);
    const gap = await context.uow.gaps.get(OWNER, MATH_GAP_ID);
    if (gap?.status === 'draft') {
      await applyTransition(context, OWNER, gap.id, { type: 'define' });
    }
    const outcome = await compile(context, OWNER, {
      gapId: MATH_GAP_ID,
      idempotencyKey: 'e24-us1-faulty-structure',
    });

    expect(outcome.status, outcome.error ?? 'compile completes').toBe('complete');

    const curriculum = await context.uow.curricula.getForRun(OWNER, outcome.runId);
    const lessons = await context.uow.curricula.listLessons(OWNER, curriculum!.id);
    const published = lessons.filter((lesson) => lesson.publicationStatus === 'published');

    expect(published.length).toBeGreaterThan(0);
    for (const lesson of published) {
      // The published surface can never carry the faulty script: every published lesson keeps
      // its checkpoint question (repaired) or the lesson was excluded entirely.
      expect(
        lesson.package.pausePrompts.length,
        `day ${lesson.day} published with a checkpoint question`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});
