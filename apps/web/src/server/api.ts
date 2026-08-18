/**
 * The HTTP API over the service layer (GAP-021).
 *
 * Handlers are plain functions: (context, owner, params, body) -> JSON-serializable value.
 * The Next.js route files are thin adapters (parse the request, call a handler, map errors);
 * tests exercise the handlers directly in-process, which is what the acceptance requires.
 *
 * Every body is validated with zod before touching a service; every service error is mapped to
 * an HTTP status; owner scoping is enforced by the X-Owner-Id header on every learner endpoint.
 */

import { z } from 'zod';
import { ExplainSelectionContract, type ExplainSelection } from '@gapos/ai-contracts';
import type { GapTransition } from '@gapos/domain';
import {
  ConcurrentModificationError,
  NotFoundError,
  type Lesson,
  type OwnerId,
  type NotebookAnnotationRecord,
} from '@gapos/database';
import { ProviderBudgetError } from '@gapos/provider-adapters';
import type { ServerContext } from './context.js';
import {
  applyTransition,
  compile as compileGap,
  createGap as createGapUseCase,
  registerSource,
  type RegisterSourceInput,
} from './services/gap-service.js';
import {
  assessMastery,
  getToday,
  submitAttempt,
  type SubmitAttemptInput,
} from './services/learning-service.js';

/* ------------------------------------------------------------------- errors */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const toHttpError = (error: unknown): { status: number; code: string; message: string } => {
  if (error instanceof ApiError)
    return { status: error.status, code: error.code, message: error.message };
  if (error instanceof NotFoundError)
    return { status: 404, code: 'not_found', message: error.message };
  if (error instanceof ConcurrentModificationError)
    return { status: 409, code: 'conflict', message: error.message };
  if (error instanceof ProviderBudgetError)
    return { status: 402, code: 'budget_exhausted', message: error.message };
  if (error instanceof z.ZodError)
    return {
      status: 400,
      code: 'validation_failed',
      message: error.issues.map((i) => i.message).join('; '),
    };
  if (error instanceof Error && /not found/i.test(error.message))
    return { status: 404, code: 'not_found', message: error.message };
  return {
    status: 500,
    code: 'internal',
    message: error instanceof Error ? error.message : 'Internal error',
  };
};

export const requireOwner = (headers: Headers): OwnerId => {
  const owner = headers.get('x-owner-id');
  if (!owner) throw new ApiError(401, 'owner_required', 'Set the X-Owner-Id header.');
  return owner as OwnerId;
};

/* ------------------------------------------------------------------- schemas */

const userSchema = z.object({
  email: z.string().email(),
  locale: z.string().min(2),
  timezone: z.string().min(1),
});

const createGapSchema = z.object({
  title: z.string().min(1),
  rawStatement: z.string().min(10),
  dailyMinutes: z.number().int().min(5).max(480),
  deadline: z.string().optional(),
  sourcePolicy: z.enum(['general_knowledge_allowed', 'sources_only']).optional(),
});

/** Revising a gap's statement (GAP-096): the plan anchors to the statement, so a track
 * can climb new rungs (e.g. DeepSeek V4 after V3/R1) by revising it and recompiling. */
const updateGapSchema = z.object({
  rawStatement: z.string().min(10).optional(),
  title: z.string().min(1).optional(),
});

const TRANSITION_TYPES = [
  'define',
  'compile',
  'retry_compilation',
  'request_mastery_check',
  'mastery_rejected',
  'reopen',
  'archive',
] as const;

const transitionSchema = z.object({ type: z.enum(TRANSITION_TYPES) }).passthrough();

const compileSchema = z.object({
  idempotencyKey: z.string().min(1),
  audioEnabled: z.boolean().optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
});

const registerSourceSchema = z.object({
  gapId: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  text: z.string().min(1),
});

