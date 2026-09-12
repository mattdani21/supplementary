/**
 * The Arc application service layer (GAP-032).
 *
 * Every value here is real domain data from the API — gap statuses, curriculum objectives,
 * mastery evidence, review scheduling, provider-validated calibration content. Nothing is
 * invented client-side: the views are projections over the same services the rest of the
 * product uses, so the Arc screens cannot drift from the engine.
 */

import {
  CalibrationContract,
  DiagnosticInterpretationContract,
  type Calibration,
} from '@gapos/ai-contracts';
import type { LearnerPreferences, OwnerId, ReviewItem, StoredQuestion } from '@gapos/database';
import type { ServerContext } from '../context.js';
import { createGap } from './gap-service.js';
import {
  assessMastery,
  completeReview,
  getToday,
  searchCapabilities,
  submitAttempt,
  type AttemptResult,
} from './learning-service.js';

/* --------------------------------------------------------------- preferences */

export const DEFAULT_PREFERENCES: Omit<LearnerPreferences, 'ownerId' | 'updatedAt'> = {
  audioTheory: true,
  gentleHints: true,
  darkMode: false,
  spacedReview: false,
};

export const getPreferences = async (
  context: ServerContext,
  owner: OwnerId,
): Promise<LearnerPreferences> => {
  const stored = await context.uow.preferences.get(owner);
  return stored ?? { ownerId: owner, ...DEFAULT_PREFERENCES, updatedAt: context.now() };
};

export const setPreferences = async (
  context: ServerContext,
  owner: OwnerId,
  values: Omit<LearnerPreferences, 'ownerId' | 'updatedAt'>,
): Promise<LearnerPreferences> => {
  const stored = await context.uow.preferences.set(owner, values, context.now());
  context.metrics.increment('arc_preferences_updated_total');
  return stored;
};

/* --------------------------------------------------------------- calibration */

export interface CalibrationKitView {
  readonly kitId: string;
  readonly subject: string;
  readonly goalOptions: readonly string[];
  readonly baselineQuestion: {
    id: string;
    prompt: string;
    code: string;
    options: readonly string[];
  };
}

/**
 * The baseline question and goal options, schema-validated at the adapter boundary. The answer
 * key never leaves the server: `fetchCalibrationKit` returns it, `toCalibrationKitView` strips
 * it, so a client cannot read the answer from the API.
 */
const fetchCalibrationKit = async (
  context: ServerContext,
  owner: OwnerId,
  subject: string,
): Promise<Calibration> =>
  (
    await context.providers.languageModel.generate({
      contract: CalibrationContract,
      purpose: 'classification',
      temperature: 0,
      runId: context.newId('run'),
      userId: owner,
      subject,
      instruction:
        `Produce the calibration kit for the subject "${subject}": three goal options and one ` +
        'baseline code question with at least three distinct options and the correct answer ' +
        'among them.',
    })
  ).value;

export const toCalibrationKitView = (kitId: string, kit: Calibration): CalibrationKitView => ({
  kitId,
  subject: kit.subject,
  goalOptions: kit.goalOptions,
  baselineQuestion: {
    id: kit.baselineQuestion.id,
    prompt: kit.baselineQuestion.prompt,
    code: kit.baselineQuestion.code,
    options: kit.baselineQuestion.options,
  },
});

export const calibrationKit = async (
  context: ServerContext,
  owner: OwnerId,
  subject: string,
): Promise<CalibrationKitView> => {
  const kit = await fetchCalibrationKit(context, owner, subject);
  return toCalibrationKitView(context.calibrationKits.issue(owner, subject, kit), kit);
};

export interface CalibrationInput {
  readonly kitId: string;
  readonly subject: string;
  readonly goal: string;
  readonly baselineAnswer: string;
  readonly dailyMinutes?: number;
  readonly deadline?: string;
  readonly sourcePolicy?: 'general_knowledge_allowed' | 'sources_only';
}

export interface CalibrationResult {
  readonly calibrationId: string;
  readonly gapId: string;
  readonly subject: string;
  readonly goal: string;
  readonly baselineCorrect: boolean;
  readonly gapsIdentified: readonly string[];
  readonly startingDifficulty: number;
  readonly preview: { next?: string; after?: string; later: readonly string[] };
  /** Real gaps the learner already has whose titles share the subject's terms. */
  readonly relatedGapIds: readonly string[];
}

