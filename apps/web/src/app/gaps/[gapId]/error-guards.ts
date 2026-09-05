import { NotFoundError } from '@gapos/database';
import { ApiError } from '../../../server/api';

/**
 * A missing or not-owned entity. The service layer signals this with an `ApiError` carrying a
 * 404 status, a `NotFoundError` from the repositories, or (for the plain-Error paths) a message
 * that mentions "not found". Anything else is a genuine bug and must keep bubbling.
 */
export const isNotFoundError = (error: unknown): boolean => {
  if (error instanceof ApiError) return error.status === 404;
  if (error instanceof NotFoundError) return true;
  return error instanceof Error && /not found/i.test(error.message);
};

/**
 * A gap that exists but has no compiled curriculum yet. Distinct from a missing gap: the learner
 * should be nudged to compile rather than shown a 404.
 */
export const isMissingCurriculumError = (error: unknown): boolean => {
  if (error instanceof ApiError) return error.code === 'no_curriculum';
  return error instanceof Error && /no curriculum/i.test(error.message);
};
