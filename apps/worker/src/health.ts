/**
 * A minimal health endpoint for the worker daemon (E22 deploy fix).
 *
 * The worker is a queue loop with no HTTP surface, but Railway probes
 * `/api/health` on every service (the repo-level railway.json applies it
 * to all services). Without this, the worker's healthcheck never succeeds
 * and the service stays `Failed`. This tiny server answers the probe so the
 * worker's liveness is verifiable like the web service's.
 */

import { createServer, type Server } from 'node:http';

export interface HealthServerHandle {
  readonly server: Server;
  readonly port: number;
  readonly close: () => Promise<void>;
}

/** Bind `GET /api/health` on $PORT (Railway injects it; default 3000 locally). */
export const startHealthServer = (
  port = Number(process.env.PORT ?? 3000),
): Promise<HealthServerHandle> =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/api/health' || req.url === '/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: 'gapos-worker' }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });

    server.once('error', reject);
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        server,
        port: actualPort,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
