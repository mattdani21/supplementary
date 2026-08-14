'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';
import {
  isOnboardingComplete,
  markOnboardingComplete,
  nextOnboardingStep,
  onboardingCompileBody,
  onboardingGapBody,
  onboardingSourceBody,
  previousOnboardingStep,
  type OnboardingStepId,
} from '../lib/onboarding';

/**
 * The guided first run (GAP-039, E23 quality spec §5): a first-time owner walks three steps —
 * name a gap, supply a source, set daily minutes — and compile starts immediately so the first
 * reward (Day 1 audio) arrives fast. Skip is always available and the app stays usable without
 * onboarding; completion is persisted per owner in localStorage.
 */

const STEP_TITLES: Record<OnboardingStepId, string> = {
  gap: 'Name your gap',
  source: 'Supply a source',
  minutes: 'Set your daily minutes',
};

const STEP_BLURBS: Record<OnboardingStepId, string> = {
  gap: 'One gap at a time — what do you want to be able to do?',
  source: 'Upload or point at the material your course will be built from.',
  minutes: 'Compile starts the moment you confirm. Day 1 audio arrives fast.',
};

const STEP_NUMBER: Record<OnboardingStepId, number> = { gap: 1, source: 2, minutes: 3 };

export function OnboardingGate({
  owner,
  hasGaps,
  children,
}: {
  readonly owner: string;
  /** The owner already has tracks — they are past first run and land on Today directly. */
  readonly hasGaps: boolean;
  readonly children: ReactNode;
}) {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    // localStorage is client-only (same as the audio player's speed): the first paint is always
    // the Today surface so the server render and the first client render agree. After mount, a
    // first-time owner with no tracks yet gets the guided flow; returning owners skip it.
    if (hasGaps) return;
    let completed = false;
    try {
      completed = isOnboardingComplete(owner, (key) => window.localStorage.getItem(key));
    } catch {
      completed = true; // storage unavailable: never block on it — Today stays usable
    }
    if (!completed) setShowOnboarding(true);
  }, [owner, hasGaps]);

  return showOnboarding ? (
    <OnboardingFlow owner={owner} onDone={() => setShowOnboarding(false)} />
  ) : (
    <>{children}</>
  );
}

