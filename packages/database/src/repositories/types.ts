/**
 * Repository interfaces.
 *
 * Every read and every write takes an `OwnerId` as its first argument. There is deliberately no
 * `findById(id)` anywhere in this package: a cross-tenant read is a type error, not a review
 * finding. See tasks/decisions.md.
 */

import type { CurriculumPlan, LessonPackage, Question } from '@gapos/ai-contracts';
import type { GapStatus, GenerationStatus, StepState } from '@gapos/domain';

/** A branded id, so an owner cannot be passed where a gap id is expected. */
export type OwnerId = string & { readonly __brand?: 'OwnerId' };

export interface User {
  readonly id: OwnerId;
  readonly email: string;
  readonly locale: string;
  readonly timezone: string;
}

export interface Gap {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly title: string;
  readonly rawStatement: string;
  readonly currentState?: string;
  readonly targetCapability?: string;
  readonly successCondition?: string;
  readonly deadline?: string;
  readonly dailyMinutes: number;
  readonly sourcePolicy: 'general_knowledge_allowed' | 'sources_only';
  readonly status: GapStatus;
  readonly assumptions: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Source {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly gapId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly storageKey: string;
  readonly processingStatus: 'pending' | 'extracting' | 'indexed' | 'rejected' | 'failed';
  readonly rejectionCode?: string;
}

export interface SourceChunk {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly sourceId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly locator: string;
  readonly extractionConfidence: number;
  readonly tokenEstimate: number;
  /** Vector embedding (GAP-018). Absent when the deployment has no embedding capability. */
  readonly embedding?: readonly number[];
}

export interface Curriculum {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly gapId: string;
  /** The generation run that produced it; a re-entered run re-enters its curriculum. */
  readonly runId?: string;
  readonly version: number;
  readonly durationDays: number;
  readonly dailyMinutes: number;
  readonly status: 'draft' | 'published' | 'partial' | 'superseded';
  readonly qualityScore?: number;
  readonly plan: CurriculumPlan;
  readonly createdAt?: Date;
}

export interface Lesson {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly curriculumId: string;
  readonly day: number;
  readonly ordinal: number;
  readonly title: string;
  readonly estimatedMinutes: number;
  readonly objectiveIds: readonly string[];
  readonly package: LessonPackage;
  readonly version: number;
  readonly publicationStatus: 'draft' | 'verified' | 'published' | 'excluded';
  readonly publishedAt?: Date;
  /** Educator review (E19): a flagged lesson sits in the review queue until decided. */
  readonly reviewStatus?: 'pending' | 'approved' | 'rejected';
  /** The reviewer's note; shown on the lesson once set. */
  readonly reviewNote?: string;
}

export interface Artefact {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly lessonId: string;
  readonly kind: 'audio' | 'transcript' | 'visual';
  readonly storageKey: string;
  readonly mediaType: string;
  readonly checksum: string;
  readonly durationSeconds?: number;
  readonly version: number;
  /**
   * Position within the lesson. Audio is synthesised as several segments, so a lesson has many
   * artefacts of kind `audio`; a transcript is a single artefact at 0. Migration 002 exists
   * because the original schema assumed one artefact per kind.
   */
  readonly segmentOrdinal: number;
  readonly frozen: boolean;
}

export interface StoredQuestion {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly lessonId: string;
  readonly objectiveId: string;
  readonly payload: Question;
  readonly version: number;
  readonly verified: boolean;
}

export interface Attempt {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly questionId: string;
  readonly sessionId: string;
  readonly response: string;
  readonly correct: boolean;
  readonly score: number;
  readonly hintsUsed: number;
  readonly confidence?: 'low' | 'medium' | 'high';
  readonly idempotencyKey: string;
  readonly completedAt: Date;
}

export interface MasteryEvidenceRecord {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly objectiveId: string;
  readonly curriculumId: string;
  readonly attemptId?: string;
  readonly sessionId: string;
  readonly evidenceType:
    'retrieval' | 'application' | 'transfer' | 'delayed_retrieval' | 'cumulative';
  readonly score: number;
  readonly independent: boolean;
  readonly difficulty: number;
  readonly recordedAt: Date;
}

export interface ReviewItem {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly objectiveId: string;
  readonly questionId?: string;
  readonly curriculumId: string;
  readonly dueAt: Date;
  readonly intervalDays: number;
  readonly state: 'scheduled' | 'due' | 'completed' | 'cancelled';
  readonly reason: 'ladder' | 'remediation' | 'confidence_drop';
}

export interface GenerationRun {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly gapId: string;
  readonly pipelineVersion: string;
  readonly status: GenerationStatus;
  readonly idempotencyKey: string;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly costMillicents: number;
  readonly error?: string;
}

export interface GenerationStepRecord {
  readonly key: string;
  readonly runId: string;
  readonly ownerId: OwnerId;
  readonly step: string;
  readonly subject?: string;
  readonly inputVersion: string;
  readonly state: StepState;
  readonly attempt: number;
  readonly output?: unknown;
  readonly error?: string;
}

export interface AuditFinding {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly runId: string;
  readonly targetId: string;
  readonly category: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly finding: string;
  readonly repairStatus: 'open' | 'repaired' | 'excluded' | 'accepted';
  readonly repairAttempts: number;
}

export interface KnowledgeEdge {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly fromCapability: string;
  readonly toCapability: string;
  readonly relationship: 'prerequisite_of' | 'extends' | 'related';
  readonly confidence: number;
}

/* ------------------------------------------------------------------- repositories */

export interface UserRepository {
  create(user: User): Promise<User>;
  find(id: OwnerId): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  /** Removes the user and every owned row. Writes an audit record. */
  deleteAccount(id: OwnerId): Promise<void>;
}

export interface GapRepository {
  create(owner: OwnerId, gap: Omit<Gap, 'ownerId'>): Promise<Gap>;
  get(owner: OwnerId, id: string): Promise<Gap | undefined>;
  list(owner: OwnerId, filter?: { status?: GapStatus }): Promise<Gap[]>;
  update(
    owner: OwnerId,
    id: string,
    patch: Partial<Omit<Gap, 'id' | 'ownerId' | 'status'>>,
  ): Promise<Gap>;
  /**
   * The only way to change a status. Callers pass the value the domain state machine returned;
   * this method never computes one. `expected` makes the write a compare-and-set, so two workers
   * cannot both advance the same gap.
   */
  setStatus(owner: OwnerId, id: string, next: GapStatus, expected: GapStatus): Promise<Gap>;
}

export interface SourceRepository {
  create(owner: OwnerId, source: Omit<Source, 'ownerId'>): Promise<Source>;
  get(owner: OwnerId, id: string): Promise<Source | undefined>;
  listForGap(owner: OwnerId, gapId: string): Promise<Source[]>;
  /** Extraction cache lookup: an identical file has already been extracted. */
  findByChecksum(owner: OwnerId, checksum: string): Promise<Source | undefined>;
  setStatus(
    owner: OwnerId,
    id: string,
    status: Source['processingStatus'],
    rejectionCode?: string,
  ): Promise<Source>;
  replaceChunks(
    owner: OwnerId,
    sourceId: string,
    chunks: Omit<SourceChunk, 'ownerId'>[],
  ): Promise<void>;
  listChunks(owner: OwnerId, sourceId: string): Promise<SourceChunk[]>;
  /** Store the embeddings a provider produced for a source's chunks (GAP-018). */
  setChunkEmbeddings(
    owner: OwnerId,
    sourceId: string,
    vectors: readonly { chunkId: string; vector: readonly number[] }[],
  ): Promise<void>;
  /**
   * Retrieval, always scoped to the owner and to the gap's own sources. When `embedding` (the
   * query's embedding) is supplied and chunks carry embeddings, ranking is by cosine distance;
   * otherwise it falls back to lexical overlap. Both implementations share this contract.
   */
  searchChunks(
    owner: OwnerId,
    gapId: string,
    query: string,
    limit?: number,
    embedding?: readonly number[],
  ): Promise<SourceChunk[]>;
}

export interface CurriculumRepository {
  create(owner: OwnerId, curriculum: Omit<Curriculum, 'ownerId'>): Promise<Curriculum>;
  get(owner: OwnerId, id: string): Promise<Curriculum | undefined>;
  getCurrentForGap(owner: OwnerId, gapId: string): Promise<Curriculum | undefined>;
  /** The curriculum a generation run produced — the run's own, which a resumed run re-enters. */
  getForRun(owner: OwnerId, runId: string): Promise<Curriculum | undefined>;
  setStatus(owner: OwnerId, id: string, status: Curriculum['status']): Promise<Curriculum>;

