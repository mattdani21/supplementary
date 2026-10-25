import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  arcPlacementKitHandler,
  arcSubmitPlacementHandler,
  resolveRequestOwner,
  toHttpError,
} from '../../../../../../server/api';
import { getServerContext } from '../../../../../../server/bootstrap';

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ enrollmentId: string }> },
) => {
  try {
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    const { enrollmentId } = await params;
    return NextResponse.json(await arcPlacementKitHandler(context, owner, enrollmentId));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ enrollmentId: string }> },
) => {
  try {
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    const { enrollmentId } = await params;
    return NextResponse.json(
      await arcSubmitPlacementHandler(context, owner, enrollmentId, await request.json()),
    );
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
