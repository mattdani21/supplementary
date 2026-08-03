import { describe, expect, it } from 'vitest';
import { checksumFor } from '../fake/speech.js';
import type { SynthesisRequest } from '../interfaces.js';
import {
  chunkText,
  createGoogleTranslateTtsEngine,
  createLiveTextToSpeech,
  estimateDurationSeconds,
  LiveSynthesisError,
  type SpeechSynthesisEngine,
  type SynthesisedAudio,
} from './speech.js';

const baseRequest = (overrides: Partial<SynthesisRequest> = {}): SynthesisRequest => ({
  text: 'Sets, relations and proof techniques.',
  segmentId: 'seg_1',
  voice: 'default',
  locale: 'en',
  runId: 'run_1',
  userId: 'user_1',
  ...overrides,
});

const engineStub = (overrides: Partial<SynthesisedAudio> = {}) => {
  const calls: { text: string; voice: string; locale: string }[] = [];
  const engine: SpeechSynthesisEngine = {
    name: 'stub',
    async synthesize(text, voice, locale) {
      calls.push({ text, voice, locale });
      return {
        audio: new TextEncoder().encode(`AUDIO:${text}`),
        mediaType: 'audio/mpeg',
        ...overrides,
      };
    },
  };
  return { engine, calls };
};

describe('live text-to-speech wrapper', () => {
  it('computes the transcript-linked checksum and forwards the engine audio', async () => {
    const { engine } = engineStub();
    const tts = createLiveTextToSpeech({ engine });
    const response = await tts.synthesise(baseRequest());

    expect(response.checksum).toBe(checksumFor('Sets, relations and proof techniques.'));
    expect(response.characters).toBe('Sets, relations and proof techniques.'.length);
    expect(response.mediaType).toBe('audio/mpeg');
    expect(response.audio).toEqual(
      new TextEncoder().encode('AUDIO:Sets, relations and proof techniques.'),
    );
  });

  it('estimates duration from characters when the engine does not know it', async () => {
    const { engine } = engineStub();
    const tts = createLiveTextToSpeech({ engine });
    const response = await tts.synthesise(baseRequest({ text: 'x'.repeat(28) }));

    expect(response.durationSeconds).toBe(estimateDurationSeconds(28));
    expect(response.durationSeconds).toBe(2);
  });

  it('uses the real duration when the engine provides one', async () => {
    const { engine } = engineStub({ durationSeconds: 12.5 });
    const tts = createLiveTextToSpeech({ engine });
    const response = await tts.synthesise(baseRequest());

    expect(response.durationSeconds).toBe(12.5);
  });

  it('charges nothing by default and charges per thousand characters when configured', async () => {
    const { engine } = engineStub();
    const free = createLiveTextToSpeech({ engine });
    const paid = createLiveTextToSpeech({ engine, costMillicentsPerThousandCharacters: 300 });

    expect((await free.synthesise(baseRequest())).costMillicents).toBe(0);
    // ceil(38/1000 × 300) = ceil(11.4) = 12
    expect((await paid.synthesise(baseRequest())).costMillicents).toBe(12);
  });

  it('forwards the segment text, voice and locale to the engine verbatim', async () => {
    const { engine, calls } = engineStub();
    const tts = createLiveTextToSpeech({ engine });
    await tts.synthesise(baseRequest({ voice: 'aria', locale: 'en-US' }));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      text: 'Sets, relations and proof techniques.',
      voice: 'aria',
      locale: 'en-US',
    });
  });

  it('wraps an engine failure in a typed error naming the segment', async () => {
    const failing: SpeechSynthesisEngine = {
      name: 'failing',
      async synthesize() {
        throw new Error('the endpoint is down');
      },
    };
    const tts = createLiveTextToSpeech({ engine: failing });
    await expect(tts.synthesise(baseRequest())).rejects.toBeInstanceOf(LiveSynthesisError);
    await expect(tts.synthesise(baseRequest())).rejects.toThrow(/seg_1/);
    await expect(tts.synthesise(baseRequest())).rejects.toThrow(/the endpoint is down/);
  });

  it('names itself after the engine by default', () => {
    const { engine } = engineStub();
    expect(createLiveTextToSpeech({ engine }).name).toBe('live:stub');
    expect(createLiveTextToSpeech({ engine, name: 'custom' }).name).toBe('custom');
  });
});

