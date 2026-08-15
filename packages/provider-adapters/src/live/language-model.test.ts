import { describe, expect, it } from 'vitest';
import type { RawCompletionRequest } from '../language-model.js';
import {
  createLiveLanguageModel,
  createLiveLanguageModelFromEnv,
  DEFAULT_LIVE_BASE_URL,
  DEFAULT_LIVE_MODEL,
  DEEPSEEK_V4_FLASH_PRICE_CACHE_HIT_INPUT_MILLICENTS_PER_MT,
  DEEPSEEK_V4_FLASH_PRICE_INPUT_MILLICENTS_PER_MT,
  DEEPSEEK_V4_FLASH_PRICE_OUTPUT_MILLICENTS_PER_MT,
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
  model: 'deepseek-v4-flash',
  choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 1000, completion_tokens: 2000 },
  ...overrides,
});

/**
 * A v4-architecture completion: the assistant message carries a reasoning trace in
 * `reasoning_content` alongside the JSON `content`, and usage reports the reasoning tokens
 * separately in `completion_tokens_details.reasoning_tokens`.
 */
const v4Completion = (content: unknown, usageOverrides: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-test',
  model: 'deepseek-v4-flash',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        reasoning_content:
          'I should map each objective to the days that teach it, then check the daily budget...',
        content: JSON.stringify(content),
      },
    },
  ],
  usage: {
    prompt_tokens: 1000,
    completion_tokens: 2000,
    completion_tokens_details: { reasoning_tokens: 500 },
    ...usageOverrides,
  },
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
    expect(result.model).toBe('deepseek-v4-flash');
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(2000);
    // 1000 × $0.14/M + 2000 × $0.28/M = 14 + 56 = 70 millicents
    expect(result.costMillicents).toBe(70);
    expect(backend.name).toBe('live:deepseek-v4-flash');
  });

  it('defaults to deepseek-v4-flash, the v4 fast/cheap tier (deepseek-chat stays reachable by override)', async () => {
    expect(DEFAULT_LIVE_MODEL).toBe('deepseek-v4-flash');
    const { backend, calls } = build(completion({ ok: true }));
    await backend.complete(baseRequest());
    expect(backend.name).toBe('live:deepseek-v4-flash');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      model: 'deepseek-v4-flash',
    });
  });

  it('prices the v4-flash table: $0.14/M input, $0.28/M output, $0.0028/M cache-hit input', () => {
    expect(DEEPSEEK_V4_FLASH_PRICE_INPUT_MILLICENTS_PER_MT).toBe(14_000);
    expect(DEEPSEEK_V4_FLASH_PRICE_OUTPUT_MILLICENTS_PER_MT).toBe(28_000);
    expect(DEEPSEEK_V4_FLASH_PRICE_CACHE_HIT_INPUT_MILLICENTS_PER_MT).toBe(280);
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
    expect(body.model).toBe('deepseek-v4-flash');
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

  it('sends reasoning_effort in the request body when the caller sets it', async () => {
    // T051: DeepSeek v4 models take a per-call reasoning_effort ('low' | 'medium' | 'high').
    // The contract-first steps run at 'low' so their direct, compliant output is not eaten by
    // a long reasoning trace; the lesson generator runs at 'high'.
    const { backend, calls } = build(completion({ ok: true }));
    await backend.complete(baseRequest({ reasoningEffort: 'low' }));
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body)) as { reasoning_effort?: string };
    expect(body.reasoning_effort).toBe('low');
  });

  it('omits reasoning_effort from the request body when the caller does not set it', async () => {
    const { backend, calls } = build(completion({ ok: true }));
    await backend.complete(baseRequest());
    const body = JSON.parse(String(calls[0]!.init.body)) as { reasoning_effort?: string };
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('rounds a fractional cost up so spend is never undercounted', async () => {
    const { backend } = build(
      completion({}, { usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    );
    const result = await backend.complete(baseRequest());
    // ceil((14000 + 28000) / 1e6) = ceil(0.042) = 1
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

  it('parses a v4 response: content stays the JSON source, reasoning_content is metadata', async () => {
    const { backend } = build(v4Completion({ ok: true }));
    const result = await backend.complete(baseRequest());

    // The JSON comes from `content`, never from the reasoning trace.
    expect(result.json).toEqual({ ok: true });
    expect(result.model).toBe('deepseek-v4-flash');
  });

  it('bills reasoning tokens as output tokens so they count against the run budget', async () => {
    const { backend } = build(v4Completion({ ok: true }));
    const result = await backend.complete(baseRequest());

    // completion_tokens 2000 + reasoning_tokens 500 = 2500 billed output tokens.
    expect(result.outputTokens).toBe(2500);
    // 1000 × 14000/1e6 + 2500 × 28000/1e6 = 14 + 70 = 84 millicents
    expect(result.costMillicents).toBe(84);
  });

  it('treats empty content after reasoning as retryable, naming the shared max_tokens failure', async () => {
    // On v4, max_tokens is shared between reasoning and content: a long reasoning trace can
    // consume the whole budget and leave content empty (observed live on v4-pro).
    const { backend } = build({
      model: 'deepseek-v4-flash',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            reasoning_content: 'A very long reasoning trace that consumed the whole budget...',
            content: '',
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 0,
        completion_tokens_details: { reasoning_tokens: 8192 },
      },
    });
    await expect(backend.complete(baseRequest())).rejects.toMatchObject({
      name: 'LiveProviderError',
      retryable: true,
    });
    await expect(backend.complete(baseRequest())).rejects.toThrow(/no message content/);
    await expect(backend.complete(baseRequest())).rejects.toThrow(/reasoning/);
  });

  it('bills prompt cache hits at the v4-flash cache-hit rate', async () => {
    const { backend } = build(
      completion(
        { ok: true },
        {
          usage: {
            prompt_tokens: 1000,
            prompt_cache_hit_tokens: 800,
            prompt_tokens_details: { cached_tokens: 800 },
            completion_tokens: 1000,
          },
        },
      ),
    );
    const result = await backend.complete(baseRequest());
    // 200 × $0.14/M + 800 × $0.0028/M + 1000 × $0.28/M = 2.8 + 0.224 + 28 = 31.024 → ceil 32
    expect(result.costMillicents).toBe(32);
  });

  it('mentions reasoning latency when the request times out', async () => {
    const timedOutFetch = (async (): Promise<Response> => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    const { backend } = build(null, { fetchImpl: timedOutFetch });
    await expect(backend.complete(baseRequest())).rejects.toMatchObject({
      name: 'LiveProviderError',
      retryable: true,
    });
    await expect(backend.complete(baseRequest())).rejects.toThrow(/reasoning/);
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
