/**
 * Speech normalisation (E26, Kokoro math-reading fix): the exact symbol failures the
 * user heard on Day 1/2 — a^2 read as "a two", "/" read as "slash".
 */

import { describe, expect, it } from 'vitest';
import { normaliseForSpeech } from './normalise-for-speech';

describe('normaliseForSpeech', () => {
  it('reads a^2 as "a squared"', () => {
    expect(normaliseForSpeech('the variance a^2')).toContain('a squared');
  });

  it('reads a^3 as "a cubed"', () => {
    expect(normaliseForSpeech('volume a^3')).toContain('a cubed');
  });

  it('reads a^n as "a to the power of n"', () => {
    expect(normaliseForSpeech('x^n grows')).toContain('x to the power of n');
  });

  it('reads braced superscripts a^(n+1) correctly', () => {
    expect(normaliseForSpeech('size 2^(n+1)')).toContain('2 to the power of n+1');
  });

  it('reads a fraction slash as "over", not "slash"', () => {
    expect(normaliseForSpeech('1/2 of the data')).toContain('1 over 2');
    expect(normaliseForSpeech('1/2 of the data')).not.toContain('slash');
  });

  it('preserves "and/or" instead of turning it into a fraction', () => {
    const out = normaliseForSpeech('a and/or b');
    expect(out).toContain('and or');
    expect(out).not.toContain('/');
  });

  it('reads multiplication and minus symbols', () => {
    expect(normaliseForSpeech('2 × 3')).toContain('2 times 3');
    expect(normaliseForSpeech('x − 1')).toContain('x minus 1');
  });

  it('reads comparisons and set notation', () => {
    expect(normaliseForSpeech('x ≤ 5')).toContain('x at most 5');
    expect(normaliseForSpeech('x ≥ 5')).toContain('x at least 5');
    expect(normaliseForSpeech('a ≠ b')).toContain('a does not equal b');
    expect(normaliseForSpeech('x ∈ A')).toContain('x in A');
    expect(normaliseForSpeech('A ⊆ B')).toContain('A is a subset of B');
  });

  it('reads square roots', () => {
    expect(normaliseForSpeech('√d_k')).toContain('the square root of d');
  });

  it('names Greek letters', () => {
    expect(normaliseForSpeech('angle θ')).toContain('angle theta');
    expect(normaliseForSpeech('Σ x_i')).toContain('sum x_i');
  });

  it('leaves plain prose untouched', () => {
    const prose = 'Welcome to Day 1 of our deep dive into modern attention mechanisms.';
    expect(normaliseForSpeech(prose)).toBe(prose);
  });
});
