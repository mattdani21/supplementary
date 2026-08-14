'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioFallback } from './audio-fallback';
import {
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_SPEED_STORAGE_KEY,
  PLAYBACK_SPEEDS,
  alignTranscriptSegments,
  cyclePlaybackSpeed,
  formatDuration,
  segmentIndexAtTime,
  startOfSegment,
  totalDurationSeconds,
  type PlaybackSpeed,
} from '../lib/audio';

export interface AudioSegmentView {
  readonly artefactId: string;
  readonly durationSeconds?: number;
}

export interface AudioPlayerViewProps {
  /** The lesson's audio segments in playback order (segmentOrdinal ascending). */
  readonly segments: readonly AudioSegmentView[];
  /** The lesson transcript, aligned to the segments for scroll-sync + tap-to-seek. */
  readonly transcript?: string;
  /** True when the audio could not be loaded (401/missing) — the designed fallback shows. */
  readonly failed: boolean;
  readonly rate: PlaybackSpeed;
  readonly playing: boolean;
  /** Whole-lesson playback position in seconds. */
  readonly currentTime: number;
  readonly onTogglePlay: () => void;
  readonly onCycleSpeed: () => void;
  readonly onSeek: (timeSeconds: number) => void;
}

/**
 * The presentational player surface (GAP-038, E23 quality spec §8): play/pause, segment skip,
 * the 0.75/1/1.25/1.5/2 speed cycle, a seek bar over the whole lesson, and the transcript as
 * scroll-synced tap-to-seek blocks. Pure markup + scroll behaviour; the media controller in
 * `AudioPlayer` owns the <audio> element, the fetch and localStorage.
 */
