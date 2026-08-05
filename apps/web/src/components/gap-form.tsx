'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';

export function GapForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = (await apiFetch('/api/gaps', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          rawStatement: form.get('rawStatement'),
          dailyMinutes: Number(form.get('dailyMinutes')),
        }),
      })) as { gap: { id: string } };
      router.push(`/gaps/${result.gap.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card">
      <h2>New gap</h2>
      <label>
        Title
        <input name="title" required placeholder="e.g. Set theory for my AI course" />
      </label>
      <label>
        What do you want to be able to do?
        <textarea
          name="rawStatement"
          required
          rows={3}
          placeholder="I understand basic set notation but need equivalence relations and proof techniques by Friday. I have 35 minutes per day."
        />
      </label>
      <label>
        Minutes per day
        <input name="dailyMinutes" type="number" min={5} max={480} defaultValue={35} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create gap'}
      </button>
    </form>
  );
}
