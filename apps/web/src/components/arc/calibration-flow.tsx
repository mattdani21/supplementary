'use client';

/**
 * The Arc 3-step AI calibration (GAP-032): subject → goal → baseline code question, then a
 * mapping animation, then the result. The kit (goal options, baseline question) comes from the
 * provider adapter through the API; the baseline answer is graded server-side; the result
 * (gaps identified, next/after/later preview, the real gap) comes back persisted. The client
 * only ever renders what the server validated.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { arcFetch } from './arc-client';

const SUBJECTS = [
  'Python for data work',
  'SQL foundations',
  'Conversational Korean',
  'Systems design',
] as const;

interface Kit {
  subject: string;
  goalOptions: readonly string[];
  baselineQuestion: { id: string; prompt: string; code: string; options: readonly string[] };
}

interface CalibrationResult {
  calibrationId: string;
  gapId: string;
  subject: string;
  goal: string;
  baselineCorrect: boolean;
  gapsIdentified: readonly string[];
  startingDifficulty: number;
  preview: { next?: string; after?: string; later: readonly string[] };
}

type Step = 1 | 2 | 3 | 'running' | 'result';

export function CalibrationFlow({ initialSubject }: { initialSubject: string }) {
  const [subject, setSubject] = useState(initialSubject);
  const [kit, setKit] = useState<Kit | null>(null);
  const [goal, setGoal] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [baselineFeedback, setBaselineFeedback] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningNote, setRunningNote] = useState('');

  const loadKit = useCallback(async (forSubject: string) => {
    setError(null);
    setKit(null);
    try {
      const body = (await arcFetch(
        `/api/arc/calibration?subject=${encodeURIComponent(forSubject)}`,
      )) as { calibration: Kit };
      setKit(body.calibration);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void loadKit(subject);
  }, [subject, loadKit]);

  const pickSubject = (next: string) => {
    setSubject(next);
    setStep(1);
  };

  const chooseBaseline = (option: string) => {
    setBaseline(option);
    // Supportive live feedback, mirroring the prototype; the real verdict comes from the server.
    setBaselineFeedback(
      option === (kit?.baselineQuestion.options[1] ?? '')
        ? 'Looks right — Arc will use this to place you.'
        : 'No problem — Arc would lower the next question and keep the tone supportive.',
    );
  };

  const next = () => {
    if (step === 1 && subject) setStep(2);
    else if (step === 2 && goal) setStep(3);
  };

  const run = async () => {
    if (!subject || !goal || !baseline) return;
    setStep('running');
    setRunningNote('Comparing your goal with what you already know.');
    try {
      const body = (await arcFetch('/api/arc/calibration', {
        method: 'POST',
        body: JSON.stringify({ subject, goal, baselineAnswer: baseline }),
      })) as { calibration: CalibrationResult };
      setResult(body.calibration);
      setStep('result');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep(3);
    }
  };

  const progressLabel = step === 1 ? 'Step 1 of 3' : step === 2 ? 'Step 2 of 3' : 'Step 3 of 3';
  const progressFill = step === 1 ? 33 : step === 2 ? 66 : 100;

  return (
    <div className="arc-assessment-shell">
      <div className="arc-assess-progress">
        <div className="arc-assess-progress-head">
          <span>{progressLabel}</span>
          <span>2 min</span>
        </div>
        <div className="arc-assess-bar" aria-hidden="true">
          <span style={{ width: `${progressFill}%` }} />
        </div>
      </div>

      {error && <p className="arc-theory-text">{error}</p>}

      {step === 1 && (
        <div className="arc-assess-step">
          <h1>What do you want to learn?</h1>
          <p>Pick a direction. You can refine the destination after Arc understands the start.</p>
          <div className="arc-option-list">
            {SUBJECTS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`arc-option${subject === candidate ? ' is-selected' : ''}`}
                onClick={() => pickSubject(candidate)}
              >
                <span>{candidate}</span>
                <span className="arc-option-dot">✓</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && kit && (
        <div className="arc-assess-step">
          <h1>What would “useful” look like?</h1>
          <p>Your goal changes which gaps matter first. Choose the outcome you care about today.</p>
          <div className="arc-option-list">
            {kit.goalOptions.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`arc-option${goal === candidate ? ' is-selected' : ''}`}
                onClick={() => setGoal(candidate)}
              >
                <span>{candidate}</span>
                <span className="arc-option-dot">✓</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && kit && (
        <div className="arc-assess-step">
          <h1>Show me how you think.</h1>
          <p>
            A quick check places you more accurately than a confidence label. A miss simply makes
            the next question easier.
          </p>
          <pre className="arc-placement-code">
            <code>{kit.baselineQuestion.code}</code>
          </pre>
          <p className="arc-placement-prompt">{kit.baselineQuestion.prompt}</p>
          <div className="arc-option-list">
            {kit.baselineQuestion.options.map((option) => (
              <button
                key={option}
                type="button"
                className={`arc-option${baseline === option ? ' is-selected' : ''}`}
                onClick={() => chooseBaseline(option)}
              >
                <span>{option}</span>
                <span className="arc-option-dot">✓</span>
              </button>
            ))}
          </div>
          {baselineFeedback && (
            <p className="arc-theory-text" aria-live="polite">
              {baselineFeedback}
            </p>
          )}
          <div className="arc-placement-note">
            <span>AI check · 1 of 1</span>
            <span>No score, just a better starting point</span>
          </div>
        </div>
      )}

      {step === 'running' && (
        <div className="arc-running" aria-live="polite">
          <div className="arc-orb" aria-hidden="true" />
          <h2>Mapping your route…</h2>
          <p>
            {runningNote}
            <br />
            Then we will put the next proof in reach.
          </p>
        </div>
      )}

      {step === 'result' && result && (
        <div className="arc-assess-result">
          <p className="arc-eyebrow">Your route is ready</p>
          <h1>
            A focused path to
            <br />
            working knowledge.
          </h1>
          <p>
            Arc found a short sequence of gaps that will unlock your goal without making you repeat
            what you already know.
          </p>
          <div className="arc-result-banner">
            <span className="arc-result-check">✓</span>
            <div>
              <strong>
                {result.gapsIdentified.length} gap{result.gapsIdentified.length === 1 ? '' : 's'}{' '}
                identified
              </strong>
              <span>Start with the highest-leverage one.</span>
            </div>
          </div>
          <div className="arc-gap-preview">
            {result.preview.next && (
              <div className="arc-gap-preview-row">
                <span>{result.preview.next}</span>
                <span>Next</span>
              </div>
            )}
            {result.preview.after && (
              <div className="arc-gap-preview-row">
                <span>{result.preview.after}</span>
                <span>After</span>
              </div>
            )}
            {result.preview.later.map((gap) => (
              <div className="arc-gap-preview-row" key={gap}>
                <span>{gap}</span>
                <span>Later</span>
              </div>
            ))}
          </div>
          <Link className="arc-primary arc-full" href={`/arc/skills/${result.gapId}`}>
            Open my skill map →
          </Link>
        </div>
      )}

      {(step === 1 || step === 2 || step === 3) && (
        <div className="arc-assess-actions">
          <button
            className="arc-secondary"
            type="button"
            onClick={() => {
              if (step === 3) setStep(2);
              else if (step === 2) setStep(1);
            }}
          >
            Back
          </button>
          {step < 3 ? (
            <button
              className="arc-primary"
              type="button"
              onClick={next}
              disabled={step === 1 ? !subject : !goal}
            >
              Continue →
            </button>
          ) : (
            <button
              className="arc-primary"
              type="button"
              onClick={run}
              disabled={!baseline || !kit}
            >
              Run my calibration →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
