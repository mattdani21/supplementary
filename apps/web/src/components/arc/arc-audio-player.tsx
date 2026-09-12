'use client';

/**
 * The Arc audio player (GAP-032): drives REAL playback of the compiled lesson's TTS artefact —
 * play/pause, ±15s skip, 1×/1.25×/1.5× rate, a waveform that tracks played time, and a
 * transcript drawer. No fake timer: every control acts on the <audio> element.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusMessage } from '@gapos/ui';
import { arcFetch } from './arc-client';

const RATES = [1, 1.25, 1.5] as const;
const WAVE_BARS = 28;

const formatTime = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export function ArcAudioPlayer({
  gapId,
  artefactId,
  title,
  durationSeconds,
  transcript,
}: {
  gapId: string;
  artefactId: string;
  title: string;
  durationSeconds: number;
  transcript: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [rate, setRate] = useState<1 | 1.25 | 1.5>(1);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    arcFetch(`/api/gaps/${gapId}/artefacts/${artefactId}/audio`)
      .then((body) => {
        if (cancelled) return;
        const { url, bytes, mediaType } = body as {
          url?: string;
          bytes?: number[];
          mediaType?: string;
        };
        if (url) {
          setSource(url);
        } else if (bytes && mediaType?.startsWith('audio')) {
          // No-S3 deployments stream the bytes through the API (the signed-URL endpoint
          // returns them as a JSON array when the store is in-memory).
          const blob = new Blob([Uint8Array.from(bytes)], { type: mediaType });
          setSource(URL.createObjectURL(blob));
        } else {
          setError('Audio is not available for this lesson.');
        }
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [gapId, artefactId]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setError('Playback was blocked.'));
    else audio.pause();
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
  }, []);

  const changeRate = useCallback((next: (typeof RATES)[number]) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = next;
    setRate(next);
  }, []);

  const playedBars =
    durationSeconds > 0 ? Math.round((currentTime / durationSeconds) * WAVE_BARS) : 0;

  const paragraphs = transcript
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const currentParagraph = Math.min(
    paragraphs.length - 1,
    Math.floor((currentTime / Math.max(1, durationSeconds)) * paragraphs.length),
  );

  if (error) {
    return (
      <StatusMessage tone="warning" title="Audio is unavailable.">
        <p>{error}</p>
        <p>
          The complete transcript remains available below. Uncached signed audio needs a network
          connection.
        </p>
        <details className="arc-transcript-copy">
          <summary>Read transcript</summary>
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </details>
      </StatusMessage>
    );
  }

  return (
    <div className="arc-audio-card">
      <audio
        ref={audioRef}
        src={source ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
        onError={() =>
          setError(
            navigator.onLine
              ? 'The audio file could not be loaded.'
              : 'Arc is offline, so this audio file cannot be loaded.',
          )
        }
        onLoadedMetadata={(event) => {
          event.currentTarget.playbackRate = rate;
          if (durationSeconds === 0) setCurrentTime(0);
        }}
      />
      <div className="arc-audio-head">
        <div>
          <strong>{title}</strong>
          <span>{Math.max(1, Math.round(durationSeconds / 60))} min · Arc audio</span>
        </div>
        <button
          className="arc-play"
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause theory audio' : 'Play theory audio'}
        >
          {playing ? 'Ⅱ' : '▶'}
        </button>
      </div>
      <div className="arc-wave" aria-hidden="true">
        {Array.from({ length: WAVE_BARS }, (_, index) => (
          <span
            key={index}
            className={index < playedBars ? 'is-played' : ''}
            style={{ ['--bar' as string]: 7 + ((index * 19) % 20) }}
          />
        ))}
      </div>
      <div className="arc-time-row">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(durationSeconds)}</span>
      </div>
      <div className="arc-audio-extra">
        <button
          className="arc-audio-skip"
          type="button"
          onClick={() => skip(-15)}
          aria-label="Skip back 15 seconds"
        >
          ↶ 15
        </button>
        <div className="arc-rate-group" aria-label="Playback speed">
          {RATES.map((candidate) => (
            <button
              key={candidate}
              className={`arc-audio-rate${rate === candidate ? ' is-active' : ''}`}
              type="button"
              onClick={() => changeRate(candidate)}
              aria-pressed={rate === candidate}
            >
              {candidate}×
            </button>
          ))}
        </div>
        <button
          className="arc-audio-skip"
          type="button"
          onClick={() => skip(15)}
          aria-label="Skip forward 15 seconds"
        >
          15 ↷
        </button>
      </div>
      {paragraphs.length > 0 && (
        <div className="arc-transcript">
          <button
            className="arc-transcript-toggle"
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            aria-expanded={transcriptOpen}
          >
            <span>Transcript</span>
            <span aria-hidden="true">{transcriptOpen ? '⌃' : '⌄'}</span>
          </button>
          {transcriptOpen && (
            <div className="arc-transcript-copy">
              {paragraphs.map((paragraph, index) => (
                <p key={index} className={index === currentParagraph ? 'is-current' : ''}>
                  {paragraph}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