const attemptSchema = z.object({
  questionId: z.string().min(1),
  sessionId: z.string().min(1),
  response: z.string().min(1),
  hintsUsed: z.number().int().min(0).optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  idempotencyKey: z.string().min(1),
});

/* ------------------------------------------------------------------- handlers */

export const apiHealth = async (
  context: ServerContext,
): Promise<{ ok: boolean; time: string }> => ({
  ok: true,
  time: context.now().toISOString(),
});

export const createUser = async (
  context: ServerContext,
  owner: OwnerId,
  body: unknown,
): Promise<{ user: { id: OwnerId; email: string; locale: string; timezone: string } }> => {
  const input = userSchema.parse(body);
  await context.uow.users.create({ id: owner, ...input });
  return { user: { id: owner, ...input } };
};

export const listGaps = async (
  context: ServerContext,
  owner: OwnerId,
): Promise<{ gaps: unknown[] }> => ({
  gaps: await context.uow.gaps.list(owner),
});

export const createGap = async (
  context: ServerContext,
  owner: OwnerId,
  body: unknown,
): Promise<{ gap: unknown }> => {
  const input = createGapSchema.parse(body);
  const gap = await createGapUseCase(context, owner, input);
  return { gap };
};

export const getGap = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ gap: unknown }> => {
  const gap = await context.uow.gaps.get(owner, gapId);
  if (!gap) throw new ApiError(404, 'gap_not_found', `Gap ${gapId} was not found for this owner.`);
  return { gap };
};

export const transitionGap = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  body: unknown,
): Promise<{ gap: unknown }> => {
  const transition = transitionSchema.parse(body) as GapTransition;
  const gap = await applyTransition(context, owner, gapId, transition);
  return { gap };
};

export const updateGap = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  body: unknown,
): Promise<{ gap: unknown }> => {
  const patch = updateGapSchema.parse(body);
  const gap = await context.uow.gaps.get(owner, gapId);
  if (!gap) throw new ApiError(404, 'gap_not_found', `Gap ${gapId} was not found for this owner.`);
  const updated = await context.uow.gaps.update(owner, gapId, patch);
  return { gap: updated };
};

export const compile = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  body: unknown,
): Promise<{ run: unknown }> => {
  const input = compileSchema.parse(body);
  const outcome = await compileGap(context, owner, { gapId, ...input });
  return {
    run: {
      runId: outcome.runId,
      status: outcome.status,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    },
  };
};

export const registerSourceHandler = async (
  context: ServerContext,
  owner: OwnerId,
  body: unknown,
): Promise<{ registration: Awaited<ReturnType<typeof registerSource>> }> => {
  const input = registerSourceSchema.parse(body) as RegisterSourceInput;
  const registration = await registerSource(context, owner, input);
  return { registration };
};

export const listSources = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ sources: unknown[] }> => {
  const sources = await context.uow.sources.listForGap(owner, gapId);
  return {
    sources: await Promise.all(
      sources.map(async (source) => ({
        ...source,
        chunks: await context.uow.sources.listChunks(owner, source.id),
      })),
    ),
  };
};

export const todayView = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ today: unknown }> => ({
  today: await getToday(context, owner, gapId),
});

export const getCurriculum = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ curriculum: unknown; lessons: unknown[] }> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) throw new ApiError(404, 'no_curriculum', `No curriculum for gap ${gapId}.`);
  const lessons = await Promise.all(
    (await context.uow.curricula.listLessons(owner, curriculum.id)).map(async (lesson) => ({
      ...lesson,
      questions: await context.uow.curricula.listQuestions(owner, lesson.id),
      artefacts: await context.uow.curricula.listArtefacts(owner, lesson.id),
    })),
  );
  return { curriculum, lessons };
};

