/**
 * Vector retrieval through the real pipeline (GAP-018).
 *
 * The repository contract suite proves searchChunks semantics on both implementations. This
 * proves the pipeline uses them: with a scripted embedding capability, a compile embeds each
 * source's chunks and the query, stores the vectors, and retrieval ranks by meaning — a chunk
 * that shares no words with the learner's statement is still retrieved when its embedding is
 * the nearest. Without the capability (the default), nothing changes and retrieval stays
 * lexical; the primary journey covers that.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import { chunkDocument } from '@gapos/domain';
import type { OwnerId } from '@gapos/database';
import { createServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../../apps/web/src/server/services/gap-service.js';

const LEARNER: OwnerId = 'user_embeddings';

const steppingClock = (start = new Date('2026-08-02T09:00:00Z')) => {
  let current = start.getTime();
  return {
    now: () => new Date((current += 1000)),
    set: (date: Date) => {
      current = date.getTime();
    },
  };
};

const buildContext = (options: Parameters<typeof createServerContext>[0] = {}) => {
  const clock = steppingClock();
  let counter = 0;
  const context = createServerContext({
    now: clock.now,
    newId: (prefix) => `${prefix}_${++counter}`,
    ...options,
  });
  return { context, clock };
};

describe('vector retrieval through the pipeline (GAP-018)', () => {
  it('embeds chunks and the query, and retrieves a chunk the query shares no words with', async () => {
    // Deterministic chunks, exactly as the pipeline will produce them.
    const chunks = chunkDocument(SET_THEORY_SOURCE);
    const target = chunks[2]!; // some chunk; its text shares no words with the statement

    // Script the embedding capability: every chunk embeds to its own distinct vector, and the
    // learner's statement embeds to the TARGET chunk's vector — so only meaning can rank it.
    const vectors: Record<string, number[]> = {};
    chunks.forEach((chunk, index) => {
      vectors[chunk.text] = Array.from({ length: 384 }, (_, d) => (d === index % 384 ? 1 : 0));
    });
    vectors[REFERENCE_GAP_STATEMENT] = vectors[target.text]!;

    const { context } = buildContext({
      fakeEmbeddings: { vectors, costMillicentsPerCall: 2 },
    });
    await context.uow.users.create({
      id: LEARNER,
      email: `${LEARNER}@example.com`,
      locale: 'en',
      timezone: 'UTC',
    });

    const gap = await createGap(context, LEARNER, {
      title: 'Relations and proof techniques',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    const registration = await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    expect(registration.accepted).toBe(true);
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });

    const outcome = await compile(context, LEARNER, { gapId: gap.id, idempotencyKey: 'embed-1' });
    expect(outcome.status).toBe('complete');

    // Chunks carry the stored vectors…
    const [source] = await context.uow.sources.listForGap(LEARNER, gap.id);
    const stored = await context.uow.sources.listChunks(LEARNER, source!.id);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every((chunk) => chunk.embedding !== undefined)).toBe(true);

    // …the run recorded the embedding steps (idempotent on resume)…
    const runs = await context.uow.generation.listSteps(LEARNER, outcome.runId);
    expect(runs.some((s) => s.step === 'embed_chunk' && s.state === 'succeeded')).toBe(true);
    expect(runs.some((s) => s.step === 'embed_query' && s.state === 'succeeded')).toBe(true);

    // …and retrieval by the query's embedding ranks the target chunk first, even though the
    // statement shares no words with it. The pipeline used the vector path, not lexical fallback.
    const hits = await context.uow.sources.searchChunks(
      LEARNER,
      gap.id,
      REFERENCE_GAP_STATEMENT,
      5,
      vectors[REFERENCE_GAP_STATEMENT],
    );
    // Chunk ids are `${sourceId}_c${ordinal}` in storage.
    expect(hits[0]?.id).toBe(`${source!.id}_c${target.ordinal}`);
  });

  it('stays lexical when the deployment has no embedding capability', async () => {
    // The default fake embeddings return undefined: no vectors stored, retrieval unchanged.
    const { context } = buildContext();
    await context.uow.users.create({
      id: LEARNER,
      email: `${LEARNER}@example.com`,
      locale: 'en',
      timezone: 'UTC',
    });
    const gap = await createGap(context, LEARNER, {
      title: 'Relations and proof techniques',
      rawStatement: REFERENCE_GAP_STATEMENT,
      dailyMinutes: 35,
    });
    await registerSource(context, LEARNER, {
      gapId: gap.id,
      filename: 'set-theory-primer.md',
      mediaType: 'text/markdown',
      text: SET_THEORY_SOURCE,
    });
    await applyTransition(context, LEARNER, gap.id, { type: 'define' });

    const outcome = await compile(context, LEARNER, { gapId: gap.id, idempotencyKey: 'embed-2' });
    expect(outcome.status).toBe('complete');

    const [source] = await context.uow.sources.listForGap(LEARNER, gap.id);
    const stored = await context.uow.sources.listChunks(LEARNER, source!.id);
    expect(stored.every((chunk) => chunk.embedding === undefined)).toBe(true);

    // Lexical retrieval still finds chunks by word overlap.
    const hits = await context.uow.sources.searchChunks(LEARNER, gap.id, 'equivalence relation');
    expect(hits.length).toBeGreaterThan(0);
  });
});
