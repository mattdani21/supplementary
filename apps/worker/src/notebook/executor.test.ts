/**
 * The notebook sandbox (GAP-032).
 *
 * The acceptance criterion is real server-side execution: correctness is decided by running the
 * learner's code and evaluating check expressions in the same realm — never by inspecting the
 * source text. The sandbox must also be a sandbox: no host globals, no runaway loops, no
 * unbounded cells or output.
 */

import { describe, expect, it } from 'vitest';
import { MAX_CELL_LENGTH, runCell } from './executor.js';

describe('real execution', () => {
  it('executes the cell and reports the completion value as output', () => {
    const executed = runCell('const total = 2 + 6;\ntotal', []);
    expect(executed.passed).toBe(true);
    expect(executed.output).toBe('8');
  });

  it('passes only when every check expression evaluates truthy in the cell realm', () => {
    const code = 'function double(number) {\n  return number * 2;\n}';
    const executed = runCell(code, [
      { name: 'doubles four', expression: 'double(4) === 8' },
      { name: 'keeps negatives', expression: 'double(-1) === -2' },
    ]);
    expect(executed.passed).toBe(true);
    expect(executed.failures).toEqual([]);
  });

  it('fails a check when the code is wrong, without looking at the source', () => {
    const executed = runCell('function double(number) {\n  return number + 2;\n}', [
      { name: 'doubles four', expression: 'double(4) === 8' },
    ]);
    expect(executed.passed).toBe(false);
    expect(executed.failures).toEqual(['doubles four']);
    expect(executed.error).toBeDefined();
  });

  it('names a check that throws while evaluating it', () => {
    const executed = runCell('function double(number) {\n  return number * 2;\n}', [
      { name: 'doubles four', expression: 'double(4) === 8' },
      { name: 'calls missing helper', expression: 'missingHelper()' },
    ]);
    expect(executed.passed).toBe(false);
    expect(executed.failures[0]).toContain('calls missing helper');
  });

  it('reports syntax and runtime errors supportively', () => {
    const syntax = runCell('function broken( {', []);
    expect(syntax.passed).toBe(false);
    expect(syntax.error).toBeDefined();

    const runtime = runCell('throw new Error("boom")', []);
    expect(runtime.passed).toBe(false);
    expect(runtime.error).toContain('boom');
  });

  it('treats an empty or oversized cell as a supportive failure', () => {
    expect(runCell('   ', []).error).toContain('empty');
    const huge = runCell('const x = 1;'.repeat(MAX_CELL_LENGTH), []);
    expect(huge.passed).toBe(false);
    expect(huge.error).toContain('too long');
  });

  it('truncates a pathological output instead of shipping it to the browser', () => {
    const executed = runCell('"x".repeat(100000)', []);
    expect(executed.output.length).toBeLessThan(5_000);
    expect(executed.output).toContain('truncated');
  });
});

describe('the sandbox', () => {
  it('hides host globals from the cell', () => {
    expect(runCell('typeof require', []).output).toBe('undefined');
    expect(runCell('typeof process', []).output).toBe('undefined');
    expect(runCell('typeof globalThis.process', []).output).toBe('undefined');
  });

  it('refuses the classic constructor escape', () => {
    const executed = runCell("({}).constructor.constructor('return process')()", []);
    expect(executed.passed).toBe(false);
    expect(executed.error).toBeDefined();
  });

  it('kills an infinite loop instead of hanging the server', () => {
    const executed = runCell('while (true) {}', []);
    expect(executed.passed).toBe(false);
    expect(executed.error).toContain('timed out');
  });

  it('gives each run a fresh realm, so one cell cannot leak into the next', () => {
    runCell('const secret = 42', []);
    const next = runCell('typeof secret', []);
    expect(next.output).toBe('undefined');
  });
});
