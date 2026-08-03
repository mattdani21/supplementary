/**
 * Shared machinery for the GAP-014b live-provider evaluation.
 *
 * Used by tests/evaluation/live-provider.test.ts (the gate) and
 * scripts/record-eval-baselines.ts (the recording run). The provider set is an explicit
 * assembly, not the factory: a live language model and live text-to-speech, with the fake
 * speech-to-text standing in only because compile never transcribes (E16 will need a live one).
 * This is an evaluation harness, not a production provider set.
 */

import type { ProducedCurriculum } from '@gapos/evaluation';
import {
  CostAccountant,
  centsToMillicents,
  createLogger,
  createMetrics,
  type Budget,
} from '@gapos/observability';
import {
  createEmbeddings,
  createFakeEmbeddings,
  createFakeSpeechToText,
  createGoogleTranslateTtsEngine,
  createLanguageModel,
  createLiveLanguageModelFromEnv,
  createLiveTextToSpeech,
  type Providers,
} from '@gapos/provider-adapters';
import type { OwnerId } from '@gapos/database';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';
import {
  applyTransition,
  compile,
  createGap,
  registerSource,
  type CompileInput,
} from '../../apps/web/src/server/services/gap-service.js';
import { fixtureById, type EvaluationFixture } from '@gapos/evaluation';

export const EVAL_OWNER: OwnerId = 'user_eval_live';

/**
 * The $2 (or configured) cap must be real, not decorative: the CostAccountant refuses a call
 * before it is made once a scope is spent, so the budget below is the hard ceiling of a run.
 * Defaults match .env.example; the recording run sets per-user-daily to the approved cap.
 */
const budgetFromEnv = (): Budget => ({
  perRunMillicents: centsToMillicents(Number(process.env.GAPOS_BUDGET_PER_RUN_CENTS ?? 200)),
  perUserDailyMillicents: centsToMillicents(
    Number(process.env.GAPOS_BUDGET_PER_USER_DAILY_CENTS ?? 1000),
  ),
});

/** The explicit provider assembly a live evaluation run needs. */
export const createLiveEvalProviders = (): Providers => {
  const costAccountant = new CostAccountant(budgetFromEnv());
  const metrics = createMetrics();
  const logger = createLogger({}, { level: 'error' });

  return {
    mode: 'live',
    languageModel: createLanguageModel(createLiveLanguageModelFromEnv(), {
      costAccountant,
      metrics,
      logger,
    }),
    speechToText: createFakeSpeechToText(),
    textToSpeech: createLiveTextToSpeech({ engine: createGoogleTranslateTtsEngine() }),
    // The live eval pack does not depend on vector retrieval; fake embeddings keep it lexical
    // so the nine fixtures score the same way they did when their baselines were recorded.
    embeddings: createEmbeddings(createFakeEmbeddings(), { costAccountant, metrics, logger }),
  };
};

export const createLiveEvalContext = (providers: Providers): ServerContext =>
  createServerContext({ providers, logLevel: 'error' });

export const createEvalUser = async (context: ServerContext): Promise<void> => {
  await context.uow.users.create({
    id: EVAL_OWNER,
    email: 'eval-live@example.com',
    locale: 'en',
    timezone: 'UTC',
  });
};

/**
 * Compile a fixture through the real pipeline and return the raw outcome, so callers can also
 * inspect the run id (findings) or expect the clarification path.
 */
export const compileRaw = async (
  context: ServerContext,
  fixture: EvaluationFixture,
  idempotencyKey: string,
) => {
  const gap = await createGap(context, EVAL_OWNER, {
    title: fixture.title,
    rawStatement: fixture.learnerStatement,
    dailyMinutes: fixture.dailyMinutes,
  });

  if (fixture.source) {
    await registerSource(context, EVAL_OWNER, {
      gapId: gap.id,
      filename: fixture.source.filename,
      mediaType: fixture.source.mediaType,
      text: fixture.source.text,
    });
  }

  await applyTransition(context, EVAL_OWNER, gap.id, { type: 'define' });
  return compile(context, EVAL_OWNER, {
    gapId: gap.id,
    idempotencyKey,
  } satisfies CompileInput);
};

/** Compile a fixture through the real pipeline and collect what it produced. */
export const compileFixture = async (
  context: ServerContext,
  fixtureId: string,
): Promise<ProducedCurriculum> => {
  const fixture = fixtureById(fixtureId);
  if (!fixture) throw new Error(`Unknown fixture ${fixtureId}`);

  const outcome = await compileRaw(context, fixture, `eval_live_${fixtureId}`);
  if (!outcome.curriculumId) {
    throw new Error(
      `Compile for ${fixtureId} produced no curriculum (status ${outcome.status}, error ${outcome.error ?? 'none'})`,
    );
  }

  const curriculum = await context.uow.curricula.get(EVAL_OWNER, outcome.curriculumId);
  const lessons = await context.uow.curricula.listLessons(EVAL_OWNER, outcome.curriculumId);

  return {
    plan: curriculum!.plan,
    lessons: lessons.map((lesson) => lesson.package),
  };
};
