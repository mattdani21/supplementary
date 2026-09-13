'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, Field, StatusMessage } from '@gapos/ui';
import { ArcFetchError, arcFetch } from './arc-client';

export interface ArcReviewItem {
  readonly reviewId: string;
  readonly questionId: string;
  readonly gapId: string;
  readonly gapTitle: string;
  readonly objectiveId: string;
  readonly capabilityStatement: string;
  readonly dueAt: string;
  readonly reason: 'ladder' | 'remediation' | 'confidence_drop';
  readonly prompt: string;
  readonly type: 'multiple_choice' | 'short_answer' | 'worked_problem' | 'code_proof';
  readonly options?: readonly string[];
  readonly hint?: string;
}

interface ReviewResult {
  readonly correct: boolean;
  readonly feedback: { readonly answer: string; readonly rubric?: string };
  readonly nextReview?: { readonly dueAt: string; readonly reason: string };
}

export function ReviewQueue({ initialReviews }: { initialReviews: readonly ArcReviewItem[] }) {
  const [reviews, setReviews] = useState([...initialReviews]);
  const [response, setResponse] = useState('');
  const [confidence, setConfidence] = useState<'low' | 'medium' | 'high'>('medium');
  const [hintOpen, setHintOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const review = reviews[0];

  if (stale) {
    return (
      <EmptyState
        eyebrow="Review refreshed"
        title="That review is no longer due."
        action={
          <Link className="arc-primary" href="/arc">
            Return to Today
          </Link>
        }
      >
        Another session may already have completed it. Nothing was submitted twice.
      </EmptyState>
    );
  }

  if (!review) {
    return (
      <EmptyState
        eyebrow="Review queue"
        title="Nothing is due right now."
        action={
          <Link className="arc-primary" href="/arc">
            Return to Today
          </Link>
        }
      >
        Arc will bring back a retrieval prompt when the fixed review ladder says it is useful.
      </EmptyState>
    );
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = (await arcFetch(`/api/arc/reviews/${review.reviewId}`, {
        method: 'POST',
        body: JSON.stringify({
          response,
          confidence,
          idempotencyKey: `arc-review:${review.reviewId}`,
        }),
      })) as { review: ReviewResult };
      setResult(body.review);
    } catch (cause) {
      if (cause instanceof ArcFetchError && cause.status === 404) {
        setStale(true);
        return;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    setReviews((current) => current.slice(1));
    setResponse('');
    setConfidence('medium');
    setHintOpen(false);
    setError(null);
    setResult(null);
  };

  if (result) {
    return (
      <div className="arc-review-result">
        <StatusMessage
          tone={result.correct ? 'success' : 'warning'}
          title={result.correct ? 'Review complete.' : 'Correction scheduled.'}
        >
          <p>
            <strong>Answer:</strong> {result.feedback.answer}
          </p>
          {result.feedback.rubric ? <p>{result.feedback.rubric}</p> : null}
          {result.nextReview ? (
            <p>
              Next retrieval: {new Date(result.nextReview.dueAt).toLocaleDateString()} (
              {result.nextReview.reason}).
            </p>
          ) : (
            <p>The fixed review ladder is complete for this attempt.</p>
          )}
        </StatusMessage>
        <button className="arc-primary arc-full" type="button" onClick={advance}>
          {reviews.length > 1 ? 'Next review →' : 'Finish reviews →'}
        </button>
      </div>
    );
  }

  return (
    <form className="arc-review-card" onSubmit={submit}>
      <div className="arc-review-meta">
        <span>{review.reason.replace('_', ' ')}</span>
        <span>{reviews.length} due</span>
      </div>
      <p className="arc-eyebrow">{review.gapTitle}</p>
      <h2>{review.capabilityStatement}</h2>
      <p className="arc-review-prompt">{review.prompt}</p>

      {review.type === 'multiple_choice' ? (
        <fieldset className="arc-practice-options">
          <legend className="arc-visually-hidden">Choose one answer</legend>
          {review.options?.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="review-response"
                value={option}
                checked={response === option}
                onChange={() => setResponse(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <Field
          label={review.type === 'code_proof' ? 'Your proof' : 'Your answer'}
          hint="The answer remains hidden until this review is submitted."
        >
          <textarea
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            rows={review.type === 'code_proof' ? 9 : 5}
            spellCheck={review.type !== 'code_proof'}
          />
        </Field>
      )}

      {review.hint ? (
        <div>
          <button
            className="arc-secondary"
            type="button"
            aria-expanded={hintOpen}
            onClick={() => setHintOpen((open) => !open)}
          >
            {hintOpen ? 'Hide hint' : 'Need a hint'}
          </button>
          {hintOpen ? <div className="arc-hint-box">{review.hint}</div> : null}
        </div>
      ) : null}

      <Field label="Confidence after answering">
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
        <StatusMessage tone="error" title="Review was not submitted.">
          {error}
        </StatusMessage>
      ) : null}
      <button className="arc-primary arc-full" type="submit" disabled={!response || busy}>
        {busy ? 'Checking review…' : 'Submit review'}
      </button>
    </form>
  );
}
