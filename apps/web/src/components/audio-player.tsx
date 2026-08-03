'use client';

import { useEffect, useRef, useState } from 'react';

/** Plays an artefact's audio through the signed-URL endpoint. */
export function AudioPlayer({ gapId, artefactId }: { gapId: string; artefactId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const owner = document.cookie
      .split('; ')
      .find((part) => part.startsWith('gapos_owner='))
      ?.split('=')[1];

    fetch(`/api/gaps/${gapId}/artefacts/${artefactId}/audio`, {
      headers: owner ? { 'x-owner-id': decodeURIComponent(owner) } : {},
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Audio unavailable (${response.status})`);
        const body = (await response.json()) as { url: string };
        if (!cancelled && audioRef.current) audioRef.current.src = body.url;
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));

    return () => {
      cancelled = true;
    };
  }, [gapId, artefactId]);

  if (error) return <span className="error">{error}</span>;
  return <audio ref={audioRef} controls preload="metadata" style={{ width: '100%' }} />;
}
