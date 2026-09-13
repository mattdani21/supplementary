'use client';

import { useState } from 'react';
import { Field, StatusMessage } from '@gapos/ui';
import { arcFetch } from './arc-client';

export interface ArcPracticeQuestion {
  readonly questionId: string;
  readonly prompt: string;
  readonly type: 'multiple_choice' | 'short_answer' | 'worked_problem';
  readonly role: 'retrieval' | 'application' | 'transfer';
  readonly options?: readonly string[];
  readonly hint?: string;
}

interface AttemptView {
  readonly correct: boolean;
  readonly feedback: { readonly answer: string; readonly rubric?: string };
  readonly scheduledReviews: readonly { readonly dueAt: string; readonly reason: string }[];
}

export function ArcPractice({
  gapId,
  sessionId,
  questions,
}: {
  readonly gapId: string;
  readonly sessionId: string;
  readonly questions: readonly ArcPracticeQuestion[];
}) {
  const [index, setIndex] = useState(0);
  const [response, setResponse] = useState('');
  const [confidence, setConfidence] = useState<'low' | 'medium' | 'high'>('medium');
  const [hintOpen, setHintOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptView | null>(null);

  const question = questions[index];
  if (!question) {
    return (
      <StatusMessage tone="success" title="Practice complete for this lesson.">
        Return to the map to see which evidence the objective still needs.
      </StatusMessage>
    );
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = (await arcFetch(`/api/gaps/${gapId}/attempts`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: question.questionId,
          sessionId,
          response,
          hintsUsed: hintOpen ? 1 : 0,
          confidence,
          idempotencyKey: `${sessionId}:${question.questionId}:practice`,
        }),
      })) as { attempt: AttemptView };
      setResult(body.attempt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    setIndex((current) => current + 1);
    setResponse('');
    setResult(null);
    setHintOpen(false);
    setError(null);
  };

  if (result) {
    const next = [...result.scheduledReviews].sort(
      (a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
    )[0];
    return (
      <div className="arc-practice-result">
        <StatusMessage
          tone={result.correct ? 'success' : 'warning'}
          title={result.correct ? 'That evidence holds.' : 'Not yet — use the correction.'}
        >
          <p>
            <strong>Answer:</strong> {result.feedback.answer}
          </p>
          {result.feedback.rubric ? <p>{result.feedback.rubric}</p> : null}
          {next ? (
            <p>
              Next retrieval: {new Date(next.dueAt).toLocaleDateString()} ({next.reason}).
            </p>
          ) : null}
        </StatusMessage>
        <button className="arc-primary arc-full" type="button" onClick={advance}>
          {index + 1 < questions.length ? 'Continue practice →' : 'Finish lesson →'}
        </button>
      </div>
    );
  }

  return (
    <form className="arc-practice-form" onSubmit={submit}>
      <div className="arc-practice-heading">
        <p className="arc-eyebrow">
          {question.role} · {index + 1} of {questions.length}
        </p>
        <h2>{question.prompt}</h2>
      </div>

      {question.type === 'multiple_choice' ? (
        <fieldset className="arc-practice-options">
          <legend className="arc-visually-hidden">Choose one answer</legend>
          {question.options?.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="response"
                value={option}
                checked={response === option}
                onChange={() => setResponse(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <Field label="Your answer" hint="The solution stays hidden until you submit.">
          <textarea
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            rows={5}
            required
          />
        </Field>
      )}

      {question.hint ? (
        <div>
          <button
            className="arc-secondary"
            type="button"
            aria-expanded={hintOpen}
            onClick={() => setHintOpen((open) => !open)}
          >
            {hintOpen ? 'Hide hint' : 'Need a hint'}
          </button>
          {hintOpen ? <div className="arc-hint-box">{question.hint}</div> : null}
        </div>
      ) : null}

      <Field label="How certain was this answer?">
        <select
          value={confidence}
          onChange={(event) => setConfidence(event.target.value as typeof confidence)}
        >
          <option value="low">Low confidence</option>
          <option value="medium">Medium confidence</option>
          <option value="high">High confidence</option>
        </select>
      </Field>

      {error ? (
        <StatusMessage tone="error" title="Practice was not submitted.">
          {error}
        </StatusMessage>
      ) : null}
      <button className="arc-primary arc-full" type="submit" disabled={!response || busy}>
        {busy ? 'Checking…' : 'Submit answer'}
      </button>
    </form>
  );
}
