import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireOwner, reviewQueue, toHttpError } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';

export const GET = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(await reviewQueue(context, owner));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
