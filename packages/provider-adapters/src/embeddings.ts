/**
 * The guarded embeddings adapter (GAP-018).
 *
 * A backend produces vectors (or `undefined` when the deployment has no embedding capability).
 * The wrapper is what makes it safe to use, mirroring the language-model wrapper: the budget is
 * checked before the call (a run degrades rather than overspends), usage and metrics are
 * recorded for every call that happens, and a configured backend that fails is an error — only
 * the deliberate absence of an embedding capability falls back to lexical retrieval.
 */

import type { CostAccountant, Logger, Metrics, Millicents } from '@gapos/observability';
import {
  ProviderBudgetError,
  type EmbeddingRequest,
  type EmbeddingResult,
  type Embeddings,
} from './interfaces.js';

export interface EmbeddingsBackend {
  readonly name: string;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult | undefined>;
}

export interface EmbeddingsDeps {
  readonly costAccountant: CostAccountant;
  readonly metrics: Metrics;
  readonly logger: Logger;
  /** Worst-case cost assumed when authorising, before the real cost is known. */
  readonly estimateMillicents?: (request: EmbeddingRequest) => Millicents;
  readonly now?: () => Date;
}

/** Embeddings are cheap; a conservative worst case is still far below a language-model call. */
const DEFAULT_ESTIMATE: Millicents = 100; // 0.1 cent

export const createEmbeddings = (backend: EmbeddingsBackend, deps: EmbeddingsDeps): Embeddings => {
  const now = deps.now ?? (() => new Date());
  const estimate = deps.estimateMillicents ?? (() => DEFAULT_ESTIMATE);

  return {
    name: backend.name,

    async embed(request: EmbeddingRequest): Promise<EmbeddingResult | undefined> {
      const decision = deps.costAccountant.authorise({
        runId: request.runId,
        userId: request.userId,
        estimateMillicents: estimate(request),
        now: now(),
      });

      if (!decision.allowed) {
        deps.metrics.increment('budget_degradation_total', { scope: decision.scope });
        deps.logger.warn('Refusing an embedding call: budget exhausted', {
          runId: request.runId,
          scope: decision.scope,
        });
        throw new ProviderBudgetError(decision.scope, decision.spent, decision.limit);
      }

      const started = Date.now();
      deps.metrics.increment('model_call_total', { purpose: 'retrieval', contract: 'embedding' });
      try {
        const result = await backend.embed(request);
        if (!result) return undefined;

        // Usage is recorded whether or not the vectors are usable downstream.
        await deps.costAccountant.record({
          runId: request.runId,
          userId: request.userId,
          purpose: 'retrieval',
          provider: backend.name,
          model: result.model,
          contract: 'embedding',
          inputTokens: result.inputTokens,
          outputTokens: 0,
          audioCharacters: 0,
          costMillicents: result.costMillicents,
          durationMs: Date.now() - started,
          promptVersionHash: '',
          at: now(),
        });
        return result;
      } finally {
        deps.metrics.observe('model_call_duration_ms', Date.now() - started, {
          purpose: 'retrieval',
          contract: 'embedding',
        });
      }
    },
  };
};
