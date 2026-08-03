/**
 * In-memory repositories.
 *
 * Not a mock: this is a full implementation of the same interfaces, used by unit tests and by
 * local development without Docker. It enforces exactly the same ownership rule as the Postgres
 * implementation, so a test that passes here is testing the real access-control behaviour.
 *
 * The Postgres implementation is verified against the identical suite (`shared-suite.ts`).
 */

import type { GapStatus, GenerationStatus } from '@gapos/domain';
import {
  ConcurrentModificationError,
  NotFoundError,
  type Artefact,
  type Attempt,
  type AttemptRepository,
  type AuditFinding,
  type Curriculum,
  type CurriculumRepository,
  type Gap,
  type GapRepository,
  type GenerationRepository,
  type GenerationRun,
  type GenerationStepRecord,
  type KnowledgeEdge,
  type KnowledgeRepository,
  type Lesson,
  type MasteryEvidenceRecord,
  type MasteryRepository,
  type OwnerId,
  type ReviewItem,
  type Source,
  type SourceChunk,
  type SourceRepository,
  type StoredQuestion,
  type UnitOfWork,
  type User,
  type UserRepository,
} from './types.js';

/** A table whose rows always carry an owner, and which can only be read through one. */
class OwnedTable<T extends { id: string; ownerId: OwnerId }> {
  private readonly rows = new Map<string, T>();

  insert(row: T): T {
    this.rows.set(row.id, row);
    return row;
  }

  get(owner: OwnerId, id: string): T | undefined {
    const row = this.rows.get(id);
    return row && row.ownerId === owner ? row : undefined;
  }

  require(entity: string, owner: OwnerId, id: string): T {
    const row = this.get(owner, id);
    if (!row) throw new NotFoundError(entity, id);
    return row;
  }

  where(owner: OwnerId, predicate: (row: T) => boolean = () => true): T[] {
    return [...this.rows.values()].filter((row) => row.ownerId === owner && predicate(row));
  }

  replace(row: T): T {
    this.rows.set(row.id, row);
    return row;
  }

  deleteOwnedBy(owner: OwnerId): void {
    for (const [id, row] of this.rows) {
      if (row.ownerId === owner) this.rows.delete(id);
    }
  }

  get size(): number {
    return this.rows.size;
  }
}

export interface MemoryStore {
  readonly users: Map<string, User>;
  readonly gaps: OwnedTable<Gap>;
  readonly sources: OwnedTable<Source>;
  readonly chunks: OwnedTable<SourceChunk>;
  readonly curricula: OwnedTable<Curriculum>;
  readonly lessons: OwnedTable<Lesson>;
  readonly questions: OwnedTable<StoredQuestion>;
  readonly artefacts: OwnedTable<Artefact>;
  readonly attempts: OwnedTable<Attempt>;
  readonly evidence: OwnedTable<MasteryEvidenceRecord>;
  readonly reviews: OwnedTable<ReviewItem>;
  readonly runs: OwnedTable<GenerationRun>;
  readonly steps: Map<string, GenerationStepRecord>;
  readonly findings: OwnedTable<AuditFinding>;
  readonly edges: OwnedTable<KnowledgeEdge>;
  readonly auditLog: { ownerId?: OwnerId; action: string; target: string }[];
}

/** Cosine similarity in [0, 1]; identical vectors score 1, orthogonal score 0. */
export const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const createMemoryStore = (): MemoryStore => ({
  users: new Map(),
  gaps: new OwnedTable(),
  sources: new OwnedTable(),
  chunks: new OwnedTable(),
  curricula: new OwnedTable(),
  lessons: new OwnedTable(),
  questions: new OwnedTable(),
  artefacts: new OwnedTable(),
  attempts: new OwnedTable(),
  evidence: new OwnedTable(),
  reviews: new OwnedTable(),
  runs: new OwnedTable(),
  steps: new Map(),
  findings: new OwnedTable(),
  edges: new OwnedTable(),
  auditLog: [],
});

