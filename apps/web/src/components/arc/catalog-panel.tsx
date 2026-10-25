'use client';

/**
 * Catalog libraries and structured outline import — entry to the syllabus placement loop.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, StatusMessage } from '@gapos/ui';
import { ArcFetchError, arcFetch } from './arc-client';

interface CatalogSyllabus {
  id: string;
  version: number;
  title: string;
  description: string;
  moduleCount: number;
  objectiveCount: number;
}

export function CatalogPanel({ syllabi }: { syllabi: readonly CatalogSyllabus[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [outcomesText, setOutcomesText] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  const enroll = async (syllabusId: string) => {
    setError(null);
    setBusyId(syllabusId);
    try {
      const body = (await arcFetch(`/api/arc/syllabi/${encodeURIComponent(syllabusId)}/enroll`, {
        method: 'POST',
        body: JSON.stringify({}),
      })) as { enrollment: { id: string } };
      router.push(`/arc/enrollments/${body.enrollment.id}`);
    } catch (cause) {
      setError(cause instanceof ArcFetchError ? cause.message : String(cause));
      setBusyId(null);
    }
  };

  const importOutline = async () => {
    setError(null);
    setImportBusy(true);
    try {
      const outcomes = outcomesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const imported = (await arcFetch('/api/arc/syllabi/import', {
        method: 'POST',
        body: JSON.stringify({
          title,
          ...(description.trim() ? { description: description.trim() } : {}),
          modules: [{ title: moduleTitle, outcomes }],
        }),
      })) as { syllabus: { id: string } };
      const body = (await arcFetch(
        `/api/arc/syllabi/${encodeURIComponent(imported.syllabus.id)}/enroll`,
        { method: 'POST', body: JSON.stringify({}) },
      )) as { enrollment: { id: string } };
      router.push(`/arc/enrollments/${body.enrollment.id}`);
    } catch (cause) {
      setError(cause instanceof ArcFetchError ? cause.message : String(cause));
      setImportBusy(false);
    }
  };

  return (
    <div className="arc-stack">
      {error ? (
        <StatusMessage tone="error" title="Catalog action failed.">
          {error}
        </StatusMessage>
      ) : null}

      <section className="arc-panel" aria-labelledby="catalog-libraries">
        <p className="arc-eyebrow">Libraries</p>
        <h2 id="catalog-libraries">Designed syllabi</h2>
        <p className="arc-muted">
          Take a placement exam. Where you lack, Arc opens short courses — then you place again.
        </p>
        <ul className="arc-skill-list">
          {syllabi.map((syllabus) => (
            <li key={syllabus.id} className="arc-skill-row">
              <div className="arc-skill-copy">
                <strong>{syllabus.title}</strong>
                <p>{syllabus.description}</p>
                <p className="arc-muted">
                  {syllabus.moduleCount} modules · {syllabus.objectiveCount} objectives
                </p>
              </div>
              <button
                type="button"
                className="arc-primary"
                disabled={busyId === syllabus.id}
                onClick={() => void enroll(syllabus.id)}
              >
                {busyId === syllabus.id ? 'Starting…' : 'Start placement'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="arc-panel" aria-labelledby="catalog-import">
        <p className="arc-eyebrow">Your outline</p>
        <h2 id="catalog-import">Import a structured syllabus</h2>
        <p className="arc-muted">
          Paste module titles and outcomes from university notes. Free-form PDF parsing comes later.
        </p>
        <div className="arc-form-stack">
          <Field label="Course title">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Intro to Algorithms"
              autoComplete="off"
            />
          </Field>
          <Field label="Description (optional)">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short note about the course"
              autoComplete="off"
            />
          </Field>
          <Field label="First module title">
            <input
              value={moduleTitle}
              onChange={(event) => setModuleTitle(event.target.value)}
              placeholder="e.g. Sorting"
              autoComplete="off"
            />
          </Field>
          <Field label="Outcomes (one per line)">
            <textarea
              value={outcomesText}
              onChange={(event) => setOutcomesText(event.target.value)}
              rows={4}
              placeholder={'Implement mergesort\nAnalyse sorting complexity'}
            />
          </Field>
          <button
            type="button"
            className="arc-primary"
            disabled={importBusy || !title.trim() || !moduleTitle.trim() || !outcomesText.trim()}
            onClick={() => void importOutline()}
          >
            {importBusy ? 'Importing…' : 'Import and start placement'}
          </button>
        </div>
      </section>
    </div>
  );
}
