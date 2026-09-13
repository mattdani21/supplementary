/**
 * Run the five named agent learners through define → source → compile → two-session
 * practice → filled. Writes docs/pilot/cohort-evidence.json (no secrets, no prompt bodies).
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import type { OwnerId } from '@gapos/database';
import { createServerContext } from '../apps/web/src/server/context.js';
import { AGENT_LEARNERS } from '../apps/web/src/server/pilot/agent-learners.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../apps/web/src/server/services/gap-service.js';
import {
  runMasteryCheck,
  searchCapabilities,
  submitAttempt,
} from '../apps/web/src/server/services/learning-service.js';

const fillGap = async (owner: OwnerId, title: string) => {
  let tick = 0;
  const context = createServerContext({
    now: () => new Date(Date.parse('2026-09-13T09:00:00Z') + ++tick * 1000),
    newId: (prefix) => `${owner}_${prefix}_${tick}`,
    logLevel: 'error',
  });
  const gap = await createGap(context, owner, {
    title,
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 35,
  });
  const registration = await registerSource(context, owner, {
    gapId: gap.id,
    filename: 'set-theory-primer.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  if (!registration.accepted) throw new Error(`Source rejected for ${owner}`);
  await applyTransition(context, owner, gap.id, { type: 'define' });
  const outcome = await compile(context, owner, {
    gapId: gap.id,
    idempotencyKey: `${owner}-cohort`,
  });
  if (outcome.status !== 'complete') {
    throw new Error(`Compile failed for ${owner}: ${outcome.error ?? outcome.status}`);
  }

  for (const session of ['session_1', 'session_2'] as const) {
    if (session === 'session_2') tick += 200_000;
    for (const day of outcome.days) {
      for (const question of await context.uow.curricula.listQuestions(owner, day.lessonId)) {
        await submitAttempt(context, owner, gap.id, {
          questionId: question.id,
          sessionId: session,
          response: question.payload.answer,
          idempotencyKey: `${owner}_${session}_${question.id}`,
        });
      }
    }
  }

  const mastery = await runMasteryCheck(context, owner, gap.id);
  const capabilities = await searchCapabilities(context, owner);
  return {
    ownerId: owner,
    gapId: gap.id,
    compileStatus: outcome.status,
    days: outcome.days.length,
    filled: mastery.filled,
    capabilities: capabilities.length,
  };
};

const main = async (): Promise<void> => {
  const results = [];
  for (const agent of AGENT_LEARNERS) {
    results.push({
      name: agent.name,
      email: agent.email,
      ...(await fillGap(agent.ownerId, agent.subject)),
    });
  }
  const failed = results.filter((row) => !row.filled);
  const evidence = {
    recordedAt: new Date().toISOString(),
    cohort: 'private-beta-agent-learners',
    publicLaunch: false,
    results,
  };
  const out = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'docs/pilot/cohort-evidence.json',
  );
  await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`);
  if (failed.length > 0) {
    throw new Error(`Unfilled gaps: ${failed.map((row) => row.ownerId).join(', ')}`);
  }
  process.stdout.write(`COHORT OK: ${results.length} agent learners filled a gap on evidence\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
