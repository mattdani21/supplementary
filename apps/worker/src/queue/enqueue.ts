/**
 * The durable compile request (GAP-015).
 *
 * The synchronous API path runs the pipeline inline. This is the durable alternative: move the
 * gap into `compiling` now, park the compile parameters in the job queue, and let the worker run
 * the pipeline — so a restart cannot lose the request, and a second request with the same
 * idempotency key cannot start a second run.
 */

import type { Job, JobQueue, OwnerId, UnitOfWork } from '@gapos/database';
import { beginCompilation } from '../pipeline/lifecycle.js';

export interface EnqueueCompileInput {
  readonly gapId: string;
  readonly idempotencyKey: string;
  readonly audioEnabled?: boolean;
  readonly concurrency?: number;
  readonly maxAttempts?: number;
}

export const enqueueCompile = async (
  deps: {
    readonly uow: UnitOfWork;
    readonly queue: JobQueue;
    readonly now: () => Date;
    readonly newId: (prefix: string) => string;
  },
  owner: OwnerId,
  input: EnqueueCompileInput,
): Promise<Job> => {
  const gap = await deps.uow.gaps.get(owner, input.gapId);
  if (!gap) throw new Error(`Gap ${input.gapId} was not found for this owner.`);

  await beginCompilation(deps.uow, owner, input.gapId);

  return deps.queue.enqueue(
    owner,
    {
      id: deps.newId('job'),
      kind: 'compile',
      payload: {
        gapId: input.gapId,
        idempotencyKey: input.idempotencyKey,
        ...(input.audioEnabled === undefined ? {} : { audioEnabled: input.audioEnabled }),
        ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
      },
      maxAttempts: input.maxAttempts ?? 3,
    },
    deps.now(),
  );
};
