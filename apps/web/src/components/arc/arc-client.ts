'use client';

/**
 * Shared client helpers for the Arc app: the owner cookie becomes X-Owner-Id on every fetch,
 * exactly as the API expects (single-learner deployments identify the viewer by cookie).
 */

export const arcOwner = (): string => {
  const cookie = document.cookie.split('; ').find((part) => part.startsWith('gapos_owner='));
  return cookie ? decodeURIComponent(cookie.split('=')[1] ?? '') : 'local-learner';
};

export const arcFetch = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const headers = new Headers(init.headers);
  headers.set('x-owner-id', arcOwner());
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: { message?: string } }).error?.message ?? 'Request failed')
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
};
