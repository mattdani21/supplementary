/* global self, caches, URL, fetch */
/**
 * Arc service worker (E14 — offline polish).
 *
 * Strategy: stale-while-revalidate for same-origin GETs. A visited Arc page and its textual
 * lesson response remain available when the network is cut. Writes always go to the network
 * and fail normally while offline. Cross-origin signed audio is deliberately never cached.
 */

const CACHE = 'gapos-arc-v2';

const offlineDocument = () =>
  new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="theme-color" content="#f8f9f7">
    <title>Arc is offline</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; background: #f8f9f7; color: #1f2529; }
      main { box-sizing: border-box; max-width: 40rem; min-height: 100vh; margin: auto;
        padding: max(3rem, env(safe-area-inset-top)) 1.5rem
          max(3rem, env(safe-area-inset-bottom)); display: grid; align-content: center; gap: 1rem; }
      p { line-height: 1.6; margin: 0; }
      a { color: #174ea6; font-weight: 700; min-height: 44px; display: inline-flex;
        align-items: center; }
      @media (prefers-color-scheme: dark) {
        body { background: #111419; color: #f1f4ef; }
        a { color: #9ec5ff; }
      }
    </style>
  </head>
  <body>
    <main>
      <p>Connection required</p>
      <h1>Arc is offline.</h1>
      <p>The visited lesson transcript remains available. New pages, submissions, reviews,
        compilation, and signed audio need a network connection.</p>
      <a href="/arc">Return to a visited Arc page</a>
    </main>
  </body>
</html>`,
    {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );

self.addEventListener('install', (event) => {
  // Activate immediately: don't wait for the old worker's clients to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // writes go to the network

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // external (e.g. signed S3 audio) never cached

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: false });
      const network = fetch(request).then(async (response) => {
        if (response.ok && response.type === 'basic') {
          await cache.put(request, response.clone());
        }
        return response;
      });

      if (cached) {
        event.waitUntil(network.then(() => undefined).catch(() => undefined));
        return cached;
      }

      try {
        return await network;
      } catch {
        if (request.mode === 'navigate') return offlineDocument();
        return Response.error();
      }
    })(),
  );
});