export class CalibrationKitUnavailableError extends Error {
  constructor() {
    super('This calibration check expired or belongs to another learner. Load a fresh check.');
    this.name = 'CalibrationKitUnavailableError';
  }
}

/**
 * Run the 3-step calibration: grade the baseline answer (exact option match, server-side),
 * create the real gap the route leads to, and interpret the diagnostic through the provider
 * adapter with the baseline outcome encoded — a correct baseline raises the starting point, a
 * miss lowers it. The selections and the schema-validated interpretation are persisted, so the
 * flow is replayable and auditable.
 */
export const runCalibration = async (
  context: ServerContext,
  owner: OwnerId,
  input: CalibrationInput,
): Promise<CalibrationResult> => {
  const kit = context.calibrationKits.get(owner, input.kitId, input.subject);
  if (!kit) throw new CalibrationKitUnavailableError();
  const baselineCorrect = kit.baselineQuestion.answer === input.baselineAnswer;

  const diagnostic = (
    await context.providers.languageModel.generate({
      contract: DiagnosticInterpretationContract,
      purpose: 'classification',
      temperature: 0,
      runId: context.newId('run'),
      userId: owner,
      subject: `arc-baseline-${baselineCorrect ? 'correct' : 'wrong'}`,
      instruction:
        `The learner answered the Arc baseline question for "${input.subject}" ` +
        `${baselineCorrect ? 'correctly' : 'incorrectly'}. Interpret the diagnostic adaptively: ` +
        'a correct baseline raises the starting difficulty and shrinks the gap list; a miss ' +
        'lowers the starting difficulty and widens it.',
    })
  ).value;

  // Provider failure is state-neutral. Persist the gap only after the diagnostic has crossed the
  // schema-validating adapter boundary, so retry cannot leave or duplicate an orphan draft.
  const gap = await createGap(context, owner, {
    title: input.subject,
    rawStatement:
      `I want to ${input.goal} in ${input.subject}. ` +
      `Arc calibration baseline: ${baselineCorrect ? 'correct' : 'needs support'}.`,
    dailyMinutes: input.dailyMinutes ?? 35,
    ...(input.deadline ? { deadline: input.deadline } : {}),
    sourcePolicy: input.sourcePolicy ?? 'general_knowledge_allowed',
  });

  const calibration = await context.uow.calibrations.create(owner, {
    id: context.newId('cal'),
    gapId: gap.id,
    subject: input.subject,
    goal: input.goal,
    baselineAnswer: input.baselineAnswer,
    baselineCorrect,
    gapsIdentified: diagnostic.knowledgeGaps,
    startingDifficulty: diagnostic.recommendedStartingDifficulty,
    createdAt: context.now(),
  });

  context.metrics.increment('arc_calibration_total', {
    baselineCorrect: String(baselineCorrect),
  });

  const terms = input.subject
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
  const relatedGapIds = (await context.uow.gaps.list(owner))
    .filter((g) => g.id !== gap.id && terms.some((term) => g.title.toLowerCase().includes(term)))
    .map((g) => g.id);

  const [next, after, ...later] = diagnostic.knowledgeGaps;
  return {
    calibrationId: calibration.id,
    gapId: gap.id,
    subject: input.subject,
    goal: input.goal,
    baselineCorrect,
    gapsIdentified: diagnostic.knowledgeGaps,
    startingDifficulty: diagnostic.recommendedStartingDifficulty,
    preview: {
      ...(next === undefined ? {} : { next }),
      ...(after === undefined ? {} : { after }),
      later,
    },
    relatedGapIds,
  };
};

/* ------------------------------------------------------------------ arc views */

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

/** The next lesson the learner has not attempted anything on, per gap. */
const nextLessonForGap = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ day: number; lessonId: string; title: string } | undefined> =>
  (await getToday(context, owner, gapId)).lesson;

export interface ArcSkillView {
  readonly gapId: string;
  readonly title: string;
  readonly status: string;
  readonly objectivesTotal: number;
  readonly objectivesCleared: number;
  readonly percent: number;
  readonly started: boolean;
}

