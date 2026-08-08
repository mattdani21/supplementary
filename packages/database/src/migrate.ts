/**
 * Forward-only migrations.
 *
 * A migration is applied once, inside a transaction, and recorded with the checksum of the file
 * that was applied. If a shipped migration is later edited, the checksum no longer matches and
 * the runner refuses to continue — which is how "never edit a migration that has shipped" stops
 * being a convention and starts being a check.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Pool } from 'pg';

// DATE columns (OID 1082) are calendar days, not instants. pg parses them into a
// JS Date at the SESSION timezone's midnight; mapping that with toISOString()
// (UTC) shifts the calendar day for any non-UTC session (SAST midnight = the
// previous day 22:00Z). Keep DATE as its raw string so the day round-trips
// unchanged — timestamps (timestamptz) are untouched by this parser override.
pg.types.setTypeParser(1082, (value: string) => value);

export interface PoolOptions {
  readonly max?: number;
  /**
   * Confine every connection to one Postgres schema.
   *
   * Used to isolate concurrent test files: two suites sharing a database will truncate each
   * other's rows mid-test, which surfaces as foreign-key violations and deadlocks rather than
   * as an honest failure. A schema per suite lets them run in parallel without interfering.
   */
  readonly schema?: string;
}

/** Postgres identifiers only. Anything else would be interpolated into DDL. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const assertIdentifier = (name: string): string => {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`"${name}" is not a valid Postgres identifier.`);
  }
  return name;
};

/**
 * Create a connection pool.
 *
 * Exported so nothing outside this package needs to import `pg` — the same reason application
 * code goes through the provider adapters rather than a vendor SDK. It keeps the driver a
 * detail of the persistence layer.
 */
export const createPool = (connectionString: string, options: PoolOptions = {}): Pool =>
  new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    // The test schema comes first (isolation); `public` follows so shared extensions — the
    // pgvector types and operators from migration 004 — resolve without leaking the tables.
    ...(options.schema
      ? { options: `-c search_path=${assertIdentifier(options.schema)},public` }
      : {}),
  });

/** Create the schema a pool is confined to, if it does not already exist. */
export const ensureSchema = async (pool: Pool, schema: string): Promise<void> => {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${assertIdentifier(schema)}`);
};

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export const loadMigrations = async (directory = MIGRATIONS_DIR): Promise<Migration[]> => {
  const files = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(join(directory, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
};

export class MigrationDriftError extends Error {
  constructor(
    readonly migration: string,
    readonly appliedChecksum: string,
    readonly currentChecksum: string,
  ) {
    super(
      `Migration ${migration} has changed since it was applied ` +
        `(recorded ${appliedChecksum.slice(0, 12)}, found ${currentChecksum.slice(0, 12)}). ` +
        'Migrations are forward-only: add a new migration instead of editing this one.',
    );
    this.name = 'MigrationDriftError';
  }
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export const migrate = async (pool: Pool, directory?: string): Promise<MigrationResult> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const migrations = await loadMigrations(directory);
  const { rows } = await pool.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM schema_migrations',
  );
  const applied = new Map(rows.map((row) => [row.name, row.checksum]));

  const appliedNow: string[] = [];
  const skipped: string[] = [];

  for (const migration of migrations) {
    const previous = applied.get(migration.name);
    if (previous) {
      if (previous !== migration.checksum) {
        throw new MigrationDriftError(migration.name, previous, migration.checksum);
      }
      skipped.push(migration.name);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
      await client.query('COMMIT');
      appliedNow.push(migration.name);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return { applied: appliedNow, skipped };
};
