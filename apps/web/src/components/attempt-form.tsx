'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';
import { ConfidenceControl, type ConfidenceLevel } from './confidence-control';
import { PracticeFeedback, type FeedbackLocator } from './practice-feedback';
import { SourceLinks } from './source-links';

export interface AttemptQuestion {
  id: string;
  objectiveId: string;
  prompt: string;
  options?: string[];
  hint?: string;
  /** The source locators behind the verified solution, shown in the correction surface. */
  locators?: readonly FeedbackLocator[];
}

export function AttemptForm({
  gapId,
  sessionId,
  question,
}: {
  gapId: string;
  sessionId: string;
  question: AttemptQuestion;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ correct: boolean; answer: string } | null>(null);
  const [revealedHint, setRevealedHint] = useState(false);
  const [confidence, setConfidence] = useState<ConfidenceLevel>();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const outcome = (await apiFetch(`/api/gaps/${gapId}/attempts`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: question.id,
          sessionId,
          response: String(form.get('response') ?? ''),
          ...(confidence ? { confidence } : {}),
          idempotencyKey: `web-${question.id}-${Date.now()}`,
        }),
      })) as { attempt: { correct: boolean; feedback: { answer: string } } };
      setResult({
        correct: outcome.attempt.correct,
        answer: outcome.attempt.feedback.answer,
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="card attempt-form">
        <p className="prompt">{question.prompt}</p>
        <PracticeFeedback
          correct={result.correct}
          answer={result.answer}
          locators={question.locators}
          sourcesTabHref={`/gaps/${gapId}?tab=sources`}
        />
        <button type="button" className="btn" onClick={() => setResult(null)}>
          Try the next one
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card attempt-form">
      <p className="prompt">{question.prompt}</p>
      {/* The locators behind this item are visible BEFORE answering (E24 US2, C-07): the
          learner sees what the question rests on, not only after a wrong answer. */}
      <SourceLinks gapId={gapId} locators={question.locators ?? []} />
      {question.options ? (
        <label>
          <select name="response" required>
            <option value="">Choose…</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Your answer
          <textarea name="response" required rows={2} />
        </label>
      )}
      {question.hint && (
        <p>
          <button type="button" className="btn" onClick={() => setRevealedHint((v) => !v)}>
            {revealedHint ? 'Hide hint' : 'Show hint'}
          </button>
          {revealedHint && <span className="hint"> {question.hint}</span>}
        </p>
      )}
      <div className="confidence-group">
        <span className="confidence-group__label">How sure are you?</span>
        <ConfidenceControl value={confidence} onChange={setConfidence} />
      </div>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn btn--primary" disabled={busy}>
        {busy ? 'Checking…' : 'Answer'}
      </button>
    </form>
  );
}
