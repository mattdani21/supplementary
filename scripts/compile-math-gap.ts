/**
 * Compile the seeded math track end-to-end (GAP-033, E21).
 *
 * The companion to scripts/seed-curriculum.ts: it takes the gap_math_to_ml track that GAP-032
 * seeded and drives it through the full slice — sources -> normalise -> diagnose -> plan ->
 * lessons — with the deterministic fake provider, then asserts the GAP-033 acceptance criteria
 * in the same process:
 *
 *   1. plan validation passes (the packages/domain/src/curriculum/plan-validation.test.ts
 *      pattern, with the same satisfied-external-prerequisites the pipeline validated with);
 *   2. every objective maps to >= 1 lesson, >= 2 retrieval items and >= 1 application item;
 *   3. the Day-1 package publishes with an audio stub and a transcript;
 *   4. the compile is idempotent: a second run with the same idempotency key does not duplicate
 *      lessons or charges.
 *
 * The seed is idempotent, so re-running this against an already-seeded database compiles the
 * existing gap without duplicating anything; the compile key is fixed so re-running the script
 * hits the run-dedupe path and never charges twice.
 *
 * Run it:
 *
 *     GAPOS_DATABASE_URL=<dsn> pnpm tsx scripts/compile-math-gap.ts
 *
 * Without GAPOS_DATABASE_URL it runs against the in-memory repositories and prints the same
 * acceptance view, so the acceptance is demonstrable from a fresh checkout with no database.
 */
import { pathToFileURL } from 'node:url';
import type { CurriculumPlan } from '@gapos/ai-contracts';
import type { Lesson, OwnerId } from '@gapos/database';
import { findPlanViolations, type GenerationStatus } from '@gapos/domain';
import { referenceDiagnostic, referenceNormalisation } from '@gapos/test-fixtures';
import type { CompileOutcome } from '../apps/worker/src/pipeline/compile.js';
import { getServerContext } from '../apps/web/src/server/bootstrap.js';
import type { ServerContext } from '../apps/web/src/server/context.js';
import { applyTransition, compile } from '../apps/web/src/server/services/gap-service.js';
import { SEED_OWNER, seedCurriculum } from './seed-curriculum.js';

/** The seeded math-to-ML track's deterministic gap id (GAP-032). */
export const MATH_GAP_ID = 'gap_math_to_ml';

/**
 * The fixed idempotency key of the acceptance compile: a re-run of the script must return the
 * original run, not start a second one — that is what makes the script itself idempotent.
 */
export const MATH_GAP_COMPILE_KEY = 'gap-033-math-compile';

export interface DayOneAssertion {
  readonly lessonId: string;
  readonly published: boolean;
  readonly textOnly: boolean;
  readonly audioSegments: number;
  readonly publishedAt: Date;
  /** False only when the audio bytes live in another process's memory store (see below). */
  readonly audioStubBytesVerified: boolean;
}

export interface MathGapCompileSummary {
  readonly gapId: string;
  readonly runId: string;
  readonly curriculumId: string;
  readonly status: GenerationStatus;
  readonly lessonCount: number;
  readonly objectiveCount: number;
  readonly dayOne: DayOneAssertion;
  readonly dayOnePublishedAt?: Date;
  /** Run spend after the compile, used by the idempotency assertion. */
  readonly costMillicentsAfterCompile: number;
  readonly idempotentRepeat: boolean;
  readonly lessonsUnchanged: boolean;
  readonly chargesUnchanged: boolean;
}

/**
 * Seed, compile and verify gap_math_to_ml. Throws with a specific message when any acceptance
 * criterion fails; the script and the deterministic test both call this one function, so the
 * script's assertions are exactly the test's assertions.
 */
