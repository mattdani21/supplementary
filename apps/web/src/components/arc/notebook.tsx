'use client';

/**
 * The Arc notebook (GAP-032): an editable code cell whose "Run cell" executes REAL server-side
 * sandboxed code, and whose "Submit proof" re-executes server-side, records an attempt and
 * mastery evidence only when every check passed, and advances the gap state machine. A wrong
 * proof is supportive and state-neutral. The client never decides correctness.
 */

import Link from 'next/link';
import { useState } from 'react';
import { arcFetch } from './arc-client';

interface NotebookProps {
  readonly gapId: string;
  readonly sessionId: string;
  readonly question: {
    questionId: string;
    prompt: string;
    starterCode: string;
    hint?: string;
  };
}

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'ran'; passed: boolean; output: string; error?: string }
  | { phase: 'submitting' }
  | { phase: 'submitted'; passed: boolean; output: string; filled: boolean; error?: string };

export function Notebook({ gapId, sessionId, question }: NotebookProps) {
  const [code, setCode] = useState(question.starterCode);
  const [hintOpen, setHintOpen] = useState(false);
  const [state, setState] = useState<RunState>({ phase: 'idle' });

  const run = async () => {
    setState({ phase: 'running' });
    try {
      const body = (await arcFetch(`/api/arc/gaps/${gapId}/proofs/run`, {
        method: 'POST',
        body: JSON.stringify({ questionId: question.questionId, code }),
      })) as { run: { passed: boolean; output: string; error?: string } };
      setState({ phase: 'ran', ...body.run });
    } catch (error) {
      setState({
        phase: 'ran',
        passed: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const submit = async () => {
    if (state.phase !== 'ran' || !state.passed) return;
    setState({ phase: 'submitting' });
    try {
      const body = (await arcFetch(`/api/arc/gaps/${gapId}/proofs`, {
        method: 'POST',
        body: JSON.stringify({
          questionId: question.questionId,
          sessionId,
          code,
          idempotencyKey: `${sessionId}:${question.questionId}`,
        }),
      })) as {
        proof: { passed: boolean; output: string; filled: boolean; error?: string };
      };
      setState({ phase: 'submitted', ...body.proof });
    } catch (error) {
      setState({
        phase: 'ran',
        passed: false,
        output: state.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const ran = state.phase === 'ran' || state.phase === 'submitted';
  const passed = ran && state.passed;
  const busy = state.phase === 'running' || state.phase === 'submitting';
  const submitted = state.phase === 'submitted';

  return (
    <>
      <div className="arc-notebook-label">
        <span>JS cell</span>
        <span>editable</span>
      </div>
      <p className="arc-notebook-prompt">{question.prompt}</p>
      <textarea
        className="arc-code-editor"
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
          if (state.phase === 'ran' || state.phase === 'submitted') setState({ phase: 'idle' });
        }}
        spellCheck={false}
        aria-label="Notebook code cell"
      />
      <div className="arc-notebook-actions">
        {question.hint && (
          <button
            className="arc-secondary"
            type="button"
            onClick={() => setHintOpen((open) => !open)}
          >
            Need a hint
          </button>
        )}
        <button className="arc-primary" type="button" onClick={run} disabled={busy || submitted}>
          {busy ? 'Running…' : 'Run cell ▶'}
        </button>
      </div>

      {ran && (
        <div className="arc-notebook-output" aria-live="polite">
          <strong>Output</strong>
          {state.output || (state.error ?? 'The cell produced no output.')}
        </div>
      )}
      {!ran && (
        <div className="arc-notebook-output">
          <strong>Output</strong>
          Run the cell to see what your code returns.
        </div>
      )}

      {hintOpen && question.hint && (
        <div className="arc-hint-box">
          <b>Hint:</b> {question.hint}
        </div>
      )}

      {ran && !passed && !submitted && (
        <p className="arc-theory-text">
          Not quite — the output is your clue. A miss never changes your progress; keep going.
        </p>
      )}

      {passed && !submitted && (
        <button className="arc-primary arc-full" type="button" onClick={submit} disabled={busy}>
          Submit proof →
        </button>
      )}

      {submitted && (
        <div className="arc-proof-success" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>{state.filled ? 'Gap cleared.' : 'Proof recorded.'}</strong>
            {state.filled
              ? 'You demonstrated the idea, not just recognised it. The gap is filled.'
              : 'Your proof was recorded as evidence. Keep clearing the sequence to fill the gap.'}
          </div>
        </div>
      )}

      {submitted && (
        <Link
          className="arc-primary arc-full"
          href={`/arc/skills/${gapId}`}
          style={{ marginTop: 15 }}
        >
          Return to map →
        </Link>
      )}
    </>
  );
}
