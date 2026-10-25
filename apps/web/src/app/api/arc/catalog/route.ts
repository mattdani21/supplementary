import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { arcCatalogHandler, resolveRequestOwner, toHttpError } from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

export const GET = async (request: NextRequest) => {
  try {
    await getServerContext();
    await resolveRequestOwner(request);
    return NextResponse.json(arcCatalogHandler());
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
