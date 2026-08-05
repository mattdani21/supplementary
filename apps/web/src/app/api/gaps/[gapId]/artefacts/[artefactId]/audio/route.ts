import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { audioUrl, requireOwner, toHttpError } from '../../../../../../../server/api';
import { getServerContext } from '../../../../../../../server/bootstrap';

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string; artefactId: string }> },
) => {
  try {
    const { gapId, artefactId } = await params;
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(await audioUrl(context, owner, gapId, artefactId));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
