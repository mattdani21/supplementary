import type { NextRequest } from 'next/server';
import { apiHealth } from '../../../server/api';
import { run } from '../helpers.js';

export const GET = async (request: NextRequest) =>
  run(async (context) => apiHealth(context), request);
