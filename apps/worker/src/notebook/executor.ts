/**
 * The notebook proof sandbox (GAP-032).
 *
 * A proof cell is learner-authored code executed server-side. The sandbox contract:
 *
 *   - a fresh V8 realm per run (`vm.createContext`), so no host object — `require`, `process`,
 *     host globals — is reachable from inside the cell. The context is created with no
 *     properties at all, so even the intrinsic objects the cell sees are the realm's own;
 *   - hard caps: cell length, per-script wall-clock timeout, output size;
 *   - checks are boolean expressions evaluated in the same realm after the cell, so the learner
 *     cannot fake a pass by returning a string — the expression itself executes their code.
 *
 * Correctness is decided by execution, never by inspecting source text: the reference solution
 * is validated the same way by the independent verifier at generation time (GAP-010).
 */

import vm from 'node:vm';

export interface CellCheck {
  readonly name: string;
  readonly expression: string;
}

export interface CellExecution {
  /** The completion value of the cell (like a notebook REPL), or the failure description. */
  readonly output: string;
  /** True only when every declared check ran and evaluated truthy. */
  readonly passed: boolean;
  /** The checks that failed, named; empty when the cell itself errored. */
  readonly failures: readonly string[];
  readonly error?: string;
}

export const MAX_CELL_LENGTH = 16_000;
export const CELL_TIMEOUT_MS = 1_000;
export const CHECK_TIMEOUT_MS = 500;
export const MAX_OUTPUT_LENGTH = 4_000;

const truncate = (value: unknown): string => {
  let text: string;
  if (value === undefined) return '';
  if (typeof value === 'string') text = value;
  else if (typeof value === 'bigint') text = `${value}n`;
  else if (typeof value === 'object' && value !== null) {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  } else text = String(value);
  return text.length > MAX_OUTPUT_LENGTH
    ? `${text.slice(0, MAX_OUTPUT_LENGTH)}\n… (truncated)`
    : text;
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return 'The cell timed out. Keep the work small — a proof should run in well under a second.';
    }
    return error.message;
  }
  return String(error);
};

/**
 * Execute a notebook cell and its checks in a fresh, object-free realm.
 *
 * The completion value of the script becomes the cell's output, which is what makes a notebook
 * read like a notebook: `double(4)` as the last line prints `8`.
 */
export const runCell = (code: string, checks: readonly CellCheck[]): CellExecution => {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return {
      output: '',
      passed: false,
      failures: [],
      error: 'The cell is empty — write some code first.',
    };
  }
  if (trimmed.length > MAX_CELL_LENGTH) {
    return {
      output: '',
      passed: false,
      failures: [],
      error: `The cell is too long (${trimmed.length} characters; the limit is ${MAX_CELL_LENGTH}).`,
    };
  }

  // No properties, no prototype: the realm sees its own intrinsics and nothing from the host.
  const context = vm.createContext(Object.create(null));

  let completion: unknown;
  try {
    completion = new vm.Script(trimmed, { filename: 'cell.js' }).runInContext(context, {
      timeout: CELL_TIMEOUT_MS,
    });
  } catch (error) {
    const message = describeError(error);
    return { output: message, passed: false, failures: [], error: message };
  }

  const failures: string[] = [];
  for (const check of checks) {
    try {
      const value = new vm.Script(check.expression, {
        filename: `check:${check.name}.js`,
      }).runInContext(context, { timeout: CHECK_TIMEOUT_MS });
      if (!value) failures.push(check.name);
    } catch (error) {
      failures.push(`${check.name} (${describeError(error)})`);
    }
  }

  return {
    output: truncate(completion),
    passed: failures.length === 0,
    failures,
    ...(failures.length > 0 ? { error: 'One or more checks did not pass.' } : {}),
  };
};
