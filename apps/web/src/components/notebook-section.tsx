'use client';

/**
 * Listen / Read toggle (E25 / GAP-083).
 *
 * The notebook HTML is rendered server-side (lib/notebook.ts, KaTeX) and shipped as a
 * string — this component only owns the mode state and the toggle UI. Listen mode shows
 * the audio player and hides the notebook; Read mode shows the notebook (plus transcript
 * fallback when the lesson has no notebook). The choice persists per session.
 */

import { useCallback, useEffect, useState } from 'react';

export type StudyMode = 'listen' | 'read';

const STORAGE_KEY = 'gapos_study_mode';

export const readStudyMode = (): StudyMode => {
  if (typeof window === 'undefined') return 'listen';
  return window.localStorage.getItem(STORAGE_KEY) === 'read' ? 'read' : 'listen';
};

interface NotebookSectionProps {
  /** Server-rendered notebook HTML (already escaped + KaTeX'd). */
  readonly notebookHtml: string;
  /** Transcript fallback when the lesson predates the notebook field. */
  readonly transcript: string;
  /** The listen surface (audio player + transcript). Rendered when mode is listen. */
  readonly listenSurface: React.ReactNode;
}

export function StudyModeToggle({
  mode,
  onChange,
}: {
  readonly mode: StudyMode;
  readonly onChange: (mode: StudyMode) => void;
}) {
  return (
    <div className="study-mode" role="group" aria-label="Study mode">
      <button
        type="button"
        className={`study-mode__btn${mode === 'listen' ? ' is-active' : ''}`}
        aria-pressed={mode === 'listen'}
        onClick={() => onChange('listen')}
      >
        Listen
      </button>
      <button
        type="button"
        className={`study-mode__btn${mode === 'read' ? ' is-active' : ''}`}
        aria-pressed={mode === 'read'}
        onClick={() => onChange('read')}
      >
        Read
      </button>
    </div>
  );
}

export function NotebookSection({ notebookHtml, transcript, listenSurface }: NotebookSectionProps) {
  const [mode, setMode] = useState<StudyMode>('listen');

  useEffect(() => {
    setMode(readStudyMode());
  }, []);

  const changeMode = useCallback((next: StudyMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable (private mode) — the toggle still works for this session
    }
  }, []);

  return (
    <div className="notebook">
      <StudyModeToggle mode={mode} onChange={changeMode} />
      {mode === 'listen' ? (
        <div className="notebook__listen">{listenSurface}</div>
      ) : notebookHtml ? (
        // The HTML is server-rendered from the lesson's own notebook markdown through
        // KaTeX + our diagram renderer — no user-supplied HTML reaches this point.
        <div className="notebook__read" dangerouslySetInnerHTML={{ __html: notebookHtml }} />
      ) : (
        <div className="notebook__read">
          <p className="transcript">{transcript}</p>
        </div>
      )}
    </div>
  );
}
