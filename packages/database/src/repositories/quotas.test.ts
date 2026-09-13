import { describe, expect, it } from 'vitest';
import { createMemoryRequestLimiter, type QuotaLimits } from './quotas.js';

const LIMITS: QuotaLimits = {
  upload: { limit: 2, windowMs: 60_000 },
  compile: { limit: 1, windowMs: 60_000 },
  proof: { limit: 3, windowMs: 60_000 },
};

describe('GAPX-04 request quotas', () => {
  it('admits at most the configured limit and isolates owners', async () => {
    const limiter = createMemoryRequestLimiter(LIMITS);
    const now = new Date('2026-09-13T12:00:00Z');

    await expect(limiter.admit('alice', 'compile', now)).resolves.toMatchObject({ admitted: true });
    await expect(limiter.admit('alice', 'compile', now)).resolves.toMatchObject({
      admitted: false,
      retryAfterSeconds: 60,
    });
    await expect(limiter.admit('bob', 'compile', now)).resolves.toMatchObject({ admitted: true });
  });

  it('resets at the window boundary', async () => {
    const limiter = createMemoryRequestLimiter(LIMITS);
    const start = new Date('2026-09-13T12:00:00Z');
    await limiter.admit('alice', 'upload', start);
    await limiter.admit('alice', 'upload', start);
    await expect(limiter.admit('alice', 'upload', start)).resolves.toMatchObject({
      admitted: false,
    });
    await expect(
      limiter.admit('alice', 'upload', new Date(start.getTime() + 60_000)),
    ).resolves.toMatchObject({ admitted: true });
  });

  it('counts a consumed attempt even when the caller later fails', async () => {
    const limiter = createMemoryRequestLimiter(LIMITS);
    const now = new Date('2026-09-13T12:00:00Z');
    const first = await limiter.admit('alice', 'compile', now);
    expect(first.admitted).toBe(true);
    // The downstream handler fails after admit(); the slot is already consumed.
    await expect(limiter.admit('alice', 'compile', now)).resolves.toMatchObject({
      admitted: false,
    });
  });
});
