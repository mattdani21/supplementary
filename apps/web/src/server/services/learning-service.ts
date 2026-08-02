/**
 * Learning use cases: the Today queue, practice attempts, the mastery check and the capability
 * library.
 *
 * The invariant this file exists to protect: a gap fills on evidence and nothing else. Every
 * path that could move a gap to `filled` runs through `assessCurriculum`, and the state machine
 * refuses the transition unless the evidence it is handed accounts for every required objective.
 */

import type { Attempt, Curriculum, OwnerId, ReviewItem, StoredQuestion } from '@gapos/database';
import {
  applyHintPenalty,
  assessCurriculum,
  buildTodayQueue,
  grade,
  scheduleAfterAttempt,
  scheduleAfterReview,
  transitionGap,
  type CurriculumMastery,
  type Evidence,
  type EvidenceType,
  type Grade,
  type ObjectiveNode,
} from '@gapos/domain';
import type { ServerContext } from '../context.js';

/* ----------------------------------------------------------------------- today */

export interface TodayView {
  readonly reviews: readonly { id: string; objectiveId: string; dueAt: Date }[];
  readonly lesson?: { day: number; lessonId: string; title: string };
  readonly totalItems: number;
}

export const getToday = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<TodayView> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) return { reviews: [], totalItems: 0 };

  const [dueReviews, lessons] = await Promise.all([
    context.uow.mastery.listDueReviews(owner, context.now()),
    context.uow.curricula.listLessons(owner, curriculum.id),
  ]);

  const attempts = await Promise.all(
    lessons.map(async (lesson) => ({
      lesson,
      questions: await context.uow.curricula.listQuestions(owner, lesson.id),
    })),
  );

  // The next published day the learner has not attempted anything on.
  let nextLesson: { day: number; lessonId: string; title: string } | undefined;
  for (const { lesson, questions } of attempts) {
    if (lesson.publicationStatus !== 'published') continue;
    const questionIds = new Set(questions.map((q) => q.id));
    const done = await hasAnyAttempt(context, owner, questionIds);
    if (!done) {
      nextLesson = { day: lesson.day, lessonId: lesson.id, title: lesson.title };
      break;
    }
  }

  const queue = buildTodayQueue({
    now: context.now(),
    dueReviews: dueReviews.map((r) => ({ id: r.id, objectiveId: r.objectiveId, dueAt: r.dueAt })),
    ...(nextLesson
      ? { nextLessonDay: { day: nextLesson.day, lessonId: nextLesson.lessonId } }
      : {}),
  });

  return {
    reviews: queue.reviews,
    ...(nextLesson ? { lesson: nextLesson } : {}),
    totalItems: queue.totalItems,
  };
};

const hasAnyAttempt = async (
  context: ServerContext,
  owner: OwnerId,
  questionIds: ReadonlySet<string>,
): Promise<boolean> => {
  for (const id of questionIds) {
    const question = await context.uow.curricula.getQuestion(owner, id);
    if (!question) continue;
    const attempts = await context.uow.attempts.listForObjective(owner, question.objectiveId);
    if (attempts.some((a) => a.questionId === id)) return true;
  }
  return false;
};

/* --------------------------------------------------------------------- attempts */

export interface SubmitAttemptInput {
  readonly questionId: string;
  readonly sessionId: string;
  readonly response: string;
  readonly hintsUsed?: number;
  readonly confidence?: 'low' | 'medium' | 'high';
  /** Required: a replayed submit must not record a second piece of evidence. */
  readonly idempotencyKey: string;
  readonly evidenceType?: EvidenceType;
}

export interface AttemptResult {
  readonly attempt: Attempt;
  readonly created: boolean;
  readonly grade: Grade;
  readonly correct: boolean;
  /** Shown to the learner after they answer, never before. */
  readonly feedback: { readonly answer: string; readonly rubric?: string };
  readonly scheduledReviews: readonly ReviewItem[];
}

const evidenceTypeFor = (question: StoredQuestion, override?: EvidenceType): EvidenceType => {
  if (override) return override;
  switch (question.payload.role) {
    case 'transfer':
      return 'transfer';
    case 'application':
      return 'application';
    default:
      return 'retrieval';
  }
};