const skillView = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  title: string,
  status: string,
): Promise<ArcSkillView> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) {
    return {
      gapId,
      title,
      status,
      objectivesTotal: 0,
      objectivesCleared: 0,
      percent: 0,
      started: false,
    };
  }
  const mastery = await assessMastery(context, owner, gapId);
  const total = mastery.requiredObjectiveIds.length;
  const cleared = mastery.masteredObjectiveIds.length;
  return {
    gapId,
    title,
    status,
    objectivesTotal: total,
    objectivesCleared: cleared,
    percent: total === 0 ? 0 : Math.round((cleared / total) * 100),
    started: true,
  };
};

export const arcSkills = async (
  context: ServerContext,
  owner: OwnerId,
): Promise<ArcSkillView[]> => {
  const gaps = await context.uow.gaps.list(owner);
  const views = await Promise.all(
    gaps
      .filter((g) => g.status !== 'archived')
      .map((g) => skillView(context, owner, g.id, g.title, g.status)),
  );
  return views.sort(
    (a, b) => Number(b.started) - Number(a.started) || a.title.localeCompare(b.title),
  );
};

export interface ArcMapItem {
  readonly objectiveId: string;
  readonly capabilityStatement: string;
  readonly state: 'cleared' | 'current' | 'later';
  readonly lessonDay?: number;
  readonly missing: readonly string[];
}

export interface ArcMapView {
  readonly gap: { id: string; title: string; status: string };
  readonly progress: { percent: number; cleared: number; total: number };
  readonly hero?: {
    objectiveId: string;
    capabilityStatement: string;
    etaMinutes: number;
    lessonDay?: number;
    lessonId?: string;
  };
  readonly sequence: readonly ArcMapItem[];
}

/**
 * The skill map: the curriculum's objectives in plan order with cleared / current / later
 * states from real mastery evidence, the progress ring from real counts, and the next-gap hero
 * from the first unmastered required objective with a real ETA (the remaining lessons' minutes).
 */
export const arcMap = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<ArcMapView | undefined> => {
  const gap = await context.uow.gaps.get(owner, gapId);
  if (!gap) return undefined;
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) {
    return {
      gap: { id: gap.id, title: gap.title, status: gap.status },
      progress: { percent: 0, cleared: 0, total: 0 },
      sequence: [],
    };
  }

  const [mastery, lessons] = await Promise.all([
    assessMastery(context, owner, gapId),
    context.uow.curricula.listLessons(owner, curriculum.id),
  ]);
  const published = lessons
    .filter((l) => l.publicationStatus === 'published')
    .sort((a, b) => a.day - b.day);

  const lessonForObjective = new Map<
    string,
    { day: number; lessonId: string; etaMinutes: number }
  >();
  for (const lesson of published) {
    for (const objectiveId of lesson.objectiveIds) {
      if (!lessonForObjective.has(objectiveId)) {
        lessonForObjective.set(objectiveId, {
          day: lesson.day,
          lessonId: lesson.id,
          etaMinutes: lesson.estimatedMinutes,
        });
      }
    }
  }

  const mastered = new Set(mastery.masteredObjectiveIds);
  const firstUnmastered = curriculum.plan.objectives.find((o) => o.required && !mastered.has(o.id));

  // ETA: the remaining published lessons' minutes, or just the next lesson's.
  const remainingMinutes = published
    .filter(
      (l) =>
        firstUnmastered === undefined ||
        l.day >= (lessonForObjective.get(firstUnmastered.id)?.day ?? 0),
    )
    .reduce((sum, l) => sum + l.estimatedMinutes, 0);

  const sequence: ArcMapItem[] = curriculum.plan.objectives.map((objective) => {
    const cleared = mastered.has(objective.id);
    const current = !cleared && objective.id === firstUnmastered?.id;
    return {
      objectiveId: objective.id,
      capabilityStatement: objective.capabilityStatement,
      state: cleared ? 'cleared' : current ? 'current' : 'later',
      missing:
        mastery.assessments.find((entry) => entry.objectiveId === objective.id)?.missing ?? [],
      ...(lessonForObjective.get(objective.id)?.day === undefined
        ? {}
        : { lessonDay: lessonForObjective.get(objective.id)!.day }),
    };
  });

  const total = mastery.requiredObjectiveIds.length;
  const clearedCount = mastery.masteredObjectiveIds.length;

  return {
    gap: { id: gap.id, title: gap.title, status: gap.status },
    progress: {
      percent: total === 0 ? 0 : Math.round((clearedCount / total) * 100),
      cleared: clearedCount,
      total,
    },
    ...(firstUnmastered
      ? {
          hero: {
            objectiveId: firstUnmastered.id,
            capabilityStatement: firstUnmastered.capabilityStatement,
            etaMinutes: remainingMinutes,
            ...(lessonForObjective.get(firstUnmastered.id)?.day === undefined
              ? {}
              : { lessonDay: lessonForObjective.get(firstUnmastered.id)!.day }),
            ...(lessonForObjective.get(firstUnmastered.id)?.lessonId === undefined
              ? {}
              : { lessonId: lessonForObjective.get(firstUnmastered.id)!.lessonId }),
          },
        }
      : {}),
    sequence,
  };
};

