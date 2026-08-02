/**
 * `pnpm db:migrate`
 *
 * Applies pending migrations against DATABASE_URL (or GAPOS_TEST_DATABASE_URL in CI).
 * Running it twice is a no-op — which is what the CI job asserts.
 */

import pg from 'pg';
import { migrate } from './migrate.js';

const connectionString = process.env.GAPOS_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Set DATABASE_URL (or GAPOS_TEST_DATABASE_URL) before running migrations.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

try {
  const { applied, skipped } = await migrate(pool);
  console.warn(
    JSON.stringify({
      message: applied.length ? 'Applied migrations' : 'Database already up to date',
      applied,
      alreadyApplied: skipped.length,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
