/**
 * Review scheduling.
 *
 * A transparent fixed ladder, deliberately. An adaptive spaced-repetition algorithm is only worth
 * introducing once there is enough attempt data to evaluate it against this baseline; until then
 * a schedule the learner can predict beats one nobody can audit.
 *
 * Ladder: same-session correction → next day → three days → seven days → later on confidence drop.
 */

export const REVIEW_LADDER_DAYS = [0, 1, 3, 7] as const;

export type ReviewReason = 'ladder' | 'remediation' | 'confidence_drop';

export interface ScheduledReview {
  readonly objectiveId: string;
  readonly questionId?: string;
  readonly dueAt: Date;
  readonly intervalDays: number;
  readonly reason: ReviewReason;
}

const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * 86_400_000);

/**
 * The next rung after a successful review. Returns `undefined` at the top of the ladder: the
 * objective has graduated and is only revisited if confidence falls.
 */
export const nextLadderInterval = (currentIntervalDays: number): number | undefined => {
  const index = REVIEW_LADDER_DAYS.indexOf(
    currentIntervalDays as (typeof REVIEW_LADDER_DAYS)[number],
  );
  if (index === -1) {
    return REVIEW_LADDER_DAYS.find((d) => d > currentIntervalDays);
  }
  return REVIEW_LADDER_DAYS[index + 1];
};

export interface AttemptOutcome {
  readonly objectiveId: string;
  readonly questionId: string;
  readonly correct: boolean;
  readonly confidence?: 'low' | 'medium' | 'high';
  readonly at: Date;
}

/**
 * What to schedule after an attempt.
 *
 * A wrong answer always produces a same-session correction *and* a next-day retrieval: the
 * correction addresses the error while it is fresh, the retrieval checks the repair held. This
 * is the "wrong answers create due remediation" behaviour the product promises.
 */
export const scheduleAfterAttempt = (outcome: AttemptOutcome): ScheduledReview[] => {
  if (!outcome.correct) {
    return [
      {
        objectiveId: outcome.objectiveId,
        questionId: outcome.questionId,
        dueAt: outcome.at,
        intervalDays: 0,
        reason: 'remediation',
      },
      {
        objectiveId: outcome.objectiveId,
        dueAt: addDays(outcome.at, 1),
        intervalDays: 1,
        reason: 'remediation',
      },
    ];
  }

  // Correct but unconfident: the learner guessed, or is fragile. Bring the review forward.
  if (outcome.confidence === 'low') {
    return [
      {
        objectiveId: outcome.objectiveId,
        dueAt: addDays(outcome.at, 1),
        intervalDays: 1,
        reason: 'confidence_drop',
      },
    ];
  }

  return [
    {
      objectiveId: outcome.objectiveId,
      dueAt: addDays(outcome.at, 1),
      intervalDays: 1,
      reason: 'ladder',
    },
  ];
};

/**
 * What to schedule after a review itself is completed. A correct review advances one rung; a
 * failed review drops back to the bottom, because the interval it just failed at was too long.
 */
export const scheduleAfterReview = (
  review: { objectiveId: string; intervalDays: number },
  correct: boolean,
  at: Date,
): ScheduledReview | undefined => {
  if (!correct) {
    return {
      objectiveId: review.objectiveId,
      dueAt: addDays(at, 1),
      intervalDays: 1,
      reason: 'remediation',
    };
  }

  const next = nextLadderInterval(review.intervalDays);
  if (next === undefined) return undefined;

  return {
    objectiveId: review.objectiveId,
    dueAt: addDays(at, next),
    intervalDays: next,
    reason: 'ladder',
  };
};

/**
 * The Today queue: due reviews first (oldest first), then the next unstarted lesson day. Reviews
 * outrank new material — an overdue retrieval is worth more than another lesson.
 */
export interface TodayQueueInput {
  readonly dueReviews: readonly { id: string; objectiveId: string; dueAt: Date }[];
  readonly nextLessonDay?: { day: number; lessonId: string };
  readonly now: Date;
}

export interface TodayQueue {
  readonly reviews: readonly { id: string; objectiveId: string; dueAt: Date }[];
  readonly lesson?: { day: number; lessonId: string };
  readonly totalItems: number;
}

export const buildTodayQueue = (input: TodayQueueInput): TodayQueue => {
  const reviews = [...input.dueReviews]
    .filter((r) => r.dueAt <= input.now)
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  return {
    reviews,
    ...(input.nextLessonDay ? { lesson: input.nextLessonDay } : {}),
    totalItems: reviews.length + (input.nextLessonDay ? 1 : 0),
  };
};
