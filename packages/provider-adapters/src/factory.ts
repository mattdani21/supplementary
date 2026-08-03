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
    // A provider set must be all-live or all-fake. The live language model (createLiveLanguageModel)
    // and the live text-to-speech backend (createLiveTextToSpeech + createGoogleTranslateTtsEngine)
    // exist, but live speech-to-text does not. Failing loudly beats silently falling back to the
    // fakes and pretending a staging run exercised real speech. Creating paid external resources
    // also requires a human approval gate (AGENTS.md §5).
    throw new Error(
      'Live mode is not fully available: the live language model and the live text-to-speech ' +
        'backend exist, but live speech-to-text does not. A provider set must be all-live or ' +
        'all-fake (AGENTS.md §4), and using live providers is a paid external resource requiring ' +
        'a human approval gate (AGENTS.md §5).',
    );
  }

  return {
    mode,
    languageModel: createLanguageModel(createFakeLanguageModel(options.fake), {
      costAccountant: options.costAccountant,
      metrics: options.metrics,
      logger: options.logger,
    }),
    speechToText: createFakeSpeechToText(),
    textToSpeech: createFakeTextToSpeech(),
    embeddings: createEmbeddings(createFakeEmbeddings(options.fakeEmbeddings), {
      costAccountant: options.costAccountant,
      metrics: options.metrics,
      logger: options.logger,
    }),
  };
};
