'use client';

import { ownerFromCookie } from '../lib/owner';

/**
 * Small fetch helper for client actions (transition buttons, forms): always sends the
 * owner as X-Owner-Id using the same ownerFromCookie fallback the audio player uses, so
 * a fresh browser authenticates as the default learner instead of hitting the raw
 * "Set the X-Owner-Id header." error (GAP-088). Parses JSON errors into calm messages.
 */
export const apiFetch = async (path: string, init: RequestInit = {}): Promise<unknown> => {
  const headers = new Headers(init.headers);
  headers.set('x-owner-id', ownerFromCookie(document.cookie));
  if (init.body) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Request failed with ${response.status}`);
  }
  return body;
};
