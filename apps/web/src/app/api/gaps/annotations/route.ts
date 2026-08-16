import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { listAnnotations, pinAnnotation, requireOwner, toHttpError } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

/**
 * Notebook annotations (E25 / GAP-085).
 * GET  /api/gaps/annotations?lessonId=...  → the learner's pinned notes for a lesson
 * POST /api/gaps/annotations               → pin an explanation into the notebook
 */
export const GET = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const { searchParams } = new URL(request.url);
    const lessonId = searchParams.get('lessonId') ?? '';
    if (!lessonId) {
      return NextResponse.json(
        { error: { status: 400, code: 'invalid_query', message: 'lessonId is required.' } },
        { status: 400 },
      );
    }
    return NextResponse.json(await listAnnotations(context, owner, lessonId));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};

export const POST = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const body = (await request.json()) as unknown;
    return NextResponse.json(await pinAnnotation(context, owner, body));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
