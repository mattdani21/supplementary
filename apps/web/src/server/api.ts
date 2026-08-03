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
import type { GapTransition } from '@gapos/domain';
import { ConcurrentModificationError, NotFoundError, type OwnerId } from '@gapos/database';
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
): Promise<{ url: string; expiresAt: string }> => {
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
  if (!signed)
    throw new ApiError(404, 'artefact_not_found', `Artefact ${artefactId} has no stored object.`);
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

export const masteryView = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<{ mastery: unknown }> => ({
  mastery: await assessMastery(context, owner, gapId),
});
