'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioFallback } from './audio-fallback';
import { Checkpoint } from './checkpoint';
import { gradeCheckpoint, pendingCheckpoint, type CheckpointPrompt } from '../lib/checkpoint';
import { ownerFromCookie } from '../lib/owner';
import type { FeedbackLocator } from './practice-feedback';
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
  /** The due checkpoint: playback pauses here until the learner responds (E24 US1). */
  readonly checkpoint?: {
    readonly prompt: string;
    readonly expectedAnswer: string;
    readonly answerLabel?: string;
    readonly locators?: readonly FeedbackLocator[];
    readonly sourcesTabHref: string;
    readonly result: { correct: boolean } | null;
    readonly onAnswer: (response: string) => void;
    readonly onComplete: () => void;
  };
  /** Practice items: surfaced as a sheet from the dock instead of below the notebook (GAP-091). */
  readonly questions?: {
    readonly count: number;
    readonly children: React.ReactNode;
  };
}

/**
 * The floating player dock (GAP-091). The lesson notebook is always on screen; the dock
 * floats above the tab bar with the transport (play/pause, segment skip, speed cycle,
 * whole-lesson seek) and two sheet triggers: Transcript (scroll-synced tap-to-seek
 * blocks) and Questions (the practice forms, lifted out of the page flow so the learner
 * never scrolls away from the lesson). A due checkpoint auto-opens its own sheet and
 * holds playback until answered. Pure markup + scroll behaviour; the media controller in
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
  checkpoint,
  questions,
}: AudioPlayerViewProps) {
  const segmentRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);

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

  // Scroll-sync: while playing with the transcript open, keep the active block in view
  // (E23 quality spec §8). Closed sheets never scroll (the blocks are display:none).
  useEffect(() => {
    if (!playing || !transcriptOpen) return;
    segmentRefs.current[activeIndex]?.scrollIntoView({
      block: 'center',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [activeIndex, playing, transcriptOpen, reducedMotion]);

  const prevStart = activeIndex > 0 ? startOfSegment(segments, activeIndex - 1) : null;
  const nextStart =
    activeIndex < segments.length - 1 ? startOfSegment(segments, activeIndex + 1) : null;

  const closeSheets = () => {
    setTranscriptOpen(false);
    setQuestionsOpen(false);
  };

  const transcriptBody =
    !transcript || !transcript.trim() ? (
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
    );

  return (
    <div className="audio-player">
      {failed ? (
        <>
          <AudioFallback />
          <div className="transcript" aria-label="Transcript">
            {transcriptBody}
          </div>
        </>
      ) : (
        segments.length > 0 && (
          <div className="study-dock" aria-label="Lesson audio">
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
            <div className="study-dock__row">
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
                disabled={checkpoint !== undefined}
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
            <div className="study-dock__actions">
              <button
                type="button"
                className="dock-btn"
                aria-expanded={transcriptOpen}
                onClick={() => setTranscriptOpen((open) => !open)}
              >
                Transcript
              </button>
              {questions && (
                <button
                  type="button"
                  className="dock-btn"
                  aria-expanded={questionsOpen}
                  onClick={() => setQuestionsOpen((open) => !open)}
                >
                  Questions{questions.count > 0 ? ` (${questions.count})` : ''}
                </button>
              )}
            </div>
          </div>
        )
      )}

      {(transcriptOpen || questionsOpen) && (
        <div className="dock-backdrop" onClick={closeSheets} aria-hidden="true" />
      )}

      {!failed && segments.length > 0 && (
        <div
          className={`dock-sheet${transcriptOpen ? ' is-open' : ''}`}
          hidden={!transcriptOpen}
          role="region"
          aria-label="Transcript"
        >
          <div className="dock-sheet__head">
            <h3 className="dock-sheet__title">Transcript</h3>
            <button type="button" className="dock-sheet__close" onClick={closeSheets}>
              Close
            </button>
          </div>
          <div className="dock-sheet__body">
            <div className="transcript">{transcriptBody}</div>
          </div>
        </div>
      )}

      {!failed && questions && (
        <div
          className={`dock-sheet${questionsOpen ? ' is-open' : ''}`}
          hidden={!questionsOpen}
          role="region"
          aria-label="Questions"
        >
          <div className="dock-sheet__head">
            <h3 className="dock-sheet__title">Questions</h3>
            <button type="button" className="dock-sheet__close" onClick={closeSheets}>
              Close
            </button>
          </div>
          <div className="dock-sheet__body">{questions.children}</div>
        </div>
      )}

      {checkpoint && (
        <div
          className="dock-sheet dock-sheet--checkpoint is-open"
          role="region"
          aria-label="Checkpoint"
        >
          <Checkpoint
            prompt={checkpoint.prompt}
            expectedAnswer={checkpoint.expectedAnswer}
            answerLabel={checkpoint.answerLabel}
            locators={checkpoint.locators}
            sourcesTabHref={checkpoint.sourcesTabHref}
            result={checkpoint.result}
            onAnswer={checkpoint.onAnswer}
            onComplete={checkpoint.onComplete}
          />
        </div>
      )}
    </div>
  );
}

interface AudioPlayerProps {
  readonly gapId: string;
  /** The lesson's audio artefacts in playback order (segmentOrdinal ascending). */
  readonly segments: readonly AudioSegmentView[];
  /** The lesson transcript, aligned to the segments for scroll-sync + tap-to-seek. */
  readonly transcript?: string;
  /** Checkpoint questions embedded in the audio: playback pauses until answered (E24 US1). */
  readonly pausePrompts?: readonly CheckpointPrompt[];
  /** Source locators behind the checkpoint answers, shown in the correction surface. */
  readonly checkpointLocators?: readonly FeedbackLocator[];
  /** Practice items surfaced from the dock's Questions sheet (GAP-091). */
  readonly questions?: {
    readonly count: number;
    readonly children: React.ReactNode;
  };
}

