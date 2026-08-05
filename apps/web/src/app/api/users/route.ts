import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createUser, requireOwner, toHttpError } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';

export const POST = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const result = await createUser(context, owner, await request.json());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
