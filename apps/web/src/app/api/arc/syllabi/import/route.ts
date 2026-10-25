import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  arcImportSyllabusHandler,
  resolveRequestOwner,
  toHttpError,
} from '../../../../../server/api';
import { getServerContext } from '../../../../../server/bootstrap';

export const POST = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = await resolveRequestOwner(request);
    return NextResponse.json(await arcImportSyllabusHandler(context, owner, await request.json()));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
