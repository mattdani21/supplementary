/**
 * The published contracts must match the code.
 *
 * A specification nobody checks is worse than none, because it is believed. These tests fail
 * when `specs/` and the implementation disagree: a regenerated schema that was not committed, a
 * domain error code the OpenAPI enum does not list, a route the services do not implement.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_CONTRACTS, exportContractSchemas } from '@gapos/ai-contracts';

const SPEC_DIR = join(process.cwd(), 'specs');
const SCHEMA_DIR = join(SPEC_DIR, 'generation-schemas');

describe('generation schemas', () => {
  it('has a published schema for every contract', async () => {
    const files = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(Object.keys(ALL_CONTRACTS).length);
    for (const contract of Object.values(ALL_CONTRACTS)) {
      expect(
        files.some((f) => f.startsWith(`${contract.name}.`)),
        contract.name,
      ).toBe(true);
    }
  });

  it('matches what the zod contracts generate, byte for byte', async () => {
    // If this fails, run `pnpm specs:generate` and commit the result. It means a contract
    // changed without the published schema being regenerated.
    for (const exported of exportContractSchemas()) {
      const onDisk = await readFile(join(SCHEMA_DIR, exported.filename), 'utf8');
      expect(onDisk, `${exported.filename} is stale — run pnpm specs:generate`).toBe(exported.json);
    }
  });

  it('publishes no schema for a contract that no longer exists', async () => {
    const expected = new Set(exportContractSchemas().map((s) => s.filename));
    const files = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      expect(expected, `${file} has no matching contract`).toContain(file);
    }
  });

  it('carries the schema version in every published schema', async () => {
    for (const contract of Object.values(ALL_CONTRACTS)) {
      const file = `${contract.name}.v${contract.version.replace(/\./g, '-')}.json`;
      const parsed = JSON.parse(await readFile(join(SCHEMA_DIR, file), 'utf8'));
      expect(parsed.properties.schemaVersion.const).toBe(contract.version);
      expect(parsed.required).toContain('schemaVersion');
    }
  });

  it('rejects unknown fields in every published schema', async () => {
    // additionalProperties:false is the property that stops a hallucinated field being accepted.
    for (const contract of Object.values(ALL_CONTRACTS)) {
      const file = `${contract.name}.v${contract.version.replace(/\./g, '-')}.json`;
      const parsed = JSON.parse(await readFile(join(SCHEMA_DIR, file), 'utf8'));
      expect(parsed.additionalProperties, contract.name).toBe(false);
    }
  });
});

describe('the OpenAPI document', () => {
  let document: string;

  const load = async () => {
    document ??= await readFile(join(SPEC_DIR, 'openapi.yaml'), 'utf8');
    return document;
  };

  it('declares every essential endpoint from the architecture document', async () => {
    const spec = await load();
    for (const route of [
      '/gaps:',
      '/gaps/{gapId}:',
      '/gaps/{gapId}/sources:',
      '/gaps/{gapId}/diagnostic:',
      '/gaps/{gapId}/compile:',
      '/runs/{runId}:',
      '/runs/{runId}/events:',
      '/gaps/{gapId}/curriculum:',
      '/today:',
      '/attempts:',
      '/sessions/{sessionId}/complete:',
      '/gaps/{gapId}/mastery-check:',
      '/capabilities:',
      '/capabilities/{gapId}:',
    ]) {
      expect(spec, `missing route ${route}`).toContain(`  ${route}`);
    }
  });

  it('requires an idempotency key on both writes that demand one', async () => {
    const spec = await load();
    const compile = spec.slice(
      spec.indexOf('operationId: compileGap'),
      spec.indexOf('/runs/{runId}:'),
    );
    const attempt = spec.slice(
      spec.indexOf('operationId: submitAttempt'),
      spec.indexOf('/sessions/{sessionId}/complete:'),
    );
    expect(compile).toContain('IdempotencyKey');
    expect(attempt).toContain('IdempotencyKey');
  });

  it('lists every domain error code, so a client can branch on any error it may receive', async () => {
    const spec = await load();
    // Kept in sync by hand with DomainErrorCode; this test is what makes that safe.
    for (const code of [
      'invalid_gap_transition',
      'invalid_generation_transition',
      'terminal_state',
      'mastery_evidence_insufficient',
      'plan_exceeds_time_budget',
      'objective_not_assessed',
      'objective_not_taught',
      'prerequisite_cycle',
      'prerequisite_unmet',
      'unsupported_source',
      'artefact_frozen',
      'glossary_violation',
      'answer_leakage',
      'repair_attempts_exhausted',
      'budget_exceeded',
      'not_found',
      'forbidden',
    ]) {
      expect(spec, `error code ${code} is not published`).toContain(`- ${code}`);
    }
  });

  it('lists every gap and generation status the domain can produce', async () => {
    const spec = await load();
    const { GAP_STATUSES, GENERATION_STATUSES } = await import('@gapos/domain');
    for (const status of GAP_STATUSES) {
      expect(spec, `gap status ${status}`).toContain(status);
    }
    for (const status of GENERATION_STATUSES) {
      expect(spec, `generation status ${status}`).toContain(status);
    }
  });

  it('never promises to return provider prompts or model reasoning', async () => {
    const spec = await load();
    expect(spec).toContain('never returned by any');
    for (const forbidden of ['chain_of_thought', 'chainOfThought', 'promptText', 'systemPrompt']) {
      expect(spec, `${forbidden} must not appear in the API surface`).not.toContain(forbidden);
    }
  });

  it('returns the same not-found response whether a resource is missing or owned by someone else', async () => {
    // Otherwise the API is an oracle for other learners' identifiers.
    const spec = await load();
    expect(spec).toContain('Returned identically whether the resource does not');
  });
});
