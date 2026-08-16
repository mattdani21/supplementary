/**
 * Who is the viewer? Single-learner deployments identify the owner by cookie (the API uses the
 * same value in X-Owner-Id). The owner switcher on /gaps writes the cookie.
 */

import { cookies } from 'next/headers';
import type { OwnerId } from '@gapos/database';
import { DEFAULT_OWNER, OWNER_COOKIE } from './owner';

export const viewerOwner = async (): Promise<OwnerId> => {
  const jar = await cookies();
  // An empty cookie (the owner switcher can write one) is the same as no cookie: a
  // fresh browser authenticates as the default learner. A stale value for an owner
  // that does not exist must not crash every gap page (GAP-095).
  const raw = jar.get(OWNER_COOKIE)?.value;
  return raw && raw.trim() ? (raw as OwnerId) : DEFAULT_OWNER;
};