export interface ArcNotebookView {
  readonly questionId: string;
  readonly prompt: string;
  readonly starterCode: string;
  readonly hint?: string;
}

export interface ArcPracticeView {
  readonly questionId: string;
  readonly prompt: string;
  readonly type: 'multiple_choice' | 'short_answer' | 'worked_problem';
  readonly role: 'retrieval' | 'application' | 'transfer';
  readonly options?: readonly string[];
  readonly hint?: string;
}

export interface ArcLessonView {
  readonly gap: { id: string; title: string };
  readonly lesson: {
    lessonId: string;
    day: number;
    title: string;
    summary: string;
    script: string;
    estimatedMinutes: number;
    totalDays: number;
  };
  readonly audio?: { artefactId: string; durationSeconds: number };
  readonly transcript: string;
  readonly notebook?: ArcNotebookView;
  readonly practice: readonly ArcPracticeView[];
  readonly defaultMode: 'theory' | 'practice';
}

/**
 * The Arc lesson: the next published lesson the learner has not attempted, with the real
 * compiled TTS audio, the transcript, and the notebook proof from the curriculum's code_proof
 * question. Falls back to the first published lesson when nothing is due.
 */
export const arcLesson = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<ArcLessonView | undefined> => {
  const [gap, preferences] = await Promise.all([
    context.uow.gaps.get(owner, gapId),
    getPreferences(context, owner),
  ]);
  if (!gap) return undefined;
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) return undefined;

  const lessons = (await context.uow.curricula.listLessons(owner, curriculum.id)).filter(
    (l) => l.publicationStatus === 'published',
  );
  if (lessons.length === 0) return undefined;

  const due = await nextLessonForGap(context, owner, gapId);
  const lesson =
    lessons.find((l) => l.id === due?.lessonId) ?? lessons.sort((a, b) => a.day - b.day)[0]!;

  const [artefacts, questions] = await Promise.all([
    context.uow.curricula.listArtefacts(owner, lesson.id),
    context.uow.curricula.listQuestions(owner, lesson.id),
  ]);

  const audioArtefacts = artefacts
    .filter((a) => a.kind === 'audio')
    .sort((a, b) => a.segmentOrdinal - b.segmentOrdinal);
  const totalAudioSeconds = audioArtefacts.reduce((sum, a) => sum + (a.durationSeconds ?? 0), 0);

  const notebookQuestion = questions.find((q) => q.payload.type === 'code_proof');
  const practice: ArcPracticeView[] = questions.flatMap((question) => {
    if (question.payload.type === 'code_proof') return [];
    return [
      {
        questionId: question.id,
        prompt: question.payload.prompt,
        type: question.payload.type,
        role: question.payload.role,
        ...(question.payload.type === 'multiple_choice'
          ? { options: question.payload.options }
          : {}),
        ...(preferences.gentleHints && question.payload.hint
          ? { hint: question.payload.hint }
          : {}),
      },
    ];
  });

  return {
    gap: { id: gap.id, title: gap.title },
    lesson: {
      lessonId: lesson.id,
      day: lesson.day,
      title: lesson.title,
      summary: lesson.package.summary,
      script: lesson.package.script,
      estimatedMinutes: lesson.estimatedMinutes,
      totalDays: curriculum.durationDays,
    },
    ...(audioArtefacts.length > 0
      ? { audio: { artefactId: audioArtefacts[0]!.id, durationSeconds: totalAudioSeconds } }
      : {}),
    transcript: lesson.package.transcript,
    ...(notebookQuestion
      ? {
          notebook: {
            questionId: notebookQuestion.id,
            prompt: notebookQuestion.payload.prompt,
            starterCode: notebookQuestion.payload.starterCode ?? '',
            ...(preferences.gentleHints && notebookQuestion.payload.hint
              ? { hint: notebookQuestion.payload.hint }
              : {}),
          },
        }
      : {}),
    practice,
    defaultMode: preferences.audioTheory ? 'theory' : 'practice',
  };
};

