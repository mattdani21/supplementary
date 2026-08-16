'use client';

/**
 * The notebook surface (E25 / GAP-083).
 *
 * The notebook HTML is rendered server-side (lib/notebook.ts, KaTeX) and shipped as a
 * string — this component wraps it in the explain layer (selection → AI explanation →
 * pin). There is no Listen/Read toggle: the notebook is always visible, and audio lives
 * in the floating player dock (GAP-091).
 */

import { ExplainLayer } from './explain-layer';

interface NotebookSectionProps {
  /** Server-rendered notebook HTML (already escaped + KaTeX'd). */
  readonly notebookHtml: string;
  /** Transcript fallback when the lesson predates the notebook field. */
  readonly transcript: string;
  /** Explain layer (E25 / GAP-085): selection → AI explanation → pin to notebook. */
  readonly explain?: {
    readonly gapId: string;
    readonly lessonId: string;
  };
}

export function NotebookSection({ notebookHtml, transcript, explain }: NotebookSectionProps) {
  const readSurface = notebookHtml ? (
    // The HTML is server-rendered from the lesson's own notebook markdown through
    // KaTeX + our diagram renderer — no user-supplied HTML reaches this point.
    <div className="notebook__read" dangerouslySetInnerHTML={{ __html: notebookHtml }} />
  ) : (
    <div className="notebook__read">
      <p className="transcript">{transcript}</p>
    </div>
  );

  return explain ? (
    <ExplainLayer gapId={explain.gapId} lessonId={explain.lessonId} context={transcript || ''}>
      {readSurface}
    </ExplainLayer>
  ) : (
    readSurface
  );
}
