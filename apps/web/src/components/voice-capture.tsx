'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from './api';

/**
 * Voice gap capture (E16): record with the microphone, transcribe through the voice endpoint,
 * and confirm an editable draft before creating the gap.
 */
export function VoiceCapture() {
  const router = useRouter();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ transcript: string; suggestedTitle: string } | null>(null);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        void transcribe(new Blob(chunksRef.current, { type: recorder.mimeType }));
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (cause) {
      setUnsupported(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const transcribe = async (blob: Blob) => {
    setBusy(true);
    try {
      const result = (await apiFetch('/api/gaps/voice', {
        method: 'POST',
        body: blob,
      })) as { transcript: string; suggestedTitle: string };
      setDraft(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
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

  if (draft) {
    return (
      <form onSubmit={create} className="card">
        <h2>Confirm your spoken gap</h2>
        <label>
          Title
          <input name="title" required defaultValue={draft.suggestedTitle} />
        </label>
        <label>
          Statement
          <textarea name="rawStatement" required rows={3} defaultValue={draft.transcript} />
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

  return (
    <div className="card">
      <h2>Speak a gap</h2>
      {recording ? (
        <button onClick={stop} className="recording">
          ⏺ Stop recording
        </button>
      ) : (
        <button onClick={() => void start()} disabled={busy || unsupported !== null}>
          {busy ? 'Transcribing…' : '🎤 Record'}
        </button>
      )}
      {unsupported && <p className="error">Microphone unavailable: {unsupported}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
