import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { audioUrl, requireOwner, toHttpError } from '../../../../../../../server/api';
import { getServerContext } from '../../../../../../../server/bootstrap';

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ gapId: string; artefactId: string }> },
) => {
  try {
    const { gapId, artefactId } = await params;
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const result = await audioUrl(context, owner, gapId, artefactId);
    if ('bytes' in result && result.bytes.length > 0) {
      // In-memory storage: stream the bytes so a no-S3 deployment still plays audio.
      return new NextResponse(new Uint8Array(result.bytes), {
        headers: { 'content-type': result.mediaType },
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
