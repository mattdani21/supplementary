'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';

export interface AttemptQuestion {
  id: string;
  objectiveId: string;
  prompt: string;
  options?: string[];
  hint?: string;
}

const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

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
  const [result, setResult] = useState<{ correct: boolean; feedback: { answer: string } } | null>(
    null,
  );
  const [revealedHint, setRevealedHint] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const confidence = String(form.get('confidence') ?? '');
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
      setResult(outcome.attempt);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div
        className={`attempt-result ${result.correct ? 'attempt-result--correct' : 'attempt-result--wrong'}`}
      >
        <p className="attempt-result__verdict">{result.correct ? '✓ Correct' : '✗ Not quite'}</p>
        <p className="attempt-result__answer">Verified solution: {result.feedback.answer}</p>
        <button type="button" className="btn" onClick={() => setResult(null)}>
          Try the next one
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card attempt-form">
      <p className="prompt">{question.prompt}</p>
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
      <fieldset className="confidence">
        <legend>How sure are you?</legend>
        {CONFIDENCE_LEVELS.map((level) => (
          <label key={level} className="confidence__option">
            <input type="radio" name="confidence" value={level} />
            <span>{level}</span>
          </label>
        ))}
      </fieldset>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn btn--primary" disabled={busy}>
        {busy ? 'Checking…' : 'Answer'}
      </button>
    </form>
  );
}