export const getLesson = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  lessonId: string,
): Promise<{ lesson: unknown }> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) throw new ApiError(404, 'no_curriculum', `No curriculum for gap ${gapId}.`);
  const lesson = (await context.uow.curricula.listLessons(owner, curriculum.id)).find(
    (l) => l.id === lessonId,
  );
  if (!lesson) throw new ApiError(404, 'lesson_not_found', `Lesson ${lessonId} was not found.`);
  return {
    lesson: {
      ...lesson,
      questions: await context.uow.curricula.listQuestions(owner, lesson.id),
      artefacts: await context.uow.curricula.listArtefacts(owner, lesson.id),
    },
  };
};

export const audioUrl = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  artefactId: string,
): Promise<
  | { url: string; expiresAt: string }
  | { url: ''; expiresAt: ''; bytes: number[]; mediaType: string }
> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) throw new ApiError(404, 'no_curriculum', `No curriculum for gap ${gapId}.`);
  const lessons = await context.uow.curricula.listLessons(owner, curriculum.id);
  let artefact;
  for (const lesson of lessons) {
    const artefacts = await context.uow.curricula.listArtefacts(owner, lesson.id);
    artefact = artefacts.find((a) => a.id === artefactId);
    if (artefact) break;
  }
  if (!artefact)
    throw new ApiError(404, 'artefact_not_found', `Artefact ${artefactId} was not found.`);
  const signed = await context.storage.signedUrl(owner, artefact.storageKey, 300);
  if (!signed) throw new ApiError(404, 'artefact_unavailable', 'The artefact is not in storage.');
  if (!signed.url.startsWith('http')) {
    // In-memory storage returns an opaque locator a browser cannot fetch. Serve the bytes
    // through the API instead, so a single-node deployment without S3 still plays audio.
    const stored = await context.storage.get(owner, artefact.storageKey);
    if (!stored) throw new ApiError(404, 'artefact_unavailable', 'The artefact is not in storage.');
    return {
      url: '',
      expiresAt: '',
      bytes: [...stored.bytes],
      mediaType: stored.mediaType,
    };
  }
  return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
};

export const submitAttemptHandler = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  body: unknown,
): Promise<{ attempt: unknown }> => {
  const input = attemptSchema.parse(body) as SubmitAttemptInput;
  const result = await submitAttempt(context, owner, gapId, input);
  return { attempt: result };
};

/* ------------------------------------------------------------ explain (E25/GAP-085) */

const explainSchema = z.object({
  lessonId: z.string().min(1),
  selection: z.string().min(1).max(2000),
  /** Surrounding lesson text so the model explains in context. */
  context: z.string().min(1).max(20000).optional(),
});

/**
 * Explain a selected word/sentence in a lesson (E25 / GAP-085). The call goes through
 * the budget-gated, contract-validated language model; the response is schema-checked
 * before it is returned, and the learner can pin it into the notebook (the route also
 * accepts an optional `pin: true` to persist the annotation).
 */
export const explainSelection = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  body: unknown,
): Promise<{ explanation: ExplainSelection }> => {
  const input = explainSchema.parse(body) as {
    lessonId: string;
    selection: string;
    context?: string;
    pin?: boolean;
  };
  const response = await context.providers.languageModel.generate({
    contract: ExplainSelectionContract,
    purpose: 'teaching',
    temperature: 0.2,
    maxOutputTokens: 500,
    reasoningEffort: 'low',
    runId: `explain-${gapId}-${input.lessonId}`,
    userId: owner,
    subject: input.selection,
    instruction:
      'Explain the selected text from a lesson as a careful teacher would: plain language, ' +
      '2-4 sentences, defining any term inside the explanation, and connecting it to the ' +
      'surrounding lesson. The selection is the only thing to explain; do not restate it at ' +
      'length. Never invent: if the context does not support a claim, say what it likely ' +
      'means and mark the uncertainty.',
    evidence: input.context
      ? [
          {
            sourceId: 'lesson-context',
            chunkId: input.lessonId,
            locator: 'lesson',
            text: input.context,
          },
        ]
      : undefined,
  });
  return { explanation: response.value as ExplainSelection };
};

