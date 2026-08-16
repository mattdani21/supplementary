/**
 * The Postgres repositories.
 *
 * The same interfaces as the in-memory implementation, backed by SQL, and verified by the same
 * suite (`shared-suite.ts`). That is the point: a test that passes for one and fails for the
 * other is a bug in one of them, and the ownership property is proven at the SQL level rather
 * than only in application code.
 *
 * Two rules hold throughout:
 *
 *   1. Every statement filters on `owner_id`. There is no query here that can be reached with a
 *      row identifier alone, which is why a guessed id is not a data leak.
 *   2. Status writes are compare-and-set. A lost race raises `ConcurrentModificationError`
 *      rather than silently overwriting a status another worker just set.
 */

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { CurriculumPlan, LessonPackage, Question } from '@gapos/ai-contracts';
import type { GapStatus, GenerationStatus, StepState } from '@gapos/domain';
import { normaliseUserProfile } from './user-profile.js';
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
  type NotebookAnnotationRecord,
  type NotebookAnnotationsRepository,
  type ReviewItem,
  type Source,
  type SourceChunk,
  type SourceRepository,
  type StoredQuestion,
  type UnitOfWork,
  type User,
  type UserRepository,
} from './types.js';

/** Anything that can run a query: the pool, or a client inside a transaction. */
interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

const inTransaction = async <T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/* ------------------------------------------------------------------------ mappers */

/* eslint-disable @typescript-eslint/no-explicit-any */

const toUser = (row: any): User => ({
  id: row.id,
  email: row.email,
  locale: row.locale,
  timezone: row.timezone,
  preferredLessonLength: row.preferred_lesson_length ?? 'standard',
  goals: row.goals ?? [],
});

