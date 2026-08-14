'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioFallback } from './audio-fallback';

/** Plays an artefact's audio through the signed-URL endpoint. */
export function AudioPlayer({ gapId, artefactId }: { gapId: string; artefactId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);

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
        if (!audioRef.current) return;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.startsWith('audio')) {
          // No-S3 deployments stream the bytes through the API.
          const blob = await response.blob();
          if (!cancelled) audioRef.current.src = URL.createObjectURL(blob);
        } else {
          const body = (await response.json()) as { url: string };
          if (!cancelled) audioRef.current.src = body.url;
        }
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
    };
  }, [gapId, artefactId]);

  // A designed fallback: the raw error string is never the user-facing surface — the study
  // page renders the transcript below the player instead (E23 quality spec §8).
  if (failed) return <AudioFallback />;
  return <audio ref={audioRef} controls preload="metadata" style={{ width: '100%' }} />;
}
