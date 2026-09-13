/**
 * Atomic request quotas (GAPX-04).
 *
 * Memory implementation is development-only. Shared deployments use the Postgres store on the
 * existing pool so concurrent workers cannot admit more than the configured owner quota.
 */

import type { Pool } from 'pg';
import type { OwnerId } from './types.js';

export type QuotaOperation = 'upload' | 'compile' | 'proof';

export interface QuotaAdmission {
  readonly admitted: boolean;
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

export interface QuotaWindow {
  readonly limit: number;
  readonly windowMs: number;
}

export type QuotaLimits = Readonly<Record<QuotaOperation, QuotaWindow>>;

export interface RequestLimiter {
  admit(owner: OwnerId, operation: QuotaOperation, now: Date): Promise<QuotaAdmission>;
}

export const DEFAULT_QUOTA_LIMITS: QuotaLimits = {
  upload: { limit: 30, windowMs: 60_000 },
  compile: { limit: 6, windowMs: 60_000 },
  proof: { limit: 40, windowMs: 60_000 },
};

export const quotaLimitsFromEnv = (
  env: Record<string, string | undefined> = process.env,
  fallback: QuotaLimits = DEFAULT_QUOTA_LIMITS,
): QuotaLimits => {
  const read = (name: string, fallbackValue: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallbackValue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number.`);
    }
    return value;
  };
  return {
    upload: {
      limit: read('GAPOS_QUOTA_UPLOAD_LIMIT', fallback.upload.limit),
      windowMs: read('GAPOS_QUOTA_UPLOAD_WINDOW_MS', fallback.upload.windowMs),
    },
    compile: {
      limit: read('GAPOS_QUOTA_COMPILE_LIMIT', fallback.compile.limit),
      windowMs: read('GAPOS_QUOTA_COMPILE_WINDOW_MS', fallback.compile.windowMs),
    },
    proof: {
      limit: read('GAPOS_QUOTA_PROOF_LIMIT', fallback.proof.limit),
      windowMs: read('GAPOS_QUOTA_PROOF_WINDOW_MS', fallback.proof.windowMs),
    },
  };
};

const retryAfterSeconds = (windowStart: Date, windowMs: number, now: Date): number =>
  Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000));

const windowStartFor = (now: Date, windowMs: number): Date =>
  new Date(Math.floor(now.getTime() / windowMs) * windowMs);

export const createMemoryRequestLimiter = (limits: QuotaLimits): RequestLimiter => {
  const counts = new Map<string, number>();
  return {
    async admit(owner, operation, now) {
      const window = limits[operation];
      const started = windowStartFor(now, window.windowMs);
      const key = `${owner}:${operation}:${started.toISOString()}`;
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      const admitted = next <= window.limit;
      return {
        admitted,
        retryAfterSeconds: retryAfterSeconds(started, window.windowMs, now),
        remaining: Math.max(0, window.limit - next),
      };
    },
  };
};

export const createPostgresRequestLimiter = (pool: Pool, limits: QuotaLimits): RequestLimiter => ({
  async admit(owner, operation, now) {
    const window = limits[operation];
    const started = windowStartFor(now, window.windowMs);
    const { rows } = await pool.query<{ count: string }>(
      `INSERT INTO request_quotas (owner_id, operation, window_started_at, count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (owner_id, operation, window_started_at)
       DO UPDATE SET count = request_quotas.count + 1
       RETURNING count`,
      [owner, operation, started],
    );
    const next = Number(rows[0]?.count ?? 0);
    return {
      admitted: next <= window.limit,
      retryAfterSeconds: retryAfterSeconds(started, window.windowMs, now),
      remaining: Math.max(0, window.limit - next),
    };
  },
});
