import { NextResponse, type NextRequest } from 'next/server';
import { arcSubmitReviewHandler, requireOwner, toHttpError } from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ reviewId: string }> },
) => {
  try {
    const { reviewId } = await params;
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(
      await arcSubmitReviewHandler(context, owner, reviewId, await request.json()),
    );
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
