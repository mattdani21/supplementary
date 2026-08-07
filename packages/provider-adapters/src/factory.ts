/**
 * Provider selection.
 *
 * `fake` is the default. A live provider must be opted into explicitly by setting
 * `GAPOS_PROVIDER_MODE=live`, so no test run and no stray local script can spend money.
 */

import type { CostAccountant, Logger, Metrics } from '@gapos/observability';
import { createEmbeddings } from './embeddings.js';
import { createFakeEmbeddings, type FakeEmbeddingsOptions } from './fake/embeddings.js';
import { createFakeLanguageModel, type FakeLanguageModelOptions } from './fake/language-model.js';
import { createFakeSpeechToText, createFakeTextToSpeech } from './fake/speech.js';
import { createLanguageModel } from './language-model.js';
import { createTextToSpeech } from './speech.js';
import { createLiveEmbeddingsFromEnv } from './live/embeddings.js';
import { createLiveLanguageModelFromEnv } from './live/language-model.js';
import { createGoogleTranslateTtsEngine, createLiveTextToSpeech } from './live/speech.js';
import { createLiveSpeechToTextFromEnv } from './live/speech-to-text.js';
import { PROVIDER_MODES, type ProviderMode, type Providers } from './interfaces.js';

export interface ProviderFactoryOptions {
  readonly mode?: ProviderMode;
  readonly costAccountant: CostAccountant;
  readonly metrics: Metrics;
  readonly logger: Logger;
  readonly fake?: FakeLanguageModelOptions;
  readonly fakeEmbeddings?: FakeEmbeddingsOptions;
}

export const resolveProviderMode = (
  raw: string | undefined = process.env.GAPOS_PROVIDER_MODE,
): ProviderMode => {
  if (!raw) return 'fake';
  if (!(PROVIDER_MODES as readonly string[]).includes(raw)) {
    throw new Error(
      `GAPOS_PROVIDER_MODE must be one of ${PROVIDER_MODES.join(', ')}; received "${raw}".`,
    );
  }
  return raw as ProviderMode;
};

export const createProviders = (options: ProviderFactoryOptions): Providers => {
  const mode = options.mode ?? resolveProviderMode();

  if (mode === 'live') {
    // A provider set must be all-live or all-fake (AGENTS.md §4). Live adapters assemble from
    // env; their constructors refuse to run without the keys, and using them is a paid external
    // resource — the human approval gate (AGENTS.md §5) is the act of configuring those keys.
    return {
      mode,
      languageModel: createLanguageModel(createLiveLanguageModelFromEnv(), {
        costAccountant: options.costAccountant,
        metrics: options.metrics,
        logger: options.logger,
      }),
      speechToText: createLiveSpeechToTextFromEnv(),
      textToSpeech: createTextToSpeech(createLiveTextToSpeech({ engine: createGoogleTranslateTtsEngine() }), {
        costAccountant: options.costAccountant,
        metrics: options.metrics,
        logger: options.logger,
      }),
      embeddings: createEmbeddings(createLiveEmbeddingsFromEnv(), {
        costAccountant: options.costAccountant,
        metrics: options.metrics,
        logger: options.logger,
      }),
    };
  }

  return {
    mode,
    languageModel: createLanguageModel(createFakeLanguageModel(options.fake), {
      costAccountant: options.costAccountant,
      metrics: options.metrics,
      logger: options.logger,
    }),
    speechToText: createFakeSpeechToText(),
    textToSpeech: createTextToSpeech(createFakeTextToSpeech(), {
      costAccountant: options.costAccountant,
      metrics: options.metrics,
      logger: options.logger,
    }),
    embeddings: createEmbeddings(createFakeEmbeddings(options.fakeEmbeddings), {
      costAccountant: options.costAccountant,
      metrics: options.metrics,
      logger: options.logger,
    }),
  };
};
