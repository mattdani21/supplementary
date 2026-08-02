/**
 * The repository contract, run against every implementation.
 *
 * Memory always runs. Postgres runs when `GAPOS_TEST_DATABASE_URL` is set — and it is set in CI,
 * so the SQL path is never merely assumed to work. When it is unset the Postgres block is
 * skipped *loudly*: a placeholder test states that the SQL implementation was not exercised,
 * because a silently absent suite reads exactly like a passing one.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createPool, ensureSchema, migrate } from '../migrate.js';
import { createMemoryUnitOfWork } from './memory.js';
import { createPostgresUnitOfWork, truncateAll } from './postgres.js';
import { describeRepositoryContract } from './shared-suite.js';
import type { UnitOfWork } from './types.js';

describeRepositoryContract('memory', { create: () => createMemoryUnitOfWork() });

const databaseUrl = process.env.GAPOS_TEST_DATABASE_URL;

if (databaseUrl) {
  // Its own schema: this file and the Postgres journey run in parallel.
  const SCHEMA = 'test_repository_contract';
  const pool = createPool(databaseUrl, { max: 4, schema: SCHEMA });
  let migrated = false;

  afterAll(async () => {
    await pool.end();
  });

  describeRepositoryContract('postgres', {
    create: async (): Promise<UnitOfWork> => {
      if (!migrated) {
        await ensureSchema(pool, SCHEMA);
        await migrate(pool);
        migrated = true;
      }
      // Each test starts from an empty database; leaking rows between tests would make an
      // ownership failure look like a passing test that simply found nothing.
      await truncateAll(pool);
      return createPostgresUnitOfWork(pool);
    },
  });
} else {
  describe('postgres', () => {
    it.skip('was not exercised: set GAPOS_TEST_DATABASE_URL to run the SQL implementation', () => {
      expect.unreachable();
    });
  });
}

describe('the shape of the interface', () => {
  it('has no repository method that reads without an owner', () => {
    // Guards the property structurally rather than case by case: every method's first parameter
    // is the owner. A future `findById(id)` fails here, which is the entire point.
    const uow = createMemoryUnitOfWork();
    const exempt = new Set(['create', 'find', 'findByEmail', 'deleteAccount']);

    for (const [name, repository] of Object.entries(uow)) {
      for (const method of Object.keys(repository as object)) {
        if (name === 'users' && exempt.has(method)) continue;
        const fn = (repository as Record<string, unknown>)[method];
        expect(typeof fn, `${name}.${method}`).toBe('function');
        expect(String(fn), `${name}.${method} must take an owner first`).toMatch(
          /^\s*async\s*(function\s*)?\w*\s*\(\s*owner\b/,
        );
      }
    }
  });

  it('exposes the same methods on both implementations', () => {
    // A method added to one and forgotten on the other would otherwise only surface at runtime.
    const memory = createMemoryUnitOfWork();
    const postgres = createPostgresUnitOfWork({} as never);

    for (const key of Object.keys(memory) as (keyof UnitOfWork)[]) {
      expect(Object.keys(postgres[key]).sort(), `${key} methods`).toEqual(
        Object.keys(memory[key]).sort(),
      );
    }
  });
});
