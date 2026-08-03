/**
 * The worker daemon bootstrap (GAP-020).
 *
 * Turns environment configuration into a running worker process. Kept deliberately thin: the
 * durable loop itself (leasing, resuming, dead-lettering) lives in `queue/worker.ts` and is
 * fully tested; this file is what a deployment starts, and everything it does is config
 * resolution and signal wiring, which is also tested.
 *
 * Configuration (all GAPOS_*):
 *   GAPOS_DATABASE_URL            Postgres DSN; absent = in-memory repositories (dev only)
 *   GAPOS_PROVIDER_MODE           fake | live (live refuses to boot without keys)
 *   GAPOS_STORAGE                 memory | s3 (s3 requires the GAPOS_S3_* keys)
 *   GAPOS_S3_ENDPOINT / _REGION / _BUCKET / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY
 *   GAPOS_QUEUE_POLL_INTERVAL_MS  default 2000
 *   GAPOS_QUEUE_LEASE_DURATION_MS default 300000
 *   GAPOS_QUEUE_CLAIM_BATCH       default 4
 *   GAPOS_LOG_LEVEL               debug | info | warn | error
 */

import {
  createMemoryJobQueue,
  createMemoryObjectStore,
  createMemoryUnitOfWork,
  createPool,
  createPostgresJobQueue,
  createPostgresUnitOfWork,
  createS3ObjectStore,
  ensureSchema,
  migrate,
  type ObjectStore,
} from '@gapos/database';
import { createLogger, type Budget, type Logger, type MetricsRecorder } from '@gapos/observability';
import { createServerContext, type ServerContext } from '../../web/src/server/context.js';
import { createCompileWorker, type WorkerHandle } from './queue/worker.js';

export interface DaemonEnv {
  readonly GAPOS_DATABASE_URL?: string;
  readonly GAPOS_PROVIDER_MODE?: string;
  readonly GAPOS_STORAGE?: string;
  readonly GAPOS_S3_ENDPOINT?: string;
  readonly GAPOS_S3_REGION?: string;
  readonly GAPOS_S3_BUCKET?: string;
  readonly GAPOS_S3_ACCESS_KEY_ID?: string;
  readonly GAPOS_S3_SECRET_ACCESS_KEY?: string;
  readonly GAPOS_QUEUE_POLL_INTERVAL_MS?: string;
  readonly GAPOS_QUEUE_LEASE_DURATION_MS?: string;
  readonly GAPOS_QUEUE_CLAIM_BATCH?: string;
  readonly GAPOS_LOG_LEVEL?: string;
  readonly GAPOS_BUDGET_DAILY_MILLICENTS?: string;
  readonly GAPOS_BUDGET_PER_RUN_MILLICENTS?: string;
}

export class DaemonConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaemonConfigurationError';
  }
}

export interface DaemonBundle {
  readonly context: ServerContext;
  readonly worker: WorkerHandle;
  readonly logger: Logger;
  readonly metrics: MetricsRecorder;
  /** Release pooled resources (Postgres pool) after the worker stops. */
  readonly close: () => Promise<void>;
}

export const bootstrapDaemon = async (env: DaemonEnv = process.env): Promise<DaemonBundle> => {
  const logger = createLogger({}, { level: (env.GAPOS_LOG_LEVEL as LoggerLevel) ?? 'info' });

  const databaseUrl = env.GAPOS_DATABASE_URL;
  let context: ServerContext;
  let close: () => Promise<void> = async () => undefined;

  if (databaseUrl) {
    const pool = createPool(databaseUrl, { schema: 'public' });
    await ensureSchema(pool, 'public');
    await migrate(pool);
    context = createServerContext({
      uow: createPostgresUnitOfWork(pool),
      queue: createPostgresJobQueue(pool),
      storage: createStorage(env, logger),
      budget: budgetFromEnv(env),
      logLevel: (env.GAPOS_LOG_LEVEL as LoggerLevel) ?? 'info',
    });
    close = () => pool.end();
  } else {
    logger.warn(
      'GAPOS_DATABASE_URL is not set; using in-memory repositories. Jobs and data do not survive a restart.',
    );
    context = createServerContext({
      uow: createMemoryUnitOfWork(),
      queue: createMemoryJobQueue(),
      storage: createStorage(env, logger),
      budget: budgetFromEnv(env),
      logLevel: (env.GAPOS_LOG_LEVEL as LoggerLevel) ?? 'info',
    });
  }

  const worker = createCompileWorker(context, {
    pollIntervalMs: numberFromEnv(
      env.GAPOS_QUEUE_POLL_INTERVAL_MS,
      2_000,
      'GAPOS_QUEUE_POLL_INTERVAL_MS',
    ),
    leaseDurationMs: numberFromEnv(
      env.GAPOS_QUEUE_LEASE_DURATION_MS,
      5 * 60_000,
      'GAPOS_QUEUE_LEASE_DURATION_MS',
    ),
    claimBatch: numberFromEnv(env.GAPOS_QUEUE_CLAIM_BATCH, 4, 'GAPOS_QUEUE_CLAIM_BATCH'),
  });

  return { context, worker, logger, metrics: context.metrics, close };
};

type LoggerLevel = 'debug' | 'info' | 'warn' | 'error';

const createStorage = (env: DaemonEnv, logger: Logger): ObjectStore => {
  const kind = env.GAPOS_STORAGE ?? 'memory';
  if (kind === 'memory') {
    logger.warn('GAPOS_STORAGE is not set to s3; using in-memory object storage.');
    return createMemoryObjectStore();
  }
  if (kind !== 's3') {
    throw new DaemonConfigurationError(`GAPOS_STORAGE must be memory or s3; received "${kind}".`);
  }
  const missing = [
    'GAPOS_S3_ENDPOINT',
    'GAPOS_S3_BUCKET',
    'GAPOS_S3_ACCESS_KEY_ID',
    'GAPOS_S3_SECRET_ACCESS_KEY',
  ].filter((name) => !env[name as keyof DaemonEnv]);
  if (missing.length > 0) {
    throw new DaemonConfigurationError(
      `GAPOS_STORAGE=s3 requires ${missing.join(', ')} to be set.`,
    );
  }
  return createS3ObjectStore({
    endpoint: env.GAPOS_S3_ENDPOINT!,
    region: env.GAPOS_S3_REGION ?? 'us-east-1',
    bucket: env.GAPOS_S3_BUCKET!,
    accessKeyId: env.GAPOS_S3_ACCESS_KEY_ID!,
    secretAccessKey: env.GAPOS_S3_SECRET_ACCESS_KEY!,
  });
};

const numberFromEnv = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new DaemonConfigurationError(`${name} must be a positive number; received "${raw}".`);
  }
  return value;
};

export const budgetFromEnv = (env: DaemonEnv = process.env): Budget | undefined => {
  const perRun = env.GAPOS_BUDGET_PER_RUN_MILLICENTS;
  const perUserDaily = env.GAPOS_BUDGET_DAILY_MILLICENTS;
  if (!perRun && !perUserDaily) return undefined;
  return {
    ...(perRun ? { perRunMillicents: Number(perRun) } : {}),
    ...(perUserDaily ? { perUserDailyMillicents: Number(perUserDaily) } : {}),
  } as Budget;
};