describe('google translate tts engine', () => {
  const jsonFetch =
    (chunks: { url: URL; init?: RequestInit }[], status = 200): typeof fetch =>
    async (url, init): Promise<Response> => {
      chunks.push({ url: new URL(String(url)), init });
      return new Response(status === 200 ? 'MP3BYTES' : 'nope', {
        status,
        headers: { 'content-type': 'audio/mpeg' },
      });
    };

  it('requests the endpoint with the gTTS query shape and returns the audio bytes', async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const engine = createGoogleTranslateTtsEngine({ fetchImpl: jsonFetch(calls) });
    const result = await engine.synthesize('Hello world', 'default', 'en');

    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url.origin + url.pathname).toBe('https://translate.google.com/translate_tts');
    expect(url.searchParams.get('q')).toBe('Hello world');
    expect(url.searchParams.get('tl')).toBe('en');
    expect(url.searchParams.get('client')).toBe('tw-ob');
    expect(url.searchParams.get('ie')).toBe('UTF-8');
    const headers = calls[0]!.init?.headers as Record<string, string> | undefined;
    expect(headers?.['user-agent']).toContain('Mozilla');

    expect(result.mediaType).toBe('audio/mpeg');
    expect(new TextDecoder().decode(result.audio)).toBe('MP3BYTES');
  });

  it('maps a regional locale to its language code', async () => {
    const calls: { url: URL }[] = [];
    const engine = createGoogleTranslateTtsEngine({
      fetchImpl: jsonFetch(calls as { url: URL; init?: RequestInit }[]),
    });
    await engine.synthesize('Bonjour', 'default', 'fr-FR');
    expect(calls[0]!.url.searchParams.get('tl')).toBe('fr');
  });

  it('splits long text into chunk requests that stay under the cap and concatenates the audio', async () => {
    const calls: { url: URL }[] = [];
    const engine = createGoogleTranslateTtsEngine({
      fetchImpl: jsonFetch(calls as { url: URL; init?: RequestInit }[]),
      maxChunkCharacters: 180,
    });
    const text = 'word '.repeat(100).trim(); // 500 characters
    const result = await engine.synthesize(text, 'default', 'en');

    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.url.searchParams.get('q')!.length).toBeLessThanOrEqual(180);
    }
    const joined = calls.map((c) => c.url.searchParams.get('q')).join(' ');
    expect(joined).toBe(text);
    expect(new TextDecoder().decode(result.audio)).toBe('MP3BYTES'.repeat(calls.length));
  });

  it('chunks at word boundaries without losing or duplicating text', () => {
    const chunks = chunkText('one two three four five', 10);
    expect(chunks).toEqual(['one two', 'three four', 'five']);
  });

  it('hard-splits an overlong word', () => {
    const chunks = chunkText('supercalifragilisticexpialidocious', 10);
    expect(chunks.join('')).toBe('supercalifragilisticexpialidocious');
    expect(chunks.every((c) => c.length <= 10)).toBe(true);
  });

  it('throws a clear error on a non-200 response', async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const engine = createGoogleTranslateTtsEngine({ fetchImpl: jsonFetch(calls, 403) });
    await expect(engine.synthesize('hello', 'default', 'en')).rejects.toThrow(/HTTP 403/);
  });

  it('throws when the network fails', async () => {
    const failing = (async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const engine = createGoogleTranslateTtsEngine({ fetchImpl: failing });
    await expect(engine.synthesize('hello', 'default', 'en')).rejects.toThrow(/fetch failed/);
  });
});
