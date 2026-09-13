import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listSources, registerSourceHandler, resolveRequestOwner } from '../../../../../server/api';
import { errorResponse } from '../../../helpers';
import { getServerContext } from '../../../../../server/bootstrap';

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string }> },
) => {
  try {
    const { gapId } = await params;
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    return NextResponse.json(await listSources(context, owner, gapId));
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string }> },
) => {
  try {
    const { gapId } = await params;
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await registerSourceHandler(context, owner, { ...body, gapId });
    return NextResponse.json(result, { status: result.registration.accepted ? 201 : 422 });
  } catch (error) {
    return errorResponse(error);
  }
};
