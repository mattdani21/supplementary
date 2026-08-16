import type { OwnerId } from '@gapos/database';

/** The cookie the owner switcher writes and every owner-scoped client call reads. */
export const OWNER_COOKIE = 'gapos_owner';

/** The single-learner default: a browser with no cookie authenticates as this owner. */
export const DEFAULT_OWNER: OwnerId = 'local-learner' as OwnerId;

/**
 * Resolve the learner owner id from a raw cookie string. Mirrors the server-side
 * default (`viewerOwner` in lib/viewer.ts): a fresh browser without the cookie
 * authenticates as the default learner instead of 401ing on every owner-scoped call —
 * the audio player, the transition actions (Check mastery / Archive / Retry compile)
 * and the explain layer all use this fallback (GAP-088), so the raw
 * "Set the X-Owner-Id header." error never reaches the page.
 */
export const ownerFromCookie = (rawCookie: string): string => {
  const raw = rawCookie
    .split('; ')
    .find((part) => part.startsWith(`${OWNER_COOKIE}=`))
    ?.split('=')[1];
  if (!raw) return DEFAULT_OWNER;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};