  upsertLesson(owner: OwnerId, lesson: Omit<Lesson, 'ownerId'>): Promise<Lesson>;
  listLessons(owner: OwnerId, curriculumId: string): Promise<Lesson[]>;
  publishLesson(owner: OwnerId, lessonId: string, at: Date): Promise<Lesson>;
  /** Record an educator review decision (E19); the note is shown on the lesson. */
  setReview(
    owner: OwnerId,
    lessonId: string,
    reviewStatus: NonNullable<Lesson['reviewStatus']>,
    note?: string,
  ): Promise<Lesson | undefined>;

  upsertQuestions(owner: OwnerId, questions: Omit<StoredQuestion, 'ownerId'>[]): Promise<void>;
  listQuestions(owner: OwnerId, lessonId: string): Promise<StoredQuestion[]>;
  getQuestion(owner: OwnerId, id: string): Promise<StoredQuestion | undefined>;

  addArtefact(owner: OwnerId, artefact: Omit<Artefact, 'ownerId'>): Promise<Artefact>;
  listArtefacts(owner: OwnerId, lessonId: string): Promise<Artefact[]>;
  freezeArtefacts(owner: OwnerId, lessonId: string): Promise<void>;
}

export interface AttemptRepository {
  /** Idempotent: a repeated key returns the original attempt rather than double-counting. */
  record(
    owner: OwnerId,
    attempt: Omit<Attempt, 'ownerId'>,
  ): Promise<{ attempt: Attempt; created: boolean }>;
  listForObjective(owner: OwnerId, objectiveId: string): Promise<Attempt[]>;
  listForSession(owner: OwnerId, sessionId: string): Promise<Attempt[]>;
}

export interface MasteryRepository {
  addEvidence(
    owner: OwnerId,
    evidence: Omit<MasteryEvidenceRecord, 'ownerId'>,
  ): Promise<MasteryEvidenceRecord>;
  listEvidence(owner: OwnerId, objectiveId: string): Promise<MasteryEvidenceRecord[]>;
  listEvidenceForCurriculum(owner: OwnerId, curriculumId: string): Promise<MasteryEvidenceRecord[]>;

