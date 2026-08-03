/**
 * The live speech-to-text backend (GAP-023): OpenAI-compatible `/audio/transcriptions` over
 * plain fetch, following the same no-SDK rule as every other live adapter.
 *
 * Cost is derived from an env-overridable price per minute (a conservative default so a
 * misconfigured deployment cannot quietly burn budget). Assembly is explicit — the guarded
 * `SpeechToText` interface is returned directly, and the factory builds it from env so live
 * mode is a real, bootable provider set.
 */

import type { SpeechToText, TranscriptionRequest, TranscriptionResponse } from '../interfaces.js';

export interface LiveSpeechToTextOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  /** Millicents per minute of audio. Default ~$0.02/min (whisper-class pricing). */
  readonly priceMillicentsPerMinute?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class LiveSpeechToTextError extends Error {
  constructor(
    readonly code: 'http' | 'network' | 'shape' | 'configuration',
    message: string,
  ) {
    super(message);
    this.name = 'LiveSpeechToTextError';
  }
}

export const createLiveSpeechToText = (options: LiveSpeechToTextOptions): SpeechToText => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const priceMillicentsPerMinute = options.priceMillicentsPerMinute ?? 20;

  return {
    name: 'live-speech-to-text',

    async transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse> {
      const began = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const form = new FormData();
      form.append('model', options.model);
      form.append(
        'file',
        new Blob([request.audio as BlobPart], { type: request.mediaType }),
        'capture.webm',
      );

      let response: Response;
      try {
        response = await fetchImpl(`${options.endpoint}/audio/transcriptions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: form,
          signal: controller.signal,
        });
      } catch (error) {
        throw new LiveSpeechToTextError(
          'network',
          `Transcription request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new LiveSpeechToTextError(
          'http',
          `Transcription endpoint returned ${response.status}: ${await response.text()}`,
        );
      }

      const body = (await response.json()) as { text?: string };
      if (typeof body.text !== 'string' || body.text.trim() === '') {
        throw new LiveSpeechToTextError('shape', 'Transcription response carried no text.');
      }

      const durationMs = Date.now() - began;
      return {
        text: body.text,
        durationMs,
        // Billed on the duration the call took (the client does not know the audio's sample
        // rate); a floor of 1 keeps tiny clips from charging zero.
        costMillicents: Math.max(1, Math.ceil((durationMs / 60_000) * priceMillicentsPerMinute)),
      };
    },
  };
};

interface SpeechToTextEnv {
  readonly GAPOS_STT_API_KEY?: string;
  readonly GAPOS_STT_BASE_URL?: string;
  readonly GAPOS_STT_MODEL?: string;
  readonly GAPOS_STT_PRICE_MILLICENTS_PER_MINUTE?: string;
}

export const createLiveSpeechToTextFromEnv = (env: SpeechToTextEnv = process.env): SpeechToText => {
  const apiKey = env.GAPOS_STT_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GAPOS_STT_API_KEY is not set. A live provider is a paid external resource: set the key ' +
        'before selecting live mode (AGENTS.md §5).',
    );
  }
  return createLiveSpeechToText({
    endpoint: env.GAPOS_STT_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey,
    model: env.GAPOS_STT_MODEL ?? 'whisper-1',
    ...(env.GAPOS_STT_PRICE_MILLICENTS_PER_MINUTE
      ? { priceMillicentsPerMinute: Number(env.GAPOS_STT_PRICE_MILLICENTS_PER_MINUTE) }
      : {}),
  });
};
