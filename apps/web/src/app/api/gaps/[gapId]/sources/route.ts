import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  listSources,
  registerSourceHandler,
  requireOwner,
  toHttpError,
} from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string }> },
) => {
  try {
    const { gapId } = await params;
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(await listSources(context, owner, gapId));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string }> },
) => {
  try {
    const { gapId } = await params;
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const body = (await request.json()) as Record<string, unknown>;
    const result = await registerSourceHandler(context, owner, { ...body, gapId });
    return NextResponse.json(result, { status: result.registration.accepted ? 201 : 422 });
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
