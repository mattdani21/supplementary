/**
 * Who is the viewer? Demo mode still accepts the unsigned owner cookie. Protected mode uses
 * the same identity port as the API (GAPX-02).
 */

import { cookies, headers } from 'next/headers';
import type { OwnerId } from '@gapos/database';
import { DEFAULT_OWNER, OWNER_COOKIE, resolveViewerOwner } from '../server/identity/resolve-owner';

export { OWNER_COOKIE, DEFAULT_OWNER };

export const viewerOwner = async (): Promise<OwnerId> => {
  const jar = await cookies();
  const headerList = await headers();
  return resolveViewerOwner(jar.get(OWNER_COOKIE)?.value, { headers: headerList });
};
