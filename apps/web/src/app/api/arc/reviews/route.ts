import type { NextRequest } from 'next/server';
import { run } from '../../helpers';
import { arcReviewsHandler } from '../../../../server/api';

export const GET = async (request: NextRequest) => run(arcReviewsHandler, request);
