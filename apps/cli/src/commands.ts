/**
 * The `gapos` command-line study client (GAP-025).
 *
 * Commands are plain functions over the service layer with an injectable IO, so a scripted
 * session can run end to end in-process (the acceptance) while the binary reads stdin.
 * Persistence follows the daemon: Postgres when GAPOS_DATABASE_URL is set, otherwise
 * in-memory with a loud warning.
 */

import { randomUUID } from 'node:crypto';
import type { OwnerId } from '@gapos/database';
import type { ServerContext } from '../../web/src/server/context.js';
import {
  compile as compileGap,
  createGap,
  registerSource,
} from '../../web/src/server/services/gap-service.js';
import {
  assessMastery,
  getToday,
  submitAttempt,
} from '../../web/src/server/services/learning-service.js';

export interface CliIO {
  readonly out: (line: string) => void;
  readonly prompt?: (question: string) => Promise<string>;
}

export const OWNER: OwnerId = (process.env.GAPOS_OWNER ?? 'local-learner') as OwnerId;

const arg = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

export const usage = (io: CliIO): void => {
  io.out(
    [
      'gapos — close the gap',
      '  gapos gap new [--title T] [--statement S] [--minutes N]',
      '  gapos gap list',
      '  gapos gap <id>',
      '  gapos source add <gapId> [--file PATH | --text TEXT]',
      '  gapos compile <gapId>',
      '  gapos plan <gapId>',
      '  gapos study <gapId>',
      '  gapos mastery <gapId>',
      'Env: GAPOS_DATABASE_URL (Postgres; else in-memory), GAPOS_OWNER (learner id).',
    ].join('\n'),
  );
};

export const gapNew = async (
  context: ServerContext,
  args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const title = arg(args, '--title') ?? (io.prompt ? await io.prompt('Title: ') : '');
  const statement =
    arg(args, '--statement') ??
    (io.prompt ? await io.prompt('What do you want to be able to do? ') : '');
  const minutes = Number(
    arg(args, '--minutes') ?? (io.prompt ? await io.prompt('Minutes per day: ') : 35),
  );

  const gap = await createGap(context, OWNER, {
    title: title || 'Untitled gap',
    rawStatement: statement || 'To be defined.',
    dailyMinutes: Number.isFinite(minutes) ? minutes : 35,
  });
  io.out(`created ${gap.id} (${gap.status})`);
};

export const gapList = async (
  context: ServerContext,
  _args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const gaps = await context.uow.gaps.list(OWNER);
  if (gaps.length === 0) {
    io.out('no gaps yet');
    return;
  }
  for (const gap of gaps)
    io.out(
      `${gap.id}\t${gap.status}\t${gap.title}` +
        (gap.targetCapability ? `\t${gap.targetCapability}` : ''),
    );
};

export const gapShow = async (
  context: ServerContext,
  args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const id = args[0] ?? '';
  const gap = await context.uow.gaps.get(OWNER, id);
  if (!gap) {
    io.out(`gap ${id} not found`);
    return;
  }
  io.out(`${gap.id} — ${gap.title}`);
  io.out(`  status: ${gap.status} · ${gap.dailyMinutes} min/day`);
  io.out(`  statement: ${gap.rawStatement}`);
};

export const sourceAdd = async (
  context: ServerContext,
  args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const gapId = args[0] ?? '';
  const file = arg(args, '--file');
  const text = arg(args, '--text');
  let content = text ?? '';
  let filename = 'note.md';
  if (file) {
    const { readFileSync } = await import('node:fs');
    content = readFileSync(file, 'utf8');
    filename = file.split('/').pop() ?? 'note.md';
  }
  const mediaType = filename.endsWith('.md')
    ? 'text/markdown'
    : filename.endsWith('.html')
      ? 'text/html'
      : 'text/plain';

  const result = await registerSource(context, OWNER, {
    gapId,
    filename,
    mediaType,
    text: content,
  });
  if (result.accepted) {
    io.out(`source ${result.source.id} ${result.deduplicated ? '(reused)' : 'added'}`);
  } else {
    io.out(`rejected: ${result.code} — ${result.message}`);
  }
};

export const compileCommand = async (
  context: ServerContext,
  args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const gapId = args[0] ?? '';
  const outcome = await compileGap(context, OWNER, {
    gapId,
    idempotencyKey: `cli-${randomUUID().slice(0, 8)}`,
  });
  io.out(`compile ${outcome.status} (run ${outcome.runId})`);
  if (outcome.status === 'failed' && outcome.error) io.out(`  ${outcome.error}`);
};

export const planCommand = async (
  context: ServerContext,
  args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const gapId = args[0] ?? '';
  const curriculum = await context.uow.curricula.getCurrentForGap(OWNER, gapId);
  if (!curriculum) {
    io.out('no curriculum yet — compile the gap first');
    return;
  }
  io.out(
    `plan: ${curriculum.durationDays} days × ${curriculum.dailyMinutes} min/day (${curriculum.status})`,
  );
  for (const objective of curriculum.plan.objectives) {
    io.out(
      `  ${objective.required ? 'req' : 'opt'} ${objective.id}: ${objective.capabilityStatement}`,
    );
  }
  const lessons = await context.uow.curricula.listLessons(OWNER, curriculum.id);
  for (const lesson of lessons) {
    io.out(`  day ${lesson.day}: ${lesson.title} [${lesson.publicationStatus}]`);
  }
};

export const studyCommand = async (
  context: ServerContext,
  args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const gapId = args[0] ?? '';
  const today = await getToday(context, OWNER, gapId);
  if (!today.lesson) {
    io.out('nothing due today');
    return;
  }
  io.out(`day ${today.lesson.day}: ${today.lesson.title}`);

  const curriculum = await context.uow.curricula.getCurrentForGap(OWNER, gapId);
  if (!curriculum) return;
  const lessons = await context.uow.curricula.listLessons(OWNER, curriculum.id);
  const lesson = lessons.find((l) => l.id === today.lesson!.lessonId);
  if (!lesson) return;
  const questions = await context.uow.curricula.listQuestions(OWNER, lesson.id);
  const sessionId = `cli-${Date.now()}`;

  for (const question of questions) {
    io.out(`Q: ${question.payload.prompt}`);
    const response = io.prompt ? await io.prompt('> ') : '';
    const result = await submitAttempt(context, OWNER, gapId, {
      questionId: question.id,
      sessionId,
      response,
      idempotencyKey: `cli-${question.id}-${sessionId}`,
    });
    io.out(`${result.correct ? 'correct' : 'incorrect'} — ${result.feedback.answer}`);
  }
};

export const masteryCommand = async (
  context: ServerContext,
  args: readonly string[],
  io: CliIO,
): Promise<void> => {
  const gapId = args[0] ?? '';
  const mastery = await assessMastery(context, OWNER, gapId);
  io.out(
    `mastery: ${mastery.masteredObjectiveIds.length}/${mastery.requiredObjectiveIds.length} required objectives`,
  );
  if (mastery.readyToFill) io.out('ready to fill 🎉');
  for (const assessment of mastery.assessments) {
    io.out(`  ${assessment.mastered ? '✓' : '○'} ${assessment.objectiveId}`);
  }
};
