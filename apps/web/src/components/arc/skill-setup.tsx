'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Field, StatusMessage } from '@gapos/ui';
import { arcFetch } from './arc-client';

interface SetupGap {
  readonly id: string;
  readonly title: string;
  readonly rawStatement: string;
  readonly dailyMinutes: number;
  readonly deadline?: string;
  readonly sourcePolicy: 'general_knowledge_allowed' | 'sources_only';
  readonly status: string;
}

interface SetupSource {
  readonly id: string;
  readonly filename: string;
  readonly processingStatus: string;
}

interface SetupRun {
  readonly status: string;
  readonly error?: string;
}

type CompileState = { phase: 'idle' } | { phase: 'running' } | { phase: 'failed'; message: string };

const mediaTypeFor = (filename: string): string => {
  if (filename.toLowerCase().endsWith('.md')) return 'text/markdown';
  if (filename.toLowerCase().endsWith('.html')) return 'text/html';
  return 'text/plain';
};

const compilationKey = (gapId: string): string => {
  const storageKey = `arc:compile:${gapId}`;
  const stored = window.sessionStorage.getItem(storageKey);
  if (stored) return stored;
  const value = `arc-${gapId}-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(storageKey, value);
  return value;
};

export function SkillSetup({
  gap,
  initialSources,
  lastRun,
}: {
  gap: SetupGap;
  initialSources: SetupSource[];
  lastRun?: SetupRun;
}) {
  const router = useRouter();
  const sourceForm = useRef<HTMLFormElement>(null);
  const [sources, setSources] = useState(initialSources);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [generalKnowledgeConfirmed, setGeneralKnowledgeConfirmed] = useState(false);
  const [compileState, setCompileState] = useState<CompileState>({ phase: 'idle' });

  useEffect(() => {
    if (gap.status === 'failed' || lastRun?.status === 'partial') {
      window.sessionStorage.removeItem(`arc:compile:${gap.id}`);
    }
  }, [gap.id, gap.status, lastRun?.status]);

  const addSource = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    const pasted = String(data.get('text') ?? '').trim();
    const selectedFile = file instanceof File && file.size > 0 ? file : undefined;
    const text = selectedFile ? await selectedFile.text() : pasted;
    const filename = selectedFile?.name ?? String(data.get('filename') || 'learner-note.md');

    if (!text.trim()) {
      setSourceError('Choose a text file or paste source material before adding it.');
      return;
    }

    setSourceBusy(true);
    setSourceError(null);
    setSourceMessage(null);
    try {
      const body = (await arcFetch(`/api/gaps/${gap.id}/sources`, {
        method: 'POST',
        body: JSON.stringify({
          gapId: gap.id,
          filename,
          mediaType: mediaTypeFor(filename),
          text,
        }),
      })) as {
        registration:
          | {
              accepted: true;
              source: SetupSource;
              deduplicated: boolean;
            }
          | { accepted: false; message: string };
      };

      if (!body.registration.accepted) {
        setSourceError(body.registration.message);
        return;
      }
      const accepted = body.registration;

      setSources((current) => {
        if (current.some((source) => source.id === accepted.source.id)) return current;
        return [...current, accepted.source];
      });
      setSourceMessage(
        accepted.deduplicated
          ? 'That source was already attached, so Arc reused it.'
          : 'Source attached. It will be normalized during compile.',
      );
      form.reset();
    } catch (cause) {
      setSourceError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSourceBusy(false);
    }
  };

  const compile = async () => {
    const retry =
      compileState.phase === 'failed' || gap.status === 'failed' || lastRun?.status === 'partial';
    setCompileState({ phase: 'running' });
    try {
      if (gap.status === 'draft') {
        await arcFetch(`/api/gaps/${gap.id}/transition`, {
          method: 'POST',
          body: JSON.stringify({ type: 'define' }),
        });
      }

      const idempotencyKey = compilationKey(gap.id);
      const body = (await arcFetch(`/api/gaps/${gap.id}/compile`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          idempotencyKey,
          audioEnabled: true,
          surface: 'arc_setup',
          retry,
        }),
      })) as { run: { status: string; error?: string } };

      if (body.run.status === 'failed') {
        // The recorded attempt ended. A deliberate retry needs a new attempt key; an ambiguous
        // network retry above keeps its key so it cannot duplicate provider work.
        window.sessionStorage.removeItem(`arc:compile:${gap.id}`);
        setCompileState({
          phase: 'failed',
          message: body.run.error ?? 'Compilation stopped before Day 1 was publishable.',
        });
        return;
      }

      if (body.run.status === 'partial') {
        window.sessionStorage.removeItem(`arc:compile:${gap.id}`);
      }
      router.push(`/arc/skills/${gap.id}`);
      router.refresh();
    } catch (cause) {
      setCompileState({
        phase: 'failed',
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  if (gap.status === 'archived') {
    return (
      <StatusMessage
        tone="warning"
        title="This skill is archived."
        action={
          <Link className="arc-primary" href="/arc/skills">
            Return to Skills
          </Link>
        }
      >
        Archived skills cannot be recompiled. Choose another active route from your library.
      </StatusMessage>
    );
  }

  if (
    (gap.status === 'active' || gap.status === 'filled' || gap.status === 'review_due') &&
    lastRun?.status !== 'partial'
  ) {
    return (
      <StatusMessage
        tone="success"
        title="Your route is published."
        action={
          <Link className="arc-primary" href={`/arc/skills/${gap.id}`}>
            Open skill map →
          </Link>
        }
      >
        Day 1 is ready with its transcript, practice, and available audio.
      </StatusMessage>
    );
  }

  const canCompile =
    sources.length > 0 ||
    (gap.sourcePolicy === 'general_knowledge_allowed' && generalKnowledgeConfirmed);
  const compileBusy = compileState.phase === 'running' || gap.status === 'compiling';

  return (
    <div className="arc-setup">
      <section className="arc-brief" aria-labelledby="arc-brief-title">
        <p className="arc-eyebrow">Confirmed brief</p>
        <h2 id="arc-brief-title">{gap.title}</h2>
        <p>{gap.rawStatement}</p>
        <dl>
          <div>
            <dt>Daily focus</dt>
            <dd>{gap.dailyMinutes} minutes</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{gap.deadline ?? 'Flexible'}</dd>
          </div>
          <div>
            <dt>Boundary</dt>
            <dd>
              {gap.sourcePolicy === 'sources_only'
                ? 'Provided sources only'
                : 'Sources + general knowledge'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="arc-setup-section" aria-labelledby="arc-sources-title">
        <div className="arc-section-heading">
          <div>
            <p className="arc-eyebrow">Evidence</p>
            <h2 id="arc-sources-title">Supply trusted sources</h2>
          </div>
          <span>{sources.length} attached</span>
        </div>

        {sources.length > 0 && (
          <ul className="arc-source-list">
            {sources.map((source) => (
              <li key={source.id}>
                <span aria-hidden="true">↳</span>
                <span>
                  <strong>{source.filename}</strong>
                  <small>{source.processingStatus}</small>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form ref={sourceForm} className="arc-source-form" onSubmit={addSource}>
          <Field
            label="Text source file"
            hint="Plain text, Markdown, or HTML. The original filename is preserved."
          >
            <input
              name="file"
              type="file"
              accept=".txt,.md,.html,text/plain,text/markdown,text/html"
            />
          </Field>
          <div className="arc-source-divider" aria-hidden="true">
            or paste a source
          </div>
          <Field label="Source name">
            <input name="filename" defaultValue="learner-note.md" />
          </Field>
          <Field label="Source content">
            <textarea
              name="text"
              rows={6}
              placeholder="Paste notes, an approved chapter, or a transcript…"
            />
          </Field>
          {sourceError && (
            <StatusMessage tone="error" title="Source not attached.">
              {sourceError}
            </StatusMessage>
          )}
          {sourceMessage && <StatusMessage tone="success" title={sourceMessage} />}
          <button className="arc-secondary" type="submit" disabled={sourceBusy}>
            {sourceBusy ? 'Attaching source…' : 'Attach source'}
          </button>
        </form>
      </section>

      {gap.sourcePolicy === 'general_knowledge_allowed' && sources.length === 0 && (
        <label className="arc-confirmation">
          <input
            type="checkbox"
            checked={generalKnowledgeConfirmed}
            onChange={(event) => setGeneralKnowledgeConfirmed(event.target.checked)}
          />
          <span>
            <strong>Continue without an upload</strong>
            Arc may use labelled general knowledge, and factual source boundaries remain visible.
          </span>
        </label>
      )}

      {gap.sourcePolicy === 'sources_only' && sources.length === 0 && (
        <StatusMessage tone="warning" title="A source is required.">
          This route is constrained to your evidence. Attach at least one accepted source before
          compiling.
        </StatusMessage>
      )}

      {gap.status === 'failed' && compileState.phase === 'idle' && (
        <StatusMessage tone="error" title="The previous compilation stopped.">
          {lastRun?.error ??
            'Your sources and brief are still here. Retry to create a fresh generation attempt.'}
        </StatusMessage>
      )}

      {lastRun?.status === 'partial' && compileState.phase === 'idle' && (
        <StatusMessage tone="warning" title="Part of this route still needs repair.">
          Verified lessons remain available. Retry compilation to rebuild the missing coverage with
          a fresh generation attempt.
        </StatusMessage>
      )}

      {compileState.phase === 'failed' && (
        <StatusMessage tone="error" title="Compilation needs another try.">
          {compileState.message}
        </StatusMessage>
      )}

      {compileBusy && (
        <StatusMessage
          tone="info"
          title="Creating your first usable lesson…"
          action={
            <Link className="arc-secondary" href={`/arc/skills/${gap.id}/setup`}>
              Refresh compile status
            </Link>
          }
        >
          Arc is normalizing evidence, planning objectives, verifying practice, and synthesizing
          available audio. Keep this page open.
        </StatusMessage>
      )}

      <button
        className="arc-primary arc-full"
        type="button"
        onClick={compile}
        disabled={!canCompile || compileBusy}
      >
        {compileBusy
          ? 'Compiling Day 1…'
          : compileState.phase === 'failed' ||
              gap.status === 'failed' ||
              lastRun?.status === 'partial'
            ? 'Retry compile'
            : 'Compile my route →'}
      </button>
    </div>
  );
}