export interface ArcProofView {
  readonly objectiveId: string;
  readonly capabilityStatement: string;
  readonly gapId: string;
  readonly gapTitle: string;
  readonly recordedAt: Date;
}

export interface ArcProgressView {
  readonly percent: number;
  readonly filledGaps: number;
  readonly totalGaps: number;
  readonly weeklyMinutes: number;
  readonly momentumDays: number;
  readonly proofs: readonly ArcProofView[];
  readonly needs: readonly {
    gapId: string;
    gapTitle: string;
    objectiveId: string;
    capabilityStatement: string;
    missing: readonly string[];
  }[];
}

const momentumDays = (evidenceDates: readonly Date[], now: Date): number => {
  const days = new Set(evidenceDates.map(dayKey));
  let streak = 0;
  const cursor = new Date(now);
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

/**
 * The Progress screen: filled gaps and the proofs ledger from real mastery evidence, weekly
 * focused minutes from the lessons the learner actually practised, and momentum from the
 * consecutive days with evidence.
 */
export const arcProgress = async (
  context: ServerContext,
  owner: OwnerId,
): Promise<ArcProgressView> => {
  const gaps = await context.uow.gaps.list(owner);
  const activeGaps = gaps.filter((g) => g.status !== 'archived' && g.status !== 'failed');

  const proofs: ArcProofView[] = [];
  const needs: {
    gapId: string;
    gapTitle: string;
    objectiveId: string;
    capabilityStatement: string;
    missing: readonly string[];
  }[] = [];
  const evidenceDates: Date[] = [];
  let weeklyMinutes = 0;

  const weekAgo = new Date(context.now().getTime() - 7 * 86_400_000);

  for (const gap of activeGaps) {
    const curriculum = await context.uow.curricula.getCurrentForGap(owner, gap.id);
    if (!curriculum) continue;
    const [records, lessons] = await Promise.all([
      context.uow.mastery.listEvidenceForCurriculum(owner, curriculum.id),
      context.uow.curricula.listLessons(owner, curriculum.id),
    ]);

    for (const record of records) {
      const objective = curriculum.plan.objectives.find((o) => o.id === record.objectiveId);
      proofs.push({
        objectiveId: record.objectiveId,
        capabilityStatement: objective?.capabilityStatement ?? record.objectiveId,
        gapId: gap.id,
        gapTitle: gap.title,
        recordedAt: record.recordedAt,
      });
      evidenceDates.push(record.recordedAt);
    }

    if (gap.status !== 'filled') {
      const mastery = await assessMastery(context, owner, gap.id);
      for (const assessment of mastery.assessments.filter((item) => !item.mastered)) {
        const objective = curriculum.plan.objectives.find(
          (item) => item.id === assessment.objectiveId,
        );
        needs.push({
          gapId: gap.id,
          gapTitle: gap.title,
          objectiveId: assessment.objectiveId,
          capabilityStatement: objective?.capabilityStatement ?? assessment.objectiveId,
          missing: assessment.missing,
        });
      }
    }

    for (const lesson of lessons) {
      const questions = await context.uow.curricula.listQuestions(owner, lesson.id);
      // Weekly minutes are real practice time: the lesson's estimate, but only for lessons
      // whose questions carry at least one attempt this week.
      if (await anyQuestionAttempted(context, owner, questions, weekAgo)) {
        weeklyMinutes += lesson.estimatedMinutes;
      }
    }
  }

  const filledGaps = activeGaps.filter((g) => g.status === 'filled').length;
  const percent = activeGaps.length === 0 ? 0 : Math.round((filledGaps / activeGaps.length) * 100);

  return {
    percent,
    filledGaps,
    totalGaps: activeGaps.length,
    weeklyMinutes,
    momentumDays: momentumDays(evidenceDates, context.now()),
    proofs: proofs.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()).slice(0, 20),
    needs,
  };
};

