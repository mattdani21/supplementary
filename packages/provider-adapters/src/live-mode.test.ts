/**
 * Live speech-to-text (GAP-023) and the now-real live-mode factory.
 *
 * The STT backend is exercised against a scripted fetch: the multipart request shape, the
 * bearer auth, the response contract and the cost floor. The factory test proves live mode
 * assembles all four adapters from env without throwing — the previous behaviour was a loud
 * error because live speech did not exist.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createLogger, createMetrics, CostAccountant } from '@gapos/observability';
import { createLiveSpeechToText } from './live/speech-to-text.js';
import { createLiveEmbeddings } from './live/embeddings.js';
import { createProviders } from './factory.js';

const audioBytes = new Uint8Array([0, 1, 2, 3, 4]);

const scriptedFetch =
  (handler: (url: string, init: RequestInit) => Promise<{ status: number; body: unknown }>) =>
  async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const result = await handler(String(url), init ?? {});
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  };

const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

describe('live speech-to-text backend', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('posts a multipart form to /audio/transcriptions with bearer auth and parses the text', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const stt = createLiveSpeechToText({
      endpoint: 'https://stt.example/v1',
      apiKey: 'key-123',
      model: 'whisper-1',
      fetchImpl: scriptedFetch(async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return { status: 200, body: { text: 'I want to understand equivalence relations.' } };
      }),
    });

    const result = await stt.transcribe({
      audio: audioBytes,
      mediaType: 'audio/webm',
      locale: 'en',
      runId: 'run_1',
      userId: 'user_1',
    });

    expect(capturedUrl).toBe('https://stt.example/v1/audio/transcriptions');
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>).Authorization).toBe('Bearer key-123');
    const contentType = (capturedInit?.headers as Record<string, string>)['Content-Type'];
    expect(contentType).toBeUndefined(); // fetch sets the multipart boundary itself
    expect(capturedInit?.body).toBeInstanceOf(FormData);
    expect((capturedInit?.body as FormData).get('model')).toBe('whisper-1');
    expect((capturedInit?.body as FormData).get('file')).toBeInstanceOf(Blob);

    expect(result.text).toBe('I want to understand equivalence relations.');
    expect(result.costMillicents).toBeGreaterThanOrEqual(1);
  });

  it('raises a typed error when the endpoint refuses', async () => {
    const stt = createLiveSpeechToText({
      endpoint: 'https://stt.example/v1',
      apiKey: 'key-123',
      model: 'whisper-1',
      fetchImpl: scriptedFetch(async () => ({
        status: 402,
        body: { error: 'insufficient funds' },
      })),
    });

    await expect(
      stt.transcribe({
        audio: audioBytes,
        mediaType: 'audio/webm',
        locale: 'en',
        runId: 'run_1',
        userId: 'user_1',
      }),
    ).rejects.toMatchObject({ name: 'LiveSpeechToTextError', code: 'http' });
  });
});

describe('live-mode factory', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('assembles all four adapters from env without throwing', () => {
    process.env = {
      ...ORIGINAL_ENV,
      GAPOS_LLM_API_KEY: 'llm-key',
      GAPOS_STT_API_KEY: 'stt-key',
      GAPOS_EMBEDDINGS_API_KEY: 'embed-key',
    };
    const providers = createProviders({
      mode: 'live',
      costAccountant: new CostAccountant(),
      metrics: createMetrics(),
      logger: createLogger({}, { level: 'error' }),
    });

    expect(providers.mode).toBe('live');
    expect(providers.languageModel.name).toContain('live');
    expect(providers.speechToText.name).toBe('live-speech-to-text');
    expect(providers.textToSpeech.name).toContain('live');
    expect(providers.embeddings.name).toContain('live');
  });

  it('still refuses live mode without the keys', () => {
    process.env = { ...ORIGINAL_ENV, GAPOS_LLM_API_KEY: '', GAPOS_STT_API_KEY: '' };
    expect(() =>
      createProviders({
        mode: 'live',
        costAccountant: new CostAccountant(),
        metrics: createMetrics(),
        logger: createLogger({}, { level: 'error' }),
      }),
    ).toThrow(/GAPOS_LLM_API_KEY/);
  });

  it('exposes a live embeddings backend for explicit assembly', async () => {
    const backend = createLiveEmbeddings({
      endpoint: 'https://embeddings.example/v1',
      apiKey: 'embed-key',
      model: 'text-embedding-3-small',
      dimensions: 4,
      fetchImpl: scriptedFetch(async () => ({
        status: 200,
        body: {
          data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }, { embedding: [0.5, 0.6, 0.7, 0.8] }],
          usage: { total_tokens: 17 },
        },
      })),
    });
    const result = await backend.embed({
      texts: ['a', 'b'],
      runId: 'run_1',
      userId: 'user_1',
    });
    expect(result?.vectors).toHaveLength(2);
    expect(result?.vectors[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});
