import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { apiHealth, toHttpError } from '../../../server/api';
import { getServerContext } from '../../../server/bootstrap';

// Liveness probe for deployment healthchecks. railway.json points the platform at this path
// with a plain GET — no X-Owner-Id. Every other endpoint requires ownership; this one must
// not, or a healthy service would answer 401 to the platform's probe and be restarted
// forever. Errors still surface so a misconfigured boot (e.g. bad S3 env) reads as 500.
export const GET = async (_request: NextRequest) => {
  try {
    const context = await getServerContext();
    return NextResponse.json(await apiHealth(context));
  } catch (error) {
    const mapped = toHttpError(error);
    return NextResponse.json({ error: mapped }, { status: mapped.status });
  }
};
