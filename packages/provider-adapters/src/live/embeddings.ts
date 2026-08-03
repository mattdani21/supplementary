/**
 * The live embeddings backend (GAP-018): OpenAI-compatible `/embeddings` over plain fetch.
 *
 * Same no-SDK rule as the live language model. Cost comes from an env-overridable price table
 * (defaults track deepseek's text-embedding price of a fraction of a cent per million tokens, so
 * a misconfigured deployment cannot quietly burn budget). The backend is assembled explicitly
 * behind the guarded wrapper — never silently swapped for the fake.
 */

import type { EmbeddingRequest, EmbeddingResult } from '../interfaces.js';
import type { EmbeddingsBackend } from '../embeddings.js';

export interface LiveEmbeddingsOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  /** Millicents per million tokens. Default: deepseek text-embedding (~0.0007 / MT). */
  readonly priceMillicentsPerMToken?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class LiveEmbeddingsError extends Error {
  constructor(
    readonly code: 'http' | 'network' | 'shape' | 'configuration',
    message: string,
  ) {
    super(message);
    this.name = 'LiveEmbeddingsError';
  }
}

export const createLiveEmbeddings = (options: LiveEmbeddingsOptions): EmbeddingsBackend => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const priceMillicentsPerMToken = options.priceMillicentsPerMToken ?? 0.7;

  return {
    name: 'live-embeddings',

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult | undefined> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(`${options.endpoint}/embeddings`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            input: request.texts,
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new LiveEmbeddingsError(
          'network',
          `Embeddings request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        throw new LiveEmbeddingsError(
          'http',
          `Embeddings endpoint returned ${response.status}: ${await response.text()}`,
        );
      }

      const body = (await response.json()) as {
        data?: { embedding?: number[] }[];
        usage?: { total_tokens?: number };
      };

      if (!Array.isArray(body.data) || body.data.length !== request.texts.length) {
        throw new LiveEmbeddingsError(
          'shape',
          `Embeddings response has ${body.data?.length ?? 0} vectors for ${request.texts.length} texts.`,
        );
      }

      const vectors = body.data.map((entry) => entry.embedding ?? []);
      for (const vector of vectors) {
        if (vector.length !== options.dimensions) {
          throw new LiveEmbeddingsError(
            'shape',
            `Embedding has ${vector.length} dimensions, expected ${options.dimensions}.`,
          );
        }
      }

      const inputTokens = body.usage?.total_tokens ?? 0;
      return {
        vectors,
        model: options.model,
        inputTokens,
        costMillicents: Math.ceil((inputTokens / 1_000_000) * priceMillicentsPerMToken),
      };
    },
  };
};

interface EmbeddingsEnv {
  readonly GAPOS_EMBEDDINGS_API_KEY?: string;
  readonly GAPOS_EMBEDDINGS_BASE_URL?: string;
  readonly GAPOS_EMBEDDINGS_MODEL?: string;
  readonly GAPOS_EMBEDDINGS_DIMENSIONS?: string;
  readonly GAPOS_EMBEDDINGS_PRICE_MILLICENTS_PER_MT?: string;
}

export const createLiveEmbeddingsFromEnv = (
  env: EmbeddingsEnv = process.env,
): EmbeddingsBackend => {
  const apiKey = env.GAPOS_EMBEDDINGS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GAPOS_EMBEDDINGS_API_KEY is not set. A live provider is a paid external resource: set ' +
        'the key before selecting live mode (AGENTS.md §5).',
    );
  }
  return createLiveEmbeddings({
    endpoint: env.GAPOS_EMBEDDINGS_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey,
    model: env.GAPOS_EMBEDDINGS_MODEL ?? 'text-embedding-3-small',
    dimensions: Number(env.GAPOS_EMBEDDINGS_DIMENSIONS ?? 384),
    ...(env.GAPOS_EMBEDDINGS_PRICE_MILLICENTS_PER_MT
      ? { priceMillicentsPerMToken: Number(env.GAPOS_EMBEDDINGS_PRICE_MILLICENTS_PER_MT) }
      : {}),
  });
};