/** Pin an explanation into the notebook (E25 / GAP-085). */
export const pinAnnotation = async (
  context: ServerContext,
  owner: OwnerId,
  body: unknown,
): Promise<{ annotation: NotebookAnnotationRecord }> => {
  const input = z
    .object({
      lessonId: z.string().min(1),
      selection: z.string().min(1),
      explanation: z.string().min(1),
    })
    .parse(body) as { lessonId: string; selection: string; explanation: string };
  const annotation = await context.uow.annotations.add(owner, {
    id: `note_${input.lessonId}_${input.selection.slice(0, 32)}`,
    lessonId: input.lessonId,
    selection: input.selection,
    explanation: input.explanation,
  });
  return { annotation };
};

/** List the learner's pinned notes for a lesson (E25 / GAP-085). */
export const listAnnotations = async (
  context: ServerContext,
  owner: OwnerId,
  lessonId: string,
): Promise<{ annotations: NotebookAnnotationRecord[] }> => {
  const annotations = await context.uow.annotations.listForLesson(owner, lessonId);
  return { annotations };
};

/* -------------------------------------------------------------- export (E25/GAP-086) */

/**
 * Export a lesson as markdown (E25 / GAP-086): the notebook (or transcript fallback)
 * plus the learner's pinned annotations, ready for download or print.
 */
export const exportLessonMarkdown = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  lessonId: string,
): Promise<{ markdown: string; filename: string }> => {
  const { lesson } = (await getLesson(context, owner, gapId, lessonId)) as {
    lesson: { title: string; package: { notebook?: string; transcript: string } };
  };
  const { annotations } = await listAnnotations(context, owner, lessonId);

  const body = lesson.package.notebook ?? lesson.package.transcript;
  const lines: string[] = [
    `# ${lesson.title}`,
    '',
    body,
    '',
    ...(annotations.length > 0
      ? [
          '---',
          '',
          '## Your notes',
          '',
          ...annotations.flatMap((a) => [`> **“${a.selection}”**`, '', a.explanation, '']),
        ]
      : []),
  ];
  const slug = lesson.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return { markdown: lines.join('\n'), filename: `${slug || 'lesson'}.md` };
};

/* -------------------------------------------------------- next lesson (E26/GAP-087) */

/**
 * The next published lesson after the current one (E26 / GAP-087), so the study page
 * can offer a Next button. Returns undefined when the current lesson is the last one.
 */
export const nextLesson = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  currentLessonId: string,
): Promise<{ next: { day: number; lessonId: string; title: string } | undefined }> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) return { next: undefined };
  const lessons = (await context.uow.curricula.listLessons(owner, curriculum.id))
    .filter((l) => l.publicationStatus === 'published')
    .sort((a, b) => a.day - b.day || a.ordinal - b.ordinal);
  const index = lessons.findIndex((l) => l.id === currentLessonId);
  const following = index >= 0 ? lessons[index + 1] : undefined;
  return following
    ? { next: { day: following.day, lessonId: following.id, title: following.title } }
    : { next: undefined };
};

export const masteryView = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ mastery: unknown }> => ({
  mastery: await assessMastery(context, owner, gapId),
});

export interface GenerationLogStep {
  readonly step: string;
  readonly state: string;
  readonly attempt: number;
  readonly error?: string;
}

export interface GenerationLogFinding {
  readonly category: string;
  readonly severity: string;
  readonly finding: string;
}

export interface GenerationLog {
  readonly run?: {
    readonly id: string;
    readonly status: string;
    readonly pipelineVersion: string;
    readonly costMillicents: number;
    readonly startedAt: string;
    readonly error?: string;
  };
  readonly steps: readonly GenerationLogStep[];
  readonly findings: readonly GenerationLogFinding[];
}

/**
 * The generation log for a gap's current curriculum (GAP-035): the run record, its steps and
 * any audit findings, read-only. Purely additive — it surfaces data the review queue already
 * reads, so the detail screen can show the learner what the compiler did and what it flagged.
 */