export const submitAttempt = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  input: SubmitAttemptInput,
): Promise<AttemptResult> => {
  const question = await context.uow.curricula.getQuestion(owner, input.questionId);
  if (!question) throw new Error(`Question ${input.questionId} was not found for this owner.`);

  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) throw new Error(`No curriculum for gap ${gapId}.`);

  const hintsUsed = input.hintsUsed ?? 0;
  const verdict = grade(question.payload, { text: input.response, hintsUsed });

  // A rubric-required grade needs a model. In the fixture-driven slice it is conservative:
  // unmatched free text is not credited rather than being optimistically accepted.
  const correct = verdict.method === 'deterministic' ? verdict.correct : false;
  const rawScore = verdict.method === 'deterministic' ? verdict.score : 0;
  const score = applyHintPenalty(rawScore, hintsUsed);

  const { attempt, created } = await context.uow.attempts.record(owner, {
    id: context.newId('attempt'),
    questionId: input.questionId,
    sessionId: input.sessionId,
    response: input.response,
    correct,
    score,
    hintsUsed,
    ...(input.confidence ? { confidence: input.confidence } : {}),
    idempotencyKey: input.idempotencyKey,
    completedAt: context.now(),
  });

  context.metrics.increment('attempt_total', { objectiveId: question.objectiveId });
  if (correct)
    context.metrics.increment('attempt_correct_total', { objectiveId: question.objectiveId });

  const scheduledReviews: ReviewItem[] = [];

  if (created) {
    await context.uow.mastery.addEvidence(owner, {
      id: context.newId('evidence'),
      objectiveId: question.objectiveId,
      curriculumId: curriculum.id,
      attemptId: attempt.id,
      sessionId: input.sessionId,
      evidenceType: evidenceTypeFor(question, input.evidenceType),
      score,
      independent: hintsUsed === 0,
      difficulty: question.payload.difficulty,
      recordedAt: context.now(),
    });

    for (const scheduled of scheduleAfterAttempt({
      objectiveId: question.objectiveId,
      questionId: input.questionId,
      correct,
      ...(input.confidence ? { confidence: input.confidence } : {}),
      at: context.now(),
    })) {
      scheduledReviews.push(
        await context.uow.mastery.scheduleReview(owner, {
          id: context.newId('review'),
          objectiveId: scheduled.objectiveId,
          ...(scheduled.questionId ? { questionId: scheduled.questionId } : {}),
          curriculumId: curriculum.id,
          dueAt: scheduled.dueAt,
          intervalDays: scheduled.intervalDays,
          state: 'scheduled',
          reason: scheduled.reason,
        }),
      );
    }

    // Once an attempt references a lesson's artefacts, those artefacts are frozen: an edit
    // creates a new version rather than rewriting what the learner actually answered against.
    await context.uow.curricula.freezeArtefacts(owner, question.lessonId);
  }

  return {
    attempt,
    created,
    grade: verdict,
    correct,
    feedback: {
      answer: question.payload.answer,
      ...(question.payload.rubric ? { rubric: question.payload.rubric } : {}),
    },
    scheduledReviews,
  };
};

export const completeReview = async (
  context: ServerContext,
  owner: OwnerId,
  reviewId: string,
  correct: boolean,
): Promise<ReviewItem | undefined> => {
  const due = await context.uow.mastery.listDueReviews(owner, context.now());
  const review = due.find((r) => r.id === reviewId);
  if (!review) return undefined;

  await context.uow.mastery.completeReview(owner, reviewId);
  const next = scheduleAfterReview(
    { objectiveId: review.objectiveId, intervalDays: review.intervalDays },
    correct,
    context.now(),
  );
  if (!next) return undefined;

  return context.uow.mastery.scheduleReview(owner, {
    id: context.newId('review'),
    objectiveId: next.objectiveId,
    curriculumId: review.curriculumId,
    dueAt: next.dueAt,
    intervalDays: next.intervalDays,
    state: 'scheduled',
    reason: next.reason,
  });
};

/* ---------------------------------------------------------------------- mastery */

const objectiveNodes = (curriculum: Curriculum): ObjectiveNode[] =>
  curriculum.plan.objectives.map((objective) => ({
    id: objective.id,
    required: objective.required,
    prerequisiteObjectiveIds: objective.prerequisiteObjectiveIds,
  }));

