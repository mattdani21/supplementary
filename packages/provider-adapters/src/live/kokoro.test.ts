/**
 * Kokoro engine (E25 / GAP-084): request shape, WAV duration parsing, failure paths.
 *
 * Pure-function + injected-fetch tests in the repo's deterministic pattern.
 */

import { describe, expect, it } from 'vitest';
import { createKokoroEngine, parseWavDurationSeconds } from './kokoro';

/** A minimal valid 24kHz mono 16-bit WAV: 1 second = 48,000 bytes of PCM data. */
const wavHeader = (dataBytes: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(44 + dataBytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  bytes[4] = (36 + dataBytes) & 0xff;
  bytes[5] = ((36 + dataBytes) >> 8) & 0xff;
  bytes[6] = ((36 + dataBytes) >> 16) & 0xff;
  bytes[7] = ((36 + dataBytes) >> 24) & 0xff;
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  bytes[16] = 16; // fmt chunk size
  bytes[20] = 1; // PCM
  bytes[22] = 1; // mono
  bytes[24] = 24_000 & 0xff;
  bytes[25] = (24_000 >> 8) & 0xff;
  bytes[26] = (24_000 >> 16) & 0xff;
  bytes[27] = (24_000 >> 24) & 0xff;
  const byteRate = 24_000 * 2; // 24kHz * 16-bit mono
  bytes[28] = byteRate & 0xff;
  bytes[29] = (byteRate >> 8) & 0xff;
  bytes[30] = (byteRate >> 16) & 0xff;
  bytes[31] = (byteRate >> 24) & 0xff;
  bytes[34] = 2; // block align
  bytes[36] = 16; // bits per sample
  ascii(36, 'data');
  bytes[40] = dataBytes & 0xff;
  bytes[41] = (dataBytes >> 8) & 0xff;
  bytes[42] = (dataBytes >> 16) & 0xff;
  bytes[43] = (dataBytes >> 24) & 0xff;
  return bytes;
};

describe('parseWavDurationSeconds', () => {
  it('parses duration from a real WAV header', () => {
    // 2 seconds at 24kHz mono 16-bit = 96,000 bytes of data
    expect(parseWavDurationSeconds(wavHeader(96_000))).toBe(2);
  });

  it('returns undefined for non-WAV bytes', () => {
    expect(parseWavDurationSeconds(new Uint8Array([1, 2, 3]))).toBeUndefined();
    const notWav = new Uint8Array(44);
    expect(parseWavDurationSeconds(notWav)).toBeUndefined();
  });
});

describe('createKokoroEngine', () => {
  it('posts the OpenAI-compatible speech request with auth and returns audio', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init: init ?? {} };
      return new Response(wavHeader(48_000).buffer, {
        status: 200,
        headers: { 'content-type': 'audio/wav' },
      });
    }) as typeof fetch;

    const engine = createKokoroEngine({
      apiKey: 'sk-test',
      fetchImpl,
    });
    const result = await engine.synthesize('Hello world.', 'af_heart', 'en');

    expect(captured?.url).toBe('https://api.deepinfra.com/v1/openai/audio/speech');
    const body = JSON.parse(String(captured?.init.body)) as Record<string, string>;
    expect(body.model).toBe('hexgrad/Kokoro-82M');
    expect(body.input).toBe('Hello world.');
    expect(body.voice).toBe('af_heart');
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers?.authorization).toBe('Bearer sk-test');

    expect(result.mediaType).toBe('audio/wav');
    expect(result.audio.length).toBe(44 + 48_000);
    // 1 second of 24kHz mono 16-bit audio
    expect(result.durationSeconds).toBe(1);
  });

  it('uses a custom base URL, model and voice when configured', async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      return new Response(
        JSON.stringify({ seen: { url: String(url), model: body.model, voice: body.voice } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const engine = createKokoroEngine({
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      model: 'custom/kokoro',
      voice: 'am_michael',
      fetchImpl,
    });
    const result = await engine.synthesize('Hi.', 'am_michael', 'en');
    // not a WAV → duration unknown, media type still wav per the contract
    expect(result.mediaType).toBe('audio/wav');
    const seen = JSON.parse(String.fromCharCode(...result.audio)) as {
      seen: { url: string; model: string; voice: string };
    };
    expect(seen.seen.url).toBe('https://example.com/v1/audio/speech');
    expect(seen.seen.model).toBe('custom/kokoro');
    expect(seen.seen.voice).toBe('am_michael');
  });

  it('throws a descriptive error on HTTP failure', async () => {
    const fetchImpl = (async () => new Response('over quota', { status: 429 })) as typeof fetch;
    const engine = createKokoroEngine({ apiKey: 'sk-test', fetchImpl });
    await expect(engine.synthesize('Hello.', 'af_heart', 'en')).rejects.toThrow(
      'Kokoro returned HTTP 429',
    );
  });

  it('throws a descriptive error when the network fails', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const engine = createKokoroEngine({ apiKey: 'sk-test', fetchImpl });
    await expect(engine.synthesize('Hello.', 'af_heart', 'en')).rejects.toThrow(
      'Kokoro synthesis request failed',
    );
  });
});
