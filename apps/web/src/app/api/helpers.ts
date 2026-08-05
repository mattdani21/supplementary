/**
 * Shared adapter for Next.js route handlers (GAP-021).
 *
 * The route files are deliberately thin: parse the request, resolve the owner header, call a
 * handler from `server/api.ts`, map errors to HTTP. All behaviour lives in the handlers, which
 * the test suite exercises in-process.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { OwnerId } from '@gapos/database';
import { getServerContext } from '../../server/bootstrap';
import { requireOwner, toHttpError } from '../../server/api';

export const run = async (
  handler: (
    context: Awaited<ReturnType<typeof getServerContext>>,
    owner: OwnerId,
  ) => Promise<unknown>,
  request: NextRequest,
): Promise<NextResponse> => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const result = await handler(context, owner);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
