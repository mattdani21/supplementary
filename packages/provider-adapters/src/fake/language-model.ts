/**
 * The deterministic fake language model.
 *
 * This is the default provider set (`GAPOS_PROVIDER_MODE=fake`), so the whole suite runs offline
 * and cannot spend money. It is a *contract fake*, not a stub: it returns real fixture content
 * that satisfies the same schemas a live provider must satisfy, and it can be scripted to
 * return faulty content so the verifier and repair loop are genuinely exercised.
 */

import {
  referenceCalibration,
  referenceDiagnostic,
  referenceLesson,
  referenceNormalisation,
  referencePlan,
  referenceVerification,
} from '@gapos/test-fixtures';
import type {
  LanguageModelBackend,
  RawCompletion,
  RawCompletionRequest,
} from '../language-model.js';

export type FakeHandler = (request: RawCompletionRequest) => unknown;

export type FakeScript = Partial<Record<string, FakeHandler>>;

export interface FakeLanguageModelOptions {
  /** Overrides for specific contracts. Anything unset falls back to the reference fixtures. */
  readonly script?: FakeScript;
  readonly model?: string;
  readonly costMillicentsPerCall?: number;
  /** Fails the first `failFirstNCalls` calls, to exercise retry behaviour. */
  readonly failFirstNCalls?: number;
  readonly latencyMs?: number;
}

const dayFromSubject = (subject: string | undefined): number => {
  const match = /(\d+)/.exec(subject ?? '');
  return match?.[1] ? Number(match[1]) : 1;
};

/** The default behaviour: coherent reference content for every contract in the pipeline. */
export const referenceScript = (): Required<Record<string, FakeHandler>> => ({
  gap_normalisation: () => referenceNormalisation(),
  // The Arc calibration (GAP-032) adapts on the baseline outcome, which is encoded in the
  // request subject: a correct baseline raises the starting point, a miss lowers it and adds a
  // gap. Still deterministic — the same subject always maps to the same interpretation.
  diagnostic_interpretation: (request) => {
    if (request.subject === 'skipped') return referenceDiagnostic({ inferred: true });
    if (request.subject?.startsWith('arc-baseline-correct')) {
      return referenceDiagnostic({
        demonstratedCapabilities: [
          'set-builder notation',
          'union and intersection',
          'loop accumulation',
        ],
        knowledgeGaps: ['double inclusion', 'relation properties', 'equivalence classes'],
        baselineConfidence: 0.9,
        recommendedStartingDifficulty: 3,
      });
    }
    if (request.subject?.startsWith('arc-baseline-wrong')) {
      return referenceDiagnostic({
        demonstratedCapabilities: ['set-builder notation'],
        knowledgeGaps: [
          'subset proofs',
          'double inclusion',
          'relation properties',
          'equivalence classes',
        ],
        baselineConfidence: 0.45,
        recommendedStartingDifficulty: 1,
      });
    }
    return referenceDiagnostic({});
  },
  curriculum_plan: (request) => referencePlan(request.subject ?? 'gap_reference'),
  lesson_package: (request) => referenceLesson(dayFromSubject(request.subject)),
  verification_report: (request) =>
    referenceVerification(request.subject ?? 'artefact', dayFromSubject(request.subject)),
  arc_calibration: (request) => referenceCalibration(request.subject ?? 'Python for data work'),
  repair_result: (request) => ({
    schemaVersion: '1.0.0',
    targetId: request.subject ?? 'artefact',
    repairedQuestions: [],
    repairedScript: 'Repaired script.',
    addressedFindings: ['Regenerated the failed artefact.'],
  }),
});

export class FakeProviderFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakeProviderFailure';
  }
}

export const createFakeLanguageModel = (
  options: FakeLanguageModelOptions = {},
): LanguageModelBackend & { readonly calls: readonly RawCompletionRequest[] } => {
  const defaults = referenceScript();
  const script = { ...defaults, ...(options.script ?? {}) };
  const calls: RawCompletionRequest[] = [];
  let failuresRemaining = options.failFirstNCalls ?? 0;

  return {
    name: 'fake',
    calls,

    async complete(request: RawCompletionRequest): Promise<RawCompletion> {
      calls.push(request);

      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new FakeProviderFailure(
          `Simulated provider failure for ${request.contractName} (${failuresRemaining} remaining)`,
        );
      }

      if (options.latencyMs) {
        await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
      }

      const handler = script[request.contractName];
      if (!handler) {
        throw new FakeProviderFailure(
          `The fake provider has no fixture for contract "${request.contractName}".`,
        );
      }

      return {
        json: handler(request),
        model: options.model ?? 'fake-large',
        inputTokens: Math.ceil((request.instruction.length + request.evidenceBlock.length) / 4),
        outputTokens: 400,
        costMillicents: options.costMillicentsPerCall ?? 1_000,
      };
    },
  };
};
