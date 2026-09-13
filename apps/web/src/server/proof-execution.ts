/**
 * Notebook execution capability (GAPX-03).
 *
 * Shared/public mode defaults to disabled. Local synthetic development may enable the existing
 * in-process executor; that is not a public isolation guarantee.
 */

export type ProofExecutionMode = 'disabled' | 'local';

export const proofExecutionFromEnv = (
  env: Record<string, string | undefined> = process.env,
  identityMode: 'demo' | 'protected' = 'demo',
): ProofExecutionMode => {
  if (env.GAPOS_PROOF_EXECUTION === 'local') return 'local';
  if (env.GAPOS_PROOF_EXECUTION === 'disabled') return 'disabled';
  return identityMode === 'protected' ? 'disabled' : 'local';
};

export class ProofExecutionUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'proof_execution_unavailable';

  constructor(message = 'Notebook proof execution is disabled on this deployment.') {
    super(message);
    this.name = 'ProofExecutionUnavailableError';
  }
}

export const assertProofExecutionEnabled = (mode: ProofExecutionMode): void => {
  if (mode === 'disabled') throw new ProofExecutionUnavailableError();
};
