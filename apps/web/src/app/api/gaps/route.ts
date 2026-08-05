import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createGap, listGaps, requireOwner, toHttpError } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';

export const GET = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(await listGaps(context, owner));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};

export const POST = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const result = await createGap(context, owner, await request.json());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
