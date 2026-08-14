/**
 * Checkpoint helpers (E24 US1, FR-004).
 *
 * A lesson's pause prompts are embedded in the audio at `atSecond` positions. Playback pauses at
 * the first prompt whose position has been reached and which has not been answered, and the
 * learner must respond before the lesson continues. Grading mirrors practice answers
 * (`packages/domain/src/mastery/grading.ts`): a deterministic, lenient match against the
 * expected answer — a checkpoint is a spoken check, not a written exam.
 */

export interface CheckpointPrompt {
  readonly atSecond: number;
  readonly prompt: string;
  readonly expectedAnswer: string;
}

/**
 * The checkpoint that is due at a playback position: the first prompt whose time has been
 * reached and which has not been answered yet. `undefined` means playback may continue.
 */
export const pendingCheckpoint = (
  prompts: readonly CheckpointPrompt[],
  currentTime: number,
  answered: number,
): CheckpointPrompt | undefined =>
  prompts.find((prompt, index) => prompt.atSecond <= currentTime && index >= answered);

const normalise = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,]+$/g, '');

/**
 * Grade a checkpoint response deterministically. An exact (normalised) match is correct; for a
 * spoken answer the expected answer's full text may also appear inside a longer response (or
 * vice versa) — deliberately lenient, never a false "wrong".
 */
export const gradeCheckpoint = (response: string, expectedAnswer: string): boolean => {
  const given = normalise(response);
  const expected = normalise(expectedAnswer);
  if (given.length === 0) return false;
  if (given === expected) return true;
  if (expected.length > 12 && (given.includes(expected) || expected.includes(given))) return true;
  return false;
};
