/**
 * The server context.
 *
 * One place that assembles repositories, storage, providers, metrics and the clock. Everything
 * downstream takes its dependencies as arguments, so a test builds a context with fakes and a
 * deterministic clock and exercises exactly the code that runs in production.
 */

import { randomUUID } from 'node:crypto';
import {
  createMemoryJobQueue,
  createMemoryObjectStore,
  createMemoryUnitOfWork,
  type JobQueue,
  type ObjectStore,
  type UnitOfWork,
} from '@gapos/database';
import {
  CostAccountant,
  createLogger,
  createMetrics,
  type Budget,
  type Logger,
  type MetricsRecorder,
} from '@gapos/observability';
import {
  createProviders,
  type FakeLanguageModelOptions,
  type Providers,
} from '@gapos/provider-adapters';

export interface ServerContext {
  readonly uow: UnitOfWork;
  readonly storage: ObjectStore;
  readonly queue: JobQueue;
  readonly providers: Providers;
  readonly metrics: MetricsRecorder;
  readonly costAccountant: CostAccountant;
  readonly logger: Logger;
  readonly now: () => Date;
  readonly newId: (prefix: string) => string;
}

export interface ContextOptions {
  readonly now?: () => Date;
  readonly newId?: (prefix: string) => string;
  readonly budget?: Budget;
  readonly fake?: FakeLanguageModelOptions;
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /**
   * Providers. Defaults to the deterministic fakes via the all-or-nothing factory.
   *
   * Injectable so the evaluation harness (GAP-014b) can assemble a live language model and
   * live text-to-speech without the factory, which refuses partial sets: a provider set here
   * is an explicit assembly, never a silent fallback.
   */
  readonly providers?: Providers;
  /**
   * Persistence. Defaults to the in-memory implementations.
   *
   * Injectable so the same application code can be exercised against Postgres — an end-to-end
   * journey that only ever runs on memory proves the SQL implementation compiles, not that the
   * product works on it.
   */
  readonly uow?: UnitOfWork;
  readonly storage?: ObjectStore;
  /** Durable job queue. Defaults to the in-memory queue; the worker uses the Postgres one. */
  readonly queue?: JobQueue;
}

export const createServerContext = (options: ContextOptions = {}): ServerContext => {
  const costAccountant = new CostAccountant(options.budget);
  const metrics = createMetrics();
  const logger = createLogger({}, { level: options.logLevel ?? 'warn' });

  return {
    uow: options.uow ?? createMemoryUnitOfWork(),
    storage: options.storage ?? createMemoryObjectStore(options.now),
    queue: options.queue ?? createMemoryJobQueue(),
    providers:
      options.providers ??
      createProviders({
        costAccountant,
        metrics,
        logger,
        ...(options.fake ? { fake: options.fake } : {}),
      }),
    metrics,
    costAccountant,
    logger,
    now: options.now ?? (() => new Date()),
    newId: options.newId ?? ((prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`),
  };
};
