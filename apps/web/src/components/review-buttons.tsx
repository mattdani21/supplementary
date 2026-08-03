'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';

/** Approve or reject a flagged lesson with an optional note (E19). */
export function ReviewButtons({ lessonId }: { lessonId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    setError(null);
    try {
      await apiFetch(`/api/review/${lessonId}`, {
        method: 'POST',
        body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="review">
      <input
        placeholder="Note (shown to the learner)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <span className="actions">
        <button onClick={() => void decide('approve')} disabled={busy !== null}>
          {busy === 'approve' ? '…' : '✓ Approve'}
        </button>
        <button onClick={() => void decide('reject')} disabled={busy !== null}>
          {busy === 'reject' ? '…' : '✗ Reject'}
        </button>
      </span>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
