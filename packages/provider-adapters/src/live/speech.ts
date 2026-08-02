/**
 * The live speech backends.
 *
 * TextToSpeech is built from two layers, mirroring the language-model adapter:
 *
 *   1. a `SpeechSynthesisEngine` — the only thing that knows a provider. The default engine
 *      speaks the free Google Translate TTS endpoint over plain fetch (no SDK, no API key),
 *      mirroring the gTTS request shape. It is deliberately small and fully testable with an
 *      injected fetch. A paid provider (ElevenLabs, OpenAI) slots in behind the same interface
 *      when provider routing (E17) is built.
 *   2. `createLiveTextToSpeech` — the guarded wrapper: it computes the transcript-linked
 *      checksum the pipeline verifies before publication, estimates duration with the same
 *      heuristic the domain segmenter uses, and records cost in integer millicents.
 *
 * Choice note: the npm `edge-tts` package was rejected — the registry only carries 1.0.1
 * (Bun-era, `main: index.ts`) under CC BY-NC-SA 4.0, which is not a dependency this product
 * should carry. The Google endpoint is unofficial and undocumented, like every free TTS route;
 * that risk is contained because the engine interface is the only place it can leak.
 */

import { CHARACTERS_PER_SECOND, checksumFor } from '../fake/speech.js';
import type { SynthesisRequest, SynthesisResponse, TextToSpeech } from '../interfaces.js';

export interface SynthesisedAudio {
  readonly audio: Uint8Array;
  readonly mediaType: string;
  /** Real duration in seconds when the engine knows it; the wrapper estimates otherwise. */
  readonly durationSeconds?: number;
}

export interface SpeechSynthesisEngine {
  readonly name: string;
  synthesize(text: string, voice: string, locale: string): Promise<SynthesisedAudio>;
}

export class LiveSynthesisError extends Error {
  constructor(segmentId: string, message: string) {
    super(`Synthesis failed for segment ${segmentId}: ${message}`);
    this.name = 'LiveSynthesisError';
  }
}

export interface LiveTextToSpeechOptions {
  readonly engine: SpeechSynthesisEngine;
  readonly name?: string;
  readonly costMillicentsPerThousandCharacters?: number;
}

/** Same heuristic the domain segmenter uses, so integrity checks pass with an estimate. */
export const estimateDurationSeconds = (characters: number): number =>
  Math.max(1, Math.round(characters / CHARACTERS_PER_SECOND));

export const createLiveTextToSpeech = (options: LiveTextToSpeechOptions): TextToSpeech => {
  const name = options.name ?? `live:${options.engine.name}`;
  const costPerThousand = options.costMillicentsPerThousandCharacters ?? 0;

  return {
    name,

    async synthesise(request: SynthesisRequest): Promise<SynthesisResponse> {
      let synthesised: SynthesisedAudio;
      try {
        synthesised = await options.engine.synthesize(request.text, request.voice, request.locale);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LiveSynthesisError(request.segmentId, message);
      }

      return {
        audio: synthesised.audio,
        mediaType: synthesised.mediaType,
        durationSeconds:
          synthesised.durationSeconds ?? estimateDurationSeconds(request.text.length),
        // The integrity model is transcript-linked: sha256 of the spoken text, exactly as the
        // fake produces, so a live run and a fake run are held to the same check.
        checksum: checksumFor(request.text),
        characters: request.text.length,
        costMillicents: Math.ceil((request.text.length / 1000) * costPerThousand),
      };
    },
  };
};

/* ---------------------------------------------------------------- google translate tts */

export interface GoogleTranslateTtsEngineOptions {
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** The endpoint refuses very long text; chunks stay well under its cap. */
  readonly maxChunkCharacters?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_CHUNK_CHARACTERS = 180;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Split into word-boundary chunks of at most `max` characters, hard-splitting overlong words. */
export const chunkText = (text: string, max: number): string[] => {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    let piece = word;
    while (piece.length > max) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(piece.slice(0, max));
      piece = piece.slice(max);
    }
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length > max && current) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
};

export const createGoogleTranslateTtsEngine = (
  options: GoogleTranslateTtsEngineOptions = {},
): SpeechSynthesisEngine => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxChunk = options.maxChunkCharacters ?? DEFAULT_MAX_CHUNK_CHARACTERS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const synthesizeChunk = async (text: string, language: string): Promise<Uint8Array> => {
    const url = new URL('https://translate.google.com/translate_tts');
    url.searchParams.set('ie', 'UTF-8');
    url.searchParams.set('q', text);
    url.searchParams.set('tl', language);
    url.searchParams.set('total', '1');
    url.searchParams.set('idx', '0');
    url.searchParams.set('textlen', String(text.length));
    url.searchParams.set('client', 'tw-ob');
    url.searchParams.set('prev', 'input');
    url.searchParams.set('ttsspeed', '1');

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Google Translate TTS request failed: ${message}`);
    }

    if (!response.ok) {
      throw new Error(
        `Google Translate TTS returned HTTP ${response.status} for a ${text.length}-character chunk`,
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  };

  return {
    name: 'google-translate-tts',

    async synthesize(text, _voice, locale): Promise<SynthesisedAudio> {
      const language = (locale.split('-')[0] ?? 'en').toLowerCase();
      const chunks = chunkText(text, maxChunk);

      const parts: Uint8Array[] = [];
      for (const chunk of chunks) {
        parts.push(await synthesizeChunk(chunk, language));
      }

      const total = parts.reduce((sum, part) => sum + part.length, 0);
      const audio = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        audio.set(part, offset);
        offset += part.length;
      }

      // The endpoint exposes no duration metadata; the wrapper estimates from characters.
      return { audio, mediaType: 'audio/mpeg' };
    },
  };
};
