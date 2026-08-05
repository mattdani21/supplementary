'use client';

/** Small fetch helper: sends the owner cookie as X-Owner-Id and parses JSON errors. */
export const apiFetch = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const owner = document.cookie
    .split('; ')
    .find((part) => part.startsWith('gapos_owner='))
    ?.split('=')[1];

  const headers = new Headers(init.headers);
  if (owner) headers.set('x-owner-id', decodeURIComponent(owner));
  if (init.body) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Request failed with ${response.status}`);
  }
  return body;
};
