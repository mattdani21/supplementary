/**
 * The gap lifecycle around a compilation, shared by the synchronous API path and the durable
 * worker path.
 *
 * The invariant from AGENTS.md §2.4: only server-side domain methods change `Gap.status`, and
 * the two state machines (gap, generation run) cannot disagree about what happened. Both paths
 * move the gap to `compiling` before the run starts and to `active`/`failed` from the run's
 * outcome — whether the run executes inline (API) or later (worker).
 */

import { transitionGap, type GapTransition } from '@gapos/domain';
import type { OwnerId, UnitOfWork } from '@gapos/database';
import type { CompileOutcome } from './compile.js';

/**
 * Move the gap into `compiling` (or allow a retry of a failed one). No-op for statuses that are
 * already compiling or past it. Returns the gap's status afterwards, or undefined if missing.
 */
export const beginCompilation = async (
  uow: UnitOfWork,
  owner: OwnerId,
  gapId: string,
): Promise<string | undefined> => {
  const gap = await uow.gaps.get(owner, gapId);
  if (!gap) return undefined;

  if (gap.status === 'ready' || gap.status === 'active' || gap.status === 'failed') {
    const transition: GapTransition =
      gap.status === 'failed' ? { type: 'retry_compilation' } : { type: 'compile' };
    const result = transitionGap(gap.status, transition);
    if (result.ok) {
      await uow.gaps.setStatus(owner, gapId, result.value, gap.status);
    }
  }

  return (await uow.gaps.get(owner, gapId))?.status;
};

/** Apply the run's outcome to the gap: `compiling` → `active` or `failed`. */
export const finishCompilation = async (
  uow: UnitOfWork,
  owner: OwnerId,
  gapId: string,
  outcome: CompileOutcome,
): Promise<void> => {
  if (outcome.deduplicated) return;

  const current = await uow.gaps.get(owner, gapId);
  if (current?.status !== 'compiling') return;

  const transition: GapTransition =
    outcome.status === 'failed'
      ? { type: 'compilation_failed', reason: outcome.error ?? 'unknown' }
      : { type: 'compilation_succeeded' };
  const result = transitionGap(current.status, transition);
  if (result.ok) {
    await uow.gaps.setStatus(owner, gapId, result.value, current.status);
  }
};
