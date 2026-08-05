/**
 * One suite, both implementations.
 *
 * The in-memory and Postgres repositories are held to exactly the same contract. A test that
 * passes for one and fails for the other is a bug in one of them — which is the whole reason
 * this file exists rather than two parallel test files that drift apart.
 *
 * The claim under test is not "the query has a WHERE clause" but "owner A cannot observe
 * anything owned by B through any method on any repository".
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { assembleLesson, referencePlan } from '@gapos/test-fixtures';
import {
  ConcurrentModificationError,
  NotFoundError,
  type OwnerId,
  type UnitOfWork,
} from './types.js';

export const ALICE: OwnerId = 'user_alice';
export const BOB: OwnerId = 'user_bob';

export const seedGap = (uow: UnitOfWork, owner: OwnerId, id: string) =>
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

const seedSource = (uow: UnitOfWork, owner: OwnerId, gapId: string, sourceId: string) =>
  uow.sources.create(owner, {
    id: sourceId,
    gapId,
    filename: `${sourceId}.md`,
    mediaType: 'text/markdown',
    byteSize: 100,
    checksum: `checksum_${sourceId}`,
    storageKey: `key/${sourceId}`,
    processingStatus: 'indexed',
  });

export interface SuiteHarness {
  /** A fresh, empty unit of work. Called before every test. */
  readonly create: () => Promise<UnitOfWork> | UnitOfWork;
  readonly teardown?: () => Promise<void> | void;
}

/**
 * Run the repository contract against one implementation.
 *
 * Called twice: once for memory (always) and once for Postgres (when a database URL is set).
 */
