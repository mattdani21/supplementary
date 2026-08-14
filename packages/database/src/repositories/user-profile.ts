/**
 * Learner profile normalisation (E24 US4, T032 — R7).
 *
 * The curriculum is a function of gap + sources + diagnostic + learner profile + mastery
 * evidence (constitution §1). The profile fields are optional on input so every existing
 * caller keeps working; the repository layer applies the documented defaults ('standard'
 * lesson length, no goals) and rejects an unknown lesson length, so an invalid profile can
 * never reach the planner silently. The Postgres schema enforces the same rule with a CHECK
 * constraint (migration 006).
 */

import { DomainError } from '@gapos/domain';
import { LESSON_LENGTHS, type User } from './types.js';

export const DEFAULT_LESSON_LENGTH = 'standard' as const;

export const normaliseUserProfile = (user: User): User => {
  const preferredLessonLength = user.preferredLessonLength ?? DEFAULT_LESSON_LENGTH;
  if (!LESSON_LENGTHS.includes(preferredLessonLength)) {
    throw new DomainError(
      'invalid_input',
      `preferredLessonLength must be one of ${LESSON_LENGTHS.join(', ')}; ` +
        `received "${preferredLessonLength}".`,
      { preferredLessonLength },
    );
  }
  return { ...user, preferredLessonLength, goals: user.goals ?? [] };
};
