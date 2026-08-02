/**
 * The server context.
 *
 * One place that assembles repositories, storage, providers, metrics and the clock. Everything
 * downstream takes its dependencies as arguments, so a test builds a context with fakes and a
 * deterministic clock and exercises exactly the code that runs in production.
 */

import { randomUUID } from 'node:crypto';
import {
  createMemoryObjectStore,
  createMemoryUnitOfWork,
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
}

export const createServerContext = (options: ContextOptions = {}): ServerContext => {
  const costAccountant = new CostAccountant(options.budget);
  const metrics = createMetrics();
  const logger = createLogger({}, { level: options.logLevel ?? 'warn' });

  return {
    uow: createMemoryUnitOfWork(),
    storage: createMemoryObjectStore(options.now),
    providers: createProviders({
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
