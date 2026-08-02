/**
 * The guarded language-model adapter.
 *
 * A backend produces raw JSON. This wrapper is what makes it safe to use:
 *
 *   1. it checks the budget *before* the call, so a run degrades rather than overspending;
 *   2. it fences source text into the evidence envelope and flags injection attempts;
 *   3. it validates the response against its versioned contract before returning;
 *   4. it records usage and metrics for every call, including failed ones.
 *
 * Nothing downstream ever sees an unvalidated response, because there is no path around this.
 */

import { createHash } from 'node:crypto';
import { detectInjectionAttempts, renderEvidenceEnvelope } from '@gapos/ai-contracts';
import type { CostAccountant, Logger, Metrics, Millicents } from '@gapos/observability';
import {
  ProviderBudgetError,
  ProviderContractError,
  type LanguageModel,
  type StructuredRequest,
  type StructuredResponse,
} from './interfaces.js';

export interface RawCompletionRequest {
  readonly instruction: string;
  /** Already fenced. The backend passes it through; it never re-assembles the prompt. */
  readonly evidenceBlock: string;
  readonly contractName: string;
  readonly contractVersion: string;
  readonly purpose: string;
  readonly subject?: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export interface RawCompletion {
  readonly json: unknown;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMillicents: Millicents;
}

export interface LanguageModelBackend {
  readonly name: string;
  complete(request: RawCompletionRequest): Promise<RawCompletion>;
}

export interface LanguageModelDeps {
  readonly costAccountant: CostAccountant;
  readonly metrics: Metrics;
  readonly logger: Logger;
  /** Worst-case cost assumed when authorising, before the real cost is known. */
  readonly estimateMillicents?: (request: RawCompletionRequest) => Millicents;
  readonly now?: () => Date;
}

const DEFAULT_ESTIMATE: Millicents = 5_000; // 5 cents

export const promptVersionHash = (request: RawCompletionRequest): string =>
  createHash('sha256')
    .update(`${request.contractName}@${request.contractVersion}\n${request.instruction}`)
    .digest('hex')
    .slice(0, 16);

export const createLanguageModel = (
  backend: LanguageModelBackend,
  deps: LanguageModelDeps,
): LanguageModel => {
  const now = deps.now ?? (() => new Date());
  const estimate = deps.estimateMillicents ?? (() => DEFAULT_ESTIMATE);

  return {
    name: backend.name,

    async generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>> {
      const evidence = request.evidence ?? [];
      const injectionSignals = detectInjectionAttempts(evidence).map((signal) => ({
        chunkId: signal.chunkId,
        excerpt: signal.excerpt,
      }));

      if (injectionSignals.length > 0) {
        // Reported, never obeyed: the text still goes to the model, but inside the envelope and
        // with an audit finding attached to the run.
        deps.logger.warn('Injection attempt detected in source evidence', {
          runId: request.runId,
          contract: request.contract.name,
          chunkIds: injectionSignals.map((s) => s.chunkId),
        });
        deps.metrics.increment('audit_finding_total', { category: 'prompt_injection' });
      }

      const raw: RawCompletionRequest = {
        instruction: request.instruction,
        evidenceBlock: renderEvidenceEnvelope(evidence),
        contractName: request.contract.name,
        contractVersion: request.contract.version,
        purpose: request.purpose,
        ...(request.subject === undefined ? {} : { subject: request.subject }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: request.maxOutputTokens }),
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
      };

      const decision = deps.costAccountant.authorise({
        runId: request.runId,
        userId: request.userId,
        estimateMillicents: estimate(raw),
        now: now(),
      });

      if (!decision.allowed) {
        deps.metrics.increment('budget_degradation_total', { scope: decision.scope });
        deps.logger.warn('Refusing a model call: budget exhausted', {
          runId: request.runId,
          scope: decision.scope,
          contract: request.contract.name,
        });
        throw new ProviderBudgetError(decision.scope, decision.spent, decision.limit);
      }

      const started = Date.now();
      deps.metrics.increment('model_call_total', {
        purpose: request.purpose,
        contract: request.contract.name,
      });

      let completion: RawCompletion;
      try {
        completion = await backend.complete(raw);
      } finally {
        deps.metrics.observe('model_call_duration_ms', Date.now() - started, {
          purpose: request.purpose,
          contract: request.contract.name,
        });
      }

      const durationMs = Date.now() - started;
      const hash = promptVersionHash(raw);

      // Usage is recorded whether or not validation passes: a rejected response still cost money.
      deps.costAccountant.record({
        runId: request.runId,
        userId: request.userId,
        purpose: request.purpose,
        provider: backend.name,
        model: completion.model,
        contract: request.contract.name,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        audioCharacters: 0,
        costMillicents: completion.costMillicents,
        durationMs,
        promptVersionHash: hash,
        at: now(),
      });

      const parsed = request.contract.schema.safeParse(completion.json);
      if (!parsed.success) {
        deps.metrics.increment('schema_validation_failure_total', {
          contract: request.contract.name,
        });
        const issues = parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        );
        deps.logger.error('Provider response failed its contract', {
          runId: request.runId,
          contract: request.contract.name,
          version: request.contract.version,
          issues,
        });
        throw new ProviderContractError(request.contract.name, request.contract.version, issues);
      }

      return {
        value: parsed.data,
        model: completion.model,
        provider: backend.name,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        costMillicents: completion.costMillicents,
        durationMs,
        promptVersionHash: hash,
        injectionSignals,
      };
    },
  };
};
