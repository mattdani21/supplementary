'use client';

/**
 * Shared client helpers for the Arc app: the owner cookie becomes X-Owner-Id on every fetch,
 * exactly as the API expects (single-learner deployments identify the viewer by cookie).
 */

export const arcOwner = (): string => {
  const cookie = document.cookie.split('; ').find((part) => part.startsWith('gapos_owner='));
  return cookie ? decodeURIComponent(cookie.split('=')[1] ?? '') : 'local-learner';
};

export class ArcFetchError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArcFetchError';
  }
}

export const arcFetch = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const headers = new Headers(init.headers);
  headers.set('x-owner-id', arcOwner());
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (cause) {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    throw new ArcFetchError(
      0,
      offline ? 'offline' : 'network_error',
      offline
        ? 'Arc is offline. Reconnect before submitting or loading new material.'
        : cause instanceof Error
          ? cause.message
          : 'The network request failed.',
    );
  }
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const error =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error: { code?: string; message?: string } }).error
        : undefined;
    throw new ArcFetchError(
      response.status,
      error?.code ?? 'request_failed',
      String(error?.message ?? `Request failed (${response.status})`),
    );
  }
  return body;
};
