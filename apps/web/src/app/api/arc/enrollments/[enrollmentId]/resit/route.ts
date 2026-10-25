import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  arcResitPlacementHandler,
  resolveRequestOwner,
  toHttpError,
} from '../../../../../../server/api';
import { getServerContext } from '../../../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ enrollmentId: string }> },
) => {
  try {
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    const { enrollmentId } = await params;
    return NextResponse.json(await arcResitPlacementHandler(context, owner, enrollmentId));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