export const describeRepositoryContract = (name: string, harness: SuiteHarness): void => {
  describe(`${name}: ownership`, () => {
    let uow: UnitOfWork;

    beforeEach(async () => {
      uow = await harness.create();
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

    it('filters a list by status without leaking across owners', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      await seedGap(uow, BOB, 'gap_bob');
      await uow.gaps.setStatus(BOB, 'gap_bob', 'ready', 'draft');

      expect((await uow.gaps.list(ALICE, { status: 'draft' })).map((g) => g.id)).toEqual([
        'gap_alice',
      ]);
      expect(await uow.gaps.list(ALICE, { status: 'ready' })).toEqual([]);
      expect((await uow.gaps.list(BOB, { status: 'ready' })).map((g) => g.id)).toEqual(['gap_bob']);
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
      await expect(
        uow.gaps.setStatus(BOB, 'gap_alice', 'compiling', 'draft'),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect((await uow.gaps.get(ALICE, 'gap_alice'))?.status).toBe('draft');
    });

    it('keeps source chunks inside the owning learner', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      await seedSource(uow, ALICE, 'gap_alice', 'src_1');
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

    it('refuses to replace chunks on another learner’s source', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      await seedSource(uow, ALICE, 'gap_alice', 'src_1');
      await expect(uow.sources.replaceChunks(BOB, 'src_1', [])).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('replaces chunks rather than merging them', async () => {
      // Re-extraction must not leave stale chunks behind with ordinals that no longer line up.
      await seedGap(uow, ALICE, 'gap_alice');
      await seedSource(uow, ALICE, 'gap_alice', 'src_1');

      const chunk = (id: string, ordinal: number, text: string) => ({
        id,
        sourceId: 'src_1',
        ordinal,
        text,
        locator: `§${ordinal}`,
        extractionConfidence: 1,
        tokenEstimate: 5,
      });

      await uow.sources.replaceChunks(ALICE, 'src_1', [
        chunk('c0', 0, 'first pass alpha'),
        chunk('c1', 1, 'first pass beta'),
      ]);
      await uow.sources.replaceChunks(ALICE, 'src_1', [chunk('c0', 0, 'second pass only')]);

      const chunks = await uow.sources.listChunks(ALICE, 'src_1');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]?.text).toBe('second pass only');
    });

    it('keeps retrieval inside the gap as well as inside the owner', async () => {
      await seedGap(uow, ALICE, 'gap_one');
      await seedGap(uow, ALICE, 'gap_two');

      for (const [gapId, sourceId] of [
        ['gap_one', 'src_one'],
        ['gap_two', 'src_two'],
      ] as const) {
        await seedSource(uow, ALICE, gapId, sourceId);
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

    it('retrieves by meaning when embeddings are present, staying inside owner and gap', async () => {
      await seedGap(uow, ALICE, 'gap_one');
      await seedGap(uow, ALICE, 'gap_two');
      await seedGap(uow, BOB, 'gap_bob');
      await seedSource(uow, ALICE, 'gap_one', 'src_one');
      await seedSource(uow, ALICE, 'gap_two', 'src_two');
      await seedSource(uow, BOB, 'gap_bob', 'src_bob');

      const chunksFor = (sourceId: string) => [
        {
          id: `chunk_${sourceId}_a`,
          sourceId,
          ordinal: 0,
          text: 'Linear algebra over finite fields.',
          locator: '§1',
          extractionConfidence: 1,
          tokenEstimate: 10,
        },
        {
          id: `chunk_${sourceId}_b`,
          sourceId,
          ordinal: 1,
          text: 'An equivalence relation partitions the underlying set.',
          locator: '§6',
          extractionConfidence: 1,
          tokenEstimate: 10,
        },
      ];
      await uow.sources.replaceChunks(ALICE, 'src_one', chunksFor('src_one'));
      await uow.sources.replaceChunks(ALICE, 'src_two', chunksFor('src_two'));
      await uow.sources.replaceChunks(BOB, 'src_bob', chunksFor('src_bob'));

      // The query embeds to [1,0,0,…]; only src_one's equivalence chunk is near it. The query
      // text itself ('frogurt') shares no words with any chunk — meaning, not overlap, is what
      // ranks it. Vectors are 384-dimensional because the pgvector column is vector(384).
      const vec = (index: number): number[] =>
        Array.from({ length: 384 }, (_, d) => (d === index ? 1 : 0));
      const queryVector = vec(0);
      await uow.sources.setChunkEmbeddings(ALICE, 'src_one', [
        { chunkId: 'chunk_src_one_a', vector: vec(1) },
        { chunkId: 'chunk_src_one_b', vector: vec(0) },
      ]);
      await uow.sources.setChunkEmbeddings(ALICE, 'src_two', [
        { chunkId: 'chunk_src_two_a', vector: vec(383) },
        { chunkId: 'chunk_src_two_b', vector: vec(383) },
      ]);
      await uow.sources.setChunkEmbeddings(BOB, 'src_bob', [
        { chunkId: 'chunk_src_bob_a', vector: vec(0) },
        { chunkId: 'chunk_src_bob_b', vector: vec(0) },
      ]);

      const hits = await uow.sources.searchChunks(ALICE, 'gap_one', 'frogurt', 5, queryVector);
      // The semantically nearest chunk ranks first; the others tie at distance 1 (all one-hot
      // vectors are mutually orthogonal), so the top of the ranking is the contract, not a
      // single-row result.
      expect(hits[0]?.id).toBe('chunk_src_one_b');
      expect(hits.length).toBeGreaterThan(0);

      // The vector path is bounded by owner and gap exactly like the lexical one.
      expect(
        await uow.sources.searchChunks(BOB, 'gap_bob', 'frogurt', 5, queryVector),
      ).toHaveLength(2);
      expect(await uow.sources.searchChunks(BOB, 'gap_one', 'frogurt', 5, queryVector)).toEqual([]);
    });

    it('finds a previously uploaded source by checksum, per owner', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      await seedGap(uow, BOB, 'gap_bob');
      await seedSource(uow, ALICE, 'gap_alice', 'src_1');

      expect((await uow.sources.findByChecksum(ALICE, 'checksum_src_1'))?.id).toBe('src_1');
      expect(await uow.sources.findByChecksum(BOB, 'checksum_src_1')).toBeUndefined();
    });

    it('hides a curriculum, its lessons, questions and artefacts from another learner', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      const curriculum = await uow.curricula.create(ALICE, {
        id: 'cur_1',
        gapId: 'gap_alice',
        version: 1,
        durationDays: 3,
        dailyMinutes: 35,
        status: 'published',
        plan: referencePlan('gap_alice'),
      });

      const lessonPackage = assembleLesson(1);
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
      await uow.curricula.upsertQuestions(
        ALICE,
        lessonPackage.questions.map((q) => ({
          id: q.id,
          lessonId: 'lesson_1',
          objectiveId: q.objectiveId,
          payload: q,
          version: 1,
          verified: true,
        })),
      );
      await uow.curricula.addArtefact(ALICE, {
        id: 'artefact_1',
        lessonId: 'lesson_1',
        kind: 'transcript',
        storageKey: 'lesson_1/transcript',
        mediaType: 'text/plain',
        checksum: 'abc',
        version: 1,
        segmentOrdinal: 0,
        frozen: false,
      });

      expect(await uow.curricula.get(BOB, curriculum.id)).toBeUndefined();
      expect(await uow.curricula.getCurrentForGap(BOB, 'gap_alice')).toBeUndefined();
      expect(await uow.curricula.listLessons(BOB, curriculum.id)).toEqual([]);
      expect(await uow.curricula.listQuestions(BOB, 'lesson_1')).toEqual([]);
      expect(await uow.curricula.getQuestion(BOB, lessonPackage.questions[0]!.id)).toBeUndefined();
      expect(await uow.curricula.listArtefacts(BOB, 'lesson_1')).toEqual([]);
    });

    it('stores every audio segment of a lesson, in order', async () => {
      // A lesson is synthesised as several segments, all kind='audio' at the same version. The
      // original schema assumed one artefact per kind, which silently disabled audio on
      // Postgres while memory accepted it — the exact divergence this shared suite exists for.
      await seedGap(uow, ALICE, 'gap_alice');
      const curriculum = await uow.curricula.create(ALICE, {
        id: 'cur_1',
        gapId: 'gap_alice',
        version: 1,
        durationDays: 1,
        dailyMinutes: 35,
        status: 'published',
        plan: referencePlan('gap_alice'),
      });
      const lessonPackage = assembleLesson(1);
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

      for (let segment = 0; segment < 4; segment++) {
        await uow.curricula.addArtefact(ALICE, {
          id: `audio_${segment}`,
          lessonId: 'lesson_1',
          kind: 'audio',
          storageKey: `lesson_1/seg_${segment}`,
          mediaType: 'audio/mpeg',
          checksum: `checksum_${segment}`,
          durationSeconds: 30,
          version: 1,
          segmentOrdinal: segment,
          frozen: false,
        });
      }
      await uow.curricula.addArtefact(ALICE, {
        id: 'transcript_1',
        lessonId: 'lesson_1',
        kind: 'transcript',
        storageKey: 'lesson_1/transcript',
        mediaType: 'text/plain',
        checksum: 'transcript',
        version: 1,
        segmentOrdinal: 0,
        frozen: false,
      });

      const artefacts = await uow.curricula.listArtefacts(ALICE, 'lesson_1');
      const audio = artefacts.filter((a) => a.kind === 'audio');

      expect(audio).toHaveLength(4);
      // Playback order matters: segments out of order are a scrambled lesson.
      expect(audio.map((a) => a.segmentOrdinal)).toEqual([0, 1, 2, 3]);
      expect(artefacts.filter((a) => a.kind === 'transcript')).toHaveLength(1);

      await uow.curricula.freezeArtefacts(ALICE, 'lesson_1');
      expect((await uow.curricula.listArtefacts(ALICE, 'lesson_1')).every((a) => a.frozen)).toBe(
        true,
      );
    });

    it('round-trips a curriculum plan and a lesson package unchanged', async () => {
      // Guards the JSON boundary: a plan that comes back subtly different would silently change
      // what the learner is taught.
      await seedGap(uow, ALICE, 'gap_alice');
      const plan = referencePlan('gap_alice');
      const created = await uow.curricula.create(ALICE, {
        id: 'cur_1',
        gapId: 'gap_alice',
        version: 1,
        durationDays: plan.days.length,
        dailyMinutes: plan.dailyMinutes,
        status: 'draft',
        plan,
      });

      const fetched = await uow.curricula.get(ALICE, created.id);
      expect(fetched?.plan).toEqual(plan);

      const lessonPackage = assembleLesson(2);
      await uow.curricula.upsertLesson(ALICE, {
        id: 'lesson_2',
        curriculumId: created.id,
        day: 2,
        ordinal: 0,
        title: lessonPackage.title,
        estimatedMinutes: lessonPackage.estimatedMinutes,
        objectiveIds: lessonPackage.objectiveIds,
        package: lessonPackage,
        version: 1,
        publicationStatus: 'verified',
      });

      const [lesson] = await uow.curricula.listLessons(ALICE, created.id);
      expect(lesson?.package).toEqual(lessonPackage);
      expect(lesson?.objectiveIds).toEqual(lessonPackage.objectiveIds);
    });

    it('returns the curriculum a generation run produced, to the owner only', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      await seedGap(uow, ALICE, 'gap_alice_2');
      const { run } = await uow.generation.startRun(ALICE, {
        id: 'run_cur',
        gapId: 'gap_alice',
        pipelineVersion: '1.0.0',
        status: 'queued',
        idempotencyKey: 'key_cur',
        startedAt: new Date('2026-08-02T09:00:00Z'),
        costMillicents: 0,
      });
      const created = await uow.curricula.create(ALICE, {
        id: 'cur_run',
        gapId: 'gap_alice',
        runId: run.id,
        version: 1,
        durationDays: 1,
        dailyMinutes: 35,
        status: 'draft',
        plan: referencePlan('gap_alice'),
      });

      // A resumed run finds its own curriculum…
      expect((await uow.curricula.getForRun(ALICE, run.id))?.id).toBe(created.id);
      // …and nobody else's run or learner can.
      expect(await uow.curricula.getForRun(ALICE, 'run_unknown')).toBeUndefined();
      expect(await uow.curricula.getForRun(BOB, run.id)).toBeUndefined();
    });

    it('is idempotent on artefact identity, as a resumed run needs it to be', async () => {
      // A worker restart re-enters the same lesson and re-synthesises from the recorded step,
      // then adds the artefact rows again. The deterministic id (lesson:kind:segment:version)
      // must make that a no-op, or a green restart would double the audio.
      await seedGap(uow, ALICE, 'gap_alice');
      const curriculum = await uow.curricula.create(ALICE, {
        id: 'cur_art',
        gapId: 'gap_alice',
        version: 1,
        durationDays: 1,
        dailyMinutes: 35,
        status: 'published',
        plan: referencePlan('gap_alice'),
      });
      await uow.curricula.upsertLesson(ALICE, {
        id: 'lesson_art',
        curriculumId: curriculum.id,
        day: 1,
        ordinal: 0,
        title: 'Lesson',
        estimatedMinutes: 5,
        objectiveIds: ['obj_a'],
        package: assembleLesson(1),
        version: 1,
        publicationStatus: 'published',
      });

      const artefact = {
        id: 'lesson_art:audio:0:v1',
        lessonId: 'lesson_art',
        kind: 'audio' as const,
        storageKey: 'lesson_art/seg_0',
        mediaType: 'audio/mpeg',
        checksum: 'checksum',
        durationSeconds: 30,
        version: 1,
        segmentOrdinal: 0,
        frozen: false,
      };
      await uow.curricula.addArtefact(ALICE, artefact);
      await uow.curricula.addArtefact(ALICE, { ...artefact, checksum: 're-synthesised' });

      const artefacts = await uow.curricula.listArtefacts(ALICE, 'lesson_art');
      expect(artefacts).toHaveLength(1);
      expect(artefacts[0]?.checksum).toBe('checksum');
    });

    it('hides runs, steps and findings from another learner', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      const { run } = await uow.generation.startRun(ALICE, {
        id: 'run_1',
        gapId: 'gap_alice',
        pipelineVersion: '1.0.0',
        status: 'queued',
        idempotencyKey: 'key_1',
        startedAt: new Date('2026-08-02T09:00:00Z'),
        costMillicents: 0,
      });
      await uow.generation.upsertStep(ALICE, {
        key: 'run_1:plan_curriculum:-:v1',
        runId: run.id,
        ownerId: ALICE,
        step: 'plan_curriculum',
        inputVersion: 'v1',
        state: 'succeeded',
        attempt: 1,
        output: { objectives: 4 },
      });
      await uow.generation.addFinding(ALICE, {
        id: 'finding_1',
        runId: run.id,
        targetId: 'lesson_1',
        category: 'answer_leakage',
        severity: 'critical',
        finding: 'The answer is in the prompt.',
        repairStatus: 'open',
        repairAttempts: 0,
      });

      expect(await uow.generation.getRun(BOB, run.id)).toBeUndefined();
      expect(await uow.generation.getStep(BOB, 'run_1:plan_curriculum:-:v1')).toBeUndefined();
      expect(await uow.generation.listSteps(BOB, run.id)).toEqual([]);
      expect(await uow.generation.listFindings(BOB, run.id)).toEqual([]);

      expect((await uow.generation.getStep(ALICE, 'run_1:plan_curriculum:-:v1'))?.output).toEqual({
        objectives: 4,
      });
    });

    it('hides mastery evidence and review items from another learner', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      const curriculum = await uow.curricula.create(ALICE, {
        id: 'cur_1',
        gapId: 'gap_alice',
        version: 1,
        durationDays: 3,
        dailyMinutes: 35,
        status: 'published',
        plan: referencePlan('gap_alice'),
      });

      await uow.mastery.addEvidence(ALICE, {
        id: 'evidence_1',
        objectiveId: 'obj_subset_proof',
        curriculumId: curriculum.id,
        sessionId: 'session_1',
        evidenceType: 'retrieval',
        score: 1,
        independent: true,
        difficulty: 2,
        recordedAt: new Date('2026-08-02T10:00:00Z'),
      });
      await uow.mastery.scheduleReview(ALICE, {
        id: 'review_1',
        objectiveId: 'obj_subset_proof',
        curriculumId: curriculum.id,
        dueAt: new Date('2026-08-01T10:00:00Z'),
        intervalDays: 1,
        state: 'scheduled',
        reason: 'ladder',
      });

      expect(await uow.mastery.listEvidence(ALICE, 'obj_subset_proof')).toHaveLength(1);
      expect(await uow.mastery.listEvidence(BOB, 'obj_subset_proof')).toEqual([]);
      expect(await uow.mastery.listEvidenceForCurriculum(BOB, curriculum.id)).toEqual([]);

      const now = new Date('2026-08-02T10:00:00Z');
      expect(await uow.mastery.listDueReviews(ALICE, now)).toHaveLength(1);
      expect(await uow.mastery.listDueReviews(BOB, now)).toEqual([]);
    });

    it('does not return a review that is not yet due, or one already completed', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      const curriculum = await uow.curricula.create(ALICE, {
        id: 'cur_1',
        gapId: 'gap_alice',
        version: 1,
        durationDays: 3,
        dailyMinutes: 35,
        status: 'published',
        plan: referencePlan('gap_alice'),
      });
      const base = {
        objectiveId: 'obj_subset_proof',
        curriculumId: curriculum.id,
        intervalDays: 1,
        state: 'scheduled' as const,
        reason: 'ladder' as const,
      };

      await uow.mastery.scheduleReview(ALICE, {
        ...base,
        id: 'due',
        dueAt: new Date('2026-08-01T10:00:00Z'),
      });
      await uow.mastery.scheduleReview(ALICE, {
        ...base,
        id: 'later',
        dueAt: new Date('2026-08-09T10:00:00Z'),
      });
      await uow.mastery.scheduleReview(ALICE, {
        ...base,
        id: 'done',
        dueAt: new Date('2026-08-01T10:00:00Z'),
      });
      await uow.mastery.completeReview(ALICE, 'done');

      const due = await uow.mastery.listDueReviews(ALICE, new Date('2026-08-02T10:00:00Z'));
      expect(due.map((r) => r.id)).toEqual(['due']);
    });

    it('keeps knowledge edges per learner and does not duplicate them', async () => {
      const edge = {
        id: 'edge_1',
        fromCapability: 'sets',
        toCapability: 'relations',
        relationship: 'prerequisite_of' as const,
        confidence: 0.9,
      };
      await uow.knowledge.addEdge(ALICE, edge);
      await uow.knowledge.addEdge(ALICE, { ...edge, id: 'edge_2' });

      expect(await uow.knowledge.listEdges(ALICE)).toHaveLength(1);
      expect(await uow.knowledge.listEdges(BOB)).toEqual([]);
    });

    it('deletes every owned row on account deletion and leaves the other learner intact', async () => {
      await seedGap(uow, ALICE, 'gap_alice');
      await seedGap(uow, BOB, 'gap_bob');
      await seedSource(uow, ALICE, 'gap_alice', 'src_1');
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
      expect(await uow.sources.listForGap(ALICE, 'gap_alice')).toEqual([]);
      expect(await uow.knowledge.listEdges(ALICE)).toEqual([]);

      expect((await uow.gaps.list(BOB)).map((g) => g.id)).toEqual(['gap_bob']);
      expect(await uow.users.find(BOB)).toBeDefined();
    });
  });

  describe(`${name}: idempotency and concurrency`, () => {
    let uow: UnitOfWork;

    beforeEach(async () => {
      uow = await harness.create();
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
        startedAt: new Date('2026-08-02T09:00:00Z'),
        costMillicents: 0,
      };
      const first = await uow.generation.startRun(ALICE, run);
      const second = await uow.generation.startRun(ALICE, { ...run, id: 'run_2' });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.run.id).toBe('run_1');
    });

    it('lets a different learner reuse the same idempotency key', async () => {
      // Keys are scoped per owner; one learner's key must not block another's compile.
      await uow.users.create({ id: BOB, email: 'bob@example.com', locale: 'en', timezone: 'UTC' });
      await seedGap(uow, BOB, 'gap_bob');

      const base = {
        pipelineVersion: '1.0.0',
        status: 'queued' as const,
        idempotencyKey: 'shared-key',
        startedAt: new Date('2026-08-02T09:00:00Z'),
        costMillicents: 0,
      };
      const alice = await uow.generation.startRun(ALICE, {
        ...base,
        id: 'run_a',
        gapId: 'gap_alice',
      });
      const bob = await uow.generation.startRun(BOB, { ...base, id: 'run_b', gapId: 'gap_bob' });

      expect(alice.created).toBe(true);
      expect(bob.created).toBe(true);
      expect(bob.run.id).toBe('run_b');
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
      const lessonPackage = assembleLesson(1);
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
        completedAt: new Date('2026-08-02T10:00:00Z'),
      };

      const first = await uow.attempts.record(ALICE, attempt);
      const second = await uow.attempts.record(ALICE, { ...attempt, id: 'attempt_2' });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.attempt.id).toBe('attempt_1');
      expect(await uow.attempts.listForObjective(ALICE, question.objectiveId)).toHaveLength(1);
      expect(await uow.attempts.listForSession(ALICE, 'session_1')).toHaveLength(1);
    });

    it('rejects a status change whose expected value has moved on', async () => {
      await uow.gaps.setStatus(ALICE, 'gap_alice', 'ready', 'draft');
      await expect(
        uow.gaps.setStatus(ALICE, 'gap_alice', 'compiling', 'draft'),
      ).rejects.toBeInstanceOf(ConcurrentModificationError);
      expect((await uow.gaps.get(ALICE, 'gap_alice'))?.status).toBe('ready');
    });

    it('re-running a step overwrites its record rather than creating a second', async () => {
      const { run } = await uow.generation.startRun(ALICE, {
        id: 'run_1',
        gapId: 'gap_alice',
        pipelineVersion: '1.0.0',
        status: 'queued',
        idempotencyKey: 'k',
        startedAt: new Date('2026-08-02T09:00:00Z'),
        costMillicents: 0,
      });
      const step = {
        key: 'run_1:generate_lesson:day-1:v1',
        runId: run.id,
        ownerId: ALICE,
        step: 'generate_lesson',
        subject: 'day-1',
        inputVersion: 'v1',
      };

      await uow.generation.upsertStep(ALICE, { ...step, state: 'running', attempt: 1 });
      await uow.generation.upsertStep(ALICE, {
        ...step,
        state: 'succeeded',
        attempt: 1,
        output: { day: 1 },
      });

      const steps = await uow.generation.listSteps(ALICE, run.id);
      expect(steps).toHaveLength(1);
      expect(steps[0]?.state).toBe('succeeded');
      expect(steps[0]?.output).toEqual({ day: 1 });
    });

    it('accumulates run cost rather than replacing it', async () => {
      const { run } = await uow.generation.startRun(ALICE, {
        id: 'run_1',
        gapId: 'gap_alice',
        pipelineVersion: '1.0.0',
        status: 'queued',
        idempotencyKey: 'k',
        startedAt: new Date('2026-08-02T09:00:00Z'),
        costMillicents: 0,
      });

      await uow.generation.addRunCost(ALICE, run.id, 1500);
      await uow.generation.addRunCost(ALICE, run.id, 500);

      expect((await uow.generation.getRun(ALICE, run.id))?.costMillicents).toBe(2000);
    });

    it('stamps a finish time when a run reaches a terminal status', async () => {
      const { run } = await uow.generation.startRun(ALICE, {
        id: 'run_1',
        gapId: 'gap_alice',
        pipelineVersion: '1.0.0',
        status: 'queued',
        idempotencyKey: 'k',
        startedAt: new Date('2026-08-02T09:00:00Z'),
        costMillicents: 0,
      });

      const running = await uow.generation.setRunStatus(ALICE, run.id, 'planning');
      expect(running.finishedAt).toBeUndefined();

      const finished = await uow.generation.setRunStatus(ALICE, run.id, 'complete');
      expect(finished.finishedAt).toBeInstanceOf(Date);
    });
  });
};
