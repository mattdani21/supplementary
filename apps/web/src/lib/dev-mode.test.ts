/**
 * GAP-088 (E27 adversarial UX): developer surfaces — the owner switcher and the review
 * queue — are hidden from learners by default. They render only on an explicit dev
 * signal: GAPOS_DEV_MODE=1 at the deployment level, or a ?dev=1 search param for
 * one-off local inspection. The helper is pure and injectable so the page render tests
 * (screens.test.tsx) and these unit tests can assert both states hermetically.
 */

import { describe, expect, it } from 'vitest';
import { isDevMode } from './dev-mode';

describe('isDevMode (GAP-088, E27)', () => {
  it('is false under the default environment — no env flag, no dev param', () => {
    expect(isDevMode(undefined, undefined)).toBe(false);
    expect(isDevMode('', undefined)).toBe(false);
    expect(isDevMode(undefined, '')).toBe(false);
    expect(isDevMode(undefined, '0')).toBe(false);
    expect(isDevMode('0', '0')).toBe(false);
  });

  it('is true when GAPOS_DEV_MODE is exactly "1"', () => {
    expect(isDevMode('1', undefined)).toBe(true);
    expect(isDevMode('1', '0')).toBe(true);
  });

  it('is true when the dev search param is "1" (string or array form)', () => {
    expect(isDevMode(undefined, '1')).toBe(true);
    expect(isDevMode(undefined, ['1'])).toBe(true);
    expect(isDevMode(undefined, ['0', '1'])).toBe(true);
  });

  it('is false for any other param value', () => {
    expect(isDevMode(undefined, 'true')).toBe(false);
    expect(isDevMode(undefined, ['0'])).toBe(false);
  });
});
