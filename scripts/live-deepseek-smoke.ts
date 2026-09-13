/**
 * One live DeepSeek compile for the first agent learner (production model gate).
 * Requires GAPOS_LLM_API_KEY in the environment. Never logs the key.
 */

import { REFERENCE_GAP_STATEMENT, SET_THEORY_SOURCE } from '@gapos/test-fixtures';
import {
  createLiveEvalContext,
  createLiveEvalProviders,
} from '../tests/evaluation/live-helpers.js';
import { AGENT_LEARNERS } from '../apps/web/src/server/pilot/agent-learners.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
} from '../apps/web/src/server/services/gap-service.js';

const main = async (): Promise<void> => {
  if (!process.env.GAPOS_LLM_API_KEY) {
    throw new Error('GAPOS_LLM_API_KEY is required for the live DeepSeek smoke.');
  }
  const agent = AGENT_LEARNERS[0]!;
  const context = createLiveEvalContext(createLiveEvalProviders());
  await context.uow.users.create({
    id: agent.ownerId,
    email: agent.email,
    locale: 'en',
    timezone: 'UTC',
  });

  const gap = await createGap(context, agent.ownerId, {
    title: `${agent.name}: ${agent.subject}`,
    rawStatement: REFERENCE_GAP_STATEMENT,
    dailyMinutes: 35,
  });
  const registration = await registerSource(context, agent.ownerId, {
    gapId: gap.id,
    filename: 'set-theory-primer.md',
    mediaType: 'text/markdown',
    text: SET_THEORY_SOURCE,
  });
  if (!registration.accepted) throw new Error(`Source rejected: ${registration.code}`);
  await applyTransition(context, agent.ownerId, gap.id, { type: 'define' });

  const started = Date.now();
  const outcome = await compile(context, agent.ownerId, {
    gapId: gap.id,
    idempotencyKey: 'live-deepseek-nova-1',
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (outcome.status !== 'complete' && outcome.status !== 'partial') {
    throw new Error(`Live compile ${outcome.status}: ${outcome.error ?? 'no curriculum'}`);
  }
  process.stdout.write(
    `LIVE DEEPSEEK OK: agent=${agent.ownerId} status=${outcome.status} days=${outcome.days.length} ${seconds}s model=${process.env.GAPOS_LLM_MODEL ?? 'deepseek-chat'}\n`,
  );
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
