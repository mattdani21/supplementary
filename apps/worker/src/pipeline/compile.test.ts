import { describe, expect, it } from 'vitest';
import { LESSON_MAX_OUTPUT_TOKENS, PLAN_MAX_OUTPUT_TOKENS } from './compile.js';

describe('v4 output budget per reasoning effort (T050/T051/T052)', () => {
  it('caps plans at 16384 (medium reasoning effort) and gives lessons 32768 so high-effort reasoning + content fit', () => {
    // On the v4 architecture max_tokens is shared between the reasoning trace and the
    // content. The planner (plan_curriculum) is a reasoning task and runs at reasoning_effort
    // 'medium' (T052) — still small enough that 16384 fits a long plan. The lesson generator
    // runs at 'high', whose reasoning can consume the whole budget alone (observed live:
    // 'Live provider returned no message content'), so lessons get 32768 to fit both.
    expect(PLAN_MAX_OUTPUT_TOKENS).toBe(16384);
    expect(LESSON_MAX_OUTPUT_TOKENS).toBe(32768);
  });
});
