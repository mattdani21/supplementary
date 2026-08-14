/**
 * Seed Matt's three real learning tracks as gaps (GAP-032, E21).
 *
 * Creates three gaps through the CLI service layer — math-to-ML fluency, the frontier-papers
 * ladder, and TOPIK Korean — each with the genuine source material from
 * ~/Seoul-plan/SKILLS-CURRICULUM.md and ~/Seoul-plan/TOPIK-TRACKER.md plus real URLs (arXiv
 * paper IDs, MIT OCW 18.06, 3Blue1Brown playlists, TTMIK, topik.go.kr). Sources are ingested
 * immediately (chunked into §-addressed sections, exactly what stage B of the compile pipeline
 * does later), so a seeded gap is ready for GAP-033 without a compile and without any provider
 * call.
 *
 * Idempotent by construction: gap ids are deterministic, and re-registering an identical source
 * hits the checksum-addressed extraction cache, so re-running never duplicates gaps, sources or
 * chunks.
 *
 * Run it:
 *
 *     GAPOS_DATABASE_URL=<dsn> pnpm tsx scripts/seed-curriculum.ts
 *
 * Without GAPOS_DATABASE_URL it seeds in-memory repositories, then prints the same view
 * `gapos gap list` prints — the acceptance — in the same process.
 */
import { pathToFileURL } from 'node:url';
import { chunkDocument } from '@gapos/domain';
import { SEED_TRACKS } from '@gapos/test-fixtures';
import type { OwnerId, Source } from '@gapos/database';
import { getServerContext } from '../apps/web/src/server/bootstrap.js';
import { createGap, registerSource } from '../apps/web/src/server/services/gap-service.js';
import type { ServerContext } from '../apps/web/src/server/context.js';
import { OWNER as CLI_OWNER, gapList } from '../apps/cli/src/commands.js';

/**
 * The seed writes as the CLI's default learner unless GAPOS_OWNER is set, so `gapos gap list`
 * shows the seeded gaps without any extra configuration.
 */
export const SEED_OWNER: OwnerId = CLI_OWNER;

export interface SeedGapResult {
  readonly gapId: string;
  readonly title: string;
  /** Whether the gap row was created on this run (false = already seeded). */
  readonly created: boolean;
  readonly sourcesRegistered: number;
  /** Sources the checksum cache reused instead of inserting. */
  readonly sourcesReused: number;
}

/**
 * Seed every track in SEED_TRACKS. Safe to call repeatedly: an existing gap is reused as-is,
 * and an identical source registration is deduplicated by checksum.
 */
export const seedCurriculum = async (
  context: ServerContext,
  owner: OwnerId = SEED_OWNER,
): Promise<SeedGapResult[]> => {
  await ensureOwnerUser(context, owner);
  const results: SeedGapResult[] = [];

  for (const track of SEED_TRACKS) {
    let gap = await context.uow.gaps.get(owner, track.gapId);
    const created = gap === undefined;
    if (!gap) {
      gap = await createGap(context, owner, {
        id: track.gapId,
        title: track.title,
        rawStatement: track.rawStatement,
        targetCapability: track.targetCapability,
        dailyMinutes: track.dailyMinutes,
      });
    }

    let sourcesRegistered = 0;
    let sourcesReused = 0;
    for (const source of track.sources) {
      const registration = await registerSource(context, owner, {
        gapId: gap.id,
        filename: source.filename,
        mediaType: source.mediaType,
        text: source.text,
      });
      if (!registration.accepted) {
        throw new Error(
          `Seed source rejected for ${track.gapId}: ${registration.code} — ${registration.message}`,
        );
      }
      if (registration.deduplicated) sourcesReused += 1;
      sourcesRegistered += 1;
      await ingestSource(context, owner, registration.source, source.text);
    }

    results.push({
      gapId: gap.id,
      title: track.title,
      created,
      sourcesRegistered,
      sourcesReused,
    });
  }

  return results;
};

/**
 * The ingestion half of the compile pipeline's stage B (apps/worker/src/pipeline/compile.ts),
 * without the run-step bookkeeping and without embeddings: chunk the registered text into
 * §-addressed sections and mark the source indexed, so locators exist before any compile.
 */
const ensureOwnerUser = async (context: ServerContext, owner: OwnerId): Promise<void> => {
  // Gaps carry a foreign key to users, so a Postgres-backed seed needs the owner row first —
  // the same "create account" step every journey test performs.
  const existing = await context.uow.users.find(owner);
  if (!existing) {
    await context.uow.users.create({
      id: owner,
      email: `${owner}@example.com`,
      locale: 'en',
      timezone: 'UTC',
    });
  }
};

const ingestSource = async (
  context: ServerContext,
  owner: OwnerId,
  source: Source,
  text: string,
): Promise<void> => {
  if (source.processingStatus === 'indexed') return; // a previous seed run already extracted it

  const chunks = chunkDocument(text);
  await context.uow.sources.replaceChunks(
    owner,
    source.id,
    chunks.map((chunk) => ({
      id: `${source.id}_c${chunk.ordinal}`,
      sourceId: source.id,
      ordinal: chunk.ordinal,
      text: chunk.text,
      locator: chunk.locator,
      extractionConfidence: chunk.extractionConfidence,
      tokenEstimate: chunk.tokenEstimate,
    })),
  );
  await context.uow.sources.setStatus(owner, source.id, 'indexed');
};

const write = (line: string): void => {
  // The CLI's stdout is its interface; lint's no-console exception covers warn/error only.
  process.stdout.write(`${line}\n`);
};

const main = async (): Promise<void> => {
  const context = await getServerContext();
  const results = await seedCurriculum(context);

  for (const result of results) {
    write(
      `seeded ${result.gapId} (${result.title}) ${result.created ? 'created' : 'exists'} — ` +
        `${result.sourcesRegistered} sources (${result.sourcesReused} reused)`,
    );
  }

  // The acceptance view: the same output `gapos gap list` prints, shown in-process so a run
  // without GAPOS_DATABASE_URL still demonstrates the seeded state.
  write('');
  write('gap list:');
  await gapList(context, [], { out: write });
};

// Run only when executed directly, so the repository test can import seedCurriculum.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `SEED FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