export const generationLog = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ log: GenerationLog }> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  // A failed compile may never have produced a curriculum (E27/GAP-089): fall back to the
  // gap's most recent run so the failure is still surfaced instead of a blank progress card.
  const runId =
    curriculum?.runId ?? (await context.uow.generation.getLatestRunForGap(owner, gapId))?.id;
  if (!runId) return { log: { steps: [], findings: [] } };

  const [run, steps, findings] = await Promise.all([
    context.uow.generation.getRun(owner, runId),
    context.uow.generation.listSteps(owner, runId),
    context.uow.generation.listFindings(owner, runId),
  ]);

  return {
    log: {
      ...(run
        ? {
            run: {
              id: run.id,
              status: run.status,
              pipelineVersion: run.pipelineVersion,
              costMillicents: run.costMillicents,
              startedAt: run.startedAt.toISOString(),
              ...(run.error ? { error: run.error } : {}),
            },
          }
        : {}),
      steps: steps.map((step) => ({
        step: step.step,
        state: step.state,
        attempt: step.attempt,
        ...(step.error ? { error: step.error } : {}),
      })),
      findings: findings.map((finding) => ({
        category: finding.category,
        severity: finding.severity,
        finding: finding.finding,
      })),
    },
  };
};

export interface MasteryScheduleItem {
  readonly id: string;
  readonly objectiveId: string;
  readonly dueAt: string;
  readonly intervalDays: number;
  readonly reason: string;
  readonly state: string;
}

/**
 * The due review schedule for a gap's current curriculum (GAP-035): the spaced-repetition
 * items the learner still owes. Read-only and per-gap, so the mastery screen can show what is
 * coming up next alongside the objective bars.
 */
export const masterySchedule = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ reviews: MasteryScheduleItem[] }> => {
  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (!curriculum) return { reviews: [] };

  const due = await context.uow.mastery.listDueReviews(owner, context.now());
  return {
    reviews: due
      .filter((review) => review.curriculumId === curriculum.id)
      .map((review) => ({
        id: review.id,
        objectiveId: review.objectiveId,
        dueAt: review.dueAt.toISOString(),
        intervalDays: review.intervalDays,
        reason: review.reason,
        state: review.state,
      })),
  };
};

export interface ReviewQueueItem {
  readonly lessonId: string;
  readonly lessonTitle: string;
  readonly day: number;
  readonly gapId: string;
  readonly gapTitle: string;
  readonly reviewStatus?: Lesson['reviewStatus'];
  readonly reviewNote?: string;
  readonly findings: readonly { category: string; severity: string; finding: string }[];
}

/**
 * The educator review queue (E19): lessons from curricula whose generation run recorded audit
 * findings, plus their review state. A lesson the reviewer has decided on still appears, marked
 * with the decision and note, so the queue is an audit trail rather than a disappearing list.
 */
export const reviewQueue = async (
  context: ServerContext,
  owner: OwnerId,
): Promise<{ items: ReviewQueueItem[] }> => {
  const gaps = await context.uow.gaps.list(owner);
  const items: ReviewQueueItem[] = [];
  for (const gap of gaps) {
    const curriculum = await context.uow.curricula.getCurrentForGap(owner, gap.id);
    if (!curriculum?.runId) continue;
    const findings = await context.uow.generation.listFindings(owner, curriculum.runId);
    if (findings.length === 0) continue;
    const lessons = await context.uow.curricula.listLessons(owner, curriculum.id);
    for (const lesson of lessons) {
      items.push({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        day: lesson.day,
        gapId: gap.id,
        gapTitle: gap.title,
        reviewStatus: lesson.reviewStatus,
        reviewNote: lesson.reviewNote,
        findings: findings.map((f) => ({
          category: f.category,
          severity: f.severity,
          finding: f.finding,
        })),
      });
    }
  }
  return { items };
};

const reviewDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(2000).optional(),
});

