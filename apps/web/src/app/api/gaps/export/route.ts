import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { exportLessonMarkdown, requireOwner, toHttpError } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

/**
 * Export a lesson as markdown (E25 / GAP-086).
 * GET /api/gaps/export?gapId=...&lessonId=...
 */
export const GET = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const { searchParams } = new URL(request.url);
    const gapId = searchParams.get('gapId') ?? '';
    const lessonId = searchParams.get('lessonId') ?? '';
    if (!gapId || !lessonId) {
      return NextResponse.json(
        {
          error: {
            status: 400,
            code: 'invalid_query',
            message: 'gapId and lessonId are required.',
          },
        },
        { status: 400 },
      );
    }
    const { markdown, filename } = await exportLessonMarkdown(context, owner, gapId, lessonId);
    return new NextResponse(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
