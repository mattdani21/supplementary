/**
 * Audio segmentation.
 *
 * A lesson script is synthesised as several segments rather than one file, for three reasons:
 * segments synthesise in parallel (the audio budget is 180 seconds for a whole course), a failed
 * segment can be retried without redoing the lesson, and a pause prompt needs a boundary to sit
 * on.
 *
 * Segment ids are derived from the content, so re-running synthesis for an unchanged script
 * produces the same ids and the idempotency check finds the existing audio instead of paying for
 * it twice.
 */

import { createHash } from 'node:crypto';

export interface AudioSegment {
  readonly id: string;
  readonly ordinal: number;
  readonly text: string;
  readonly estimatedSeconds: number;
}

/** Matches the fake TTS and is close enough to real narration for budgeting. */
export const SPEAKING_CHARACTERS_PER_SECOND = 14;

export interface SegmentationOptions {
  /** Target segment length. Long enough for natural prosody, short enough to parallelise. */
  readonly targetCharacters?: number;
  /** Seconds at which a pause prompt interrupts; segments are cut so a prompt lands on a break. */
  readonly pauseAtSeconds?: readonly number[];
}

const SENTENCE = /[^.!?]+[.!?]+\s*|[^.!?]+$/g;

export const segmentScript = (
  script: string,
  options: SegmentationOptions = {},
): AudioSegment[] => {
  const target = options.targetCharacters ?? 600;
  const pauses = [...(options.pauseAtSeconds ?? [])].sort((a, b) => a - b);
  const sentences =
    script
      .match(SENTENCE)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? [];

  const segments: AudioSegment[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;
  let elapsedSeconds = 0;
  let nextPause = pauses.shift();

  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join(' ');
    segments.push({
      id: `seg_${segments.length}_${createHash('sha256').update(text).digest('hex').slice(0, 12)}`,
      ordinal: segments.length,
      text,
      estimatedSeconds: Math.max(1, Math.round(text.length / SPEAKING_CHARACTERS_PER_SECOND)),
    });
    buffer = [];
    bufferLength = 0;
  };

  for (const sentence of sentences) {
    buffer.push(sentence);
    bufferLength += sentence.length + 1;
    elapsedSeconds += sentence.length / SPEAKING_CHARACTERS_PER_SECOND;

    // Cut at a pause point so the prompt interrupts between sentences, never mid-clause.
    if (nextPause !== undefined && elapsedSeconds >= nextPause) {
      flush();
      nextPause = pauses.shift();
      continue;
    }

    if (bufferLength >= target) flush();
  }
  flush();

  return segments;
};

/**
 * The integrity check run before an audio artefact is published: the audio must correspond to
 * the transcript that will be shown alongside it, and its duration must be plausible for the
 * text. A mismatch means a stale segment was picked up, which is exactly the bug that would
 * otherwise ship silently.
 */
export interface SegmentResult {
  readonly segmentId: string;
  readonly checksum: string;
  readonly durationSeconds: number;
}

export type AudioIntegrityFailure =
  | { code: 'missing_segment'; segmentId: string }
  | { code: 'checksum_mismatch'; segmentId: string; expected: string; actual: string }
  | { code: 'implausible_duration'; segmentId: string; expected: number; actual: number };

export const DURATION_TOLERANCE = 0.5;

export const checkAudioIntegrity = (
  segments: readonly AudioSegment[],
  results: readonly SegmentResult[],
  checksumOf: (text: string) => string,
): AudioIntegrityFailure[] => {
  const byId = new Map(results.map((r) => [r.segmentId, r]));
  const failures: AudioIntegrityFailure[] = [];

  for (const segment of segments) {
    const result = byId.get(segment.id);
    if (!result) {
      failures.push({ code: 'missing_segment', segmentId: segment.id });
      continue;
    }

    const expected = checksumOf(segment.text);
    if (result.checksum !== expected) {
      failures.push({
        code: 'checksum_mismatch',
        segmentId: segment.id,
        expected,
        actual: result.checksum,
      });
    }

    const drift = Math.abs(result.durationSeconds - segment.estimatedSeconds);
    if (drift > segment.estimatedSeconds * DURATION_TOLERANCE + 1) {
      failures.push({
        code: 'implausible_duration',
        segmentId: segment.id,
        expected: segment.estimatedSeconds,
        actual: result.durationSeconds,
      });
    }
  }

  return failures;
};
