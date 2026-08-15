import { describe, expect, it } from 'vitest';
import { LESSON_MAX_OUTPUT_TOKENS, PLAN_MAX_OUTPUT_TOKENS } from './compile.js';

describe('v4 output budget (T050)', () => {
  it('gives plans and lessons 16384 max output tokens so v4 reasoning + content fit', () => {
    // On the v4 architecture max_tokens is shared between the reasoning trace and the
    // content, so 8192 could be exhausted by reasoning alone, leaving no content (observed
    // live: 'Live provider returned no message content'). 16384 fits both.
    expect(PLAN_MAX_OUTPUT_TOKENS).toBe(16384);
    expect(LESSON_MAX_OUTPUT_TOKENS).toBe(16384);
  });
});
