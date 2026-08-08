/**
 * Budget-guarded text-to-speech wrapper (GAP-015 / M2.2).
 *
 * The language model and embeddings check the budget before every call; text-to-speech did
 * not, so a paid audio engine could overspend a run. This wrapper mirrors the same pattern:
 * the budget is authorised BEFORE synthesis, and a refusal throws ProviderBudgetError — the
 * pipeline's audio stage catches it and degrades to transcript-only, so the curriculum
 * survives and the run never overspends (docs/OPERATIONS.md Cost controls).
 *
 * The default estimate is zero because the shipped engines (the Google Translate TTS engine
 * and the deterministic fake) are free; a paid engine wires a real estimate via
 * `estimateMillicents` at assembly time. The recorded cost is the engine's actual
 * `costMillicents`, never the estimate.
 */
import type { Logger, Metrics } from '@gapos/observability';
import type { CostAccountant } from '@gapos/observability';
import type { SynthesisRequest, SynthesisResponse, TextToSpeech } from './interfaces.js';
import { ProviderBudgetError } from './interfaces.js';

export interface TextToSpeechDeps {
  readonly costAccountant: CostAccountant;
  readonly metrics: Metrics;
  readonly logger: Logger;
  /** Worst-case cost of one synthesis call. Free engines default to zero. */
  readonly estimateMillicents?: (request: SynthesisRequest) => number;
  readonly now?: () => Date;
}

export const createTextToSpeech = (backend: TextToSpeech, deps: TextToSpeechDeps): TextToSpeech => {
  const now = deps.now ?? (() => new Date());
  const estimate = deps.estimateMillicents ?? (() => 0);

  return {
    name: backend.name,

    async synthesise(request: SynthesisRequest): Promise<SynthesisResponse> {
      const decision = deps.costAccountant.authorise({
        runId: request.runId,
        userId: request.userId,
        estimateMillicents: estimate(request),
        now: now(),
      });

      if (!decision.allowed) {
        deps.metrics.increment('budget_degradation_total', { scope: decision.scope });
        deps.logger.warn('Refusing an audio call: budget exhausted; the lesson degrades to text', {
          runId: request.runId,
          scope: decision.scope,
        });
        throw new ProviderBudgetError(decision.scope, decision.spent, decision.limit);
      }

      const started = Date.now();
      const response = await backend.synthesise(request);
      deps.costAccountant.record({
        runId: request.runId,
        userId: request.userId,
        purpose: 'speech',
        provider: backend.name,
        model: backend.name,
        contract: 'synthesis',
        inputTokens: 0,
        outputTokens: 0,
        audioCharacters: response.characters,
        costMillicents: response.costMillicents,
        durationMs: Date.now() - started,
        promptVersionHash: '',
        at: now(),
      });
      return response;
    },
  };
};
