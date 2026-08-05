import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireOwner, reviewLesson, toHttpError } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ lessonId: string }> },
) => {
  try {
    const { lessonId } = await params;
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(await reviewLesson(context, owner, lessonId, await request.json()));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
