#!/usr/bin/env -S tsx
/**
 * The worker daemon process entrypoint (GAP-020).
 *
 * Boots from env, starts the durable loop, and shuts down cleanly on SIGTERM/SIGINT: the
 * in-flight job finishes, the poller stops claiming, and pooled resources are released.
 */

import { bootstrapDaemon, DaemonConfigurationError } from './daemon.js';
import { startHealthServer } from './health.js';

const main = async (): Promise<void> => {
  try {
    const bundle = await bootstrapDaemon();
    const { worker, logger } = bundle;

    // Railway probes /api/health on every service; the daemon has no HTTP
    // surface of its own, so a tiny health server keeps the worker deployable.
    const health = await startHealthServer();
    logger.info(`gapos-worker health server listening on :${health.port}`);

    // The worker's poll timer is unref'd so tests never hang; a daemon must keep the process
    // alive until a signal arrives. A ref'd heartbeat holds the event loop open deterministically.
    const heartbeat = setInterval(() => undefined, 30_000);

    let stopping = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (stopping) return;
      stopping = true;
      clearInterval(heartbeat);
      logger.info(`Received ${signal}: stopping the poller (in-flight job finishes).`);
      await worker.stop();
      await health.close();
      await bundle.close();
      logger.info('gapos-worker stopped cleanly.');
      process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    worker.start();
    logger.info('gapos-worker started', {
      mode: bundle.context.providers.mode,
      database: process.env.GAPOS_DATABASE_URL ? 'postgres' : 'memory',
      storage: process.env.GAPOS_STORAGE ?? 'memory',
    });
  } catch (error) {
    if (error instanceof DaemonConfigurationError) {
      console.error(`Configuration error: ${error.message}`);
    } else {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    process.exit(1);
  }
};

void main();
