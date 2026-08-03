import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getLesson, requireOwner, toHttpError } from '../../../../../../server/api';
import { getServerContext } from '../../../../../../server/bootstrap';

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string; lessonId: string }> },
) => {
  try {
    const { gapId, lessonId } = await params;
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(await getLesson(context, owner, gapId, lessonId));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