export const createMemoryUnitOfWork = (store: MemoryStore = createMemoryStore()): UnitOfWork => {
  const users: UserRepository = {
    async create(user) {
      store.users.set(user.id, user);
      return user;
    },
    async find(id) {
      return store.users.get(id);
    },
    async findByEmail(email) {
      return [...store.users.values()].find((u) => u.email === email);
    },
    async deleteAccount(id) {
      store.users.delete(id);
      for (const table of [
        store.gaps,
        store.sources,
        store.chunks,
        store.curricula,
        store.lessons,
        store.questions,
        store.artefacts,
        store.attempts,
        store.evidence,
        store.reviews,
        store.runs,
        store.findings,
        store.edges,
      ]) {
        table.deleteOwnedBy(id);
      }
      for (const [key, step] of store.steps) {
        if (step.ownerId === id) store.steps.delete(key);
      }
      store.auditLog.push({ ownerId: id, action: 'account_deleted', target: id });
    },
  };

  const gaps: GapRepository = {
    async create(owner, gap) {
      return store.gaps.insert({ ...gap, ownerId: owner });
    },
    async get(owner, id) {
      return store.gaps.get(owner, id);
    },
    async list(owner, filter) {
      return store.gaps
        .where(owner, (g) => !filter?.status || g.status === filter.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async update(owner, id, patch) {
      const gap = store.gaps.require('Gap', owner, id);
      return store.gaps.replace({ ...gap, ...patch, updatedAt: new Date() });
    },
    async setStatus(owner, id, next: GapStatus, expected: GapStatus) {
      const gap = store.gaps.require('Gap', owner, id);
      if (gap.status !== expected) {
        throw new ConcurrentModificationError('Gap', id, expected, gap.status);
      }
      return store.gaps.replace({ ...gap, status: next, updatedAt: new Date() });
    },
  };

  const sources: SourceRepository = {
    async create(owner, source) {
      return store.sources.insert({ ...source, ownerId: owner });
    },
    async get(owner, id) {
      return store.sources.get(owner, id);
    },
    async listForGap(owner, gapId) {
      return store.sources.where(owner, (s) => s.gapId === gapId);
    },
    async findByChecksum(owner, checksum) {
      return store.sources.where(owner, (s) => s.checksum === checksum)[0];
    },
    async setStatus(owner, id, status, rejectionCode) {
      const source = store.sources.require('Source', owner, id);
      return store.sources.replace({
        ...source,
        processingStatus: status,
        ...(rejectionCode === undefined ? {} : { rejectionCode }),
      });
    },
    async replaceChunks(owner, sourceId, chunks) {
      store.sources.require('Source', owner, sourceId);
      for (const chunk of store.chunks.where(owner, (c) => c.sourceId === sourceId)) {
        store.chunks.replace({ ...chunk, sourceId: '__deleted__' });
      }
      for (const chunk of chunks) store.chunks.insert({ ...chunk, ownerId: owner });
    },
    async listChunks(owner, sourceId) {
      return store.chunks
        .where(owner, (c) => c.sourceId === sourceId)
        .sort((a, b) => a.ordinal - b.ordinal);
    },
    async setChunkEmbeddings(owner, sourceId, vectors) {
      for (const { chunkId, vector } of vectors) {
        const chunk = store.chunks.get(owner, chunkId);
        if (chunk && chunk.sourceId === sourceId) {
          store.chunks.replace({ ...chunk, embedding: vector });
        }
      }
    },
    async searchChunks(owner, gapId, query, limit = 8, embedding) {
      // The property being tested is the ownership and gap boundary, identical in both
      // implementations; the ranking differs. With a query embedding and embedded chunks,
      // rank by cosine similarity; otherwise fall back to lexical overlap.
      const gapSourceIds = new Set(
        store.sources.where(owner, (s) => s.gapId === gapId).map((s) => s.id),
      );
      const chunks = store.chunks.where(owner, (c) => gapSourceIds.has(c.sourceId));
      const embedded = embedding !== undefined && chunks.some((c) => c.embedding !== undefined);

      const terms = query
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 3);

      const scored = chunks.map((chunk) => {
        if (embedded) {
          // Mirrors the SQL path: only embedded chunks compete, ranked by cosine distance.
          return {
            chunk,
            score: chunk.embedding ? cosineSimilarity(embedding!, chunk.embedding) : 0,
          };
        }
        const text = chunk.text.toLowerCase();
        return { chunk, score: terms.filter((t) => text.includes(t)).length };
      });

      return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.chunk.ordinal - b.chunk.ordinal)
        .slice(0, limit)
        .map((s) => s.chunk);
    },
  };

  const curricula: CurriculumRepository = {
    async create(owner, curriculum) {
      return store.curricula.insert({ ...curriculum, ownerId: owner });
    },
    async get(owner, id) {
      return store.curricula.get(owner, id);
    },
    async getCurrentForGap(owner, gapId) {
      return store.curricula
        .where(owner, (c) => c.gapId === gapId && c.status !== 'superseded')
        .sort(
          (a, b) =>
            b.version - a.version || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
        )[0];
    },
    async getForRun(owner, runId) {
      return store.curricula.where(owner, (c) => c.runId === runId)[0];
    },
    async setStatus(owner, id, status) {
      const curriculum = store.curricula.require('Curriculum', owner, id);
      return store.curricula.replace({ ...curriculum, status });
    },

    async upsertLesson(owner, lesson) {
      return store.lessons.replace({ ...lesson, ownerId: owner });
    },
    async listLessons(owner, curriculumId) {
      return store.lessons
        .where(owner, (l) => l.curriculumId === curriculumId)
        .sort((a, b) => a.day - b.day || a.ordinal - b.ordinal);
    },
    async publishLesson(owner, lessonId, at) {
      const lesson = store.lessons.require('Lesson', owner, lessonId);
      return store.lessons.replace({ ...lesson, publicationStatus: 'published', publishedAt: at });
    },

    async upsertQuestions(owner, questions) {
      for (const question of questions) store.questions.replace({ ...question, ownerId: owner });
    },
    async listQuestions(owner, lessonId) {
      return store.questions.where(owner, (q) => q.lessonId === lessonId);
    },
    async getQuestion(owner, id) {
      return store.questions.get(owner, id);
    },

    async addArtefact(owner, artefact) {
      const existing = store.artefacts.get(owner, artefact.id);
      if (existing) return existing;
      return store.artefacts.insert({ ...artefact, ownerId: owner });
    },
    async listArtefacts(owner, lessonId) {
      return store.artefacts
        .where(owner, (a) => a.lessonId === lessonId)
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.segmentOrdinal - b.segmentOrdinal);
    },
    async freezeArtefacts(owner, lessonId) {
      for (const artefact of store.artefacts.where(owner, (a) => a.lessonId === lessonId)) {
        store.artefacts.replace({ ...artefact, frozen: true });
      }
    },
  };

  const attempts: AttemptRepository = {
    async record(owner, attempt) {
      const existing = store.attempts.where(
        owner,
        (a) => a.idempotencyKey === attempt.idempotencyKey,
      )[0];
      if (existing) return { attempt: existing, created: false };
      return { attempt: store.attempts.insert({ ...attempt, ownerId: owner }), created: true };
    },
    async listForObjective(owner, objectiveId) {
      const questionIds = new Set(
        store.questions.where(owner, (q) => q.objectiveId === objectiveId).map((q) => q.id),
      );
      return store.attempts
        .where(owner, (a) => questionIds.has(a.questionId))
        .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
    },
    async listForSession(owner, sessionId) {
      return store.attempts.where(owner, (a) => a.sessionId === sessionId);
    },
  };

  const mastery: MasteryRepository = {
    async addEvidence(owner, evidence) {
      return store.evidence.insert({ ...evidence, ownerId: owner });
    },
    async listEvidence(owner, objectiveId) {
      return store.evidence
        .where(owner, (e) => e.objectiveId === objectiveId)
        .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    },
    async listEvidenceForCurriculum(owner, curriculumId) {
      return store.evidence.where(owner, (e) => e.curriculumId === curriculumId);
    },
    async scheduleReview(owner, item) {
      return store.reviews.insert({ ...item, ownerId: owner });
    },
    async listDueReviews(owner, now) {
      return store.reviews
        .where(owner, (r) => r.state !== 'completed' && r.state !== 'cancelled' && r.dueAt <= now)
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    },
    async completeReview(owner, id) {
      const item = store.reviews.require('ReviewItem', owner, id);
      return store.reviews.replace({ ...item, state: 'completed' });
    },
  };

  const generation: GenerationRepository = {
    async startRun(owner, run) {
      const existing = store.runs.where(owner, (r) => r.idempotencyKey === run.idempotencyKey)[0];
      if (existing) return { run: existing, created: false };
      return { run: store.runs.insert({ ...run, ownerId: owner }), created: true };
    },
    async getRun(owner, id) {
      return store.runs.get(owner, id);
    },
    async setRunStatus(owner, id, status: GenerationStatus, error) {
      const run = store.runs.require('GenerationRun', owner, id);
      const terminal = ['complete', 'partial', 'failed', 'cancelled'].includes(status);
      return store.runs.replace({
        ...run,
        status,
        ...(error === undefined ? {} : { error }),
        ...(terminal ? { finishedAt: new Date() } : {}),
      });
    },
    async addRunCost(owner, id, millicents) {
      const run = store.runs.require('GenerationRun', owner, id);
      store.runs.replace({ ...run, costMillicents: run.costMillicents + millicents });
    },

    async getStep(owner, key) {
      const step = store.steps.get(key);
      return step && step.ownerId === owner ? step : undefined;
    },
    async upsertStep(owner, step) {
      const row = { ...step, ownerId: owner };
      store.steps.set(step.key, row);
      return row;
    },
    async listSteps(owner, runId) {
      return [...store.steps.values()].filter((s) => s.ownerId === owner && s.runId === runId);
    },

    async addFinding(owner, finding) {
      return store.findings.insert({ ...finding, ownerId: owner });
    },
    async listFindings(owner, runId) {
      return store.findings.where(owner, (f) => f.runId === runId);
    },
    async updateFinding(owner, id, patch) {
      const finding = store.findings.require('AuditFinding', owner, id);
      return store.findings.replace({ ...finding, ...patch });
    },
  };

  const knowledge: KnowledgeRepository = {
    async addEdge(owner, edge) {
      const existing = store.edges.where(
        owner,
        (e) =>
          e.fromCapability === edge.fromCapability &&
          e.toCapability === edge.toCapability &&
          e.relationship === edge.relationship,
      )[0];
      if (existing) return existing;
      return store.edges.insert({ ...edge, ownerId: owner });
    },
    async listEdges(owner) {
      return store.edges.where(owner);
    },
  };

  return { users, gaps, sources, curricula, attempts, mastery, generation, knowledge };
};
