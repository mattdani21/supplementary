/**
 * First-run rules (GAP-039, E23 quality spec §5).
 *
 * Pure and DOM-free: the storage key, the completion check, the step machine and the
 * auto-compile idempotency key are all plain values in / values out, so the whole behaviour is
 * unit-testable without a browser. The client components hand in the storage accessors.
 */

import { mediaTypeForFilename } from './sources';

export type OnboardingStepId = 'gap' | 'source' | 'minutes';

/** The guided first run, in order: name a gap → supply a source → set daily minutes. */
export const ONBOARDING_STEPS: readonly OnboardingStepId[] = ['gap', 'source', 'minutes'];

/** Completion marker prefix; the key is per-owner so two learners on one device each get the flow. */
export const ONBOARDING_STORAGE_PREFIX = 'gapos.onboarded.';

export const onboardingStorageKey = (owner: string): string =>
  `${ONBOARDING_STORAGE_PREFIX}${owner}`;

/** Has this owner completed (or skipped) the guided flow? Missing marker ⇒ fresh user. */
export const isOnboardingComplete = (
  owner: string,
  getItem: (key: string) => string | null,
): boolean => getItem(onboardingStorageKey(owner)) === '1';

/** Persist completion under the per-owner key. */
export const markOnboardingComplete = (
  owner: string,
  setItem: (key: string, value: string) => void,
): void => setItem(onboardingStorageKey(owner), '1');

/** The next step after the given one; 'done' after minutes (the auto-compile step). */
export const nextOnboardingStep = (step: OnboardingStepId): OnboardingStepId | 'done' =>
  ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? 'done';

/** The step before the given one; undefined on the first step (no Back there). */
export const previousOnboardingStep = (step: OnboardingStepId): OnboardingStepId | undefined =>
  ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) - 1];

/**
 * The auto-compile's idempotency key: deterministic per gap, so a replayed submit returns the
 * run already started instead of charging twice for the same curriculum (AGENTS.md §2.6).
 */
export const onboardingCompileKey = (gapId: string): string => `onboarding-${gapId}`;

/* ------------------------------------------------------------ request payload builders */

export interface OnboardingGapBody {
  readonly title: string;
  readonly rawStatement: string;
  readonly dailyMinutes: number;
}

/** POST /api/gaps — the gap-form fields, collected across steps 1 and 3. */
export const onboardingGapBody = (input: {
  readonly title: string;
  readonly rawStatement: string;
  readonly dailyMinutes: number;
}): OnboardingGapBody => ({
  title: input.title,
  rawStatement: input.rawStatement,
  dailyMinutes: input.dailyMinutes,
});

export interface OnboardingSourceBody {
  readonly gapId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly text: string;
}

/** POST /api/gaps/:id/sources — the source-form contract (upload or pasted URL text). */
export const onboardingSourceBody = (
  gapId: string,
  input: { readonly filename: string; readonly text: string },
): OnboardingSourceBody => ({
  gapId,
  filename: input.filename,
  mediaType: mediaTypeForFilename(input.filename),
  text: input.text,
});

export interface OnboardingCompileBody {
  readonly idempotencyKey: string;
}

/** POST /api/gaps/:id/compile — the auto-compile that starts as soon as step 3 confirms. */
export const onboardingCompileBody = (gapId: string): OnboardingCompileBody => ({
  idempotencyKey: onboardingCompileKey(gapId),
});