/** Reads the learner cookie client-side (the audio endpoint scopes by X-Owner-Id). */
const readOwnerId = (): string => ownerFromCookie(document.cookie);

/**
 * The media controller: resolves every segment's signed URL, drives a single <audio> element
 * across segments (auto-advance, seek, speed) and persists the speed per session in
 * localStorage. On any audio failure (401/missing) it flips to the designed fallback — the raw
 * error string never reaches the surface (E23 quality spec §8).
 */
export function AudioPlayer({
  gapId,
  segments,
  transcript,
  pausePrompts = [],
  checkpointLocators = [],
  questions,
}: AudioPlayerProps) {
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
  // Checkpoint state (E24 US1): how many prompts have been answered, and the result of the due
  // one. `due` is derived from the playback position, so seeking past a prompt makes it due.
  const [answeredCount, setAnsweredCount] = useState(0);
  const [checkpointResult, setCheckpointResult] = useState<{ correct: boolean } | null>(null);
  const due = pendingCheckpoint(pausePrompts, currentTime, answeredCount);

  // Pause at the checkpoint: the moment a prompt's position is reached while playing, stop the
  // audio and require a response before the lesson continues (FR-004, US1 AS3).
  useEffect(() => {
    if (!due || !playing) return;
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    setPlaying(false);
  }, [due, playing]);

  const handleCheckpointAnswer = (response: string) => {
    if (!due) return;
    setCheckpointResult({ correct: gradeCheckpoint(response, due.expectedAnswer) });
  };

  const handleCheckpointComplete = () => {
    setCheckpointResult(null);
    setAnsweredCount((count) => count + 1);
    // Resume from exactly where the checkpoint stopped the lesson.
    const audio = audioRef.current;
    if (audio && urls[segmentIndex]) void audio.play().catch(() => undefined);
  };

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
        questions={questions}
        checkpoint={
          due
            ? {
                prompt: due.prompt,
                expectedAnswer: due.expectedAnswer,
                locators: checkpointLocators,
                sourcesTabHref: `/gaps/${gapId}?tab=sources`,
                result: checkpointResult,
                onAnswer: handleCheckpointAnswer,
                onComplete: handleCheckpointComplete,
              }
            : undefined
        }
      />
    </>
  );
}
