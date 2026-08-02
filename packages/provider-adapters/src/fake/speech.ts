/**
 * Deterministic speech fakes.
 *
 * The synthesised "audio" is a stable byte string derived from the text, so a test can assert
 * that the published audio corresponds to the published transcript — which is the integrity check
 * the pipeline performs before publication — without shipping binary fixtures.
 */

import { createHash } from 'node:crypto';
import type {
  SpeechToText,
  SynthesisRequest,
  SynthesisResponse,
  TextToSpeech,
  TranscriptionRequest,
  TranscriptionResponse,
} from '../interfaces.js';

/** Average speaking rate used to estimate duration from character count. */
export const CHARACTERS_PER_SECOND = 14;

export const checksumFor = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);

export interface FakeTextToSpeechOptions {
  /** Segment ids that should fail, to exercise the text-only fallback. */
  readonly failingSegmentIds?: readonly string[];
  readonly costMillicentsPerThousandCharacters?: number;
}

export class FakeSynthesisFailure extends Error {
  constructor(segmentId: string) {
    super(`Simulated synthesis failure for segment ${segmentId}`);
    this.name = 'FakeSynthesisFailure';
  }
}

export const createFakeTextToSpeech = (
  options: FakeTextToSpeechOptions = {},
): TextToSpeech & { readonly calls: readonly SynthesisRequest[] } => {
  const calls: SynthesisRequest[] = [];
  const failing = new Set(options.failingSegmentIds ?? []);

  return {
    name: 'fake',
    calls,

    async synthesise(request: SynthesisRequest): Promise<SynthesisResponse> {
      calls.push(request);
      if (failing.has(request.segmentId)) throw new FakeSynthesisFailure(request.segmentId);

      const checksum = checksumFor(request.text);
      return {
        // Deterministic stand-in for encoded audio, derived from exactly the text spoken.
        audio: new TextEncoder().encode(`FAKE-AUDIO:${checksum}`),
        mediaType: 'audio/mpeg',
        durationSeconds: Math.max(1, Math.round(request.text.length / CHARACTERS_PER_SECOND)),
        checksum,
        characters: request.text.length,
        costMillicents: Math.ceil(
          (request.text.length / 1000) * (options.costMillicentsPerThousandCharacters ?? 300),
        ),
      };
    },
  };
};

export interface FakeSpeechToTextOptions {
  readonly transcript?: string;
}

export const createFakeSpeechToText = (options: FakeSpeechToTextOptions = {}): SpeechToText => ({
  name: 'fake',
  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
    return {
      text:
        options.transcript ??
        'I understand basic set notation but need relations and proof techniques by Friday.',
      durationMs: 120,
      costMillicents: Math.ceil(request.audio.byteLength / 1000),
    };
  },
});
