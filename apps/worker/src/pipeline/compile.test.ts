import { describe, expect, it } from 'vitest';
import { LESSON_MAX_OUTPUT_TOKENS, PLAN_MAX_OUTPUT_TOKENS } from './compile.js';

describe('v4 output budget per reasoning effort (T050/T051)', () => {
  it('caps plans at 16384 (low reasoning effort) and gives lessons 32768 so high-effort reasoning + content fit', () => {
    // On the v4 architecture max_tokens is shared between the reasoning trace and the
    // content. The contract-first steps run at reasoning_effort 'low' — their direct,
    // compliant output needs little reasoning — so 16384 still fits a long plan. The lesson
    // generator runs at 'high', whose reasoning can consume the whole budget alone (observed
    // live: 'Live provider returned no message content'), so lessons get 32768 to fit both.
    expect(PLAN_MAX_OUTPUT_TOKENS).toBe(16384);
    expect(LESSON_MAX_OUTPUT_TOKENS).toBe(32768);
  });
});