const anyQuestionAttempted = async (
  context: ServerContext,
  owner: OwnerId,
  questions: readonly { id: string; objectiveId: string }[],
  since: Date,
): Promise<boolean> => {
  for (const question of questions) {
    const attempts = await context.uow.attempts.listForObjective(owner, question.objectiveId);
    if (attempts.some((a) => a.questionId === question.id && a.completedAt >= since)) return true;
  }
  return false;
};

export interface ArcTodayView {
  readonly greeting: { dayLabel: string; partOfDay: string; name: string };
  readonly focus: { plannedMinutes: number; completedMinutes: number; itemsLabel: string };
  readonly continueGap?: {
    gapId: string;
    title: string;
    status: string;
    progress: { done: number; total: number };
    lesson?: { day: number; lessonId: string; title: string };
  };
  readonly mapProgress: { percent: number; cleared: number; total: number };
  readonly suggestions: readonly { gapId: string; title: string; status: string }[];
  readonly attention: readonly {
    gapId: string;
    title: string;
    state: 'compiling' | 'failed' | 'partial';
  }[];
  readonly momentumDays: number;
  readonly dueReviews: readonly {
    reviewId: string;
    gapId: string;
    objectiveId: string;
    dueAt: Date;
  }[];
}

/**
 * The Today screen: the continue card from the gap with a next lesson or due reviews, the map
 * ring from real objective counts, keep-exploring suggestions from gaps without a published
 * curriculum, momentum from evidence dates, and — only when the spaced-review preference is on —
 * the real due review queue.
 */
export const arcToday = async (context: ServerContext, owner: OwnerId): Promise<ArcTodayView> => {
  const [preferences, user, gaps] = await Promise.all([
    getPreferences(context, owner),
    context.uow.users.find(owner),
    context.uow.gaps.list(owner),
  ]);

  const active = gaps.filter((g) => g.status !== 'archived' && g.status !== 'failed');

  const continueGaps: Awaited<ReturnType<typeof skillView>>[] = [];
  const evidenceDates: Date[] = [];
  let plannedMinutes = 0;
  let completedMinutes = 0;
  let totalObjectives = 0;
  let clearedObjectives = 0;

  for (const gap of active) {
    const view = await skillView(context, owner, gap.id, gap.title, gap.status);
    if (!view.started) continue;
    totalObjectives += view.objectivesTotal;
    clearedObjectives += view.objectivesCleared;

    const due = await nextLessonForGap(context, owner, gap.id);
    const curriculum = await context.uow.curricula.getCurrentForGap(owner, gap.id);
    if (!curriculum) continue;

    const records = await context.uow.mastery.listEvidenceForCurriculum(owner, curriculum.id);
    for (const record of records) evidenceDates.push(record.recordedAt);

    const lessons = await context.uow.curricula.listLessons(owner, curriculum.id);
    const todayStart = dayKey(context.now());
    for (const lesson of lessons) {
      if (lesson.publicationStatus !== 'published') continue;
      const questions = await context.uow.curricula.listQuestions(owner, lesson.id);
      const attemptsToday = await anyQuestionAttemptedToday(context, owner, questions, todayStart);
      if (attemptsToday) completedMinutes += lesson.estimatedMinutes;
    }

    if (due || (await context.uow.mastery.listDueReviews(owner, context.now())).length > 0) {
      continueGaps.push(view);
    }
    if (plannedMinutes === 0) plannedMinutes = gap.dailyMinutes;
  }

  const continueGap = continueGaps.sort(
    (a, b) => Number(b.started) - Number(a.started) || a.title.localeCompare(b.title),
  )[0];

  const dueReviews: { reviewId: string; gapId: string; objectiveId: string; dueAt: Date }[] = [];
  if (preferences.spacedReview) {
    const reviews = await context.uow.mastery.listDueReviews(owner, context.now());
    for (const review of reviews) {
      const curriculum = await context.uow.curricula.get(owner, review.curriculumId);
      if (!curriculum) continue;
      dueReviews.push({
        reviewId: review.id,
        gapId: curriculum.gapId,
        objectiveId: review.objectiveId,
        dueAt: review.dueAt,
      });
    }
  }

  const now = context.now();
  const hour = now.getHours();
  const partOfDay =
    hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const dayLabel = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const name = user ? (user.email.split('@')[0] ?? 'learner') : 'learner';

  const suggestions = active
    .filter((g) => g.status === 'draft' || g.status === 'ready')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 2)
    .map((g) => ({ gapId: g.id, title: g.title, status: g.status }));

  const attention = (
    await Promise.all(
      gaps
        .filter((gap) => gap.status !== 'archived')
        .map(async (gap) => {
          if (gap.status === 'compiling' || gap.status === 'failed') {
            return { gapId: gap.id, title: gap.title, state: gap.status };
          }
          const curriculum = await context.uow.curricula.getCurrentForGap(owner, gap.id);
          const run = curriculum?.runId
            ? await context.uow.generation.getRun(owner, curriculum.runId)
            : undefined;
          return run?.status === 'partial'
            ? { gapId: gap.id, title: gap.title, state: 'partial' as const }
            : undefined;
        }),
    )
  ).filter((item): item is NonNullable<typeof item> => item !== undefined);

  const continueLesson = continueGap
    ? await nextLessonForGap(context, owner, continueGap.gapId)
    : undefined;

  return {
    greeting: { dayLabel, partOfDay, name },
    focus: {
      plannedMinutes,
      completedMinutes: Math.min(completedMinutes, plannedMinutes || completedMinutes),
      itemsLabel: active.length === 1 ? 'one gap' : `${active.length} gaps`,
    },
    ...(continueGap
      ? {
          continueGap: {
            gapId: continueGap.gapId,
            title: continueGap.title,
            status: continueGap.status,
            progress: {
              done: continueGap.objectivesCleared,
              total: continueGap.objectivesTotal,
            },
            ...(continueLesson ? { lesson: continueLesson } : {}),
          },
        }
      : {}),
    mapProgress: {
      percent: totalObjectives === 0 ? 0 : Math.round((clearedObjectives / totalObjectives) * 100),
      cleared: clearedObjectives,
      total: totalObjectives,
    },
    suggestions,
    attention,
    momentumDays: momentumDays(evidenceDates, now),
    dueReviews,
  };
};

