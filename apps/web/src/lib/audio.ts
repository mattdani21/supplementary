/**
 * Audio player pure logic (GAP-038, E23 quality spec §8).
 *
 * Everything here is deterministic and DOM-free so the player's behaviour — speed cycle, seek
 * resolution, transcript alignment, duration formatting — is unit-tested directly. The client
 * component in components/audio-player.tsx is a thin controller over these rules.
 */

/** The playback-speed cycle (E23 quality spec §8: 0.75/1/1.25/1.5/2). */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1;

/** localStorage key for the per-session speed preference. */
export const PLAYBACK_SPEED_STORAGE_KEY = 'gapos.playback-speed';

/** The next speed in the cycle; wraps from 2 back to 0.75. */
export const cyclePlaybackSpeed = (current: PlaybackSpeed): PlaybackSpeed => {
  const index = PLAYBACK_SPEEDS.indexOf(current);
  return PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length] ?? DEFAULT_PLAYBACK_SPEED;
};

/** "3:24" for 204 seconds; "1:01:01" past an hour; null when the duration is unknown. */
export const formatDuration = (totalSeconds?: number): string | null => {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return null;
  }
  const total = Math.round(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
};

/** Sum of the segment durations — the whole lesson's audio length. */
export const totalDurationSeconds = (segments: readonly { durationSeconds?: number }[]): number =>
  segments.reduce((sum, segment) => sum + (segment.durationSeconds ?? 0), 0);

/** Start time of a segment within the whole lesson, in seconds. */
export const startOfSegment = (
  segments: readonly { durationSeconds?: number }[],
  index: number,
): number => totalDurationSeconds(segments.slice(0, index));

/** Which segment is playing at a whole-lesson time; clamped to the last segment. */
export const segmentIndexAtTime = (
  segments: readonly { durationSeconds?: number }[],
  timeSeconds: number,
): number => {
  let elapsed = 0;
  for (let i = 0; i < segments.length; i += 1) {
    elapsed += segments[i]?.durationSeconds ?? 0;
    if (timeSeconds < elapsed) return i;
  }
  return Math.max(0, segments.length - 1);
};

/** One readable transcript block, aligned to one audio segment. */
export interface TranscriptSegment {
  /** 1-based label, so the Nth audio segment owns the Nth block. */
  readonly index: number;
  readonly text: string;
  /** Whole-lesson start time (seconds) — the tap-to-seek offset. */
  readonly start: number;
  /** Whole-lesson end time (seconds), exclusive. */
  readonly end: number;
}

const SENTENCE = /[^.!?]+[.!?]+\s*|[^.!?]+$/g;

/**
 * Split the lesson transcript into one block per audio segment, sized by each segment's share of
 * the total duration and cut on sentence boundaries so every block reads naturally. When there
 * are no segments (text-only lesson), the whole transcript is one block.
 */
export const alignTranscriptSegments = (
  transcript: string,
  segments: readonly { durationSeconds?: number }[],
): TranscriptSegment[] => {
  const total = totalDurationSeconds(segments);
  const sentences =
    transcript
      .match(SENTENCE)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? [];

  if (segments.length === 0) {
    return transcript.trim() ? [{ index: 1, text: transcript, start: 0, end: total }] : [];
  }
  if (sentences.length === 0) {
    return segments.map((_, i) => ({
      index: i + 1,
      text: '',
      start: startOfSegment(segments, i),
      end: startOfSegment(segments, i) + (segments[i]?.durationSeconds ?? 0),
    }));
  }

  const aligned: TranscriptSegment[] = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const start = startOfSegment(segments, i);
    const duration = segments[i]?.durationSeconds ?? 0;
    const isLast = i === segments.length - 1;

    let count = 0;
    if (isLast) {
      // The final block takes whatever sentences remain — nothing is ever dropped.
      count = sentences.length - cursor;
    } else {
      const target = total > 0 ? Math.round((transcript.length * duration) / total) : 0;
      let length = 0;
      // Take sentences greedily up to the target, but always leave at least one sentence for
      // every remaining segment so no later block ends up empty while sentences exist.
      const keepForRest = segments.length - i - 1;
      while (
        cursor + count < sentences.length &&
        length < target &&
        sentences.length - (cursor + count) > keepForRest
      ) {
        length += (sentences[cursor + count]?.length ?? 0) + (count > 0 ? 1 : 0);
        count += 1;
      }
      if (count === 0 && cursor < sentences.length) count = 1;
    }

    aligned.push({
      index: i + 1,
      text: sentences.slice(cursor, cursor + count).join(' '),
      start,
      end: start + duration,
    });
    cursor += count;
  }

  return aligned;
};
