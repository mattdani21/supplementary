import { NextResponse, type NextRequest } from 'next/server';
import {
  arcSubmitReviewHandler,
  resolveRequestOwner,
  toHttpError,
} from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> },
) => {
  try {
    const { reviewId } = await params;
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    return NextResponse.json(
      await arcSubmitReviewHandler(context, owner, reviewId, await request.json()),
    );
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
