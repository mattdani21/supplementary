import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireOwner, toHttpError, voiceGapDraft } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

export const POST = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const audio = new Uint8Array(await request.arrayBuffer());
    const mediaType = request.headers.get('content-type') ?? 'audio/webm';
    const result = await voiceGapDraft(context, owner, audio, mediaType);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
