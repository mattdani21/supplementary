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
    try {
      const outcome = (await apiFetch(`/api/gaps/${gapId}/attempts`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: question.id,
          sessionId,
          response: String(form.get('response') ?? ''),
          idempotencyKey: `web-${question.id}-${Date.now()}`,
        }),
      })) as { attempt: { correct: boolean; feedback: { answer: string } } };
      // Show the grade and model answer, but do NOT refresh yet: answering advances the
      // "today" lesson server-side, and a refresh here would remount this form and wipe the
      // feedback before the learner can read it. Refresh when they choose to continue.
      setResult(outcome.attempt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className={`attempt ${result.correct ? 'attempt-correct' : 'attempt-wrong'}`}>
        <p>
          {result.correct ? '✓ Correct' : '✗ Not quite'} — model answer: {result.feedback.answer}
        </p>
        <button
          onClick={() => {
            setResult(null);
            router.refresh();
          }}
        >
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
          <button type="button" onClick={() => setRevealedHint((v) => !v)}>
            {revealedHint ? 'Hide hint' : 'Show hint'}
          </button>
          {revealedHint && <span className="hint"> {question.hint}</span>}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Answer'}
      </button>
    </form>
  );
}
