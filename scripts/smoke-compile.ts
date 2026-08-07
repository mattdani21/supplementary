/**
 * Smoke compilation (GAP-026): the documented release-strategy step 4, as an executable.
 *
 * Drives the full journey through the service layer in one process — create a gap, register a
 * source, define, compile, then report the plan, lessons and audio availability. Uses the
 * default provider set (deterministic fakes) and in-memory repositories, so it runs from a
 * fresh checkout with no keys, no database and no object storage:
 *
 *     pnpm tsx scripts/smoke-compile.ts
 *
 * Exits non-zero if any stage fails. The journey covers the no-S3 audio path: with memory
 * storage the artefact API returns the bytes (mediaType + length) instead of a presigned URL.
 */
import { createServerContext } from '../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../apps/web/src/server/services/gap-service.js';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import { createLogger } from '@gapos/observability';
import type { OwnerId } from '@gapos/database';

const OWNER: OwnerId = 'user_smoke';

const main = async (): Promise<void> => {
  const logger = createLogger({}, { level: 'warn' });
  const context = createServerContext({ logLevel: 'warn' });

  const gap = await createGap(context, OWNER, {
    title: 'Smoke: relations and proof techniques',
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 35,
  });
  logger.info('gap created', { gapId: gap.id });

  const registration = await registerSource(context, OWNER, {
    gapId: gap.id,
    filename: 'set-theory-primer.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  if (!registration.accepted) {
    throw new Error(`Source rejected: ${registration.code}`);
  }
  logger.info('source registered', { sourceId: registration.source.id });

  await applyTransition(context, OWNER, gap.id, { type: 'define' });

  const started = Date.now();
  const outcome = await compile(context, OWNER, { gapId: gap.id, idempotencyKey: 'smoke-1' });
  const elapsedSeconds = Math.round((Date.now() - started) / 1000);
  if (!outcome.curriculumId) {
    throw new Error(`Compile failed: ${outcome.error ?? 'no curriculum'}`);
  }
  logger.info('compile complete', { runId: outcome.runId, elapsedSeconds });

  const curriculum = await context.uow.curricula.get(OWNER, outcome.curriculumId);
  if (!curriculum) throw new Error('Curriculum missing after a successful compile');
  const lessons = await context.uow.curricula.listLessons(OWNER, outcome.curriculumId);
  logger.info('course published', {
    status: curriculum.status,
    days: curriculum.durationDays,
    lessons: lessons.length,
  });

  // The no-S3 audio path: memory storage returns the bytes, not a presigned URL.
  const artefact = await context.uow.curricula.listArtefacts(OWNER, lessons[0]!.id);
  if (artefact.length === 0) throw new Error('No audio artefact for the first lesson');
  const audio = await context.storage.get(OWNER, artefact[0]!.storageKey);
  if (!audio) throw new Error('Audio bytes missing from storage');
  logger.info('audio artefact', { mediaType: audio.mediaType, bytes: audio.bytes.length });

  process.stdout.write(
    `SMOKE OK: ${curriculum.status} course, ${lessons.length} lessons, ` +
      `${audio.mediaType} audio (${audio.bytes.length} bytes) in ${elapsedSeconds}s\n`,
  );
};

void main().catch((error: unknown) => {
  process.stderr.write(`SMOKE FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
