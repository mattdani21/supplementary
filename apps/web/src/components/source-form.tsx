'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';

export function SourceForm({ gapId }: { gapId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const filename = String(form.get('filename') || 'note.txt');
    try {
      const result = (await apiFetch(`/api/gaps/${gapId}/sources`, {
        method: 'POST',
        body: JSON.stringify({
          filename,
          mediaType: filename.endsWith('.md')
            ? 'text/markdown'
            : filename.endsWith('.html')
              ? 'text/html'
              : 'text/plain',
          text: form.get('text'),
        }),
      })) as {
        registration: {
          accepted: boolean;
          code?: string;
          message?: string;
          deduplicated?: boolean;
        };
      };
      if (result.registration.accepted) {
        setMessage(
          result.registration.deduplicated ? 'Already uploaded — reused.' : 'Source added.',
        );
        (event.currentTarget.elements.namedItem('text') as HTMLTextAreaElement).value = '';
        router.refresh();
      } else {
        setError(result.registration.message ?? `Rejected (${result.registration.code}).`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card">
      <h2>Add a source</h2>
      <label>
        Filename
        <input name="filename" defaultValue="note.md" />
      </label>
      <label>
        Content
        <textarea
          name="text"
          required
          rows={6}
          placeholder="Paste notes, a chapter, a transcript…"
        />
      </label>
      {error && <p className="error">{error}</p>}
      {message && <p className="ok">{message}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add source'}
      </button>
    </form>
  );
}
