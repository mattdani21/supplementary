/**
 * The worker daemon health server (E22 deploy fix).
 *
 * The queue loop has no HTTP surface, but Railway probes /api/health on every
 * service. This proves the daemon answers the probe on an ephemeral port.
 */

import { describe, expect, it } from 'vitest';
import { startHealthServer } from './health.js';

describe('worker health server', () => {
  it('answers GET /api/health with ok:true and service identity', async () => {
    const handle = await startHealthServer(0);
    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/api/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean; service: string };
      expect(body.ok).toBe(true);
      expect(body.service).toBe('gapos-worker');
    } finally {
      await handle.close();
    }
  });

  it('answers GET /health too (plain probe path)', async () => {
    const handle = await startHealthServer(0);
    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(response.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it('404s unknown paths', async () => {
    const handle = await startHealthServer(0);
    try {
      const response = await fetch(`http://127.0.0.1:${handle.port}/nope`);
      expect(response.status).toBe(404);
    } finally {
      await handle.close();
    }
  });
});
