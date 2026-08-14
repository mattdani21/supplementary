/**
 * Onboarding + first-run flow (GAP-039, E23 quality spec §5), asserted at the markup level.
 *
 * Acceptance covered here:
 *  - the 3-step walkthrough renders: step 1 = gap-form fields, step 2 = source-form fields
 *    (upload/paste + URL), step 3 = daily minutes with the auto-compile submit (the compile
 *    POST carries a deterministic idempotency key so a replay never starts a second run);
 *  - skip is always available and the app is usable without onboarding (Today renders);
 *  - completed-onboarding owners land directly on Today (the per-owner localStorage marker);
 *  - Today shows the compile-in-progress surface (GenerationProgress, GAP-037) until Day 1
 *    lands — never a blank Today.
 *
 * Same pattern as feedback.test.tsx / screens.test.tsx: the pure first-run rules live in
 * lib/onboarding (unit-tested), the flow is asserted at the markup level with
 * renderToStaticMarkup, and the Today page renders against a fresh in-memory server context
 * with the request-coupled modules stubbed. The gate reads localStorage only after mount
 * (client-only, exactly like the audio player's playback speed), so the server-rendered first
 * paint is always the Today surface — hydration-safe — and the fresh-user decision is the pure
 * isOnboardingComplete rule.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type * as ServerContextModule from '../server/context';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import {
  ONBOARDING_STEPS,
  isOnboardingComplete,
  markOnboardingComplete,
  nextOnboardingStep,
  onboardingCompileBody,
  onboardingCompileKey,
  onboardingStorageKey,
  previousOnboardingStep,
  type OnboardingStepId,
} from '../lib/onboarding';
import { mediaTypeForFilename } from '../lib/sources';
import { OnboardingFlow } from './onboarding';

/** Which owner the next/headers mock reports; lets each describe test its own tenant. */
let ownerCookie: string | undefined;
const setViewerOwner = (owner: string | undefined): void => {
  ownerCookie = owner;
};

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (ownerCookie ? { value: ownerCookie } : undefined) }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));
/**
 * Pages bootstrap the server context from env — and this sandbox sets GAPOS_DATABASE_URL,
 * which would make the test read and write a real Postgres database. Mock the bootstrap to one
 * fresh in-memory context per test file: hermetic, deterministic, and exactly the code path
 * the API journey suite already exercises.
 */
vi.mock('../server/bootstrap', async () => {
  const { createServerContext } =
    await vi.importActual<typeof ServerContextModule>('../server/context');
  const context = createServerContext({ logLevel: 'error' });
  return {
    getServerContext: async () => context,
    closeServerContext: async () => undefined,
  };
});

import HomePage from '../app/page';
import { getServerContext } from '../server/bootstrap';
import {
  compile,
  createGap,
  createUser,
  registerSourceHandler,
  transitionGap,
} from '../server/api';

/* --------------------------------------------------------------- the pure first-run rules */

describe('the first-run rules (GAP-039)', () => {
  it('keys the completion marker per owner', () => {
    expect(onboardingStorageKey('local-learner')).toBe('gapos.onboarded.local-learner');
    expect(onboardingStorageKey('alice')).toBe('gapos.onboarded.alice');
  });

  it('treats a missing marker as a fresh user — the guided flow shows', () => {
    expect(isOnboardingComplete('alice', () => null)).toBe(false);
    expect(isOnboardingComplete('alice', () => '0')).toBe(false);
  });

  it('treats the completion marker as done — the owner lands on Today', () => {
    const storage = new Map<string, string>([['gapos.onboarded.alice', '1']]);
    const get = (key: string): string | null => storage.get(key) ?? null;
    expect(isOnboardingComplete('alice', get)).toBe(true);
    // Another owner, same browser: their own key decides.
    expect(isOnboardingComplete('bob', get)).toBe(false);
  });

  it('marks completion under the same per-owner key', () => {
    const writes = new Map<string, string>();
    markOnboardingComplete('alice', (key, value) => writes.set(key, value));
    expect(writes.get('gapos.onboarded.alice')).toBe('1');
  });

  it('walks the three steps gap → source → minutes → done', () => {
    expect(ONBOARDING_STEPS).toEqual(['gap', 'source', 'minutes']);
    expect(nextOnboardingStep('gap')).toBe('source');
    expect(nextOnboardingStep('source')).toBe('minutes');
    expect(nextOnboardingStep('minutes')).toBe('done');
    // Back walks the same line in reverse; the first step has no Back.
    expect(previousOnboardingStep('minutes')).toBe('source');
    expect(previousOnboardingStep('source')).toBe('gap');
    expect(previousOnboardingStep('gap')).toBeUndefined();
  });

  it('issues the auto-compile with a deterministic per-gap idempotency key', () => {
    expect(onboardingCompileKey('gap_1')).toBe('onboarding-gap_1');
    expect(onboardingCompileBody('gap_1')).toEqual({ idempotencyKey: 'onboarding-gap_1' });
    // Replay-safe: the same gap always asks for the same run, never a second charge.
    expect(onboardingCompileBody('gap_1')).toEqual(onboardingCompileBody('gap_1'));
    expect(onboardingCompileBody('gap_1').idempotencyKey).not.toBe(
      onboardingCompileBody('gap_2').idempotencyKey,
    );
  });

  it('derives the source media type from the filename (the source-form rule)', () => {
    expect(mediaTypeForFilename('note.md')).toBe('text/markdown');
    expect(mediaTypeForFilename('chapter.html')).toBe('text/html');
    expect(mediaTypeForFilename('notes.txt')).toBe('text/plain');
  });
});

