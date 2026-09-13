import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { arcProgressHandler, resolveRequestOwner, toHttpError } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

export const GET = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    return NextResponse.json(await arcProgressHandler(context, owner));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