export const compileSeededMathGap = async (
  context: ServerContext,
  owner: OwnerId,
  idempotencyKey: string,
): Promise<MathGapCompileSummary> => {
  // The seed is idempotent (GAP-032): an existing gap and its sources are reused, never
  // duplicated, so compiling an already-seeded database is exactly as safe as a fresh one.
  await seedCurriculum(context, owner);

  const gap = await context.uow.gaps.get(owner, MATH_GAP_ID);
  if (!gap) {
    throw new Error(`Seeded gap ${MATH_GAP_ID} was not found after seeding.`);
  }

  // Drive the lifecycle the way the journey does: draft -> ready -> compiling -> active.
  if (gap.status === 'draft') {
    await applyTransition(context, owner, gap.id, { type: 'define' });
  }

  const outcome = await compile(context, owner, { gapId: gap.id, idempotencyKey });
  if (outcome.status !== 'complete') {
    throw new Error(
      `Compile of ${MATH_GAP_ID} did not complete: ${outcome.status} — ` +
        `${outcome.error ?? 'unknown error'}.`,
    );
  }

  // The pipeline omits curriculumId and returns a summary-only days list when the idempotency
  // key has been seen — that is its idempotency contract — so resolve the run's curriculum
  // instead of assuming the outcome carries it.
  const freshCompile = outcome.deduplicated !== true;
  const curriculum =
    (outcome.curriculumId
      ? await context.uow.curricula.get(owner, outcome.curriculumId)
      : undefined) ??
    (await context.uow.curricula.getForRun(owner, outcome.runId)) ??
    (await context.uow.curricula.getCurrentForGap(owner, gap.id));
  if (!curriculum) throw new Error('Curriculum missing after a successful compile.');

  /* ---------------------------------------------------------- acceptance 1: valid plan */
  assertPlanValid(curriculum.plan);

  /* --------------------------------- acceptance 2: objective mapping invariants */
  const lessons = await context.uow.curricula.listLessons(owner, curriculum.id);
  await assertObjectiveCoverage(curriculum.plan, lessons, context, owner);

  /* --------------------------------- acceptance 3: Day 1 publishes with audio + transcript */
  const dayOne = await assertDayOnePublished(lessons, context, owner, { freshCompile });

  /* ------------------- acceptance 4: idempotent — no duplicate lessons or charges */
  const idempotency = await assertIdempotentRepeat({
    context,
    owner,
    gapId: gap.id,
    idempotencyKey,
    outcome,
    curriculumId: curriculum.id,
    lessonsBefore: lessons.length,
  });

  return {
    gapId: gap.id,
    runId: outcome.runId,
    curriculumId: curriculum.id,
    status: outcome.status,
    lessonCount: lessons.length,
    objectiveCount: curriculum.plan.objectives.length,
    dayOne,
    ...(dayOne.publishedAt ? { dayOnePublishedAt: dayOne.publishedAt } : {}),
    costMillicentsAfterCompile: context.costAccountant.spentForRun(outcome.runId),
    ...idempotency,
  };
};

/**
 * The external prerequisites the pipeline treated as held: stage A's normalisation assumptions
 * plus stage C's demonstrated capabilities, exactly what compile.ts passes as
 * satisfiedExternalPrerequisites. Asserting the stored plan against this set is the same check
 * the pipeline performed before generating a single lesson.
 */
const satisfiedExternalPrerequisites = (): readonly string[] => [
  ...referenceNormalisation().assumedPrerequisites,
  ...referenceDiagnostic().demonstratedCapabilities,
];

const assertPlanValid = (plan: CurriculumPlan): void => {
  const violations = findPlanViolations(plan, {
    satisfiedExternalPrerequisites: satisfiedExternalPrerequisites(),
  });
  if (violations.length > 0) {
    throw new Error(
      `Plan validation failed with ${violations.length} violation(s): ` +
        violations.map((v) => v.message).join(' '),
    );
  }
};

const assertObjectiveCoverage = async (
  plan: CurriculumPlan,
  lessons: readonly Lesson[],
  context: ServerContext,
  owner: OwnerId,
): Promise<void> => {
  const questions = (
    await Promise.all(
      lessons.map((lesson) => context.uow.curricula.listQuestions(owner, lesson.id)),
    )
  ).flat();

  for (const objective of plan.objectives) {
    const teachingLessons = lessons.filter((lesson) => lesson.objectiveIds.includes(objective.id));
    const items = questions.filter((question) => question.objectiveId === objective.id);
    const retrieval = items.filter((question) => question.payload.role === 'retrieval').length;
    const application = items.filter(
      (question) => question.payload.role === 'application' || question.payload.role === 'transfer',
    ).length;

    if (teachingLessons.length < 1 || retrieval < 2 || application < 1) {
      throw new Error(
        `Objective "${objective.id}" breaks the coverage invariant: ${teachingLessons.length} ` +
          `lesson(s), ${retrieval} retrieval item(s), ${application} application item(s) — need ` +
          '>= 1 lesson, >= 2 retrieval and >= 1 application.',
      );
    }
  }
};

/**
 * Day 1 must be published with an audio stub and a transcript. Asserted from the repository,
 * not from the compile outcome, because a deduplicated repeat returns a summary-only days list
 * (audioSegments: 0) — the artefacts are the ground truth either way.
 *
 * The stub bytes themselves are verified whenever the current storage serves them: a fresh
 * compile writes to this process's store, and an S3-backed deployment serves them on any re-run.
 * The one case where the byte read is not possible is a deduplicated re-run against the
 * per-process memory store (GAP-026): the bytes lived in the process that compiled. That case
 * is reported explicitly rather than failed — the pipeline verified audio integrity before
 * publishing, the artefact rows (kind, mediaType, checksum) survive in the database, and the
 * fresh run demonstrated the stub bytes.
 */
