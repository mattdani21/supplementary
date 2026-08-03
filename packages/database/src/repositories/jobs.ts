/**
 * The durable job queue (GAP-015): in-memory and Postgres implementations of `JobQueue`.
 *
 * The queue is system infrastructure, not learner data: the worker claims jobs for every owner,
 * so `claimDue` is the one method without an owner. Everything else is owner-scoped. The two
 * implementations share no code — the Postgres one is real SQL with atomic leasing, which is the
 * whole point of proving the restart behaviour on the database rather than on an in-memory map.
 */

import type { Pool, QueryResultRow } from 'pg';
import type { Job, JobQueue, JobState } from './types.js';

/** Exponential backoff after the Nth attempt: 2s, 4s, 8s… capped at a minute. */
export const FAILURE_BACKOFF_MS = (attempts: number): number =>
  Math.min(60_000, 2 ** attempts * 1_000);

const JOB_STATES: readonly JobState[] = ['ready', 'leased', 'succeeded', 'failed', 'dead_letter'];

/* --------------------------------------------------------------- in-memory queue */

export const createMemoryJobQueue = (): JobQueue => {
  const jobs = new Map<string, Job>();

  return {
    async enqueue(owner, job, now) {
      const record: Job = {
        ...job,
        ownerId: owner,
        state: 'ready',
        attempts: 0,
        availableAt: now,
        createdAt: now,
      };
      jobs.set(record.id, record);
      return record;
    },

    async claimDue(now, limit = 10, leaseDurationMs = 300_000) {
      const due = [...jobs.values()]
        .filter(
          (job) =>
            (job.state === 'ready' && job.availableAt <= now) ||
            (job.state === 'leased' && job.leasedUntil !== undefined && job.leasedUntil <= now),
        )
        .sort((a, b) => a.availableAt.getTime() - b.availableAt.getTime())
        .slice(0, limit);

      const leasedUntil = new Date(now.getTime() + leaseDurationMs);
      for (const job of due) {
        jobs.set(job.id, { ...job, state: 'leased', leasedUntil });
      }
      return due.map((job) => jobs.get(job.id)!);
    },

    async complete(owner, id) {
      const existing = jobs.get(id);
      if (!existing || existing.ownerId !== owner || existing.state !== 'leased') return undefined;
      const updated = { ...existing, state: 'succeeded' as const, leasedUntil: undefined };
      jobs.set(id, updated);
      return updated;
    },

    async fail(owner, id, error, now) {
      const existing = jobs.get(id);
      if (!existing || existing.ownerId !== owner || existing.state !== 'leased') return undefined;
      const attempts = existing.attempts + 1;
      const dead = attempts >= existing.maxAttempts;
      const updated: Job = {
        ...existing,
        state: dead ? 'dead_letter' : 'ready',
        attempts,
        lastError: error,
        leasedUntil: undefined,
        ...(dead ? {} : { availableAt: new Date(now.getTime() + FAILURE_BACKOFF_MS(attempts)) }),
      };
      jobs.set(id, updated);
      return updated;
    },

    async get(owner, id) {
      const job = jobs.get(id);
      return job && job.ownerId === owner ? job : undefined;
    },

    async listByState(owner, state) {
      return [...jobs.values()].filter((job) => job.ownerId === owner && job.state === state);
    },
  };
};

/* -------------------------------------------------------------- Postgres queue */

const toJob = (row: QueryResultRow): Job => ({
  id: row.id,
  ownerId: row.owner_id,
  kind: row.kind,
  runId: row.run_id ?? undefined,
  payload:
    typeof row.payload === 'string' ? (JSON.parse(row.payload) as Job['payload']) : row.payload,
  state: row.state,
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts),
  availableAt: new Date(row.available_at),
  leasedUntil: row.leased_until ? new Date(row.leased_until) : undefined,
  lastError: row.last_error ?? undefined,
  createdAt: new Date(row.created_at),
});

export const createPostgresJobQueue = (pool: Pool): JobQueue => {
  const jobColumns = `id, kind, owner_id, run_id, payload, state, attempts, max_attempts,
                      available_at, leased_until, last_error, created_at`;

  return {
    async enqueue(owner, job, now) {
      const { rows } = await pool.query(
        `INSERT INTO jobs (id, kind, owner_id, run_id, payload, state, max_attempts, available_at,
                           created_at)
         VALUES ($1, $2, $3, $4, $5, 'ready', $6, $7, $7)
         RETURNING ${jobColumns}`,
        [
          job.id,
          job.kind,
          owner,
          job.runId ?? null,
          JSON.stringify(job.payload),
          job.maxAttempts,
          now,
        ],
      );
      return toJob(rows[0]);
    },

    async claimDue(now, limit = 10, leaseDurationMs = 300_000) {
      // One statement leases the due rows and returns them. The subquery takes the locks, so two
      // workers cannot claim the same job; a crashed worker's expired lease is re-claimable here.
      const { rows } = await pool.query(
        `UPDATE jobs
            SET state = 'leased', leased_until = $1
          WHERE id IN (
            SELECT id FROM jobs
             WHERE (state = 'ready' AND available_at <= $2)
                OR (state = 'leased' AND leased_until <= $2)
             ORDER BY available_at
             LIMIT $3
             FOR UPDATE SKIP LOCKED
          )
          RETURNING ${jobColumns}`,
        [new Date(now.getTime() + leaseDurationMs), now, limit],
      );
      return rows.map(toJob);
    },

    async complete(owner, id) {
      const { rows } = await pool.query(
        `UPDATE jobs SET state = 'succeeded', leased_until = NULL
          WHERE id = $1 AND owner_id = $2 AND state = 'leased'
          RETURNING ${jobColumns}`,
        [id, owner],
      );
      return rows[0] ? toJob(rows[0]) : undefined;
    },

    async fail(owner, id, error, now) {
      const { rows } = await pool.query(
        `UPDATE jobs
            SET state        = CASE WHEN attempts + 1 >= max_attempts THEN 'dead_letter' ELSE 'ready' END,
                attempts     = attempts + 1,
                last_error   = $3,
                leased_until = NULL,
                available_at = CASE WHEN attempts + 1 >= max_attempts THEN available_at
                                    ELSE $4 + LEAST(60, POW(2, attempts + 1)) * INTERVAL '1 second'
                               END
          WHERE id = $1 AND owner_id = $2 AND state = 'leased'
          RETURNING ${jobColumns}`,
        [id, owner, error, now],
      );
      return rows[0] ? toJob(rows[0]) : undefined;
    },

    async get(owner, id) {
      const { rows } = await pool.query(
        `SELECT ${jobColumns} FROM jobs WHERE id = $1 AND owner_id = $2`,
        [id, owner],
      );
      return rows[0] ? toJob(rows[0]) : undefined;
    },

    async listByState(owner, state) {
      const { rows } = await pool.query(
        `SELECT ${jobColumns} FROM jobs WHERE owner_id = $1 AND state = $2 ORDER BY created_at, id`,
        [owner, state],
      );
      return rows.map(toJob);
    },
  };
};

/** The states a job can be in — kept here so the CHECK constraint and the type cannot drift. */
export const JOB_STATE_VALUES = JOB_STATES;