export function OnboardingFlow({
  owner,
  onDone,
  initialStep = 'gap',
}: {
  readonly owner: string;
  /** Called once the flow ends (skip or auto-compile), so the gate swaps back to Today. */
  readonly onDone?: () => void;
  /** Seeded step for tests; production always starts the walkthrough at the gap step. */
  readonly initialStep?: OnboardingStepId;
}) {
  const router = useRouter();

  const [step, setStep] = useState<OnboardingStepId>(initialStep);
  const [title, setTitle] = useState('');
  const [rawStatement, setRawStatement] = useState('');
  const [filename, setFilename] = useState('note.md');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [dailyMinutes, setDailyMinutes] = useState(35);
  const [busy, setBusy] = useState(false);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceNote, setSourceNote] = useState<string | null>(null);

  /** Persist the per-owner completion marker; private mode must not break the flow. */
  const persistCompleted = (): void => {
    try {
      markOnboardingComplete(owner, (key, value) => window.localStorage.setItem(key, value));
    } catch {
      // Storage unavailable: onboarding still completes for this session.
    }
  };

  /** Step 3's URL convenience: fetch the page text into the paste field. */
  const fetchUrlText = async (): Promise<void> => {
    if (!url.trim()) return;
    setFetchingUrl(true);
    setError(null);
    try {
      const response = await fetch(url.trim());
      if (!response.ok) throw new Error('url_unreadable');
      const fetched = await response.text();
      if (!fetched.trim()) throw new Error('url_empty');
      setText(fetched);
      setSourceNote('Fetched — review the text below, then continue.');
    } catch {
      // Designed fallback, never a raw network error string (E23 quality spec §3).
      setError("Couldn't read that URL — paste the text instead.");
    } finally {
      setFetchingUrl(false);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (step === 'minutes') {
      void start();
      return;
    }
    setError(null);
    const next = nextOnboardingStep(step);
    if (next === 'done') {
      void start();
      return;
    }
    setStep(next);
  };

  const back = (): void => {
    setError(null);
    setStep((current) => previousOnboardingStep(current) ?? current);
  };

  /**
   * The auto-compile: create the gap → register the source → start the compile with the
   * deterministic idempotency key, then land on Today (which shows the progress surface until
   * Day 1 lands). One coherent submit — the reward arrives fast (spec §5).
   */
  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const created = (await apiFetch('/api/gaps', {
        method: 'POST',
        body: JSON.stringify(onboardingGapBody({ title, rawStatement, dailyMinutes })),
      })) as { gap: { id: string } };
      const gapId = created.gap.id;

      const registration = (await apiFetch(`/api/gaps/${gapId}/sources`, {
        method: 'POST',
        body: JSON.stringify(onboardingSourceBody(gapId, { filename, text })),
      })) as { registration: { accepted: boolean; code?: string; message?: string } };
      if (!registration.registration.accepted) {
        throw new Error(
          registration.registration.message ??
            `The source was rejected (${registration.registration.code ?? 'unknown'}).`,
        );
      }

      await apiFetch(`/api/gaps/${gapId}/compile`, {
        method: 'POST',
        body: JSON.stringify(onboardingCompileBody(gapId)),
      });

      persistCompleted();
      // We are already on Today: swap the gate back and refetch the server children so the
      // surface reflects the new gap (continue card once Day 1 lands, progress until then).
      onDone?.();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const skip = (): void => {
    persistCompleted();
    // Skip is a dismissal, not a data change: swap the gate back to the Today surface.
    onDone?.();
  };

  return (
    <main className="onboarding">
      <header className="onboarding__head">
        <p className="onboarding__step" role="status">
          Step {STEP_NUMBER[step]} of 3 — {STEP_TITLES[step]}
        </p>
        <h1>{STEP_TITLES[step]}</h1>
        <p className="onboarding__subtitle">{STEP_BLURBS[step]}</p>
      </header>

      <form className="card onboarding__card" onSubmit={submit}>
        {step === 'gap' && (
          <>
            <label>
              Title
              <input
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                placeholder="e.g. Set theory for my AI course"
              />
            </label>
            <label>
              What do you want to be able to do?
              <textarea
                name="rawStatement"
                value={rawStatement}
                onChange={(event) => setRawStatement(event.target.value)}
                required
                rows={3}
                placeholder="I understand basic set notation but need equivalence relations and proof techniques by Friday. I have 35 minutes per day."
              />
            </label>
          </>
        )}

        {step === 'source' && (
          <>
            <label>
              Filename
              <input
                name="filename"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
              />
            </label>
            <label>
              Content
              <textarea
                name="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
                rows={6}
                placeholder="Paste notes, a chapter, a transcript…"
              />
            </label>
            <div className="onboarding__url">
              <label>
                …or a URL
                <input
                  name="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/chapter"
                />
              </label>
              <button
                type="button"
                onClick={() => void fetchUrlText()}
                disabled={fetchingUrl || !url.trim()}
              >
                {fetchingUrl ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
            {sourceNote && <p className="ok">{sourceNote}</p>}
          </>
        )}

        {step === 'minutes' && (
          <>
            <label>
              Minutes per day
              <input
                name="dailyMinutes"
                type="number"
                min={5}
                max={480}
                value={dailyMinutes}
                onChange={(event) => setDailyMinutes(Number(event.target.value))}
              />
            </label>
            <p className="muted">
              You&rsquo;re ready — GapOS builds a source-grounded audio course from your gap and
              source, then Day 1 is yours.
            </p>
          </>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="onboarding__actions">
          {step !== 'gap' && (
            <button type="button" className="btn" onClick={back} disabled={busy}>
              Back
            </button>
          )}
          {step === 'minutes' ? (
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Building your course…' : 'Start my course'}
            </button>
          ) : (
            <button type="submit" className="btn btn--primary">
              Continue
            </button>
          )}
        </div>
      </form>

      <button type="button" className="onboarding__skip" onClick={skip} disabled={busy}>
        Skip for now — I&rsquo;ll build tracks myself
      </button>
    </main>
  );
}
