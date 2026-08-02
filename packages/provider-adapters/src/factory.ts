/**
 * Provider selection.
 *
 * `fake` is the default. A live provider must be opted into explicitly by setting
 * `GAPOS_PROVIDER_MODE=live`, so no test run and no stray local script can spend money.
 */

import type { CostAccountant, Logger, Metrics } from '@gapos/observability';
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
    // Deliberately unimplemented: adding a live provider is a task with a human gate attached
    // (paid external resources). Failing loudly beats silently falling back to the fake and
    // pretending a staging run exercised a real provider.
    throw new Error(
      'No live provider is configured. Implement a LanguageModelBackend and register it here; ' +
        'creating paid external resources requires a human approval gate (AGENTS.md §5).',
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
  };
};
