import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveRequestOwner, toHttpError, transitionGap } from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string }> },
) => {
  try {
    const { gapId } = await params;
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    return NextResponse.json(await transitionGap(context, owner, gapId, await request.json()));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
