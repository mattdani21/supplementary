/**
 * The architectural constraints in AGENTS.md are only real if they fail the build.
 *
 * These tests lint synthetic files through the repository's own ESLint configuration, so they
 * verify the rules that will actually run in CI rather than restating them.
 */

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

const lint = async (filePath: string, code: string) => {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
};

const messagesFor = (messages: { ruleId: string | null; message: string }[], ruleId: string) =>
  messages.filter((m) => m.ruleId === ruleId).map((m) => m.message);

describe('domain purity', () => {
  it('rejects a web framework import in the domain package', async () => {
    const messages = await lint(
      'packages/domain/src/gap/illegal.ts',
      `import { NextResponse } from 'next/server';\nexport const x = NextResponse;\n`,
    );
    expect(messagesFor(messages, 'no-restricted-imports')).toContainEqual(
      expect.stringContaining('Domain must not import web framework code'),
    );
  });

  it('rejects a React import in the domain package', async () => {
    const messages = await lint(
      'packages/domain/src/gap/illegal.ts',
      `import { useState } from 'react';\nexport const x = useState;\n`,
    );
    expect(messagesFor(messages, 'no-restricted-imports').length).toBeGreaterThan(0);
  });

  it('rejects a persistence import in the domain package', async () => {
    const messages = await lint(
      'packages/domain/src/gap/illegal.ts',
      `import { Pool } from 'pg';\nexport const x = Pool;\n`,
    );
    expect(messagesFor(messages, 'no-restricted-imports')).toContainEqual(
      expect.stringContaining('Domain must not talk to infrastructure directly'),
    );
  });

  it('rejects an adapter import in the domain package', async () => {
    const messages = await lint(
      'packages/domain/src/gap/illegal.ts',
      `import { createLanguageModel } from '@gapos/provider-adapters';\nexport const x = createLanguageModel;\n`,
    );
    expect(messagesFor(messages, 'no-restricted-imports')).toContainEqual(
      expect.stringContaining('Domain must not depend on adapters or persistence'),
    );
  });

  it('allows an ordinary intra-domain import', async () => {
    const messages = await lint(
      'packages/domain/src/gap/legal.ts',
      `import { ok } from '../errors.js';\nexport const x = ok;\n`,
    );
    expect(messagesFor(messages, 'no-restricted-imports')).toEqual([]);
  });
});

describe('provider boundary', () => {
  it('rejects a direct provider SDK import from application code', async () => {
    const messages = await lint(
      'apps/worker/src/illegal.ts',
      `import OpenAI from 'openai';\nexport const x = OpenAI;\n`,
    );
    expect(messagesFor(messages, 'no-restricted-imports')).toContainEqual(
      expect.stringContaining('must not call AI providers directly'),
    );
  });

  it('allows application code to use the adapter package', async () => {
    const messages = await lint(
      'apps/worker/src/legal.ts',
      `import { createProviders } from '@gapos/provider-adapters';\nexport const x = createProviders;\n`,
    );
    expect(messagesFor(messages, 'no-restricted-imports')).toEqual([]);
  });
});
