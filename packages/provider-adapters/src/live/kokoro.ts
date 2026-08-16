/**
 * Kokoro-82M via DeepInfra (E25 / GAP-084).
 *
 * DeepInfra serves Kokoro-82M behind the OpenAI audio/speech shape
 * (POST /v1/openai/audio/speech with `model`, `input`, `voice`), returning a 24kHz
 * mono WAV. The engine is deliberately small and fully testable with an injected fetch,
 * mirroring the Google Translate engine next to it.
 *
 * Duration: Kokoro returns a WAV — the RIFF header carries byte rate + data size, so the
 * wrapper gets a REAL duration instead of the character-count estimate. `parseWavDuration`
 * is exported for tests.
 */

import type { SynthesisedAudio, SpeechSynthesisEngine } from './speech.js';

export interface KokoroEngineOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly voice?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.deepinfra.com/v1/openai';
const DEFAULT_MODEL = 'hexgrad/Kokoro-82M';
export const DEFAULT_KOKORO_VOICE = 'af_heart';
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Parse a WAV's duration in seconds from its RIFF header.
 * Standard layout: "RIFF" <size> "WAVE" then chunks; the "fmt " chunk carries the
 * byte rate (offset +20 within the chunk), and the "data" chunk size / byte rate
 * is the duration. Returns undefined when the header is not a WAV.
 */
export const parseWavDurationSeconds = (bytes: Uint8Array): number | undefined => {
  const ascii = (offset: number, length: number): string =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return undefined;

  const u32 = (offset: number): number =>
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24);

  let offset = 12;
  let byteRate: number | undefined;
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(offset, 4);
    const chunkSize = u32(offset + 4);
    if (chunkId === 'fmt ' && offset + 8 + chunkSize <= bytes.length) {
      // fmt data: format(2) channels(2) sampleRate(4) byteRate(4) blockAlign(2) bitsPerSample(2)
      byteRate = u32(offset + 8 + 8);
    } else if (chunkId === 'data' && byteRate && byteRate > 0) {
      return chunkSize / byteRate;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return undefined;
};

export const createKokoroEngine = (options: KokoroEngineOptions): SpeechSynthesisEngine => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const model = options.model ?? DEFAULT_MODEL;
  const voice = options.voice ?? DEFAULT_KOKORO_VOICE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: `deepinfra-kokoro:${voice}`,

    async synthesize(text, _voice, _locale): Promise<SynthesisedAudio> {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model, input: text, voice }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Kokoro synthesis request failed: ${message}`);
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(
          `Kokoro returned HTTP ${response.status} for a ${text.length}-character input: ${detail}`,
        );
      }

      const audio = new Uint8Array(await response.arrayBuffer());
      return {
        audio,
        mediaType: 'audio/wav',
        durationSeconds: parseWavDurationSeconds(audio),
      };
    },
  };
};
