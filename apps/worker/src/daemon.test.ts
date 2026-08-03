/**
 * The worker daemon (GAP-020).
 *
 * Bootstrap is config resolution, so it is tested directly: memory mode, s3 misconfiguration,
 * invalid intervals. The signal path is proven by spawning the real entrypoint and sending
 * SIGTERM — the child must finish, log a clean stop, and exit 0.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bootstrapDaemon, DaemonConfigurationError } from './daemon.js';

/** The repo's tsx CLI, resolved from this test file. Spawned directly (not via pnpm) so
 * SIGTERM reaches the daemon process rather than the pnpm wrapper. */
const TSX_BIN = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url));
const DAEMON_MAIN = fileURLToPath(new URL('./daemon-main.ts', import.meta.url));

const BASE_ENV: Record<string, string> = {
  GAPOS_PROVIDER_MODE: 'fake',
  GAPOS_LOG_LEVEL: 'silent',
};

describe('bootstrapDaemon', () => {
  it('boots in-memory repositories when GAPOS_DATABASE_URL is absent', async () => {
    const bundle = await bootstrapDaemon(BASE_ENV);
    expect(bundle.worker.start).toBeTypeOf('function');
    expect(bundle.worker.stop).toBeTypeOf('function');
    expect(bundle.context.uow.gaps).toBeDefined();
    await bundle.close();
  });

  it('refuses s3 storage without the S3 keys', async () => {
    await expect(bootstrapDaemon({ ...BASE_ENV, GAPOS_STORAGE: 's3' })).rejects.toBeInstanceOf(
      DaemonConfigurationError,
    );
  });

  it('refuses an invalid poll interval', async () => {
    await expect(
      bootstrapDaemon({ ...BASE_ENV, GAPOS_QUEUE_POLL_INTERVAL_MS: 'soon' }),
    ).rejects.toBeInstanceOf(DaemonConfigurationError);
  });

  it('rejects an unknown storage kind', async () => {
    await expect(bootstrapDaemon({ ...BASE_ENV, GAPOS_STORAGE: 'tape' })).rejects.toBeInstanceOf(
      DaemonConfigurationError,
    );
  });
});

describe('the daemon process', () => {
  it('starts, and stops cleanly on SIGTERM with exit code 0', async () => {
    const child = spawn(TSX_BIN, [DAEMON_MAIN], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GAPOS_PROVIDER_MODE: 'fake',
        GAPOS_QUEUE_POLL_INTERVAL_MS: '200',
        GAPOS_LOG_LEVEL: 'info',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    const started = new Promise<void>((resolve) => {
      child.stderr?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('gapos-worker started')) resolve();
      });
    });

    await Promise.race([
      started,
      new Promise((_, reject) =>
        child.once('exit', (code) => reject(new Error(`daemon exited early with code ${code}`))),
      ),
    ]);

    child.kill('SIGTERM');

    const exitCode = await new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    // Drain anything still in flight before asserting on the captured output.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(exitCode).toBe(0);
    expect(output).toContain('gapos-worker started');
    expect(output).toContain('gapos-worker stopped cleanly');
  }, 30_000);
});
