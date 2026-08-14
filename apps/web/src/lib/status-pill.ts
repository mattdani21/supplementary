/**
 * Status pill tone mapping (GAP-034/035, E22). The pill base class is the muted look; the
 * variant classes add the semantic tone. Shared by the Today surface, the gaps list and the
 * gap detail workspace so one status always reads the same across the app.
 */

export const STATUS_TONE: Record<string, string> = {
  active: 'pill--accent',
  mastery_check: 'pill--accent',
  review_due: 'pill--accent',
  filled: 'pill--ok',
  compiling: 'pill--warn',
  failed: 'pill--error',
};

export const pillClass = (status: string): string => `pill ${STATUS_TONE[status] ?? ''}`;