const anyQuestionAttemptedToday = async (
  context: ServerContext,
  owner: OwnerId,
  questions: readonly { id: string; objectiveId: string }[],
  todayStart: string,
): Promise<boolean> => {
  for (const question of questions) {
    const attempts = await context.uow.attempts.listForObjective(owner, question.objectiveId);
    if (
      attempts.some((a) => a.questionId === question.id && dayKey(a.completedAt) === todayStart)
    ) {
      return true;
    }
  }
  return false;
};

/* ------------------------------------------------------------ reviews/retention */

interface ResolvedReview {
  readonly review: ReviewItem;
  readonly question: StoredQuestion;
  readonly gapId: string;
  readonly gapTitle: string;
  readonly capabilityStatement: string;
}

const resolveReview = async (
  context: ServerContext,
  owner: OwnerId,
  review: ReviewItem,
): Promise<ResolvedReview | undefined> => {
  const curriculum = await context.uow.curricula.get(owner, review.curriculumId);
  if (!curriculum) return undefined;
  const gap = await context.uow.gaps.get(owner, curriculum.gapId);
  if (!gap) return undefined;

  let question = review.questionId
    ? await context.uow.curricula.getQuestion(owner, review.questionId)
    : undefined;
  if (!question) {
    const lessons = await context.uow.curricula.listLessons(owner, curriculum.id);
    const candidates: StoredQuestion[] = [];
    for (const lesson of lessons) {
      candidates.push(...(await context.uow.curricula.listQuestions(owner, lesson.id)));
    }
    question =
      candidates.find(
        (candidate) =>
          candidate.objectiveId === review.objectiveId && candidate.payload.role === 'retrieval',
      ) ?? candidates.find((candidate) => candidate.objectiveId === review.objectiveId);
  }
  if (!question) return undefined;

  const objective = curriculum.plan.objectives.find((entry) => entry.id === review.objectiveId);
  return {
    review,
    question,
    gapId: gap.id,
    gapTitle: gap.title,
    capabilityStatement: objective?.capabilityStatement ?? review.objectiveId,
  };
};