/* ----------------------------------------------------------------- the 3-step walkthrough */

const renderFlow = (step: OnboardingStepId): string =>
  renderToStaticMarkup(<OnboardingFlow owner="local-learner" initialStep={step} />);

describe('the 3-step walkthrough (GAP-039)', () => {
  it('step 1 renders the gap-form fields: title + statement', () => {
    const html = renderFlow('gap');
    expect(html).toContain('Step 1 of 3');
    expect(html).toContain('Name your gap');
    expect(html).toMatch(/name="title"/);
    expect(html).toMatch(/name="rawStatement"/);
    expect(html).toContain('e.g. Set theory for my AI course');
    expect(html).not.toMatch(/name="dailyMinutes"/); // minutes belong to step 3
    expect(html).toContain('Continue');
  });

  it('step 2 renders the source-form fields: filename + content + a URL', () => {
    const html = renderFlow('source');
    expect(html).toContain('Step 2 of 3');
    expect(html).toContain('Supply a source');
    expect(html).toMatch(/name="filename"/);
    expect(html).toMatch(/name="text"/);
    expect(html).toMatch(/name="url"/);
    expect(html).toContain('Paste notes, a chapter, a transcript…');
    expect(html).toContain('Fetch');
    expect(html).toContain('Back');
  });

  it('step 3 renders daily minutes and the auto-compile submit', () => {
    const html = renderFlow('minutes');
    expect(html).toContain('Step 3 of 3');
    expect(html).toContain('Set your daily minutes');
    expect(html).toMatch(
      /name="dailyMinutes"[^>]*type="number"|type="number"[^>]*name="dailyMinutes"/,
    );
    expect(html).toMatch(/min="5"/);
    expect(html).toMatch(/max="480"/);
    expect(html).toContain('Start my course');
    expect(html).toContain('Back');
  });

  it('skip is always available on every step', () => {
    for (const step of ONBOARDING_STEPS) {
      const html = renderFlow(step);
      expect(html, `step ${step} must offer skip`).toContain('Skip for now');
    }
  });
});

/* ----------------------------------------------------------------------- Today integration */

describe('Today for a first-time owner (GAP-039)', () => {
  beforeAll(() => {
    // A brand-new owner: no gaps, no completion marker.
    setViewerOwner('fresh-user');
  });

  it('lands on the styled empty state — never onboarding markup, app usable without it', async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('No tracks yet.');
    expect(html).toContain('Name your first gap');
    expect(html).not.toContain('Step 1 of 3');
    expect(html).not.toContain('onboarding__');
  });
});

describe('Today shows compile-in-progress until Day 1 lands (GAP-039)', () => {
  beforeAll(async () => {
    setViewerOwner('alice');
    const context = await getServerContext();
    await createUser(context, 'alice', {
      email: 'alice@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    const created = (await createGap(context, 'alice', {
      title: 'Equivalence relations',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    })) as { gap: { id: string } };
    // Defined and sourced, but never compiled: Day 1 has not landed.
    await transitionGap(context, 'alice', created.gap.id, { type: 'define' });
    await registerSourceHandler(context, 'alice', {
      gapId: created.gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
  });

  it('renders the generation progress surface for the gap, never a blank Today', async () => {
    const html = renderToStaticMarkup(await HomePage());

    // The designed compile-in-progress surface (GenerationProgress, GAP-037).
    expect(html).toContain('class="card progress-card"');
    expect(html).toContain('Compile progress');
    expect(html).toContain('Not compiled yet.');
    // The track is still listed — Today is never blank.
    expect(html).toContain('Equivalence relations');
    expect(html).not.toContain('No tracks yet.');
  });
});

describe('Today once Day 1 has landed (GAP-039)', () => {
  beforeAll(async () => {
    setViewerOwner('bob');
    const context = await getServerContext();
    await createUser(context, 'bob', {
      email: 'bob@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    const created = (await createGap(context, 'bob', {
      title: 'Set theory',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    })) as { gap: { id: string } };
    const gapId = created.gap.id;
    await transitionGap(context, 'bob', gapId, { type: 'define' });
    await registerSourceHandler(context, 'bob', {
      gapId,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    const outcome = (await compile(context, 'bob', gapId, {
      idempotencyKey: 'onboarding-test-compile',
    })) as { run: { status: string } };
    expect(outcome.run.status).toBe('complete');
  });

  it('leads with the continue card, not the in-progress surface', async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('class="continue-card"');
    expect(html).toContain('Continue');
    expect(html).not.toContain('Not compiled yet.');
  });
});
