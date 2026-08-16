/**
 * Gap visibility errors (GAP-095): a gap the viewer cannot see is a designed surface,
 * never a crash. Covers both error shapes in the codebase: the API layer's `ApiError`
 * (status 404) and the service layer's plain `Error` messages for a missing gap or
 * curriculum. Server-safe (no 'use client') — imported by the gap pages.
 */
export const isGapNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if ('status' in error && (error as { status: number }).status === 404) return true;
  return (
    error.message.includes('was not found for this owner') ||
    error.message.includes('No curriculum for gap')
  );
};
