import type { NextRequest } from 'next/server';
import { run } from '../../helpers';
import { arcCapabilitiesHandler } from '../../../../server/api';

export const GET = async (request: NextRequest) =>
  run(
    (context, owner) =>
      arcCapabilitiesHandler(context, owner, request.nextUrl.searchParams.get('query') ?? ''),
    request,
  );
