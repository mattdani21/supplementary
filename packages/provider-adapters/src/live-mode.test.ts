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
import { createLiveLanguageModel, createLiveLanguageModelFromEnv } from './live/language-model.js';
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

describe('provider routing (E17) and the local preset (E18)', () => {
  const completionFetch = (capture: { bodies: { model?: string; authorization?: string }[] }) =>
    scriptedFetch(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { model?: string };
      const headers = (init.headers ?? {}) as Record<string, string>;
      capture.bodies.push({ model: body.model, authorization: headers.authorization });
      return {
        status: 200,
        body: {
          model: body.model ?? 'm',
          choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      };
    });

  const request = (purpose: string) => ({
    instruction: 'Produce the artefact',
    evidenceBlock: '<evidence/>',
    contractName: 'lesson_package',
    contractVersion: '1.0.0',
    purpose,
  });

  it('routes the model by call purpose', async () => {
    const capture: { bodies: { model?: string; authorization?: string }[] } = { bodies: [] };
    const backend = createLiveLanguageModel({
      apiKey: 'key',
      model: 'default-model',
      routing: { teaching: 'teacher-model', planning: 'planner-model' },
      fetchImpl: completionFetch(capture),
    });

    await backend.complete(request('teaching'));
    await backend.complete(request('planning'));
    await backend.complete(request('verification')); // unlisted -> default
    expect(capture.bodies.map((b) => b.model)).toEqual([
      'teacher-model',
      'planner-model',
      'default-model',
    ]);
  });

  it('parses the routing table from the environment', async () => {
    const capture: { bodies: { model?: string; authorization?: string }[] } = { bodies: [] };
    const backend = createLiveLanguageModelFromEnv(
      {
        GAPOS_LLM_API_KEY: 'key',
        GAPOS_MODEL_ROUTING: 'teaching:model-x,planning:model-y',
      },
      completionFetch(capture),
    );
    await backend.complete(request('teaching'));
    expect(capture.bodies[0]?.model).toBe('model-x');
  });

  it('assembles the local preset without any key (E18)', async () => {
    const capture: { bodies: { model?: string; authorization?: string }[] } = { bodies: [] };
    const backend = createLiveLanguageModelFromEnv(
      { GAPOS_LLM_MODE: 'local' },
      completionFetch(capture),
    );
    const completion = await backend.complete(request('teaching'));
    expect(completion.json).toEqual({ ok: true });
    expect(capture.bodies[0]?.model).toBe('qwen2.5:7b-instruct');
    expect(capture.bodies[0]?.authorization).toBeUndefined();
  });

  it('still refuses live mode without a key and without the local mode', () => {
    expect(() => createLiveLanguageModelFromEnv({})).toThrow(/GAPOS_LLM_API_KEY/);
  });
});

describe('adapter resilience', () => {
  const request = {
    instruction: 'Produce the artefact',
    evidenceBlock: '<evidence/>',
    contractName: 'curriculum_plan',
    contractVersion: '1.0.0',
    purpose: 'planning',
  };

  it('retries truncated content (unparseable JSON) and succeeds on the next attempt', async () => {
    let calls = 0;
    const backend = createLiveLanguageModel({
      apiKey: 'key',
      retryDelaysMs: [1],
      fetchImpl: scriptedFetch(async () => {
        calls += 1;
        if (calls === 1) {
          // A response whose content JSON is cut mid-string — the live gate's eval_03 failure.
          return {
            status: 200,
            body: {
              choices: [
                {
                  message: { content: '{"schemaVersion":"1.0.0","gapId":"prove-both-directions",' },
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            },
          };
        }
        return {
          status: 200,
          body: {
            choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        };
      }),
    });

    const completion = await backend.complete(request);
    expect(completion.json).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('retries a 200 with empty message content (the eval_02 live failure)', async () => {
    let calls = 0;
    const backend = createLiveLanguageModel({
      apiKey: 'key',
      retryDelaysMs: [1],
      fetchImpl: scriptedFetch(async () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: 200,
            body: {
              choices: [{ message: { content: '' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            },
          };
        }
        return {
          status: 200,
          body: {
            choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        };
      }),
    });

    const completion = await backend.complete(request);
    expect(completion.json).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('retries a 200 that omitted usage', async () => {
    let calls = 0;
    const backend = createLiveLanguageModel({
      apiKey: 'key',
      retryDelaysMs: [1],
      fetchImpl: scriptedFetch(async () => {
        calls += 1;
        if (calls === 1) {
          return {
            status: 200,
            body: { choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }, // no usage
          };
        }
        return {
          status: 200,
          body: {
            choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          },
        };
      }),
    });

    const completion = await backend.complete(request);
    expect(completion.json).toEqual({ ok: true });
    expect(calls).toBe(2);
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

  it('boots live mode without an STT key (voice capture is optional)', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      GAPOS_LLM_API_KEY: 'llm-key',
      GAPOS_EMBEDDINGS_API_KEY: 'embed-key',
      // Deliberately no GAPOS_STT_API_KEY: the worker never transcribes and must
      // still boot (E22 deploy fix).
    };
    const providers = createProviders({
      mode: 'live',
      costAccountant: new CostAccountant(),
      metrics: createMetrics(),
      logger: createLogger({}, { level: 'error' }),
    });
    expect(providers.mode).toBe('live');
    expect(providers.speechToText.name).toBe('unconfigured');
    await expect(
      providers.speechToText.transcribe({
        audio: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/mpeg',
        locale: 'en',
        runId: 'run_x',
        userId: 'u',
      }),
    ).rejects.toThrow(/GAPOS_STT_API_KEY is not set/);
  });

  it('boots live mode without an embeddings key (retrieval stays lexical)', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      GAPOS_LLM_API_KEY: 'llm-key',
      // Deliberately no GAPOS_EMBEDDINGS_API_KEY: the worker must boot, and the
      // embeddings contract allows `undefined` (lexical retrieval, no charge).
    };
    const providers = createProviders({
      mode: 'live',
      costAccountant: new CostAccountant(),
      metrics: createMetrics(),
      logger: createLogger({}, { level: 'error' }),
    });
    expect(providers.mode).toBe('live');
    expect(providers.embeddings.name).toBe('unconfigured');
    const result = await providers.embeddings.embed({
      texts: ['hello'],
      runId: 'run_x',
      userId: 'u',
    });
    expect(result).toBeUndefined();
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
