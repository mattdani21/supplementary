import { describe, expect, it } from 'vitest';
import type { RawCompletionRequest } from '../language-model.js';
import {
  createLiveLanguageModel,
  createLiveLanguageModelFromEnv,
  DEFAULT_LIVE_BASE_URL,
  LiveProviderError,
} from './language-model.js';

const baseRequest = (overrides: Partial<RawCompletionRequest> = {}): RawCompletionRequest => ({
  instruction: 'Produce the curriculum plan for the set-theory gap.',
  evidenceBlock: '<<<EVIDENCE_BLOCK>>>\nfenced source text\n<<<END_EVIDENCE_BLOCK>>>',
  contractName: 'curriculum_plan',
  contractVersion: '1.0.0',
  schemaJson:
    '{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}',
  purpose: 'plan',
  ...overrides,
});

const completion = (content: unknown, overrides: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-test',
  model: 'deepseek-chat',
  choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 2000 },
  ...overrides,
});

interface CapturedCall {
  url: string;
  init: RequestInit;
}

const build = (
  payload: unknown,
  options: {
    status?: number;
    fetchImpl?: typeof fetch;
    priceInputMillicentsPerMToken?: number;
    priceOutputMillicentsPerMToken?: number;
  } = {},
) => {
  const calls: CapturedCall[] = [];
  const fetchImpl =
    options.fetchImpl ??
    ((async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(payload), {
        status: options.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);

  const backend = createLiveLanguageModel({
    apiKey: 'sk-test',
    // Keep retryable-error tests fast; the retry policy itself has dedicated tests.
    retryDelaysMs: [1, 1],
    ...(options.priceInputMillicentsPerMToken !== undefined
      ? { priceInputMillicentsPerMToken: options.priceInputMillicentsPerMToken }
      : {}),
    ...(options.priceOutputMillicentsPerMToken !== undefined
      ? { priceOutputMillicentsPerMToken: options.priceOutputMillicentsPerMToken }
      : {}),
    fetchImpl,
  });

  return { backend, calls };
};

describe('live language model', () => {
  it('returns the parsed JSON with usage, model and computed cost', async () => {
    const { backend } = build(completion({ hello: 'world' }));
    const result = await backend.complete(baseRequest());

    expect(result.json).toEqual({ hello: 'world' });
    expect(result.model).toBe('deepseek-chat');
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(2000);
    // 1000 × $0.27/M + 2000 × $1.10/M = 27 + 220 = 247 millicents
    expect(result.costMillicents).toBe(247);
    expect(backend.name).toBe('live:deepseek-chat');
  });

  it('sends an OpenAI-compatible request: bearer auth, json mode, contract named, evidence fenced', async () => {
    const { backend, calls } = build(completion({ ok: true }));
    await backend.complete(
      baseRequest({ temperature: 0.2, maxOutputTokens: 4000, timeoutMs: 9_000 }),
    );

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`${DEFAULT_LIVE_BASE_URL}/chat/completions`);

    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers['content-type']).toBe('application/json');
    expect(call.init.signal).toBeInstanceOf(AbortSignal);

    const body = JSON.parse(String(call.init.body)) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: { type: string };
      temperature: number;
      max_tokens: number;
      stream: boolean;
    };
    expect(body.model).toBe('deepseek-chat');
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(4000);
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[0]!.content).toContain('curriculum_plan@1.0.0');
    expect(body.messages[0]!.content).toContain('JSON');
    expect(body.messages[0]!.content).toContain('Match it exactly');
    expect(body.messages[0]!.content).toContain('"additionalProperties":false');
    expect(body.messages[1]!.content).toContain('Produce the curriculum plan');
    expect(body.messages[1]!.content).toContain('<<<EVIDENCE_BLOCK>>>');
    expect(body.messages[1]!.content).toContain('fenced source text');
  });

  it('rounds a fractional cost up so spend is never undercounted', async () => {
    const { backend } = build(
      completion({}, { usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    );
    const result = await backend.complete(baseRequest());
    // ceil((27000 + 110000) / 1e6) = ceil(0.137) = 1
    expect(result.costMillicents).toBe(1);
  });

  it('uses custom prices when provided', async () => {
    const { backend } = build(completion({}), {
      priceInputMillicentsPerMToken: 1_000,
      priceOutputMillicentsPerMToken: 1_000,
    });
    const result = await backend.complete(baseRequest());
    // 1000 × 1000/1e6 + 2000 × 1000/1e6 = 1 + 2 = 3 millicents
    expect(result.costMillicents).toBe(3);
  });

  it('throws a non-retryable error on HTTP 400 with a body excerpt', async () => {
    const { backend } = build({ error: 'bad request' }, { status: 400 });
    await expect(backend.complete(baseRequest())).rejects.toMatchObject({
      name: 'LiveProviderError',
      status: 400,
      retryable: false,
    });
    await expect(backend.complete(baseRequest())).rejects.toThrow(/HTTP 400/);
  });

  it('throws a retryable error on HTTP 429', async () => {
    const { backend } = build({ error: 'rate limited' }, { status: 429 });
    await expect(backend.complete(baseRequest())).rejects.toMatchObject({
      name: 'LiveProviderError',
      status: 429,
      retryable: true,
    });
  });

  it('throws a retryable error on a server error', async () => {
    const { backend } = build({ error: 'boom' }, { status: 503 });
    await expect(backend.complete(baseRequest())).rejects.toMatchObject({
      name: 'LiveProviderError',
      status: 503,
      retryable: true,
    });
  });

  it('throws a retryable error when the network fails', async () => {
    const failingFetch = (async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const { backend } = build(null, { fetchImpl: failingFetch });
    await expect(backend.complete(baseRequest())).rejects.toMatchObject({
      name: 'LiveProviderError',
      retryable: true,
    });
  });

  it('throws when the message content is not JSON', async () => {
    const { backend } = build(
      completion(null, { choices: [{ message: { content: 'this is not json' } }] }),
    );
    await expect(backend.complete(baseRequest())).rejects.toThrow(/unparseable JSON/);
    await expect(backend.complete(baseRequest())).rejects.toBeInstanceOf(LiveProviderError);
  });

  it('throws when the provider omits usage', async () => {
    const { backend } = build(completion({ ok: true }, { usage: undefined }));
    await expect(backend.complete(baseRequest())).rejects.toThrow(/omitted usage/);
  });

  it('throws when the provider returns no message content', async () => {
    const { backend } = build(completion({ ok: true }, { choices: [] }));
    await expect(backend.complete(baseRequest())).rejects.toThrow(/no message content/);
  });

  it('retries a transient non-JSON body and succeeds on the second attempt', async () => {
    const calls: CapturedCall[] = [];
    let served = 0;
    const fetchImpl = (async (
      url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      served += 1;
      if (served === 1) {
        // A gateway blip: HTTP 200 with an HTML error page instead of JSON.
        return new Response('<html>upstream error</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(JSON.stringify(completion({ ok: true })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const backend = createLiveLanguageModel({
      apiKey: 'sk-test',
      retryDelaysMs: [1],
      fetchImpl,
    });
    const result = await backend.complete(baseRequest());
    expect(result.json).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('gives up after the retries are exhausted', async () => {
    let served = 0;
    const fetchImpl = (async (): Promise<Response> => {
      served += 1;
      return new Response('<html>upstream error</html>', { status: 200 });
    }) as typeof fetch;

    const backend = createLiveLanguageModel({
      apiKey: 'sk-test',
      retryDelaysMs: [1, 1],
      fetchImpl,
    });
    await expect(backend.complete(baseRequest())).rejects.toThrow(/non-JSON response body/);
    expect(served).toBe(3);
  });

  it('does not retry a non-retryable failure', async () => {
    let served = 0;
    const fetchImpl = (async (): Promise<Response> => {
      served += 1;
      return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    }) as typeof fetch;

    const backend = createLiveLanguageModel({
      apiKey: 'sk-test',
      retryDelaysMs: [1, 1],
      fetchImpl,
    });
    await expect(backend.complete(baseRequest())).rejects.toThrow(/HTTP 400/);
    expect(served).toBe(1);
  });
});

describe('live language model from environment', () => {
  it('refuses to build without a key, loudly', () => {
    expect(() => createLiveLanguageModelFromEnv({})).toThrow(/GAPOS_LLM_API_KEY/);
  });

  it('reads model, base URL and pricing from the environment', async () => {
    const calls: CapturedCall[] = [];
    const fetchImpl = (async (
      url: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify(completion({ ok: true }, { model: 'deepseek-v4-flash' })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const backend = createLiveLanguageModelFromEnv(
      {
        GAPOS_LLM_API_KEY: 'sk-env',
        GAPOS_LLM_MODEL: 'deepseek-v4-flash',
        GAPOS_LLM_BASE_URL: 'https://example.com/v1/',
        GAPOS_LLM_PRICE_INPUT_MILLICENTS_PER_MT: '1000',
        GAPOS_LLM_PRICE_OUTPUT_MILLICENTS_PER_MT: '1000',
      },
      fetchImpl,
    );

    expect(backend.name).toBe('live:deepseek-v4-flash');

    const result = await backend.complete(baseRequest());
    expect(result.model).toBe('deepseek-v4-flash');
    expect(calls[0]!.url).toBe('https://example.com/v1/chat/completions');
    // 1000 × 1000/1e6 + 2000 × 1000/1e6 = 1 + 2 = 3 millicents
    expect(result.costMillicents).toBe(3);
  });
});
