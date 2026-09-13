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
  createMemoryRequestLimiter,
  createMemoryUnitOfWork,
  createPool,
  createPostgresJobQueue,
  createPostgresRequestLimiter,
  createPostgresUnitOfWork,
  createS3ObjectStore,
  ensureSchema,
  migrate,
  quotaLimitsFromEnv,
  type ObjectStore,
} from '@gapos/database';
import { createLogger } from '@gapos/observability';
import { createServerContext, type ServerContext } from './context.js';
import { createAuthJsVerifier } from './identity/authjs-verifier.js';
import { identityModeFromEnv } from './identity/port.js';
import { configureIdentityRuntime, identityRuntimeFromEnv } from './identity/resolve-owner.js';
import { proofExecutionFromEnv } from './proof-execution.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface RuntimeState {
  contextPromise?: Promise<ServerContext>;
  pool?: { end: () => Promise<void> };
}

const runtime = globalThis as typeof globalThis & {
  __gaposServerRuntime?: RuntimeState;
};
const state = (runtime.__gaposServerRuntime ??= {});

export const getServerContext = (): Promise<ServerContext> => {
  if (!state.contextPromise) {
    state.contextPromise = buildContext();
  }
  return state.contextPromise;
};

const buildContext = async (): Promise<ServerContext> => {
  const logLevel = (process.env.GAPOS_LOG_LEVEL as LogLevel) ?? 'info';
  const logger = createLogger({}, { level: logLevel });
  const identityMode = identityModeFromEnv();
  await configureIdentityForBoot(identityMode);

  const proofExecution = proofExecutionFromEnv(process.env, identityMode);
  const limits = quotaLimitsFromEnv();

  const databaseUrl = process.env.GAPOS_DATABASE_URL;
  if (databaseUrl) {
    const schema = process.env.GAPOS_DATABASE_SCHEMA ?? 'public';
    const pgPool = createPool(databaseUrl, { schema });
    await ensureSchema(pgPool, schema);
    await migrate(pgPool);
    state.pool = pgPool;
    if (identityMode === 'protected' && !process.env.GAPOS_QUOTA_COMPILE_LIMIT) {
      throw new Error('Protected mode requires explicit GAPOS_QUOTA_* limits.');
    }
    return createServerContext({
      uow: createPostgresUnitOfWork(pgPool),
      queue: createPostgresJobQueue(pgPool),
      storage: await createStorage(logger),
      compileTransport: 'queue',
      proofExecution,
      limiter: createPostgresRequestLimiter(pgPool, limits),
      logLevel,
    });
  }

  logger.warn('GAPOS_DATABASE_URL is not set; using in-memory repositories (data is ephemeral).');
  if (identityMode === 'protected') {
    throw new Error('Protected mode requires GAPOS_DATABASE_URL and a shared limiter.');
  }
  return createServerContext({
    uow: createMemoryUnitOfWork(),
    storage: await createStorage(logger),
    proofExecution,
    limiter: createMemoryRequestLimiter(limits),
    logLevel,
  });
};

const configureIdentityForBoot = async (mode: 'demo' | 'protected'): Promise<void> => {
  if (mode === 'demo') {
    configureIdentityRuntime({ mode: 'demo' });
    return;
  }
  const { auth } = await import('../auth.js');
  const verifier = createAuthJsVerifier(async () => {
    const session = await auth();
    const subject =
      (session as { subject?: string } | null)?.subject ?? session?.user?.email ?? undefined;
    return session ? { subject, expires: session.expires } : null;
  });
  configureIdentityRuntime(identityRuntimeFromEnv(process.env, verifier));
};

export const closeServerContext = async (): Promise<void> => {
  await state.pool?.end();
  state.contextPromise = undefined;
  state.pool = undefined;
};

const createStorage = async (log: ReturnType<typeof createLogger>): Promise<ObjectStore> => {
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
  const store = createS3ObjectStore({
    endpoint: process.env.GAPOS_S3_ENDPOINT!,
    region: process.env.GAPOS_S3_REGION ?? 'us-east-1',
    bucket: process.env.GAPOS_S3_BUCKET!,
    accessKeyId: process.env.GAPOS_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.GAPOS_S3_SECRET_ACCESS_KEY!,
  });
  await store.ensureBucket?.();
  return store;
};
