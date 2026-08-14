/**
 * The seed-curriculum repository test (GAP-032, E21).
 *
 * Runs the same function scripts/seed-curriculum.ts exposes — the seed that drives the CLI
 * service layer — against the in-memory repositories and asserts the acceptance criteria:
 *
 *   1. exactly the three learning tracks exist as gaps with target capabilities;
 *   2. every seeded gap has at least two sources, and every source is indexed with chunks that
 *      carry structural locators (§-addressed sections, not "Document");
 *   3. re-running the seed does not duplicate gaps, sources or chunks (idempotency).
 *
 * No network, no provider calls, no database — deterministic by construction.
 */

import { describe, expect, it } from 'vitest';
import { SEED_TRACKS } from '@gapos/test-fixtures';
import type { OwnerId } from '@gapos/database';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import { gapList, OWNER as CLI_OWNER } from '../../apps/cli/src/commands.js';
import { seedCurriculum } from '../../scripts/seed-curriculum.js';

const OWNER: OwnerId = 'user_seed';

const buildContext = (): ServerContext => createServerContext({ logLevel: 'error' });

const collectLines = (): { lines: string[]; out: (line: string) => void } => {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
};

describe('seed-curriculum (GAP-032)', () => {
  it('seeds exactly the three learning tracks as gaps with target capabilities', async () => {
    const context = buildContext();
    const results = await seedCurriculum(context, OWNER);

    expect(results.map((r) => r.gapId).sort()).toEqual(SEED_TRACKS.map((t) => t.gapId).sort());

    const gaps = await context.uow.gaps.list(OWNER);
    expect(gaps).toHaveLength(3);
    for (const track of SEED_TRACKS) {
      const gap = await context.uow.gaps.get(OWNER, track.gapId);
      expect(gap, `gap ${track.gapId} exists`).toBeDefined();
      expect(gap!.title).toBe(track.title);
      expect(gap!.rawStatement).toBe(track.rawStatement);
      expect(gap!.targetCapability).toBe(track.targetCapability);
      expect(gap!.dailyMinutes).toBe(track.dailyMinutes);
      expect(gap!.status).toBe('draft');
    }
  });

  it('gives every seeded gap at least two sources with structural locators', async () => {
    const context = buildContext();
    await seedCurriculum(context, OWNER);

    for (const track of SEED_TRACKS) {
      const sources = await context.uow.sources.listForGap(OWNER, track.gapId);
      expect(sources.length, `${track.gapId} has >= 2 sources`).toBeGreaterThanOrEqual(2);
      expect(sources).toHaveLength(track.sources.length);

      for (const source of sources) {
        expect(source.processingStatus, `${source.filename} is indexed`).toBe('indexed');
        const chunks = await context.uow.sources.listChunks(OWNER, source.id);
        expect(chunks.length, `${source.filename} has chunks`).toBeGreaterThan(0);
        const locators = chunks.map((chunk) => chunk.locator);
        for (const locator of locators) {
          // A structural locator addresses a named section, not the whole document.
          expect(locator, `${source.filename} locator is structural`).toMatch(/^§\s+\S/);
          expect(locator).not.toBe('§ Document');
        }
        // No two chunks may claim the same address.
        expect(new Set(locators).size, `${source.filename} locators are distinct`).toBe(
          locators.length,
        );
      }
    }
  });

  it('is idempotent: re-running the seed does not duplicate gaps, sources or chunks', async () => {
    const context = buildContext();
    await seedCurriculum(context, OWNER);

    // Snapshot chunk ids per source after the first run.
    const chunkIds: Record<string, string[]> = {};
    for (const track of SEED_TRACKS) {
      for (const source of await context.uow.sources.listForGap(OWNER, track.gapId)) {
        chunkIds[source.id] = (await context.uow.sources.listChunks(OWNER, source.id)).map(
          (chunk) => chunk.id,
        );
      }
    }

    const secondRun = await seedCurriculum(context, OWNER);
    expect(secondRun.map((r) => r.gapId).sort()).toEqual(SEED_TRACKS.map((t) => t.gapId).sort());

    // Gap count unchanged.
    expect(await context.uow.gaps.list(OWNER)).toHaveLength(3);

    for (const track of SEED_TRACKS) {
      const sources = await context.uow.sources.listForGap(OWNER, track.gapId);
      // Source count unchanged — the checksum-addressed cache reuses the first registration.
      expect(sources, `${track.gapId} sources not duplicated`).toHaveLength(track.sources.length);

      for (const source of sources) {
        const chunks = await context.uow.sources.listChunks(OWNER, source.id);
        // Chunk count and ids unchanged — the second run reuses the same extraction.
        expect(
          chunks.map((chunk) => chunk.id),
          `${source.filename} chunks not duplicated`,
        ).toEqual(chunkIds[source.id]);
      }
    }
  });

  it('gap list output shows the three seeded gaps with target capabilities', async () => {
    const context = buildContext();
    // gapList is wired to the CLI's own owner (GAPOS_OWNER ?? 'cli-learner'), so seed as that
    // owner — exactly the flow `pnpm exec gapos gap list` runs after seeding.
    await seedCurriculum(context, CLI_OWNER);

    const { lines, out } = collectLines();
    await gapList(context, [], { out });

    for (const track of SEED_TRACKS) {
      const line = lines.find((l) => l.startsWith(`${track.gapId}\t`));
      expect(line, `${track.gapId} appears in gap list`).toBeDefined();
      expect(line).toContain(track.targetCapability);
    }
  });
});
