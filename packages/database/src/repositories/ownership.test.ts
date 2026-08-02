/**
 * The ownership property.
 *
 * The claim being tested is not "the query has a WHERE clause" but "owner A cannot observe
 * anything owned by B through any method on any repository". The last test in this file walks
 * the interface by reflection, so a repository method added later without an owner filter fails
 * here rather than shipping.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { referencePlan, referenceLesson } from '@gapos/test-fixtures';
import { createMemoryUnitOfWork } from './memory.js';
import {
  ConcurrentModificationError,
  NotFoundError,
  type OwnerId,
  type UnitOfWork,
} from './types.js';

const ALICE: OwnerId = 'user_alice';
const BOB: OwnerId = 'user_bob';

const seedGap = (uow: UnitOfWork, owner: OwnerId, id: string) =>
  uow.gaps.create(owner, {
    id,
    title: 'Relations and proof',
    rawStatement: 'I need relations by Friday.',
    dailyMinutes: 35,
    sourcePolicy: 'general_knowledge_allowed',
    status: 'draft',
    assumptions: [],
    createdAt: new Date('2026-08-01T09:00:00Z'),
    updatedAt: new Date('2026-08-01T09:00:00Z'),
  });

describe('ownership', () => {
  let uow: UnitOfWork;

  beforeEach(async () => {
    uow = createMemoryUnitOfWork();
    await uow.users.create({
      id: ALICE,
      email: 'alice@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    await uow.users.create({ id: BOB, email: 'bob@example.com', locale: 'en', timezone: 'UTC' });
  });

  it('does not return another learner’s gap by id', async () => {
    await seedGap(uow, ALICE, 'gap_alice');
    expect(await uow.gaps.get(ALICE, 'gap_alice')).toBeDefined();
    expect(await uow.gaps.get(BOB, 'gap_alice')).toBeUndefined();
  });

  it('does not list another learner’s gaps', async () => {
    await seedGap(uow, ALICE, 'gap_alice');
    await seedGap(uow, BOB, 'gap_bob');
    expect((await uow.gaps.list(ALICE)).map((g) => g.id)).toEqual(['gap_alice']);
    expect((await uow.gaps.list(BOB)).map((g) => g.id)).toEqual(['gap_bob']);
  });

  it('refuses a write to another learner’s gap', async () => {
    await seedGap(uow, ALICE, 'gap_alice');
    await expect(uow.gaps.update(BOB, 'gap_alice', { title: 'hijacked' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await uow.gaps.get(ALICE, 'gap_alice'))?.title).toBe('Relations and proof');
  });

  it('refuses a status change on another learner’s gap', async () => {
    await seedGap(uow, ALICE, 'gap_alice');
    await expect(uow.gaps.setStatus(BOB, 'gap_alice', 'compiling', 'draft')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('keeps source chunks inside the owning learner', async () => {
    await seedGap(uow, ALICE, 'gap_alice');
    await uow.sources.create(ALICE, {
      id: 'src_1',
      gapId: 'gap_alice',
      filename: 'primer.md',
      mediaType: 'text/markdown',
      byteSize: 100,
      checksum: 'abc',
      storageKey: 'k1',
      processingStatus: 'indexed',
    });
    await uow.sources.replaceChunks(ALICE, 'src_1', [
      {
        id: 'chunk_1',
        sourceId: 'src_1',
        ordinal: 0,
        text: 'A relation is a subset of the Cartesian product.',
        locator: '§5',
        extractionConfidence: 1,
        tokenEstimate: 12,
      },
    ]);

    expect(await uow.sources.listChunks(ALICE, 'src_1')).toHaveLength(1);
    expect(await uow.sources.listChunks(BOB, 'src_1')).toHaveLength(0);
    expect(await uow.sources.searchChunks(BOB, 'gap_alice', 'relation')).toHaveLength(0);
  });

  it('keeps retrieval inside the gap as well as inside the owner', async () => {
    await seedGap(uow, ALICE, 'gap_one');
    await seedGap(uow, ALICE, 'gap_two');
    for (const [gapId, sourceId] of [
      ['gap_one', 'src_one'],
      ['gap_two', 'src_two'],
    ] as const) {
      await uow.sources.create(ALICE, {
        id: sourceId,
        gapId,
        filename: `${sourceId}.md`,
        mediaType: 'text/markdown',
        byteSize: 10,
        checksum: sourceId,
        storageKey: sourceId,
        processingStatus: 'indexed',
      });
      await uow.sources.replaceChunks(ALICE, sourceId, [
        {
          id: `chunk_${sourceId}`,
          sourceId,
          ordinal: 0,
          text: 'An equivalence relation partitions the underlying set.',
          locator: '§6',
          extractionConfidence: 1,
          tokenEstimate: 10,
        },
      ]);
    }

    const hits = await uow.sources.searchChunks(ALICE, 'gap_one', 'equivalence relation');
    expect(hits.map((c) => c.sourceId)).toEqual(['src_one']);
  });

  it('deletes every owned row on account deletion and leaves the other learner intact', async () => {
    await seedGap(uow, ALICE, 'gap_alice');
    await seedGap(uow, BOB, 'gap_bob');
    await uow.knowledge.addEdge(ALICE, {
      id: 'edge_1',
      fromCapability: 'sets',
      toCapability: 'relations',
      relationship: 'prerequisite_of',
      confidence: 0.9,
    });

    await uow.users.deleteAccount(ALICE);

    expect(await uow.users.find(ALICE)).toBeUndefined();
    expect(await uow.gaps.list(ALICE)).toEqual([]);
    expect(await uow.knowledge.listEdges(ALICE)).toEqual([]);
    expect((await uow.gaps.list(BOB)).map((g) => g.id)).toEqual(['gap_bob']);
  });

  it('has no repository method that reads without an owner', () => {
    // Guards the property structurally: every method's first parameter is the owner. A new
    // `findById(id)` would fail this, which is the entire point.
    const exempt = new Set(['create', 'find', 'findByEmail', 'deleteAccount']);
    for (const [name, repository] of Object.entries(uow)) {
      for (const method of Object.keys(repository as object)) {
        if (name === 'users' && exempt.has(method)) continue;
        const fn = (repository as Record<string, unknown>)[method];
        expect(typeof fn, `${name}.${method}`).toBe('function');
        const source = String(fn);
        expect(source, `${name}.${method} must take an owner first`).toMatch(
          /^\s*async\s*(function\s*)?\w*\s*\(\s*owner\b/,
        );
      }
    }
  });
});

describe('idempotency and concurrency', () => {
  let uow: UnitOfWork;

  beforeEach(async () => {
    uow = createMemoryUnitOfWork();
    await uow.users.create({
      id: ALICE,
      email: 'alice@example.com',
      locale: 'en',
      timezone: 'UTC',
    });
    await seedGap(uow, ALICE, 'gap_alice');
  });

  it('returns the existing run for a repeated compile idempotency key', async () => {
    const run = {
      id: 'run_1',
      gapId: 'gap_alice',
      pipelineVersion: '1.0.0',
      status: 'queued' as const,
      idempotencyKey: 'compile-key-1',
      startedAt: new Date(),
      costMillicents: 0,
    };
    const first = await uow.generation.startRun(ALICE, run);
    const second = await uow.generation.startRun(ALICE, { ...run, id: 'run_2' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe('run_1');
  });

  it('does not double-count a replayed attempt', async () => {
    const curriculum = await uow.curricula.create(ALICE, {
      id: 'cur_1',
      gapId: 'gap_alice',
      version: 1,
      durationDays: 3,
      dailyMinutes: 35,
      status: 'published',
      plan: referencePlan('gap_alice'),
    });
    const lessonPackage = referenceLesson(1);
    await uow.curricula.upsertLesson(ALICE, {
      id: 'lesson_1',
      curriculumId: curriculum.id,
      day: 1,
      ordinal: 0,
      title: lessonPackage.title,
      estimatedMinutes: lessonPackage.estimatedMinutes,
      objectiveIds: lessonPackage.objectiveIds,
      package: lessonPackage,
      version: 1,
      publicationStatus: 'published',
    });
    const question = lessonPackage.questions[0]!;
    await uow.curricula.upsertQuestions(ALICE, [
      {
        id: question.id,
        lessonId: 'lesson_1',
        objectiveId: question.objectiveId,
        payload: question,
        version: 1,
        verified: true,
      },
    ]);

    const attempt = {
      id: 'attempt_1',
      questionId: question.id,
      sessionId: 'session_1',
      response: question.answer,
      correct: true,
      score: 1,
      hintsUsed: 0,
      idempotencyKey: 'attempt-key-1',
      completedAt: new Date(),
    };

    const first = await uow.attempts.record(ALICE, attempt);
    const second = await uow.attempts.record(ALICE, { ...attempt, id: 'attempt_2' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await uow.attempts.listForObjective(ALICE, question.objectiveId)).toHaveLength(1);
  });

  it('rejects a status change whose expected value has moved on', async () => {
    await uow.gaps.setStatus(ALICE, 'gap_alice', 'ready', 'draft');
    await expect(
      uow.gaps.setStatus(ALICE, 'gap_alice', 'compiling', 'draft'),
    ).rejects.toBeInstanceOf(ConcurrentModificationError);
  });
});
