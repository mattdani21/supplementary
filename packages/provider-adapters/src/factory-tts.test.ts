/**
 * TTS engine selection (E25 / GAP-084): GAPOS_TTS_PROVIDER env drives the engine.
 */

import { describe, expect, it } from 'vitest';
import { createTtsEngineFromEnv, ttsCostMillicents } from './factory';

describe('createTtsEngineFromEnv', () => {
  it('defaults to the google translate engine without configuration', () => {
    const engine = createTtsEngineFromEnv({} as unknown as NodeJS.ProcessEnv);
    expect(engine.name).toBe('google-translate-tts');
  });

  it('selects the Kokoro engine when configured', () => {
    const engine = createTtsEngineFromEnv({
      GAPOS_TTS_PROVIDER: 'deepinfra-kokoro',
      GAPOS_DEEPINFRA_API_KEY: 'sk-test',
    } as unknown as NodeJS.ProcessEnv);
    expect(engine.name).toContain('deepinfra-kokoro');
  });

  it('throws when Kokoro is configured without a key', () => {
    expect(() =>
      createTtsEngineFromEnv({
        GAPOS_TTS_PROVIDER: 'deepinfra-kokoro',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow('requires GAPOS_DEEPINFRA_API_KEY');
  });
});

describe('ttsCostMillicents', () => {
  it('charges nothing for gTTS', () => {
    expect(ttsCostMillicents({} as unknown as NodeJS.ProcessEnv)).toBe(0);
  });

  it('charges the Kokoro rate when configured', () => {
    expect(
      ttsCostMillicents({ GAPOS_TTS_PROVIDER: 'deepinfra-kokoro' } as unknown as NodeJS.ProcessEnv),
    ).toBe(0.8);
  });
});
