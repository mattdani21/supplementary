import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { explainSelection, requireOwner, toHttpError } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

/**
 * Explain a selected word/sentence in a lesson (E25 / GAP-085).
 * POST /api/gaps/explain  { gapId, lessonId, selection, context? }
 */
export const POST = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const body = (await request.json()) as {
      gapId: string;
      lessonId: string;
      selection: string;
      context?: string;
    };
    return NextResponse.json(await explainSelection(context, owner, body.gapId, body));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
