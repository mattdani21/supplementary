import { describe, expect, it } from 'vitest';
import {
  CostAccountant,
  centsToMillicents,
  createLogger,
  createMemorySink,
  createMetrics,
  redact,
  type UsageRecord,
} from './index.js';

describe('logger redaction', () => {
  it('redacts fields that could carry user content or credentials', () => {
    const out = redact({
      runId: 'run_1',
      prompt: 'the whole instruction',
      transcript: 'lesson text',
      apiKey: 'sk-live-123',
      Authorization: 'Bearer x',
      rawStatement: 'I need relations by Friday',
      day: 1,
    });
    expect(out).toEqual({
      runId: 'run_1',
      prompt: '[redacted]',
      transcript: '[redacted]',
      apiKey: '[redacted]',
      Authorization: '[redacted]',
      rawStatement: '[redacted]',
      day: 1,
    });
  });

  it('redacts nested content', () => {
    expect(redact({ meta: { model: 'x', prompt: 'secret' } })).toEqual({
      meta: { model: 'x', prompt: '[redacted]' },
    });
  });

  it('carries child context into every record', () => {
    const { records, sink } = createMemorySink();
    const logger = createLogger({ runId: 'run_1' }, { sink }).child({ step: 'planning' });
    logger.info('planned', { objectives: 4 });
    expect(records).toHaveLength(1);
    expect(records[0]?.fields).toMatchObject({ runId: 'run_1', step: 'planning', objectives: 4 });
  });

  it('drops records below the configured level', () => {
    const { records, sink } = createMemorySink();
    createLogger({}, { sink, level: 'warn' }).info('noise');
    expect(records).toEqual([]);
  });
});

describe('cost accounting', () => {
  const usage = (over: Partial<UsageRecord> = {}): UsageRecord => ({
    runId: 'run_1',
    userId: 'user_1',
    purpose: 'teaching',
    provider: 'fake',
    model: 'fake-large',
    inputTokens: 1000,
    outputTokens: 500,
    audioCharacters: 0,
    costMillicents: centsToMillicents(10),
    durationMs: 900,
    promptVersionHash: 'abc123',
    at: new Date('2026-08-02T10:00:00Z'),
    ...over,
  });

  it('authorises a call that fits inside the run budget', () => {
    const accountant = new CostAccountant();
    const decision = accountant.authorise({
      runId: 'run_1',
      userId: 'user_1',
      estimateMillicents: centsToMillicents(50),
    });
    expect(decision.allowed).toBe(true);
  });

  it('refuses a call before it is made when it would exceed the run ceiling', () => {
    const accountant = new CostAccountant();
    accountant.record(usage({ costMillicents: centsToMillicents(190) }));
    const decision = accountant.authorise({
      runId: 'run_1',
      userId: 'user_1',
      estimateMillicents: centsToMillicents(20),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.scope).toBe('run');
  });

  it('refuses on the daily user ceiling even when the run itself has room', () => {
    const accountant = new CostAccountant();
    // Spread across many runs so no single run exceeds its own ceiling.
    for (let i = 0; i < 10; i++) {
      accountant.record(usage({ runId: `run_${i}`, costMillicents: centsToMillicents(99) }));
    }
    const decision = accountant.authorise({
      runId: 'run_new',
      userId: 'user_1',
      estimateMillicents: centsToMillicents(50),
      now: new Date('2026-08-02T23:00:00Z'),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.scope).toBe('user_daily');
  });

  it("does not carry yesterday's spend into today", () => {
    const accountant = new CostAccountant();
    for (let i = 0; i < 10; i++) {
      accountant.record(
        usage({
          runId: `run_${i}`,
          costMillicents: centsToMillicents(99),
          at: new Date('2026-08-01T10:00:00Z'),
        }),
      );
    }
    const decision = accountant.authorise({
      runId: 'run_new',
      userId: 'user_1',
      estimateMillicents: centsToMillicents(50),
      now: new Date('2026-08-02T10:00:00Z'),
    });
    expect(decision.allowed).toBe(true);
  });

  it("keeps one user's spend away from another's budget", () => {
    const accountant = new CostAccountant();
    for (let i = 0; i < 10; i++) {
      accountant.record(
        usage({ runId: `run_${i}`, userId: 'user_1', costMillicents: centsToMillicents(99) }),
      );
    }
    const decision = accountant.authorise({
      runId: 'run_other',
      userId: 'user_2',
      estimateMillicents: centsToMillicents(50),
      now: new Date('2026-08-02T10:00:00Z'),
    });
    expect(decision.allowed).toBe(true);
  });

  it('attributes cost by pipeline purpose', () => {
    const accountant = new CostAccountant();
    accountant.record(usage({ purpose: 'planning', costMillicents: 5000 }));
    accountant.record(usage({ purpose: 'teaching', costMillicents: 12000 }));
    accountant.record(usage({ purpose: 'verification', costMillicents: 8000 }));
    expect(accountant.costByPurpose('run_1')).toEqual({
      classification: 0,
      planning: 5000,
      teaching: 12000,
      verification: 8000,
      speech: 0,
      retrieval: 0,
    });
  });

  it('avoids floating-point drift across many small calls', () => {
    const accountant = new CostAccountant();
    for (let i = 0; i < 300; i++) {
      accountant.record(usage({ costMillicents: centsToMillicents(0.001) }));
    }
    expect(accountant.spentForRun('run_1')).toBe(300);
  });
});

describe('metrics', () => {
  it('sums a counter by label', () => {
    const metrics = createMetrics();
    metrics.increment('attempt_total', { objectiveId: 'o1' });
    metrics.increment('attempt_total', { objectiveId: 'o1' });
    metrics.increment('attempt_total', { objectiveId: 'o2' });
    expect(metrics.sum('attempt_total', { objectiveId: 'o1' })).toBe(2);
    expect(metrics.sum('attempt_total')).toBe(3);
  });

  it('records a stage duration even when the stage throws', async () => {
    const metrics = createMetrics();
    await expect(
      metrics.time('compilation_stage_duration_ms', { step: 'planning' }, async () => {
        throw new Error('provider down');
      }),
    ).rejects.toThrow('provider down');
    expect(metrics.points.some((p) => p.name === 'compilation_stage_duration_ms')).toBe(true);
  });
});
