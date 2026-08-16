'use client';

/**
 * The explain layer (E25 / GAP-085): select a word or sentence in the notebook, get an
 * AI explanation in a popover, and pin it into the notebook as an annotation callout.
 *
 * Selection detection uses window.getSelection over the notebook's rendered HTML. The
 * popover calls POST /api/gaps/explain (budget-gated, contract-validated) and the pin
 * button persists the annotation through the same endpoint.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ownerFromCookie } from './audio-player';

interface ExplainResponse {
  explanation: { selection: string; explanation: string; note?: string };
}

interface ExplainPopoverProps {
  readonly gapId: string;
  readonly lessonId: string;
  readonly selection: string;
  readonly context: string;
  readonly onClose: () => void;
  readonly onPinned: (selection: string, explanation: string) => void;
}

export function ExplainPopover({
  gapId,
  lessonId,
  selection,
  context,
  onClose,
  onPinned,
}: ExplainPopoverProps) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [explanation, setExplanation] = useState('');
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    void fetch('/api/gaps/explain', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-owner-id': ownerFromCookie(document.cookie),
      },
      body: JSON.stringify({ gapId, lessonId, selection, context }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ExplainResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setExplanation(data.explanation.explanation);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [gapId, lessonId, selection, context]);

  const pin = useCallback(async () => {
    setPinned(true);
    try {
      await fetch('/api/gaps/explain', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-owner-id': ownerFromCookie(document.cookie),
        },
        body: JSON.stringify({ gapId, lessonId, selection, explanation }),
      });
      onPinned(selection, explanation);
    } catch {
      setPinned(false);
    }
  }, [gapId, lessonId, selection, explanation, onPinned]);

  return (
    <div className="explain-popover" role="dialog" aria-label="Explain selection">
      <p className="explain-popover__selection">“{selection}”</p>
      {state === 'loading' && <p className="muted">Explaining…</p>}
      {state === 'error' && (
        <p className="explain-popover__error">Could not explain this selection. Try again.</p>
      )}
      {state === 'ready' && (
        <>
          <p className="explain-popover__body">{explanation}</p>
          <div className="explain-popover__actions">
            {pinned ? (
              <span className="explain-popover__pinned">✓ Added to notebook</span>
            ) : (
              <button type="button" className="btn" onClick={pin}>
                Add to notebook
              </button>
            )}
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface ExplainLayerProps {
  readonly gapId: string;
  readonly lessonId: string;
  readonly context: string;
  readonly children: React.ReactNode;
}

export function ExplainLayer({ gapId, lessonId, context, children }: ExplainLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const handleMouseUp = useCallback(() => {
    // Let the browser settle the selection before reading it.
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 2 || text.length > 2000) {
        setSelection(null);
        setPos(null);
        return;
      }
      // Only react to selections inside the notebook container.
      const node = sel?.anchorNode;
      const inside = containerRef.current?.contains(node instanceof Node ? node : null);
      if (!inside) return;
      const rect = sel?.getRangeAt(0).getBoundingClientRect();
      setSelection(text);
      setPos(rect ? { x: rect.left + rect.width / 2, y: rect.top - 8 } : null);
    }, 10);
  }, []);

  return (
    <div
      ref={containerRef}
      className="explain-layer"
      onMouseUp={handleMouseUp}
      onKeyUp={handleMouseUp}
    >
      {children}
      {selection && pos && (
        <div className="explain-popover__anchor" style={{ left: pos.x, top: pos.y }}>
          <ExplainPopover
            gapId={gapId}
            lessonId={lessonId}
            selection={selection}
            context={context}
            onClose={() => {
              setSelection(null);
              setPos(null);
              window.getSelection()?.removeAllRanges();
            }}
            onPinned={() => {
              // The annotation is persisted server-side; closing the popover is all
              // the client needs to do — the page shows it on next load.
              setSelection(null);
              setPos(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
