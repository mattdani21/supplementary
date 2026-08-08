import { describe, expect, it } from 'vitest';
import { GET } from './route.js';

describe('the deployment health probe', () => {
  it('answers 200 without an owner header — the platform healthcheck must not 401', async () => {
    // railway.json probes /api/health with a plain GET; every other endpoint requires the
    // X-Owner-Id header, so this route deliberately skips ownership. A 401 here would make a
    // healthy deployment look dead to the platform and restart forever.
    const response = await GET({} as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
