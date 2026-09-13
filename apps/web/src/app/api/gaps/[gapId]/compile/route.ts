import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { compile, resolveRequestOwner } from '../../../../../server/api';
import { errorResponse } from '../../../helpers';
import { getServerContext } from '../../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string }> },
) => {
  try {
    const { gapId } = await params;
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    return NextResponse.json(await compile(context, owner, gapId, await request.json()));
  } catch (error) {
    return errorResponse(error);
  }
};
