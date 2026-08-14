/**
 * The deterministic fake language model.
 *
 * This is the default provider set (`GAPOS_PROVIDER_MODE=fake`), so the whole suite runs offline
 * and cannot spend money. It is a *contract fake*, not a stub: it returns real fixture content
 * that satisfies the same schemas a live provider must satisfy, and it can be scripted to
 * return faulty content so the verifier and repair loop are genuinely exercised.
 */

import {
  SET_THEORY_SECTIONS,
  claimAuditClean,
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
  diagnostic_interpretation: (request) =>
    referenceDiagnostic(request.subject === 'skipped' ? { inferred: true } : {}),
  curriculum_plan: (request) => referencePlan(request.subject ?? 'gap_reference'),
  lesson_package: (request) => referenceLesson(dayFromSubject(request.subject)),
  verification_report: (request) =>
    referenceVerification(request.subject ?? 'artefact', dayFromSubject(request.subject)),
  repair_result: (request) => ({
    schemaVersion: '1.0.0',
    targetId: request.subject ?? 'artefact',
    repairedQuestions: [],
    repairedScript: 'Repaired script.',
    addressedFindings: ['Regenerated the failed artefact.'],
  }),
  claim_audit: (request) => claimAuditClean(request.subject ?? 'artefact'),
});

export class FakeProviderFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakeProviderFailure';
  }
}

/** The `[source:… chunk:… at:…]` headers renderEvidenceEnvelope emits before each chunk. */
const EVIDENCE_HEADER = /\[source:(.+?) chunk:(.+?) at:(.+?)\]/g;

const normaliseKey = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();

interface EvidenceEntry {
  readonly sourceId: string;
  readonly chunkId: string;
  readonly locator: string;
}

/**
 * The fixture content cites evidence by placeholder ids (`src_set_theory_primer` / `chunk_2`,
 * meaning "the second section"). A competent model cites the chunks it was actually shown, so
 * the fake rewrites every locator in its response to the real evidence it was given:
 *
 *   1. exact id match (`sourceId::chunkId`), as a live model would;
 *   2. normalized locator match (`§2 Subsets…` → `§ 2. Subsets…`);
 *   3. the fixture convention `chunk_N` → the Nth section of the cited source (ordinal N−1),
 *      for locators too coarse to match on their own (`§2`).
 *
 * A locator that matches nothing is left untouched — a deliberately wrong citation in a faulty
 * fixture stays wrong, which is exactly what the traceability invariant must catch.
 */
const remapLocators = (value: unknown, evidenceBlock: string): unknown => {
  const entries: EvidenceEntry[] = [];
  for (const match of evidenceBlock.matchAll(EVIDENCE_HEADER)) {
    entries.push({
      sourceId: match[1]!.trim(),
      chunkId: match[2]!.trim(),
      locator: match[3]!.trim(),
    });
  }
  if (entries.length === 0) return value;

  const byId = new Map(entries.map((e) => [`${e.sourceId}::${e.chunkId}`, e]));
  const byLocator = new Map<string, EvidenceEntry>();
  for (const entry of entries) byLocator.set(normaliseKey(entry.locator), entry);

  const rewrite = (locator: { sourceId: string; chunkId: string; locator?: string }): void => {
    const exact = byId.get(`${locator.sourceId}::${locator.chunkId}`);
    if (exact) {
      locator.sourceId = exact.sourceId;
      locator.chunkId = exact.chunkId;
      return;
    }
    if (locator.locator) {
      const byLoc = byLocator.get(normaliseKey(locator.locator));
      if (byLoc) {
        locator.sourceId = byLoc.sourceId;
        locator.chunkId = byLoc.chunkId;
        return;
      }
    }
    const ordinal = /^chunk_(\d+)$/.exec(locator.chunkId);
    if (ordinal) {
      // The fixtures cite `chunk_N` for "the Nth section". The sourceId in a fixture is a
      // placeholder (`src_set_theory_primer`), so match on the chunk-id suffix alone — but
      // only when the envelope's Nth section is actually a primer section, so a citation is
      // never remapped onto a foreign document's section (e.g. the hostile chunk of the
      // injection fixture). Require exactly one candidate: a deliberately wrong citation
      // stays unresolved.
      const primerSections = new Set(SET_THEORY_SECTIONS.map(normaliseKey));
      const nthSection = entries.filter(
        (e) =>
          primerSections.has(normaliseKey(e.locator)) &&
          e.chunkId.endsWith(`_c${Number(ordinal[1]) - 1}`),
      );
      if (nthSection.length === 1) {
        locator.sourceId = nthSection[0]!.sourceId;
        locator.chunkId = nthSection[0]!.chunkId;
      }
    }
  };

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (
      typeof record.sourceId === 'string' &&
      typeof record.chunkId === 'string' &&
      typeof record.locator === 'string'
    ) {
      rewrite(record as unknown as { sourceId: string; chunkId: string; locator?: string });
    }
    for (const value of Object.values(record)) walk(value);
  };

  walk(value);
  return value;
};

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

      const json = remapLocators(handler(request), request.evidenceBlock);

      return {
        json,
        model: options.model ?? 'fake-large',
        inputTokens: Math.ceil((request.instruction.length + request.evidenceBlock.length) / 4),
        outputTokens: 400,
        costMillicents: options.costMillicentsPerCall ?? 1_000,
      };
    },
  };
};
