/**
 * Gap use cases.
 *
 * The API route handlers are thin wrappers over these functions. Status changes always go
 * through the domain state machine and then through the repository's compare-and-set, so there
 * is no path by which a handler can write a status the domain would have refused.
 */

import { screenSource, transitionGap, type GapStatus, type GapTransition } from '@gapos/domain';
import { bytesOfText, checksumOf, type Gap, type OwnerId, type Source } from '@gapos/database';
import { compileGap, type CompileOutcome } from '../../../../worker/src/pipeline/compile.js';
import type { ServerContext } from '../context.js';

export interface CreateGapInput {
  readonly title: string;
  readonly rawStatement: string;
  readonly dailyMinutes: number;
  readonly deadline?: string;
  readonly sourcePolicy?: Gap['sourcePolicy'];
}

export const createGap = async (
  context: ServerContext,
  owner: OwnerId,
  input: CreateGapInput,
): Promise<Gap> => {
  const at = context.now();
  return context.uow.gaps.create(owner, {
    id: context.newId('gap'),
    title: input.title,
    rawStatement: input.rawStatement,
    dailyMinutes: input.dailyMinutes,
    ...(input.deadline ? { deadline: input.deadline } : {}),
    sourcePolicy: input.sourcePolicy ?? 'general_knowledge_allowed',
    status: 'draft',
    assumptions: [],
    createdAt: at,
    updatedAt: at,
  });
};

/**
 * Apply a lifecycle transition. The domain decides whether it is legal and what the next status
 * is; the repository then applies it as a compare-and-set so two concurrent callers cannot both
 * advance the same gap.
 */
export const applyTransition = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
  transition: GapTransition,
): Promise<Gap> => {
  const gap = await context.uow.gaps.get(owner, gapId);
  if (!gap) throw new Error(`Gap ${gapId} was not found for this owner.`);

  const result = transitionGap(gap.status, transition);
  if (!result.ok) throw result.error;

  return context.uow.gaps.setStatus(owner, gapId, result.value, gap.status);
};

export interface RegisterSourceInput {
  readonly gapId: string;
  readonly filename: string;
  readonly mediaType: string;
  readonly text: string;
}

export type RegisterSourceResult =
  | { accepted: true; source: Source; deduplicated: boolean }
  | { accepted: false; code: string; message: string };

/**
 * Register an upload. Screening happens before storage, so an unsupported or hostile file never
 * occupies a bucket, and an identical file already uploaded reuses the existing extraction.
 */
export const registerSource = async (
  context: ServerContext,
  owner: OwnerId,
  input: RegisterSourceInput,
): Promise<RegisterSourceResult> => {
  const bytes = bytesOfText(input.text);
  const rejection = screenSource({
    mediaType: input.mediaType,
    byteSize: bytes.byteLength,
    text: input.text,
  });

  if (rejection) {
    return { accepted: false, code: rejection.code, message: rejection.message };
  }

  const checksum = checksumOf(bytes);
  const existing = await context.uow.sources.findByChecksum(owner, checksum);
  if (existing && existing.gapId === input.gapId) {
    return { accepted: true, source: existing, deduplicated: true };
  }

  const id = context.newId('src');
  const storageKey = `${owner}/${input.gapId}/${id}`;
  await context.storage.put(owner, storageKey, bytes, input.mediaType);

  const source = await context.uow.sources.create(owner, {
    id,
    gapId: input.gapId,
    filename: input.filename,
    mediaType: input.mediaType,
    byteSize: bytes.byteLength,
    checksum,
    storageKey,
    processingStatus: 'pending',
  });

  return { accepted: true, source, deduplicated: false };
};

export interface CompileInput {
  readonly gapId: string;
  readonly idempotencyKey: string;
  readonly audioEnabled?: boolean;
  readonly concurrency?: number;
}

/**
 * Start a compilation and drive the gap's lifecycle from its outcome.
 *
 * The gap moves to `compiling` before the run starts and to `active` or `failed` from the run's
 * result, so the two state machines cannot disagree about what happened.
 */
export const compile = async (
  context: ServerContext,
  owner: OwnerId,
  input: CompileInput,
): Promise<CompileOutcome> => {
  const gap = await context.uow.gaps.get(owner, input.gapId);
  if (!gap) throw new Error(`Gap ${input.gapId} was not found for this owner.`);

  if (gap.status === 'ready' || gap.status === 'active' || gap.status === 'failed') {
    await applyTransition(
      context,
      owner,
      input.gapId,
      gap.status === 'failed' ? { type: 'retry_compilation' } : { type: 'compile' },
    );
  }

  const outcome = await compileGap(
    { owner, gapId: input.gapId, idempotencyKey: input.idempotencyKey },
    {
      uow: context.uow,
      storage: context.storage,
      providers: context.providers,
      metrics: context.metrics,
      logger: context.logger,
      now: context.now,
      newId: context.newId,
      ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
      ...(input.audioEnabled === undefined ? {} : { audioEnabled: input.audioEnabled }),
    },
  );

  if (outcome.deduplicated) return outcome;

  const current = await context.uow.gaps.get(owner, input.gapId);
  if (current?.status === 'compiling') {
    await applyTransition(
      context,
      owner,
      input.gapId,
      outcome.status === 'failed'
        ? { type: 'compilation_failed', reason: outcome.error ?? 'unknown' }
        : { type: 'compilation_succeeded' },
    );
  }

  return outcome;
};

export const gapStatus = async (
  context: ServerContext,
  owner: OwnerId,
  gapId: string,
): Promise<GapStatus | undefined> => (await context.uow.gaps.get(owner, gapId))?.status;
