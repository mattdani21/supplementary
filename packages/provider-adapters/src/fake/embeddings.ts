/**
 * The deterministic fake embeddings backend.
 *
 * Returns `undefined` unless every requested text is scripted — that is the contract's "this
 * deployment does not embed" signal, and it is what keeps the whole suite on lexical retrieval
 * by default. Scripted vectors make the vector path deterministic for the tests that need it.
 */

import type { EmbeddingRequest, EmbeddingResult } from '../interfaces.js';
import type { EmbeddingsBackend } from '../embeddings.js';

export interface FakeEmbeddingsOptions {
  /** Exact text → vector. A request naming any unscripted text returns undefined. */
  readonly vectors?: Readonly<Record<string, readonly number[]>>;
  readonly model?: string;
  readonly costMillicentsPerCall?: number;
}

export const createFakeEmbeddings = (
  options: FakeEmbeddingsOptions = {},
): EmbeddingsBackend & { readonly calls: readonly EmbeddingRequest[] } => {
  const calls: EmbeddingRequest[] = [];

  return {
    name: 'fake-embeddings',
    calls,

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult | undefined> {
      calls.push(request);
      if (!options.vectors) return undefined;

      const vectors = request.texts.map((text) => options.vectors![text]);
      if (vectors.some((vector) => vector === undefined)) return undefined;

      return {
        vectors: vectors as readonly (readonly number[])[],
        model: options.model ?? 'fake-embed',
        inputTokens: request.texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
        costMillicents: options.costMillicentsPerCall ?? 0,
      };
    },
  };
};