export const assessMastery = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<CurriculumMastery> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) throw new Error(`No curriculum for gap ${gapId}.`);

  const records = await context.uow.mastery.listEvidenceForCurriculum(owner, curriculum.id);
  const evidence: Evidence[] = records.map((record) => ({
    objectiveId: record.objectiveId,
    sessionId: record.sessionId,
    evidenceType: record.evidenceType,
    score: record.score,
    independent: record.independent,
    difficulty: record.difficulty,
    recordedAt: record.recordedAt,
  }));

  return assessCurriculum(objectiveNodes(curriculum), evidence);
};

export interface MasteryCheckResult {
  readonly mastery: CurriculumMastery;
  readonly filled: boolean;
  /** Present when the gap could not be filled: which clause of the rule is still unmet. */
  readonly blockedBy?: readonly string[];
}

/**
 * The mastery check. Note what it does *not* do: there is no path here that fills a gap without
 * first assessing the evidence, and the state machine independently refuses a `mastery_confirmed`
 * transition whose evidence does not account for every required objective.
 */
export const runMasteryCheck = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<MasteryCheckResult> => {
  const gap = await context.uow.gaps.get(owner, gapId);
  if (!gap) throw new Error(`Gap ${gapId} was not found for this owner.`);

  const mastery = await assessMastery(context, owner, gapId);

  if (gap.status === 'active') {
    const toCheck = transitionGap(gap.status, { type: 'request_mastery_check' });
    if (!toCheck.ok) throw toCheck.error;
    await context.uow.gaps.setStatus(owner, gapId, toCheck.value, gap.status);
  }

  const current = await context.uow.gaps.get(owner, gapId);
  if (current?.status !== 'mastery_check') {
    return {
      mastery,
      filled: false,
      blockedBy: [`The gap is ${current?.status ?? 'missing'}, not ready for a mastery check.`],
    };
  }

  const attempt = transitionGap('mastery_check', {
    type: 'mastery_confirmed',
    evidence: {
      requiredObjectiveIds: mastery.requiredObjectiveIds,
      masteredObjectiveIds: mastery.masteredObjectiveIds,
    },
  });

  if (!attempt.ok) {
    // Not an error: the learner simply has not proved it yet. Return to active so they can
    // keep practising, and say precisely what is missing.
    const rejected = transitionGap('mastery_check', { type: 'mastery_rejected' });
    if (rejected.ok) {
      await context.uow.gaps.setStatus(owner, gapId, rejected.value, 'mastery_check');
    }
    return {
      mastery,
      filled: false,
      blockedBy: mastery.assessments.filter((a) => !a.mastered).flatMap((a) => a.missing),
    };
  }

  await context.uow.gaps.setStatus(owner, gapId, attempt.value, 'mastery_check');

  // A filled gap becomes a reusable capability: record what it unlocks.
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (curriculum) {
    for (const objective of curriculum.plan.objectives) {
      for (const prerequisiteId of objective.prerequisiteObjectiveIds) {
        await context.uow.knowledge.addEdge(owner, {
          id: context.newId('edge'),
          fromCapability: prerequisiteId,
          toCapability: objective.id,
          relationship: 'prerequisite_of',
          confidence: 0.9,
        });
      }
    }
  }

  return { mastery, filled: true };
};

/* ------------------------------------------------------------------ capabilities */

export interface Capability {
  readonly gapId: string;
  readonly title: string;
  readonly targetCapability?: string;
  readonly objectiveIds: readonly string[];
  readonly filledAt: Date;
}

export const searchCapabilities = async (
  context: ServerContext,
  owner: OwnerId,
  query = '',
): Promise<Capability[]> => {
  const filled = await context.uow.gaps.list(owner, { status: 'filled' });
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);

  const capabilities = await Promise.all(
    filled.map(async (gap) => {
      const curriculum = await context.uow.curricula.getCurrentForGap(owner, gap.id);
      return {
        gapId: gap.id,
        title: gap.title,
        ...(gap.targetCapability ? { targetCapability: gap.targetCapability } : {}),
        objectiveIds: curriculum?.plan.objectives.map((o) => o.id) ?? [],
        filledAt: gap.updatedAt,
      };
    }),
  );

  if (terms.length === 0) return capabilities;

  return capabilities.filter((capability) => {
    const haystack = [
      capability.title,
      capability.targetCapability ?? '',
      ...capability.objectiveIds,
    ]
      .join(' ')
      .toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
};