const assertDayOnePublished = async (
  lessons: readonly Lesson[],
  context: ServerContext,
  owner: OwnerId,
  options: { readonly freshCompile: boolean },
): Promise<DayOneAssertion> => {
  const dayOne = lessons.find((lesson) => lesson.day === 1);
  if (!dayOne) throw new Error('The published course has no Day-1 lesson.');
  if (dayOne.publicationStatus !== 'published' || !dayOne.publishedAt) {
    throw new Error(`Day 1 was not published (status ${dayOne.publicationStatus}).`);
  }

  const artefacts = await context.uow.curricula.listArtefacts(owner, dayOne.id);
  const audio = artefacts.filter((artefact) => artefact.kind === 'audio');
  const transcript = artefacts.find((artefact) => artefact.kind === 'transcript');
  if (audio.length === 0 || !transcript) {
    throw new Error(
      `Day 1 artefacts incomplete: ${audio.length} audio segment(s), ` +
        `transcript=${transcript !== undefined}.`,
    );
  }

  let audioStubBytesVerified = false;
  const object = await context.storage.get(owner, audio[0]!.storageKey);
  if (object) {
    if (!new TextDecoder().decode(object.bytes).includes('FAKE-AUDIO:')) {
      throw new Error('Day 1 audio artefact is not the deterministic fake audio stub.');
    }
    audioStubBytesVerified = true;
  } else if (options.freshCompile) {
    throw new Error('Day 1 audio bytes missing from storage.');
  } else {
    context.logger.warn(
      "Day 1 audio stub bytes live in the compiling process's memory store; verified at " +
        'publish time by the pipeline and recorded as artefact rows. Re-run without durable ' +
        '(S3) storage cannot re-read them.',
      { lessonId: dayOne.id },
    );
  }

  return {
    lessonId: dayOne.id,
    published: true,
    textOnly: false,
    audioSegments: audio.length,
    publishedAt: dayOne.publishedAt,
    audioStubBytesVerified,
  };
};

const assertIdempotentRepeat = async (params: {
  context: ServerContext;
  owner: OwnerId;
  gapId: string;
  idempotencyKey: string;
  outcome: CompileOutcome;
  curriculumId: string;
  lessonsBefore: number;
}): Promise<{
  idempotentRepeat: boolean;
  lessonsUnchanged: boolean;
  chargesUnchanged: boolean;
}> => {
  const { context, owner, gapId, idempotencyKey, outcome, curriculumId, lessonsBefore } = params;

  const spendBefore = context.costAccountant.spentForRun(outcome.runId);
  const repeat = await compile(context, owner, { gapId, idempotencyKey });
  const spendAfter = context.costAccountant.spentForRun(outcome.runId);
  const lessonsAfter = await context.uow.curricula.listLessons(owner, curriculumId);

  const idempotentRepeat = repeat.deduplicated === true && repeat.runId === outcome.runId;
  const lessonsUnchanged = lessonsAfter.length === lessonsBefore;
  const chargesUnchanged = spendAfter === spendBefore;

  if (!idempotentRepeat || !lessonsUnchanged || !chargesUnchanged) {
    throw new Error(
      'The compile was not idempotent: ' +
        `deduplicated=${repeat.deduplicated}, sameRun=${repeat.runId === outcome.runId}, ` +
        `lessons ${lessonsBefore} -> ${lessonsAfter.length}, spend ${spendBefore} -> ${spendAfter}.`,
    );
  }

  return { idempotentRepeat, lessonsUnchanged, chargesUnchanged };
};

const write = (line: string): void => {
  // The script's stdout is its interface; lint's no-console exception covers warn/error only.
  process.stdout.write(`${line}\n`);
};

const main = async (): Promise<void> => {
  const context = await getServerContext();
  const summary = await compileSeededMathGap(context, SEED_OWNER, MATH_GAP_COMPILE_KEY);

  write(
    `GAP-033 OK: ${summary.gapId} compiled end-to-end (${summary.status}) — ` +
      `${summary.objectiveCount} objectives, ${summary.lessonCount} lessons; ` +
      `Day 1 published with ${summary.dayOne.audioSegments} audio segment(s) + transcript ` +
      `(stub bytes verified=${summary.dayOne.audioStubBytesVerified}); ` +
      `repeat compile deduplicated=${summary.idempotentRepeat}, ` +
      `lessons unchanged=${summary.lessonsUnchanged}, charges unchanged=${summary.chargesUnchanged}; ` +
      `run ${summary.runId}`,
  );
};

// Run only when executed directly, so the repository test can import compileSeededMathGap.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `GAP-033 FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
