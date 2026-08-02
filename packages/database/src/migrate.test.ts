import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMigrations, MigrationDriftError, migrate } from './migrate.js';

/** A minimal Pool stand-in that records statements, so drift detection is testable offline. */
const fakePool = (appliedRows: { name: string; checksum: string }[] = []) => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [] };
    },
    release: () => {},
  };
  return {
    statements,
    pool: {
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: sql.includes('FROM schema_migrations') ? appliedRows : [] };
      },
      connect: async () => client,
    } as never,
  };
};

describe('migrations', () => {
  it('ships at least the core schema and orders migrations by filename', async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.name).toBe('001_core_schema.sql');
    expect([...migrations].sort((a, b) => a.name.localeCompare(b.name))).toEqual(migrations);
  });

  it('constrains gap status in the schema, so a stray write cannot invent one', async () => {
    const [core] = await loadMigrations();
    expect(core?.sql).toContain("CHECK (status IN ('draft', 'ready', 'compiling', 'active',");
  });

  it('gives every learner-owned table an owner column', async () => {
    const [core] = await loadMigrations();
    const sql = core?.sql ?? '';
    const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)];
    const exempt = new Set(['users', 'learner_profiles', 'schema_migrations']);
    for (const [, name, body] of tables) {
      if (!name || exempt.has(name)) continue;
      expect(body, `${name} must carry owner_id`).toContain('owner_id');
    }
  });

  it('applies a pending migration exactly once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gapos-migrations-'));
    await writeFile(join(directory, '001_test.sql'), 'CREATE TABLE t (id TEXT);');

    const first = fakePool();
    expect((await migrate(first.pool, directory)).applied).toEqual(['001_test.sql']);

    const migrations = await loadMigrations(directory);
    const second = fakePool([{ name: '001_test.sql', checksum: migrations[0]!.checksum }]);
    const result = await migrate(second.pool, directory);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['001_test.sql']);
  });

  it('refuses to run when a shipped migration has been edited', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gapos-migrations-'));
    await writeFile(join(directory, '001_test.sql'), 'CREATE TABLE t (id TEXT);');
    const { pool } = fakePool([{ name: '001_test.sql', checksum: 'a-checksum-from-before' }]);

    await expect(migrate(pool, directory)).rejects.toBeInstanceOf(MigrationDriftError);
    await expect(migrate(pool, directory)).rejects.toThrow(/forward-only/);
  });
});
