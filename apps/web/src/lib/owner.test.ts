/**
 * The owner-cookie contract shared by every client surface that talks to an owner-scoped
 * endpoint (GAP-088, E27): the audio player, the transition actions (Check mastery /
 * Archive / Retry compile) and the explain layer all resolve the owner the same way —
 * a fresh browser with no cookie authenticates as the default learner, so the raw
 * "Set the X-Owner-Id header." error never reaches the page.
 */

import { describe, expect, it } from 'vitest';
import { ownerFromCookie } from './owner';

describe('ownerFromCookie (owner auth fallback)', () => {
  it('defaults to local-learner for a fresh browser with no cookie', () => {
    expect(ownerFromCookie('')).toBe('local-learner');
    expect(ownerFromCookie('other=1; theme=dark')).toBe('local-learner');
  });

  it('reads an explicit owner cookie', () => {
    expect(ownerFromCookie('gapos_owner=someone; theme=dark')).toBe('someone');
  });

  it('decodes URL-encoded owner ids', () => {
    expect(ownerFromCookie('gapos_owner=my%40learner')).toBe('my@learner');
  });

  it('mirrors the server-side default exactly', () => {
    // The server (lib/viewer.ts viewerOwner) falls back to 'local-learner' when the
    // cookie is missing. The client must match, or a fresh browser 401s on audio and
    // on every transition action.
    expect(ownerFromCookie('')).toBe('local-learner');
    expect(ownerFromCookie('gapos_owner=local-learner')).toBe('local-learner');
  });
});
