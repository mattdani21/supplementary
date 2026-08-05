'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';

const LABELS: Record<string, string> = {
  define: 'Start',
  compile: 'Compile',
  retry_compilation: 'Retry compile',
  request_mastery_check: 'Request mastery check',
  archive: 'Archive',
};

export function TransitionButtons({
  gapId,
  available,
}: {
  gapId: string;
  available: readonly { type: string; label?: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = async (type: string) => {
    setBusy(type);
    setError(null);
    try {
      await apiFetch(`/api/gaps/${gapId}/transition`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="actions">
      {available.map(({ type, label }) => (
        <button key={type} onClick={() => void apply(type)} disabled={busy !== null}>
          {busy === type ? '…' : (label ?? LABELS[type] ?? type)}
        </button>
      ))}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
