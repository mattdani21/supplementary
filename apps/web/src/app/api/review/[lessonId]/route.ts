import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveRequestOwner, reviewLesson, toHttpError } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> },
) => {
  try {
    const { lessonId } = await params;
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    return NextResponse.json(await reviewLesson(context, owner, lessonId, await request.json()));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
