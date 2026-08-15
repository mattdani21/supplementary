/**
 * A server context whose fake language model records every raw completion request.
 *
 * The pipeline tests that assert on prompt content (T044 generateLesson instruction, T046
 * review-due brief) need to read the instruction the guarded adapter actually sent. The default
 * `createServerContext` hides the fake backend, so this assembles the provider set explicitly —
 * the same pattern `apps/web/src/server/api.test.ts` and `tests/end-to-end/journey.test.ts` use —
 * and returns the backend's `calls` log alongside the context.
 */

import type { RawCompletionRequest } from '@gapos/provider-adapters';
import {
  createEmbeddings,
  createFakeEmbeddings,
  createFakeLanguageModel,
  createFakeSpeechToText,
  createFakeTextToSpeech,
  createLanguageModel,
  createTextToSpeech,
} from '@gapos/provider-adapters';
import { CostAccountant, createLogger, createMetrics } from '@gapos/observability';
import { createServerContext, type ServerContext } from '../../apps/web/src/server/context.js';

export const buildRecordingContext = (): {
  context: ServerContext;
  calls: readonly RawCompletionRequest[];
} => {
  const costAccountant = new CostAccountant();
  const metrics = createMetrics();
  const logger = createLogger({}, { level: 'error' });
  const backend = createFakeLanguageModel();
  const context = createServerContext({
    logLevel: 'error',
    providers: {
      mode: 'fake',
      languageModel: createLanguageModel(backend, { costAccountant, metrics, logger }),
      speechToText: createFakeSpeechToText(),
      textToSpeech: createTextToSpeech(createFakeTextToSpeech(), {
        costAccountant,
        metrics,
        logger,
      }),
      embeddings: createEmbeddings(createFakeEmbeddings(), { costAccountant, metrics, logger }),
    },
  });
  return { context, calls: backend.calls };
};
