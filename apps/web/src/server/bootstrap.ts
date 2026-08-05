/**
 * The web process bootstrap (GAP-021).
 *
 * Builds the single server context for the Next.js process, mirroring the worker daemon's env
 * resolution: Postgres when GAPOS_DATABASE_URL is set (migrated on boot), in-memory otherwise;
 * storage from GAPOS_STORAGE; providers from GAPOS_PROVIDER_MODE. The route handlers share this
 * singleton, so a deployment is configured entirely by env.
 */

import {
  createMemoryObjectStore,
  createMemoryUnitOfWork,
  createPool,
  createPostgresUnitOfWork,
  createS3ObjectStore,
  ensureSchema,
  migrate,
  type ObjectStore,
} from '@gapos/database';
import { createLogger } from '@gapos/observability';
import { createServerContext, type ServerContext } from './context.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let contextPromise: Promise<ServerContext> | undefined;
let pool: { end: () => Promise<void> } | undefined;

export const getServerContext = (): Promise<ServerContext> => {
  if (!contextPromise) {
    contextPromise = buildContext();
  }
  return contextPromise;
};

const buildContext = async (): Promise<ServerContext> => {
  const logLevel = (process.env.GAPOS_LOG_LEVEL as LogLevel) ?? 'info';
  const logger = createLogger({}, { level: logLevel });

  const databaseUrl = process.env.GAPOS_DATABASE_URL;
  if (databaseUrl) {
    const pgPool = createPool(databaseUrl, { schema: 'public' });
    await ensureSchema(pgPool, 'public');
    await migrate(pgPool);
    pool = pgPool;
    return createServerContext({
      uow: createPostgresUnitOfWork(pgPool),
      storage: createStorage(logger),
      logLevel,
    });
  }

  logger.warn('GAPOS_DATABASE_URL is not set; using in-memory repositories (data is ephemeral).');
  return createServerContext({
    uow: createMemoryUnitOfWork(),
    storage: createStorage(logger),
    logLevel,
  });
};

export const closeServerContext = async (): Promise<void> => {
  await pool?.end();
  contextPromise = undefined;
  pool = undefined;
};

const createStorage = (log: ReturnType<typeof createLogger>): ObjectStore => {
  const kind = process.env.GAPOS_STORAGE ?? 'memory';
  if (kind === 'memory') {
    log.warn('GAPOS_STORAGE is not set to s3; using in-memory object storage.');
    return createMemoryObjectStore();
  }
  if (kind !== 's3') throw new Error(`GAPOS_STORAGE must be memory or s3; received "${kind}".`);
  const missing = [
    'GAPOS_S3_ENDPOINT',
    'GAPOS_S3_BUCKET',
    'GAPOS_S3_ACCESS_KEY_ID',
    'GAPOS_S3_SECRET_ACCESS_KEY',
  ].filter((name) => !process.env[name]);
  if (missing.length > 0)
    throw new Error(`GAPOS_STORAGE=s3 requires ${missing.join(', ')} to be set.`);
  return createS3ObjectStore({
    endpoint: process.env.GAPOS_S3_ENDPOINT!,
    region: process.env.GAPOS_S3_REGION ?? 'us-east-1',
    bucket: process.env.GAPOS_S3_BUCKET!,
    accessKeyId: process.env.GAPOS_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.GAPOS_S3_SECRET_ACCESS_KEY!,
  });
};
