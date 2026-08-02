/**
 * The AI provider boundary (ADR 0003).
 *
 * Everything the system asks a model for goes through these three interfaces. Application and
 * worker code may not import a provider SDK; lint enforces it, and `tests/architecture` proves
 * the lint rule works.
 *
 * A structured request is a *contract request*: it names the schema the response must satisfy.
 * The adapter validates before returning, so nothing downstream ever handles unvalidated output.
 */

import type { Contract, EvidenceItem } from '@gapos/ai-contracts';
import type { CallPurpose, Millicents } from '@gapos/observability';

export interface StructuredRequest<T> {
  readonly contract: Contract<T>;
  /**
   * What the model must do. This is authored by us and never contains learner or source text —
   * that goes in `evidence`, inside the envelope.
   */
  readonly instruction: string;
  readonly evidence?: readonly EvidenceItem[];
  /** Routes to a cheap or a strong model. See docs/OPERATIONS.md cost controls. */
  readonly purpose: CallPurpose;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
  /** Correlates the call with a run for cost accounting and the generation log. */
  readonly runId: string;
  readonly userId: string;
  /**
   * Distinguishes concurrent calls of the same kind within a run (day number, artefact id).
   * The fake provider uses it to pick a fixture, so parallel generation stays deterministic.
   */
  readonly subject?: string;
}

export interface StructuredResponse<T> {
  readonly value: T;
  readonly model: string;
  readonly provider: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMillicents: Millicents;
  readonly durationMs: number;
  readonly promptVersionHash: string;
  /** Injection attempts spotted in the evidence, surfaced as findings rather than obeyed. */
  readonly injectionSignals: readonly { chunkId: string; excerpt: string }[];
}

export interface LanguageModel {
  readonly name: string;
  generate<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export interface TranscriptionRequest {
  readonly audio: Uint8Array;
  readonly mediaType: string;
  readonly locale: string;
  readonly runId: string;
  readonly userId: string;
}

export interface TranscriptionResponse {
  readonly text: string;
  readonly durationMs: number;
  readonly costMillicents: Millicents;
}

export interface SpeechToText {
  readonly name: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResponse>;
}

export interface SynthesisRequest {
  /** One stable segment of a lesson script. Segments are synthesised in parallel. */
  readonly text: string;
  readonly segmentId: string;
  readonly voice: string;
  readonly locale: string;
  readonly runId: string;
  readonly userId: string;
}

export interface SynthesisResponse {
  readonly audio: Uint8Array;
  readonly mediaType: string;
  readonly durationSeconds: number;
  /** Verified against the transcript before publication. */
  readonly checksum: string;
  readonly characters: number;
  readonly costMillicents: Millicents;
}

export interface TextToSpeech {
  readonly name: string;
  synthesise(request: SynthesisRequest): Promise<SynthesisResponse>;
}

export interface Providers {
  readonly languageModel: LanguageModel;
  readonly speechToText: SpeechToText;
  readonly textToSpeech: TextToSpeech;
  readonly mode: ProviderMode;
}

export const PROVIDER_MODES = ['fake', 'live'] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];

/** Raised when a provider returns something its contract does not accept. */
export class ProviderContractError extends Error {
  constructor(
    readonly contractName: string,
    readonly contractVersion: string,
    readonly issues: readonly string[],
  ) {
    super(
      `Provider response failed contract ${contractName}@${contractVersion}: ${issues.join('; ')}`,
    );
    this.name = 'ProviderContractError';
  }
}

export class ProviderBudgetError extends Error {
  constructor(
    readonly scope: 'run' | 'user_daily',
    readonly spent: Millicents,
    readonly limit: Millicents,
  ) {
    super(`Refused: the ${scope} budget of ${limit} millicents is spent (${spent}).`);
    this.name = 'ProviderBudgetError';
  }
}