export function AudioPlayerView({
  segments,
  transcript,
  failed,
  rate,
  playing,
  currentTime,
  onTogglePlay,
  onCycleSpeed,
  onSeek,
}: AudioPlayerViewProps) {
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  const total = totalDurationSeconds(segments);
  const aligned = alignTranscriptSegments(transcript ?? '', segments);
  const activeIndex = segmentIndexAtTime(segments, currentTime);

  useEffect(() => {
    try {
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      // Match-media unavailable (SSR / odd embedders): keep the default.
    }
  }, []);

  // Scroll-sync: while playing, keep the active transcript block in view (E23 quality spec §8).
  useEffect(() => {
    if (!playing) return;
    segmentRefs.current[activeIndex]?.scrollIntoView({
      block: 'center',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [activeIndex, playing, reducedMotion]);

  const prevStart = activeIndex > 0 ? startOfSegment(segments, activeIndex - 1) : null;
  const nextStart =
    activeIndex < segments.length - 1 ? startOfSegment(segments, activeIndex + 1) : null;

  return (
    <div className="audio-player">
      {failed ? (
        <AudioFallback />
      ) : (
        segments.length > 0 && (
          <div className="player-chrome">
            <div className="player-chrome__row">
              <button
                type="button"
                className="player-btn"
                onClick={() => {
                  if (prevStart !== null) onSeek(prevStart);
                }}
                disabled={prevStart === null}
                aria-label="Previous segment"
              >
                ‹
              </button>
              <button
                type="button"
                className="player-btn player-btn--play"
                onClick={onTogglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <button
                type="button"
                className="player-btn"
                onClick={() => {
                  if (nextStart !== null) onSeek(nextStart);
                }}
                disabled={nextStart === null}
                aria-label="Next segment"
              >
                ›
              </button>
              <span className="player-time">
                {formatDuration(currentTime) ?? '0:00'} / {formatDuration(total) ?? '0:00'}
              </span>
              <button
                type="button"
                className="player-speed"
                onClick={onCycleSpeed}
                aria-label={`Playback speed, currently ${rate}×`}
                data-rate={rate}
              >
                {rate}×
              </button>
            </div>
            <input
              type="range"
              className="player-seek"
              min={0}
              max={Math.max(total, 0)}
              step={1}
              value={Math.min(currentTime, Math.max(total, 0))}
              onChange={(event) => onSeek(Number(event.target.value))}
              aria-label="Seek"
            />
          </div>
        )
      )}

      <div className="transcript" aria-label="Transcript">
        <h3 className="transcript__heading">Transcript</h3>
        {!transcript || !transcript.trim() ? (
          <p className="muted">Transcript unavailable for this lesson.</p>
        ) : segments.length === 0 ? (
          <p>{transcript}</p>
        ) : (
          aligned.map((segment) =>
            segment.text.trim() ? (
              <button
                key={segment.index}
                type="button"
                ref={(element) => {
                  segmentRefs.current[segment.index - 1] = element;
                }}
                className={
                  segment.index - 1 === activeIndex
                    ? 'transcript__segment transcript__segment--active'
                    : 'transcript__segment'
                }
                data-seek-to={segment.start}
                onClick={() => onSeek(segment.start)}
                aria-current={segment.index - 1 === activeIndex ? 'true' : undefined}
              >
                {segment.text}
              </button>
            ) : null,
          )
        )}
      </div>
    </div>
  );
}

interface AudioPlayerProps {
  readonly gapId: string;
  /** The lesson's audio artefacts in playback order (segmentOrdinal ascending). */
  readonly segments: readonly AudioSegmentView[];
  /** The lesson transcript, aligned to the segments for scroll-sync + tap-to-seek. */
  readonly transcript?: string;
}

/** Reads the learner cookie client-side (the audio endpoint scopes by X-Owner-Id). */
const readOwnerId = (): string | undefined => {
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith('gapos_owner='))
    ?.split('=')[1];
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * The media controller: resolves every segment's signed URL, drives a single <audio> element
 * across segments (auto-advance, seek, speed) and persists the speed per session in
 * localStorage. On any audio failure (401/missing) it flips to the designed fallback — the raw
 * error string never reaches the surface (E23 quality spec §8).
 */
export function AudioPlayer({ gapId, segments, transcript }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState<PlaybackSpeed>(DEFAULT_PLAYBACK_SPEED);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [urls, setUrls] = useState<readonly (string | undefined)[]>(() =>
    segments.map(() => undefined),
  );
  const pendingSeek = useRef<number | null>(null);
  const autoPlay = useRef(false);

  // Restore the per-session speed preference, then keep it in sync.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY);
      const parsed = Number(stored);
      if ((PLAYBACK_SPEEDS as readonly number[]).includes(parsed)) {
        setRate(parsed as PlaybackSpeed);
      }
    } catch {
      // Storage unavailable (private mode): fall back to the default speed.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(rate));
    } catch {
      // Non-fatal: the chosen speed still applies for this session.
    }
  }, [rate]);

  // Resolve every segment's signed URL up front so segment skips never stall. Any failure —
  // 401, missing artefact, empty payload — falls the whole player back to the designed surface.
  useEffect(() => {
    let cancelled = false;
    const owner = readOwnerId();
    void Promise.all(
      segments.map(async (segment) => {
        const response = await fetch(`/api/gaps/${gapId}/artefacts/${segment.artefactId}/audio`, {
          headers: owner ? { 'x-owner-id': owner } : {},
        });
        if (!response.ok) throw new Error(`audio unavailable (${response.status})`);
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.startsWith('audio')) {
          // No-S3 deployments stream the bytes through the API.
          const blob = await response.blob();
          return URL.createObjectURL(blob);
        }
        const body = (await response.json()) as { url: string };
        if (!body.url) throw new Error('audio artefact missing');
        return body.url;
      }),
    )
      .then((resolved) => {
        if (!cancelled) setUrls(resolved);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gapId, segments]);

  // Apply the current segment's source and keep the rate on the element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
    const url = urls[segmentIndex];
    if (!url) return;
    if (audio.getAttribute('src') !== url) {
      audio.src = url;
    }
  }, [rate, segmentIndex, urls]);

  // A seek that lands in another segment is applied once its metadata is ready.
  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (pendingSeek.current !== null) {
      audio.currentTime = Math.min(Math.max(pendingSeek.current, 0), audio.duration || 0);
      pendingSeek.current = null;
    }
    if (autoPlay.current) {
      autoPlay.current = false;
      void audio.play().catch(() => undefined);
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(startOfSegment(segments, segmentIndex) + audio.currentTime);
  };

  const handleEnded = () => {
    if (segmentIndex < segments.length - 1) {
      pendingSeek.current = 0;
      autoPlay.current = true;
      setSegmentIndex((index) => index + 1);
    } else {
      setPlaying(false);
      setCurrentTime(totalDurationSeconds(segments));
    }
  };

  const handleSeek = (timeSeconds: number) => {
    const audio = audioRef.current;
    const clamped = Math.min(Math.max(timeSeconds, 0), totalDurationSeconds(segments));
    const index = segmentIndexAtTime(segments, clamped);
    const withinSegment = Math.max(0, clamped - startOfSegment(segments, index));
    if (index !== segmentIndex) {
      pendingSeek.current = withinSegment;
      autoPlay.current = playing;
      setSegmentIndex(index);
    } else if (audio && audio.getAttribute('src')) {
      audio.currentTime = withinSegment;
    } else if (audio) {
      // Source not loaded yet: apply the seek once metadata arrives.
      pendingSeek.current = withinSegment;
    }
    setCurrentTime(clamped);
  };

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !urls[segmentIndex]) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play().catch(() => undefined);
    }
  };

  const handleCycleSpeed = () => setRate(cyclePlaybackSpeed(rate));

  return (
    <>
      <audio
        ref={audioRef}
        preload="auto"
        className="audio-player__element"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      <AudioPlayerView
        segments={segments}
        transcript={transcript}
        failed={failed}
        rate={rate}
        playing={playing}
        currentTime={currentTime}
        onTogglePlay={handleTogglePlay}
        onCycleSpeed={handleCycleSpeed}
        onSeek={handleSeek}
      />
    </>
  );
}
