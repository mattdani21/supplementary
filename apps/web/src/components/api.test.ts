/**
 * GAP-088 (E27 adversarial UX): the shared client fetch helper must authenticate every
 * owner-scoped call — including the transition actions a learner fires (Check mastery /
 * Archive / Retry compile) — with the same ownerFromCookie fallback the audio player
 * uses. A fresh browser with no owner cookie sends X-Owner-Id: local-learner, so the
 * server's requireOwner guard can never return the raw "Set the X-Owner-Id header."
 * error, and whatever error the server does return surfaces as its calm parsed message.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';

const okResponse = (body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** fetch mock typed with real parameters so `mock.calls` carries [input, init] tuples. */
const fetchMockFor = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) => vi.fn(handler);

describe('apiFetch owner header (GAP-088, E27)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a mastery transition fired without an owner cookie sends the local-learner fallback', async () => {
    // Fresh browser: no gapos_owner cookie at all.
    vi.stubGlobal('document', { cookie: 'theme=dark; session=abc' });
    const fetchMock = fetchMockFor(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/gaps/gap_1/transition', {
      method: 'POST',
      body: JSON.stringify({ type: 'request_mastery_check' }),
    });

    const firstCall = fetchMock.mock.calls[0]!;
    expect(String(firstCall[0])).toBe('/api/gaps/gap_1/transition');
    const headers = new Headers(firstCall[1]?.headers);
    expect(headers.get('x-owner-id')).toBe('local-learner');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('sends the explicit owner cookie when present, URL-decoded', async () => {
    vi.stubGlobal('document', { cookie: 'gapos_owner=my%40learner; theme=dark' });
    const fetchMock = fetchMockFor(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/gaps/gap_1/transition', {
      method: 'POST',
      body: JSON.stringify({ type: 'archive' }),
    });

    const firstCall = fetchMock.mock.calls[0]!;
    expect(new Headers(firstCall[1]?.headers).get('x-owner-id')).toBe('my@learner');
  });

  it('keeps the owner header even when the request body is empty', async () => {
    vi.stubGlobal('document', { cookie: '' });
    const fetchMock = fetchMockFor(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/gaps/gap_1/transition', { method: 'POST' });

    const firstCall = fetchMock.mock.calls[0]!;
    expect(new Headers(firstCall[1]?.headers).get('x-owner-id')).toBe('local-learner');
  });

  it('throws the calm parsed server message, never the raw header text', async () => {
    vi.stubGlobal('document', { cookie: 'gapos_owner=local-learner' });
    vi.stubGlobal(
      'fetch',
      fetchMockFor(
        async () =>
          new Response(JSON.stringify({ error: { message: 'The owner has no gaps.' } }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    await expect(
      apiFetch('/api/gaps/gap_1/transition', {
        method: 'POST',
        body: JSON.stringify({ type: 'request_mastery_check' }),
      }),
    ).rejects.toThrow('The owner has no gaps.');
  });
});
