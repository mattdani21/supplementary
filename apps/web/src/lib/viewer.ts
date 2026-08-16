/**
 * Who is the viewer? Single-learner deployments identify the owner by cookie (the API uses the
 * same value in X-Owner-Id). The owner switcher on /gaps writes the cookie.
 */

import { cookies } from 'next/headers';
import type { OwnerId } from '@gapos/database';
import { DEFAULT_OWNER, OWNER_COOKIE } from './owner';

export const viewerOwner = async (): Promise<OwnerId> => {
  const jar = await cookies();
  return (jar.get(OWNER_COOKIE)?.value as OwnerId | undefined) ?? DEFAULT_OWNER;
};