  scheduleReview(owner: OwnerId, item: Omit<ReviewItem, 'ownerId'>): Promise<ReviewItem>;
  listDueReviews(owner: OwnerId, now: Date): Promise<ReviewItem[]>;
  completeReview(owner: OwnerId, id: string): Promise<ReviewItem>;
}

export interface GenerationRepository {
  /** Returns the existing run when the idempotency key has been seen. */
  startRun(
    owner: OwnerId,
    run: Omit<GenerationRun, 'ownerId'>,
  ): Promise<{ run: GenerationRun; created: boolean }>;
  getRun(owner: OwnerId, id: string): Promise<GenerationRun | undefined>;
  setRunStatus(
    owner: OwnerId,
    id: string,
    status: GenerationStatus,
    error?: string,
  ): Promise<GenerationRun>;
  addRunCost(owner: OwnerId, id: string, millicents: number): Promise<void>;

  getStep(owner: OwnerId, key: string): Promise<GenerationStepRecord | undefined>;
  upsertStep(owner: OwnerId, step: GenerationStepRecord): Promise<GenerationStepRecord>;
  listSteps(owner: OwnerId, runId: string): Promise<GenerationStepRecord[]>;

  addFinding(owner: OwnerId, finding: Omit<AuditFinding, 'ownerId'>): Promise<AuditFinding>;
  listFindings(owner: OwnerId, runId: string): Promise<AuditFinding[]>;
  updateFinding(
    owner: OwnerId,
    id: string,
    patch: Partial<Pick<AuditFinding, 'repairStatus' | 'repairAttempts'>>,
  ): Promise<AuditFinding>;
}

export interface KnowledgeRepository {
  addEdge(owner: OwnerId, edge: Omit<KnowledgeEdge, 'ownerId'>): Promise<KnowledgeEdge>;
  listEdges(owner: OwnerId): Promise<KnowledgeEdge[]>;
}

/* --------------------------------------------------------------------- job queue */

export type JobKind = 'compile';
export type JobState = 'ready' | 'leased' | 'succeeded' | 'failed' | 'dead_letter';

export interface CompileJobPayload {
  readonly gapId: string;
  readonly idempotencyKey: string;
  readonly audioEnabled?: boolean;
  readonly concurrency?: number;
}

/**
 * A durable work item. The worker leases jobs rather than deleting them, so a crash returns the
 * job to the queue once `leasedUntil` passes; step idempotency then makes the re-run safe. A job
 * that fails `maxAttempts` times is dead-lettered with its last error, and `payload` is the
 * reproduction context (docs/OPERATIONS.md).
 */
export interface Job {
  readonly id: string;
  readonly ownerId: OwnerId;
  readonly kind: JobKind;
  readonly runId?: string;
  readonly payload: CompileJobPayload;
  readonly state: JobState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly leasedUntil?: Date;
  readonly lastError?: string;
  readonly createdAt: Date;
}

/**
 * The durable job queue (GAP-015). Unlike the learner repositories this is system
 * infrastructure — the worker processes every learner's jobs — so `claimDue` is deliberately
 * the one method without an owner: it is the polling face of the worker, equivalent to the
 * migration runner. Every other method is owner-scoped like everything else: completing or
 * failing a job requires knowing its owner first, so a guessed job id is not a way to touch
 * another learner's work.
 */
export interface JobQueue {
  enqueue(
    owner: OwnerId,
    job: Omit<Job, 'ownerId' | 'state' | 'attempts' | 'availableAt' | 'createdAt'>,
    now: Date,
  ): Promise<Job>;
  /**
   * Lease the jobs that are due: `ready` with `availableAt` passed, or `leased` past their
   * lease (a crashed worker's job returning to the queue). Postgres leases atomically with
   * `FOR UPDATE SKIP LOCKED` so concurrent workers cannot claim the same job.
   */
  claimDue(now: Date, limit?: number, leaseDurationMs?: number): Promise<Job[]>;
  complete(owner: OwnerId, id: string): Promise<Job | undefined>;
  /** Record a failure: one more attempt, exponential backoff, dead-letter at `maxAttempts`. */
  fail(owner: OwnerId, id: string, error: string, now: Date): Promise<Job | undefined>;
  get(owner: OwnerId, id: string): Promise<Job | undefined>;
  listByState(owner: OwnerId, state: JobState): Promise<Job[]>;
}

export interface UnitOfWork {
  readonly users: UserRepository;
  readonly gaps: GapRepository;
  readonly sources: SourceRepository;
  readonly curricula: CurriculumRepository;
  readonly attempts: AttemptRepository;
  readonly mastery: MasteryRepository;
  readonly generation: GenerationRepository;
  readonly knowledge: KnowledgeRepository;
}

/** Thrown when a write targets a row the caller does not own or that does not exist. */
export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found for this owner.`);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a compare-and-set status write loses the race. */
export class ConcurrentModificationError extends Error {
  constructor(entity: string, id: string, expected: string, actual: string) {
    super(`${entity} ${id} is ${actual}, not the expected ${expected}.`);
    this.name = 'ConcurrentModificationError';
  }
}
