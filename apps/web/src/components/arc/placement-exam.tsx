'use client';

/**
 * Multi-item placement exam. Answers are graded server-side; the kit never includes the key.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatusMessage } from '@gapos/ui';
import { ArcFetchError, arcFetch } from './arc-client';

interface PlacementItemView {
  id: string;
  objectiveId: string;
  type: 'multiple_choice' | 'short_answer';
  prompt: string;
  options?: readonly string[];
}

interface PlacementKit {
  kitId: string;
  syllabusId: string;
  syllabusVersion: number;
  title: string;
  items: readonly PlacementItemView[];
}

export function PlacementExam({ enrollmentId, kit }: { enrollmentId: string; kit: PlacementKit }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await arcFetch(`/api/arc/enrollments/${encodeURIComponent(enrollmentId)}/placement`, {
        method: 'POST',
        body: JSON.stringify({
          kitId: kit.kitId,
          answers: kit.items.map((item) => ({
            itemId: item.id,
            response: answers[item.id] ?? '',
          })),
        }),
      });
      router.push(`/arc/enrollments/${enrollmentId}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ArcFetchError ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const answered = kit.items.every((item) => (answers[item.id] ?? '').trim().length > 0);

  return (
    <div className="arc-stack">
      <div className="arc-brief">
        <p className="arc-eyebrow">Placement</p>
        <h1>{kit.title}</h1>
        <p>Answer every item. Arc grades privately and opens courses only where you need them.</p>
      </div>

      {error ? (
        <StatusMessage tone="error" title="Placement was not submitted.">
          {error}
        </StatusMessage>
      ) : null}

      <ol className="arc-placement-list">
        {kit.items.map((item, index) => (
          <li key={item.id} className="arc-panel">
            <p className="arc-eyebrow">Question {index + 1}</p>
            <p className="arc-placement-prompt">{item.prompt}</p>
            {item.options ? (
              <div
                className="arc-option-list"
                role="radiogroup"
                aria-label={`Question ${index + 1}`}
              >
                {item.options.map((option) => {
                  const selected = answers[item.id] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`arc-option${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => setAnswers((current) => ({ ...current, [item.id]: option }))}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                className="arc-text-input"
                value={answers[item.id] ?? ''}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [item.id]: event.target.value }))
                }
                aria-label={`Answer for question ${index + 1}`}
              />
            )}
          </li>
        ))}
      </ol>

      <button
        type="button"
        className="arc-primary"
        disabled={!answered || busy}
        onClick={() => void submit()}
      >
        {busy ? 'Checking…' : 'Submit placement'}
      </button>
    </div>
  );
}
