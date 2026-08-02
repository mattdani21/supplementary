/**
 * Idempotent step execution.
 *
 * Every unit of pipeline work goes through `runStep`. It is the single place that decides whether
 * to do the work or hand back what a previous attempt already produced, which is what makes a
 * worker restart safe: killing the process mid-run and starting again re-enters the same steps
 * and finds their outputs, so no lesson, no audio and no provider charge is duplicated.
 */

import { decideStep, stepKey, type GenerationStepName, type StepRecord } from '@gapos/domain';
import type { GenerationRepository, OwnerId } from '@gapos/database';
import type { Logger, Metrics } from '@gapos/observability';

export interface StepContext {
  readonly owner: OwnerId;
  readonly runId: string;
  readonly generation: GenerationRepository;
  readonly logger: Logger;
  readonly metrics: Metrics;
}

export class StepAbandoned extends Error {
  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`Step ${key} abandoned: ${reason}`);
    this.name = 'StepAbandoned';
  }
}

export interface StepDescriptor {
  readonly step: GenerationStepName;
  readonly subject?: string;
  /** A hash of everything the step consumes. Changing the inputs legitimately re-runs the step. */
  readonly inputVersion: string;
}

export const runStep = async <T>(
  context: StepContext,
  descriptor: StepDescriptor,
  work: () => Promise<T>,
): Promise<T> => {
  const key = stepKey({
    runId: context.runId,
    step: descriptor.step,
    ...(descriptor.subject === undefined ? {} : { subject: descriptor.subject }),
    inputVersion: descriptor.inputVersion,
  });

  const existing = await context.generation.getStep(context.owner, key);
  const decision = decideStep(existing as StepRecord<T> | undefined);

  if (decision.action === 'reuse') {
    context.logger.info('Reusing a completed step', { step: descriptor.step, key });
    return decision.output;
  }

  if (decision.action === 'abandon') {
    throw new StepAbandoned(key, decision.reason);
  }

  await context.generation.upsertStep(context.owner, {
    key,
    runId: context.runId,
    ownerId: context.owner,
    step: descriptor.step,
    ...(descriptor.subject === undefined ? {} : { subject: descriptor.subject }),
    inputVersion: descriptor.inputVersion,
    state: 'running',
    attempt: decision.attempt,
  });

  const started = Date.now();
  try {
    const output = await work();
    await context.generation.upsertStep(context.owner, {
      key,
      runId: context.runId,
      ownerId: context.owner,
      step: descriptor.step,
      ...(descriptor.subject === undefined ? {} : { subject: descriptor.subject }),
      inputVersion: descriptor.inputVersion,
      state: 'succeeded',
      attempt: decision.attempt,
      output,
    });
    context.metrics.observe('compilation_stage_duration_ms', Date.now() - started, {
      step: descriptor.step,
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await context.generation.upsertStep(context.owner, {
      key,
      runId: context.runId,
      ownerId: context.owner,
      step: descriptor.step,
      ...(descriptor.subject === undefined ? {} : { subject: descriptor.subject }),
      inputVersion: descriptor.inputVersion,
      state: 'failed',
      attempt: decision.attempt,
      error: message,
    });
    context.metrics.observe('compilation_stage_duration_ms', Date.now() - started, {
      step: descriptor.step,
      outcome: 'failed',
    });
    context.logger.error('Step failed', { step: descriptor.step, key, error: message });
    throw error;
  }
};

/**
 * Run tasks with bounded concurrency, preserving start order.
 *
 * Start order matters: Day 1 must begin before Day 2 so it can publish first. Unbounded
 * Promise.all would also fan out seven simultaneous provider calls, which is how a rate limit
 * turns a nine-minute compile into a failed one.
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;

  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
};