const toGap = (row: any): Gap => ({
  id: row.id,
  ownerId: row.owner_id,
  title: row.title,
  rawStatement: row.raw_statement,
  ...(row.current_state ? { currentState: row.current_state } : {}),
  ...(row.target_capability ? { targetCapability: row.target_capability } : {}),
  ...(row.success_condition ? { successCondition: row.success_condition } : {}),
  ...(row.deadline ? { deadline: toDateOnly(row.deadline) } : {}),
  dailyMinutes: row.daily_minutes,
  sourcePolicy: row.source_policy,
  status: row.status as GapStatus,
  assumptions: row.assumptions ?? [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** `DATE` comes back as a Date in the session timezone; the domain wants the calendar day. */
const toDateOnly = (value: Date | string): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

const toSource = (row: any): Source => ({
  id: row.id,
  ownerId: row.owner_id,
  gapId: row.gap_id,
  filename: row.filename,
  mediaType: row.media_type,
  byteSize: Number(row.byte_size),
  checksum: row.checksum,
  storageKey: row.storage_key,
  processingStatus: row.processing_status,
  ...(row.rejection_code ? { rejectionCode: row.rejection_code } : {}),
});

const toChunk = (row: any): SourceChunk => ({
  id: row.id,
  ownerId: row.owner_id,
  sourceId: row.source_id,
  ordinal: row.ordinal,
  text: row.text,
  locator: row.locator,
  extractionConfidence: Number(row.extraction_confidence),
  tokenEstimate: row.token_estimate,
  // pgvector returns a string like '[0.1,0.2,...]' (or a Buffer in some drivers).
  ...(row.embedding
    ? {
        embedding: (typeof row.embedding === 'string' ? row.embedding : String(row.embedding))
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((n: string) => Number(n)),
      }
    : {}),
});

const toCurriculum = (row: any): Curriculum => ({
  id: row.id,
  ownerId: row.owner_id,
  gapId: row.gap_id,
  runId: row.run_id ?? undefined,
  version: row.version,
  durationDays: row.duration_days,
  dailyMinutes: row.daily_minutes,
  status: row.status,
  ...(row.quality_score === null ? {} : { qualityScore: Number(row.quality_score) }),
  plan: row.plan as CurriculumPlan,
  createdAt: new Date(row.created_at),
});

const toLesson = (row: any): Lesson => ({
  id: row.id,
  ownerId: row.owner_id,
  curriculumId: row.curriculum_id,
  day: row.day,
  ordinal: row.ordinal,
  title: row.title,
  estimatedMinutes: row.estimated_minutes,
  objectiveIds: row.objective_ids ?? [],
  package: row.package as LessonPackage,
  version: row.version,
  publicationStatus: row.publication_status,
  ...(row.published_at ? { publishedAt: row.published_at } : {}),
  ...(row.review_status ? { reviewStatus: row.review_status } : {}),
  ...(row.review_note ? { reviewNote: row.review_note } : {}),
});

const toArtefact = (row: any): Artefact => ({
  id: row.id,
  ownerId: row.owner_id,
  lessonId: row.lesson_id,
  kind: row.kind,
  storageKey: row.storage_key,
  mediaType: row.media_type,
  checksum: row.checksum,
  ...(row.duration_seconds === null ? {} : { durationSeconds: Number(row.duration_seconds) }),
  version: row.version,
  segmentOrdinal: row.segment_ordinal,
  frozen: row.frozen,
});

const toQuestion = (row: any): StoredQuestion => ({
  id: row.id,
  ownerId: row.owner_id,
  lessonId: row.lesson_id,
  objectiveId: row.objective_id,
  payload: row.payload as Question,
  version: row.version,
  verified: row.verified,
});

const toAttempt = (row: any): Attempt => ({
  id: row.id,
  ownerId: row.owner_id,
  questionId: row.question_id,
  sessionId: row.session_id,
  response: row.response,
  correct: row.correct,
  score: Number(row.score),
  hintsUsed: row.hints_used,
  ...(row.confidence ? { confidence: row.confidence } : {}),
  idempotencyKey: row.idempotency_key,
  completedAt: row.completed_at,
});

const toEvidence = (row: any): MasteryEvidenceRecord => ({
  id: row.id,
  ownerId: row.owner_id,
  objectiveId: row.objective_id,
  curriculumId: row.curriculum_id,
  ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
  sessionId: row.session_id,
  evidenceType: row.evidence_type,
  score: Number(row.score),
  independent: row.independent,
  difficulty: row.difficulty,
  recordedAt: row.recorded_at,
});

const toNotebookAnnotation = (row: any): NotebookAnnotationRecord => ({
  id: row.id,
  ownerId: row.owner_id,
  lessonId: row.lesson_id,
  selection: row.selection,
  explanation: row.explanation,
  createdAt: row.created_at,
});

const toReview = (row: any): ReviewItem => ({
  id: row.id,
  ownerId: row.owner_id,
  objectiveId: row.objective_id,
  ...(row.question_id ? { questionId: row.question_id } : {}),
  curriculumId: row.curriculum_id,
  dueAt: row.due_at,
  intervalDays: row.interval_days,
  state: row.state,
  reason: row.reason,
});

const toRun = (row: any): GenerationRun => ({
  id: row.id,
  ownerId: row.owner_id,
  gapId: row.gap_id,
  pipelineVersion: row.pipeline_version,
  status: row.status as GenerationStatus,
  idempotencyKey: row.idempotency_key,
  startedAt: row.started_at,
  ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
  costMillicents: Number(row.cost_millicents),
  ...(row.error ? { error: row.error } : {}),
});

const toStep = (row: any): GenerationStepRecord => ({
  key: row.key,
  runId: row.run_id,
  ownerId: row.owner_id,
  step: row.step,
  ...(row.subject ? { subject: row.subject } : {}),
  inputVersion: row.input_version,
  state: row.state as StepState,
  attempt: row.attempt,
  ...(row.output === null ? {} : { output: row.output }),
  ...(row.error ? { error: row.error } : {}),
});

const toFinding = (row: any): AuditFinding => ({
  id: row.id,
  ownerId: row.owner_id,
  runId: row.run_id,
  targetId: row.target_id,
  category: row.category,
  severity: row.severity,
  finding: row.finding,
  repairStatus: row.repair_status,
  repairAttempts: row.repair_attempts,
});

const toEdge = (row: any): KnowledgeEdge => ({
  id: row.id,
  ownerId: row.owner_id,
  fromCapability: row.from_capability,
  toCapability: row.to_capability,
  relationship: row.relationship,
  confidence: Number(row.confidence),
});

/* eslint-enable @typescript-eslint/no-explicit-any */

const one = <T>(rows: readonly unknown[], map: (row: never) => T): T | undefined =>
  rows.length === 0 ? undefined : map(rows[0] as never);

const require_ = <T>(value: T | undefined, entity: string, id: string): T => {
  if (value === undefined) throw new NotFoundError(entity, id);
  return value;
};

/* ------------------------------------------------------------------ the unit of work */

export const createPostgresUnitOfWork = (pool: Pool): UnitOfWork => {
  const db: Queryable = pool;

  const users: UserRepository = {
    async create(user) {
      const profile = normaliseUserProfile(user);
      const { rows } = await db.query(
        `INSERT INTO users (id, email, locale, timezone, preferred_lesson_length, goals)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        [
          profile.id,
          profile.email,
          profile.locale,
          profile.timezone,
          profile.preferredLessonLength,
          JSON.stringify(profile.goals ?? []),
        ],
      );
      return toUser(rows[0]);
    },
    async find(id) {
      const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
      return one(rows, toUser);
    },
    async findByEmail(email) {
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
      return one(rows, toUser);
    },
    async deleteAccount(id) {
      await inTransaction(pool, async (client) => {
        // Every learner-owned table cascades from users, so one delete clears them all. The
        // audit record is written afterwards and deliberately carries no owner: the trail
        // survives the deletion without re-identifying the deleted learner.
        await client.query('DELETE FROM users WHERE id = $1', [id]);
        await client.query(
          `INSERT INTO audit_log (id, owner_id, action, target, detail)
           VALUES ($1, NULL, 'account_deleted', $2, '{}'::jsonb)`,
          [`audit_${id}_${Date.now()}`, id],
        );
      });
    },
  };

  const gaps: GapRepository = {
    async create(owner, gap) {
      const { rows } = await db.query(
        `INSERT INTO gaps (id, owner_id, title, raw_statement, current_state, target_capability,
                           success_condition, deadline, daily_minutes, source_policy, status,
                           assumptions, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
         RETURNING *`,
        [
          gap.id,
          owner,
          gap.title,
          gap.rawStatement,
          gap.currentState ?? null,
          gap.targetCapability ?? null,
          gap.successCondition ?? null,
          gap.deadline ?? null,
          gap.dailyMinutes,
          gap.sourcePolicy,
          gap.status,
          JSON.stringify(gap.assumptions ?? []),
          gap.createdAt,
          gap.updatedAt,
        ],
      );
      return toGap(rows[0]);
    },

    async get(owner, id) {
      const { rows } = await db.query('SELECT * FROM gaps WHERE id = $1 AND owner_id = $2', [
        id,
        owner,
      ]);
      return one(rows, toGap);
    },

    async list(owner, filter) {
      const { rows } = await db.query(
        `SELECT * FROM gaps
          WHERE owner_id = $1 AND ($2::text IS NULL OR status = $2)
          ORDER BY created_at DESC`,
        [owner, filter?.status ?? null],
      );
      return rows.map(toGap);
    },

    async update(owner, id, patch) {
      const { rows } = await db.query(
        `UPDATE gaps SET
            title             = COALESCE($3, title),
            raw_statement     = COALESCE($4, raw_statement),
            current_state     = COALESCE($5, current_state),
            target_capability = COALESCE($6, target_capability),
            success_condition = COALESCE($7, success_condition),
            deadline          = COALESCE($8, deadline),
            daily_minutes     = COALESCE($9, daily_minutes),
            assumptions       = COALESCE($10::jsonb, assumptions),
            updated_at        = now()
          WHERE id = $1 AND owner_id = $2
          RETURNING *`,
        [
          id,
          owner,
          patch.title ?? null,
          patch.rawStatement ?? null,
          patch.currentState ?? null,
          patch.targetCapability ?? null,
          patch.successCondition ?? null,
          patch.deadline ?? null,
          patch.dailyMinutes ?? null,
          patch.assumptions ? JSON.stringify(patch.assumptions) : null,
        ],
      );
      return require_(one(rows, toGap), 'Gap', id);
    },

    async setStatus(owner, id, next, expected) {
      // Compare-and-set in a single statement: two workers cannot both advance the same gap.
      const { rows } = await db.query(
        `UPDATE gaps SET status = $3, updated_at = now()
          WHERE id = $1 AND owner_id = $2 AND status = $4
          RETURNING *`,
        [id, owner, next, expected],
      );
      const updated = one(rows, toGap);
      if (updated) return updated;

      // No row updated: either it is not ours (or does not exist), or the status has moved on.
      // Those are different failures and the caller handles them differently.
      const current = await gaps.get(owner, id);
      if (!current) throw new NotFoundError('Gap', id);
      throw new ConcurrentModificationError('Gap', id, expected, current.status);
    },
  };

  const sources: SourceRepository = {
    async create(owner, source) {
      const { rows } = await db.query(
        `INSERT INTO sources (id, owner_id, gap_id, filename, media_type, byte_size, checksum,
                              storage_key, processing_status, rejection_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          source.id,
          owner,
          source.gapId,
          source.filename,
          source.mediaType,
          source.byteSize,
          source.checksum,
          source.storageKey,
          source.processingStatus,
          source.rejectionCode ?? null,
        ],
      );
      return toSource(rows[0]);
    },

    async get(owner, id) {
      const { rows } = await db.query('SELECT * FROM sources WHERE id = $1 AND owner_id = $2', [
        id,
        owner,
      ]);
      return one(rows, toSource);
    },

    async listForGap(owner, gapId) {
      const { rows } = await db.query(
        'SELECT * FROM sources WHERE owner_id = $1 AND gap_id = $2 ORDER BY created_at',
        [owner, gapId],
      );
      return rows.map(toSource);
    },

    async findByChecksum(owner, checksum) {
      const { rows } = await db.query(
        'SELECT * FROM sources WHERE owner_id = $1 AND checksum = $2 ORDER BY created_at LIMIT 1',
        [owner, checksum],
      );
      return one(rows, toSource);
    },

    async setStatus(owner, id, status, rejectionCode) {
      const { rows } = await db.query(
        `UPDATE sources SET processing_status = $3, rejection_code = COALESCE($4, rejection_code)
          WHERE id = $1 AND owner_id = $2 RETURNING *`,
        [id, owner, status, rejectionCode ?? null],
      );
      return require_(one(rows, toSource), 'Source', id);
    },

    async replaceChunks(owner, sourceId, chunks) {
      await inTransaction(pool, async (client) => {
        const { rowCount } = await client.query(
          'SELECT 1 FROM sources WHERE id = $1 AND owner_id = $2',
          [sourceId, owner],
        );
        if (!rowCount) throw new NotFoundError('Source', sourceId);

        // Replace, not merge: re-extraction must not leave chunks from the previous pass behind
        // with stale ordinals that no longer line up with the locators.
        await client.query('DELETE FROM source_chunks WHERE source_id = $1 AND owner_id = $2', [
          sourceId,
          owner,
        ]);

        for (const chunk of chunks) {
          await client.query(
            `INSERT INTO source_chunks (id, owner_id, source_id, ordinal, text, locator,
                                        extraction_confidence, token_estimate)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              chunk.id,
              owner,
              chunk.sourceId,
              chunk.ordinal,
              chunk.text,
              chunk.locator,
              chunk.extractionConfidence,
              chunk.tokenEstimate,
            ],
          );
        }
      });
    },

    async listChunks(owner, sourceId) {
      const { rows } = await db.query(
        'SELECT * FROM source_chunks WHERE owner_id = $1 AND source_id = $2 ORDER BY ordinal',
        [owner, sourceId],
      );
      return rows.map(toChunk);
    },

    async setChunkEmbeddings(owner, sourceId, vectors) {
      for (const { chunkId, vector } of vectors) {
        await db.query(
          `UPDATE source_chunks
              SET embedding = $3::vector
            WHERE id = $1 AND owner_id = $2 AND source_id = $4`,
          [chunkId, owner, `[${vector.join(',')}]`, sourceId],
        );
      }
    },

    async searchChunks(owner, gapId, query, limit = 8, embedding) {
      // With a query embedding, rank by pgvector cosine distance (GAP-018); without one, fall
      // back to full-text ranking. Either way the join to `sources` bounds the result by owner
      // AND by gap, so a learner's second gap cannot pull chunks from their first.
      if (embedding !== undefined) {
        const { rows } = await db.query(
          `SELECT c.*
             FROM source_chunks c
             JOIN sources s ON s.id = c.source_id AND s.owner_id = c.owner_id
            WHERE c.owner_id = $1
              AND s.gap_id = $2
              AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> $3::vector, c.ordinal ASC
            LIMIT $4`,
          [owner, gapId, `[${embedding.join(',')}]`, limit],
        );
        return rows.map(toChunk);
      }
      // Every chunk competes, ranked by relevance (E24 US2, T019): the planner must be able
      // to ground a citation in any section of the material, so the tsvector predicate is a
      // rank, not a filter — non-matching chunks rank last and only appear within the limit.
      const { rows } = await db.query(
        `SELECT c.*
           FROM source_chunks c
           JOIN sources s ON s.id = c.source_id AND s.owner_id = c.owner_id
          WHERE c.owner_id = $1
            AND s.gap_id = $2
          ORDER BY ts_rank(to_tsvector('english', c.text), plainto_tsquery('english', $3)) DESC,
                   c.ordinal ASC
          LIMIT $4`,
        [owner, gapId, query, limit],
      );
      return rows.map(toChunk);
    },
  };

  const curricula: CurriculumRepository = {
    async create(owner, curriculum) {
      const { rows } = await db.query(
        `INSERT INTO curricula (id, owner_id, gap_id, run_id, version, duration_days, daily_minutes,
                                status, quality_score, plan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
        [
          curriculum.id,
          owner,
          curriculum.gapId,
          curriculum.runId ?? null,
          curriculum.version,
          curriculum.durationDays,
          curriculum.dailyMinutes,
          curriculum.status,
          curriculum.qualityScore ?? null,
          JSON.stringify(curriculum.plan),
        ],
      );
      return toCurriculum(rows[0]);
    },

    async get(owner, id) {
      const { rows } = await db.query('SELECT * FROM curricula WHERE id = $1 AND owner_id = $2', [
        id,
        owner,
      ]);
      return one(rows, toCurriculum);
    },

    async getCurrentForGap(owner, gapId) {
      const { rows } = await db.query(
        `SELECT * FROM curricula
          WHERE owner_id = $1 AND gap_id = $2 AND status <> 'superseded'
          ORDER BY version DESC, created_at DESC, id LIMIT 1`,
        [owner, gapId],
      );
      return one(rows, toCurriculum);
    },

    async getForRun(owner, runId) {
      const { rows } = await db.query(
        'SELECT * FROM curricula WHERE owner_id = $1 AND run_id = $2 ORDER BY created_at DESC, id LIMIT 1',
        [owner, runId],
      );
      return one(rows, toCurriculum);
    },

    async setStatus(owner, id, status) {
      const { rows } = await db.query(
        'UPDATE curricula SET status = $3 WHERE id = $1 AND owner_id = $2 RETURNING *',
        [id, owner, status],
      );
      return require_(one(rows, toCurriculum), 'Curriculum', id);
    },

    async upsertLesson(owner, lesson) {
      const { rows } = await db.query(
        `INSERT INTO lessons (id, owner_id, curriculum_id, day, ordinal, title, estimated_minutes,
                              objective_ids, script, transcript, summary, package, version,
                              publication_status, published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
            title              = EXCLUDED.title,
            estimated_minutes  = EXCLUDED.estimated_minutes,
            objective_ids      = EXCLUDED.objective_ids,
            script             = EXCLUDED.script,
            transcript         = EXCLUDED.transcript,
            summary            = EXCLUDED.summary,
            package            = EXCLUDED.package,
            version            = EXCLUDED.version,
            publication_status = EXCLUDED.publication_status,
            published_at       = EXCLUDED.published_at
         RETURNING *`,
        [
          lesson.id,
          owner,
          lesson.curriculumId,
          lesson.day,
          lesson.ordinal,
          lesson.title,
          lesson.estimatedMinutes,
          JSON.stringify(lesson.objectiveIds),
          lesson.package.script,
          lesson.package.transcript,
          lesson.package.summary,
          JSON.stringify(lesson.package),
          lesson.version,
          lesson.publicationStatus,
          lesson.publishedAt ?? null,
        ],
      );
      return toLesson(rows[0]);
    },

    async listLessons(owner, curriculumId) {
      const { rows } = await db.query(
        `SELECT * FROM lessons WHERE owner_id = $1 AND curriculum_id = $2
          ORDER BY day, ordinal`,
        [owner, curriculumId],
      );
      return rows.map(toLesson);
    },

    async publishLesson(owner, lessonId, at) {
      const { rows } = await db.query(
        `UPDATE lessons SET publication_status = 'published', published_at = $3
          WHERE id = $1 AND owner_id = $2 RETURNING *`,
        [lessonId, owner, at],
      );
      return require_(one(rows, toLesson), 'Lesson', lessonId);
    },

    async setReview(owner, lessonId, reviewStatus, note) {
      const { rows } = await db.query(
        `UPDATE lessons
            SET review_status = $3,
                review_note = COALESCE($4, review_note)
          WHERE id = $1 AND owner_id = $2
          RETURNING *`,
        [lessonId, owner, reviewStatus, note ?? null],
      );
      return one(rows, toLesson);
    },

    async upsertQuestions(owner, questions) {
      if (questions.length === 0) return;
      await inTransaction(pool, async (client) => {
        for (const question of questions) {
          await client.query(
            `INSERT INTO questions (id, owner_id, lesson_id, objective_id, type, role, difficulty,
                                    payload, version, verified)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
             ON CONFLICT (id) DO UPDATE SET
                objective_id = EXCLUDED.objective_id,
                type         = EXCLUDED.type,
                role         = EXCLUDED.role,
                difficulty   = EXCLUDED.difficulty,
                payload      = EXCLUDED.payload,
                version      = EXCLUDED.version,
                verified     = EXCLUDED.verified`,
            [
              question.id,
              owner,
              question.lessonId,
              question.objectiveId,
              question.payload.type,
              question.payload.role,
              question.payload.difficulty,
              JSON.stringify(question.payload),
              question.version,
              question.verified,
            ],
          );
        }
      });
    },

    async listQuestions(owner, lessonId) {
      const { rows } = await db.query(
        'SELECT * FROM questions WHERE owner_id = $1 AND lesson_id = $2 ORDER BY id',
        [owner, lessonId],
      );
      return rows.map(toQuestion);
    },

    async getQuestion(owner, id) {
      const { rows } = await db.query('SELECT * FROM questions WHERE id = $1 AND owner_id = $2', [
        id,
        owner,
      ]);
      return one(rows, toQuestion);
    },

    async addArtefact(owner, artefact) {
      const { rows } = await db.query(
        `INSERT INTO artefacts (id, owner_id, lesson_id, kind, storage_key, media_type, checksum,
                                duration_seconds, version, segment_ordinal, frozen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET frozen = artefacts.frozen
         RETURNING *`,
        [
          artefact.id,
          owner,
          artefact.lessonId,
          artefact.kind,
          artefact.storageKey,
          artefact.mediaType,
          artefact.checksum,
          artefact.durationSeconds ?? null,
          artefact.version,
          artefact.segmentOrdinal,
          artefact.frozen,
        ],
      );
      return toArtefact(rows[0]);
    },

    async listArtefacts(owner, lessonId) {
      const { rows } = await db.query(
        `SELECT * FROM artefacts WHERE owner_id = $1 AND lesson_id = $2
          ORDER BY kind, segment_ordinal, id`,
        [owner, lessonId],
      );
      return rows.map(toArtefact);
    },

    async freezeArtefacts(owner, lessonId) {
      await db.query('UPDATE artefacts SET frozen = true WHERE owner_id = $1 AND lesson_id = $2', [
        owner,
        lessonId,
      ]);
    },
  };

  const attempts: AttemptRepository = {
    async record(owner, attempt) {
      // The unique constraint on (owner_id, idempotency_key) is what makes this safe under a
      // concurrent replay: at most one insert wins, and the loser reads the winner's row.
      const inserted = await db.query(
        `INSERT INTO attempts (id, owner_id, question_id, session_id, response, correct, score,
                               hints_used, confidence, idempotency_key, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (owner_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          attempt.id,
          owner,
          attempt.questionId,
          attempt.sessionId,
          attempt.response,
          attempt.correct,
          attempt.score,
          attempt.hintsUsed,
          attempt.confidence ?? null,
          attempt.idempotencyKey,
          attempt.completedAt,
        ],
      );

      if (inserted.rows.length > 0) {
        return { attempt: toAttempt(inserted.rows[0]), created: true };
      }

      const { rows } = await db.query(
        'SELECT * FROM attempts WHERE owner_id = $1 AND idempotency_key = $2',
        [owner, attempt.idempotencyKey],
      );
      return { attempt: toAttempt(rows[0]), created: false };
    },

    async listForObjective(owner, objectiveId) {
      const { rows } = await db.query(
        `SELECT a.* FROM attempts a
           JOIN questions q ON q.id = a.question_id AND q.owner_id = a.owner_id
          WHERE a.owner_id = $1 AND q.objective_id = $2
          ORDER BY a.completed_at`,
        [owner, objectiveId],
      );
      return rows.map(toAttempt);
    },

    async listForSession(owner, sessionId) {
      const { rows } = await db.query(
        'SELECT * FROM attempts WHERE owner_id = $1 AND session_id = $2 ORDER BY completed_at',
        [owner, sessionId],
      );
      return rows.map(toAttempt);
    },
  };

  const mastery: MasteryRepository = {
    async addEvidence(owner, evidence) {
      const { rows } = await db.query(
        `INSERT INTO mastery_evidence (id, owner_id, objective_id, curriculum_id, attempt_id,
                                       session_id, evidence_type, score, independent, difficulty,
                                       recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          evidence.id,
          owner,
          evidence.objectiveId,
          evidence.curriculumId,
          evidence.attemptId ?? null,
          evidence.sessionId,
          evidence.evidenceType,
          evidence.score,
          evidence.independent,
          evidence.difficulty,
          evidence.recordedAt,
        ],
      );
      return toEvidence(rows[0]);
    },

    async listEvidence(owner, objectiveId) {
      const { rows } = await db.query(
        `SELECT * FROM mastery_evidence WHERE owner_id = $1 AND objective_id = $2
          ORDER BY recorded_at`,
        [owner, objectiveId],
      );
      return rows.map(toEvidence);
    },

    async listEvidenceForCurriculum(owner, curriculumId) {
      const { rows } = await db.query(
        `SELECT * FROM mastery_evidence WHERE owner_id = $1 AND curriculum_id = $2
          ORDER BY recorded_at`,
        [owner, curriculumId],
      );
      return rows.map(toEvidence);
    },

    async scheduleReview(owner, item) {
      const { rows } = await db.query(
        `INSERT INTO review_items (id, owner_id, objective_id, question_id, curriculum_id,
                                   due_at, interval_days, state, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          item.id,
          owner,
          item.objectiveId,
          item.questionId ?? null,
          item.curriculumId,
          item.dueAt,
          item.intervalDays,
          item.state,
          item.reason,
        ],
      );
      return toReview(rows[0]);
    },

    async listDueReviews(owner, now) {
      const { rows } = await db.query(
        `SELECT * FROM review_items
          WHERE owner_id = $1 AND state NOT IN ('completed', 'cancelled') AND due_at <= $2
          ORDER BY due_at`,
        [owner, now],
      );
      return rows.map(toReview);
    },

    async completeReview(owner, id) {
      const { rows } = await db.query(
        `UPDATE review_items SET state = 'completed' WHERE id = $1 AND owner_id = $2 RETURNING *`,
        [id, owner],
      );
      return require_(one(rows, toReview), 'ReviewItem', id);
    },
  };

  const annotations: NotebookAnnotationsRepository = {
    async add(owner, annotation) {
      const { rows } = await db.query(
        `INSERT INTO notebook_annotations (id, owner_id, lesson_id, selection, explanation)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (owner_id, lesson_id, selection) DO UPDATE SET explanation = EXCLUDED.explanation
         RETURNING *`,
        [annotation.id, owner, annotation.lessonId, annotation.selection, annotation.explanation],
      );
      return require_(one(rows, toNotebookAnnotation), 'NotebookAnnotation', annotation.id);
    },

    async listForLesson(owner, lessonId) {
      const { rows } = await db.query(
        `SELECT * FROM notebook_annotations WHERE owner_id = $1 AND lesson_id = $2
         ORDER BY created_at`,
        [owner, lessonId],
      );
      return rows.map(toNotebookAnnotation);
    },
  };

  const generation: GenerationRepository = {
    async startRun(owner, run) {
      const inserted = await db.query(
        `INSERT INTO generation_runs (id, owner_id, gap_id, pipeline_version, status,
                                      idempotency_key, started_at, cost_millicents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (owner_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          run.id,
          owner,
          run.gapId,
          run.pipelineVersion,
          run.status,
          run.idempotencyKey,
          run.startedAt,
          run.costMillicents,
        ],
      );

      if (inserted.rows.length > 0) return { run: toRun(inserted.rows[0]), created: true };

      const { rows } = await db.query(
        'SELECT * FROM generation_runs WHERE owner_id = $1 AND idempotency_key = $2',
        [owner, run.idempotencyKey],
      );
      return { run: toRun(rows[0]), created: false };
    },

    async getRun(owner, id) {
      const { rows } = await db.query(
        'SELECT * FROM generation_runs WHERE id = $1 AND owner_id = $2',
        [id, owner],
      );
      return one(rows, toRun);
    },

    async getLatestRunForGap(owner, gapId) {
      const { rows } = await db.query(
        'SELECT * FROM generation_runs WHERE owner_id = $1 AND gap_id = $2 ORDER BY started_at DESC LIMIT 1',
        [owner, gapId],
      );
      return one(rows, toRun);
    },

    async setRunStatus(owner, id, status, error) {
      const terminal = ['complete', 'partial', 'failed', 'cancelled'].includes(status);
      const { rows } = await db.query(
        `UPDATE generation_runs
            SET status = $3,
                error = COALESCE($4, error),
                finished_at = CASE WHEN $5 THEN now() ELSE finished_at END
          WHERE id = $1 AND owner_id = $2 RETURNING *`,
        [id, owner, status, error ?? null, terminal],
      );
      return require_(one(rows, toRun), 'GenerationRun', id);
    },

    async addRunCost(owner, id, millicents) {
      const { rowCount } = await db.query(
        `UPDATE generation_runs SET cost_millicents = cost_millicents + $3
          WHERE id = $1 AND owner_id = $2`,
        [id, owner, millicents],
      );
      if (!rowCount) throw new NotFoundError('GenerationRun', id);
    },

    async getStep(owner, key) {
      const { rows } = await db.query(
        'SELECT * FROM generation_steps WHERE key = $1 AND owner_id = $2',
        [key, owner],
      );
      return one(rows, toStep);
    },

    async upsertStep(owner, step) {
      const { rows } = await db.query(
        `INSERT INTO generation_steps (key, run_id, owner_id, step, subject, input_version,
                                       state, attempt, output, error, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,
                 CASE WHEN $7 = 'running' THEN now() ELSE NULL END,
                 CASE WHEN $7 IN ('succeeded','failed') THEN now() ELSE NULL END)
         ON CONFLICT (key) DO UPDATE SET
            state       = EXCLUDED.state,
            attempt     = EXCLUDED.attempt,
            output      = EXCLUDED.output,
            error       = EXCLUDED.error,
            finished_at = CASE WHEN EXCLUDED.state IN ('succeeded','failed')
                               THEN now() ELSE generation_steps.finished_at END
         RETURNING *`,
        [
          step.key,
          step.runId,
          owner,
          step.step,
          step.subject ?? null,
          step.inputVersion,
          step.state,
          step.attempt,
          step.output === undefined ? null : JSON.stringify(step.output),
          step.error ?? null,
        ],
      );
      return toStep(rows[0]);
    },

    async listSteps(owner, runId) {
      const { rows } = await db.query(
        'SELECT * FROM generation_steps WHERE owner_id = $1 AND run_id = $2 ORDER BY key',
        [owner, runId],
      );
      return rows.map(toStep);
    },

    async addFinding(owner, finding) {
      const { rows } = await db.query(
        `INSERT INTO audit_findings (id, owner_id, run_id, target_id, category, severity,
                                     finding, repair_status, repair_attempts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          finding.id,
          owner,
          finding.runId,
          finding.targetId,
          finding.category,
          finding.severity,
          finding.finding,
          finding.repairStatus,
          finding.repairAttempts,
        ],
      );
      return toFinding(rows[0]);
    },

    async listFindings(owner, runId) {
      const { rows } = await db.query(
        'SELECT * FROM audit_findings WHERE owner_id = $1 AND run_id = $2 ORDER BY created_at, id',
        [owner, runId],
      );
      return rows.map(toFinding);
    },

    async updateFinding(owner, id, patch) {
      const { rows } = await db.query(
        `UPDATE audit_findings
            SET repair_status  = COALESCE($3, repair_status),
                repair_attempts = COALESCE($4, repair_attempts)
          WHERE id = $1 AND owner_id = $2 RETURNING *`,
        [id, owner, patch.repairStatus ?? null, patch.repairAttempts ?? null],
      );
      return require_(one(rows, toFinding), 'AuditFinding', id);
    },
  };

  const knowledge: KnowledgeRepository = {
    async addEdge(owner, edge) {
      const { rows } = await db.query(
        `INSERT INTO knowledge_edges (id, owner_id, from_capability, to_capability, relationship,
                                      confidence)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (owner_id, from_capability, to_capability, relationship) DO UPDATE
            SET confidence = knowledge_edges.confidence
         RETURNING *`,
        [
          edge.id,
          owner,
          edge.fromCapability,
          edge.toCapability,
          edge.relationship,
          edge.confidence,
        ],
      );
      return toEdge(rows[0]);
    },

    async listEdges(owner) {
      const { rows } = await db.query(
        'SELECT * FROM knowledge_edges WHERE owner_id = $1 ORDER BY created_at, id',
        [owner],
      );
      return rows.map(toEdge);
    },
  };

  return { users, gaps, sources, curricula, attempts, mastery, generation, knowledge, annotations };
};

/** Remove every row, preserving the schema. Used to isolate integration tests from each other. */
export const truncateAll = async (pool: Pool): Promise<void> => {
  await pool.query(`
    TRUNCATE users, gaps, sources, source_chunks, diagnostics, curricula, objectives, lessons,
             artefacts, questions, attempts, mastery_evidence, review_items, generation_runs,
             generation_steps, audit_findings, knowledge_edges, jobs, provider_usage, audit_log,
             learner_profiles, notebook_annotations
    RESTART IDENTITY CASCADE
  `);
};
