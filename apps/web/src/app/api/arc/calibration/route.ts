import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  arcCalibrationKitHandler,
  arcCalibrateHandler,
  requireOwner,
  toHttpError,
} from '../../../../server/api';
import { getServerContext } from '../../../../server/bootstrap';

export const GET = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    const subject = request.nextUrl.searchParams.get('subject') ?? '';
    if (!subject) {
      return NextResponse.json(
        { error: { status: 400, code: 'validation_failed', message: 'A subject is required.' } },
        { status: 400 },
      );
    }
    return NextResponse.json(await arcCalibrationKitHandler(context, owner, subject));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};

export const POST = async (request: NextRequest) => {
  try {
    const context = await getServerContext();
    const owner = requireOwner(request.headers);
    return NextResponse.json(await arcCalibrateHandler(context, owner, await request.json()));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
