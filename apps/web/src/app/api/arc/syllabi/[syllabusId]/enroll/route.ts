import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  arcEnrollSyllabusHandler,
  resolveRequestOwner,
  toHttpError,
} from '../../../../../../server/api';
import { getServerContext } from '../../../../../../server/bootstrap';

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ syllabusId: string }> },
) => {
  try {
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    const { syllabusId } = await params;
    return NextResponse.json(await arcEnrollSyllabusHandler(context, owner, syllabusId));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