export const reviewLesson = async (
  context: ServerContext,
  owner: OwnerId,
  lessonId: string,
  body: unknown,
): Promise<{ lesson: unknown }> => {
  const { decision, note } = reviewDecisionSchema.parse(body);
  const lesson = await context.uow.curricula.setReview(
    owner,
    lessonId,
    decision === 'approve' ? 'approved' : 'rejected',
    note,
  );
  if (!lesson) throw new ApiError(404, 'lesson_not_found', `Lesson ${lessonId} was not found.`);
  return { lesson };
};

/**
 * Voice gap capture (E16): transcribe raw audio and return an editable draft. The transcript
 * becomes the gap's rawStatement; the suggested title is the first words. The learner edits
 * both in the UI and creates the real gap through the ordinary endpoint.
 */
export const voiceGapDraft = async (
  context: ServerContext,
  owner: OwnerId,
  audio: Uint8Array,
  mediaType: string,
): Promise<{ transcript: string; suggestedTitle: string }> => {
  const response = await context.providers.speechToText.transcribe({
    audio,
    mediaType,
    locale: 'en',
    runId: `voice-${context.newId('run')}`,
    userId: owner,
  });
  const text = response.text.trim();
  // A dictation usually starts with "I want to be able to …"; that is not a title.
  const LEAD_INS = [
    'i want to be able to',
    'i want to learn',
    'i would like to',
    'i need to',
    'i want to',
  ] as const;
  const lower = text.toLowerCase();
  const lead = LEAD_INS.find((candidate) => lower.startsWith(candidate));
  const words = (lead ? text.slice(lead.length) : text).trim().split(/\s+/).filter(Boolean);
  return {
    transcript: text,
    suggestedTitle: words.slice(0, 6).join(' '),
  };
};

export interface KnowledgeNode {
  readonly id: string;
  readonly kind: 'gap' | 'capability';
  readonly label: string;
}

export interface KnowledgeEdgeView {
  readonly from: string;
  readonly to: string;
  readonly relationship: 'teaches' | 'prerequisite_of' | 'extends' | 'related';
}

/**
 * The knowledge map (E15): the gap, the capabilities its curriculum teaches, their
 * prerequisites, and any knowledge-graph edges the system has recorded. Deterministic data for
 * a deterministic SVG layout in the UI.
 */
export const knowledgeMap = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdgeView[] }> => {
  const gap = await context.uow.gaps.get(owner, gapId);
  if (!gap) throw new ApiError(404, 'gap_not_found', `Gap ${gapId} was not found for this owner.`);

  const nodes = new Map<string, KnowledgeNode>();
  const edges: KnowledgeEdgeView[] = [];
  nodes.set(gapId, { id: gapId, kind: 'gap', label: gap.title });

  const curriculum = await context.uow.curricula.getCurrentForGap(owner, gapId);
  if (curriculum) {
    for (const objective of curriculum.plan.objectives) {
      nodes.set(objective.id, {
        id: objective.id,
        kind: 'capability',
        label: objective.capabilityStatement,
      });
      edges.push({ from: gapId, to: objective.id, relationship: 'teaches' });
      for (const prereq of objective.prerequisiteObjectiveIds ?? []) {
        nodes.set(prereq, { id: prereq, kind: 'capability', label: prereq });
        edges.push({ from: prereq, to: objective.id, relationship: 'prerequisite_of' });
      }
    }
  }

  for (const edge of await context.uow.knowledge.listEdges(owner)) {
    for (const [id, label] of [
      [edge.fromCapability, edge.fromCapability],
      [edge.toCapability, edge.toCapability],
    ] as const) {
      if (!nodes.has(id)) nodes.set(id, { id, kind: 'capability', label });
    }
    edges.push({
      from: edge.fromCapability,
      to: edge.toCapability,
      relationship: edge.relationship,
    });
  }

  return { nodes: [...nodes.values()], edges };
};