export interface ArcReviewView {
  readonly reviewId: string;
  readonly questionId: string;
  readonly gapId: string;
  readonly gapTitle: string;
  readonly objectiveId: string;
  readonly capabilityStatement: string;
  readonly dueAt: Date;
  readonly reason: ReviewItem['reason'];
  readonly prompt: string;
  readonly type: StoredQuestion['payload']['type'];
  readonly options?: readonly string[];
  readonly hint?: string;
}

export const arcReviews = async (
  context: ServerContext,
  owner: OwnerId,
): Promise<ArcReviewView[]> => {
  const [due, preferences] = await Promise.all([
    context.uow.mastery.listDueReviews(owner, context.now()),
    getPreferences(context, owner),
  ]);
  const resolved = await Promise.all(due.map((review) => resolveReview(context, owner, review)));
  return resolved.flatMap((entry) => {
    if (!entry) return [];
    const { review, question } = entry;
    return [
      {
        reviewId: review.id,
        questionId: question.id,
        gapId: entry.gapId,
        gapTitle: entry.gapTitle,
        objectiveId: review.objectiveId,
        capabilityStatement: entry.capabilityStatement,
        dueAt: review.dueAt,
        reason: review.reason,
        prompt: question.payload.prompt,
        type: question.payload.type,
        ...(question.payload.type === 'multiple_choice'
          ? { options: question.payload.options }
          : {}),
        ...(preferences.gentleHints && question.payload.hint
          ? { hint: question.payload.hint }
          : {}),
      },
    ];
  });
};

export interface ArcReviewSubmission {
  readonly correct: boolean;
  readonly feedback: AttemptResult['feedback'];
  readonly nextReview?: ReviewItem;
}

export const submitArcReview = async (
  context: ServerContext,
  owner: OwnerId,
  reviewId: string,
  input: {
    readonly response: string;
    readonly confidence?: 'low' | 'medium' | 'high';
    readonly idempotencyKey: string;
  },
): Promise<ArcReviewSubmission> => {
  const review = (await context.uow.mastery.listDueReviews(owner, context.now())).find(
    (candidate) => candidate.id === reviewId,
  );
  if (!review) throw new Error(`Review ${reviewId} was not found in due reviews for this owner.`);
  const resolved = await resolveReview(context, owner, review);
  if (!resolved) throw new Error(`Review ${reviewId} has no available practice question.`);

  const result = await submitAttempt(context, owner, resolved.gapId, {
    questionId: resolved.question.id,
    sessionId: `review:${review.id}`,
    response: input.response,
    ...(input.confidence ? { confidence: input.confidence } : {}),
    idempotencyKey: input.idempotencyKey,
    evidenceType: 'retrieval',
    scheduleReviews: false,
  });
  const nextReview = await completeReview(context, owner, review.id, result.correct);
  context.metrics.increment('arc_review_completed_total', {
    correct: String(result.correct),
  });

  return {
    correct: result.correct,
    feedback: result.feedback,
    ...(nextReview ? { nextReview } : {}),
  };
};

export const arcCapabilities = async (context: ServerContext, owner: OwnerId, query = '') => {
  context.metrics.increment('arc_capability_search_total', {
    hasQuery: String(query.trim().length > 0),
  });
  return searchCapabilities(context, owner, query);
};

export interface ArcProfileView {
  readonly name: string;
  readonly email: string;
  readonly preferences: LearnerPreferences;
  readonly stats: { filledGaps: number; totalGaps: number };
}

export const arcProfile = async (
  context: ServerContext,
  owner: OwnerId,
): Promise<ArcProfileView> => {
  const [user, preferences, gaps] = await Promise.all([
    context.uow.users.find(owner),
    getPreferences(context, owner),
    context.uow.gaps.list(owner),
  ]);
  const active = gaps.filter((g) => g.status !== 'archived' && g.status !== 'failed');
  return {
    name: user ? (user.email.split('@')[0] ?? 'learner') : 'learner',
    email: user?.email ?? '',
    preferences,
    stats: {
      filledGaps: active.filter((g) => g.status === 'filled').length,
      totalGaps: active.length,
    },
  };
};
