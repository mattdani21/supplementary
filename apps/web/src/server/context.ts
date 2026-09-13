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
  createMemoryRequestLimiter,
  createMemoryUnitOfWork,
  type JobQueue,
  type ObjectStore,
  type OwnerId,
  type RequestLimiter,
  type UnitOfWork,
} from '@gapos/database';
import type { ProofExecutionMode } from './proof-execution.js';
import type { Calibration } from '@gapos/ai-contracts';
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
  type FakeEmbeddingsOptions,
  type FakeLanguageModelOptions,
  type Providers,
} from '@gapos/provider-adapters';

export interface CalibrationKitStore {
  issue(owner: OwnerId, subject: string, kit: Calibration): string;
  get(owner: OwnerId, kitId: string, subject: string): Calibration | undefined;
}

export interface ServerContext {
  readonly uow: UnitOfWork;
  readonly storage: ObjectStore;
  readonly queue: JobQueue;
  readonly providers: Providers;
  readonly metrics: MetricsRecorder;
  readonly costAccountant: CostAccountant;
  readonly logger: Logger;
  readonly calibrationKits: CalibrationKitStore;
  readonly compileTransport: 'inline' | 'queue';
  readonly proofExecution: ProofExecutionMode;
  readonly limiter: RequestLimiter;
  readonly now: () => Date;
  readonly newId: (prefix: string) => string;
}

export interface ContextOptions {
  readonly now?: () => Date;
  readonly newId?: (prefix: string) => string;
  readonly budget?: Budget;
  readonly fake?: FakeLanguageModelOptions;
  /** Scripted vectors for the fake embeddings backend (GAP-018); unset stays lexical. */
  readonly fakeEmbeddings?: FakeEmbeddingsOptions;
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
  readonly calibrationKits?: CalibrationKitStore;
  readonly compileTransport?: 'inline' | 'queue';
  readonly proofExecution?: ProofExecutionMode;
  readonly limiter?: RequestLimiter;
}

export const createServerContext = (options: ContextOptions = {}): ServerContext => {
  const costAccountant = new CostAccountant(options.budget);
  const metrics = createMetrics();
  const logger = createLogger({}, { level: options.logLevel ?? 'warn' });
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? ((prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`);
  const pendingKits = new Map<
    string,
    { owner: OwnerId; subject: string; kit: Calibration; expiresAt: number }
  >();
  const calibrationKits: CalibrationKitStore = options.calibrationKits ?? {
    issue(owner, subject, kit) {
      const at = now().getTime();
      for (const [id, pending] of pendingKits) {
        if (pending.expiresAt <= at) pendingKits.delete(id);
      }
      const id = newId('cal-kit');
      pendingKits.set(id, { owner, subject, kit, expiresAt: at + 15 * 60_000 });
      return id;
    },
    get(owner, kitId, subject) {
      const pending = pendingKits.get(kitId);
      if (
        !pending ||
        pending.owner !== owner ||
        pending.subject !== subject ||
        pending.expiresAt <= now().getTime()
      ) {
        if (pending?.expiresAt && pending.expiresAt <= now().getTime()) pendingKits.delete(kitId);
        return undefined;
      }
      return pending.kit;
    },
  };

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
        ...(options.fakeEmbeddings ? { fakeEmbeddings: options.fakeEmbeddings } : {}),
      }),
    metrics,
    costAccountant,
    logger,
    calibrationKits,
    compileTransport: options.compileTransport ?? 'inline',
    proofExecution: options.proofExecution ?? 'local',
    limiter:
      options.limiter ??
      createMemoryRequestLimiter({
        upload: { limit: 10_000, windowMs: 60_000 },
        compile: { limit: 10_000, windowMs: 60_000 },
        proof: { limit: 10_000, windowMs: 60_000 },
      }),
    now,
    newId,
  };
};
