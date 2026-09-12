/* global self, caches, URL, Request, fetch, Response, decodeURIComponent */
/**
 * Arc service worker (E14 — offline polish).
 *
 * Strategy: stale-while-revalidate for Arc documents and static assets only. Private Arc
 * documents use an owner-scoped cache key; API responses are never cached. Writes and
 * cross-origin signed audio always use the network.
 */

const CACHE = 'gapos-arc-v3';
const OWNER_KEY = '__gapos_owner';

const ownerFromRequest = async (request) => {
  const explicit = request.headers.get('x-owner-id');
  if (explicit) return explicit;

  const cookieHeader = request.headers.get('cookie') ?? '';
  const encodedCookie = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('gapos_owner='))
    ?.slice('gapos_owner='.length);
  if (encodedCookie) return decodeURIComponent(encodedCookie);

  // Modern Chromium exposes first-party cookies to service workers through Cookie Store.
  // If neither source is available, private content is deliberately left uncached.
  try {
    const cookie = await self.cookieStore?.get('gapos_owner');
    return cookie?.value;
  } catch {
    return undefined;
  }
};

const scopedArcRequest = async (request) => {
  const owner = await ownerFromRequest(request);
  if (!owner) return undefined;
  const scopedUrl = new URL(request.url);
  scopedUrl.searchParams.set(OWNER_KEY, owner);
  return new Request(scopedUrl, request);
};

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
  if (url.pathname.startsWith('/api/')) return; // owner-specific API data is network-only

  const isArcPage = url.pathname === '/arc' || url.pathname.startsWith('/arc/');
  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/manifest.webmanifest';
  if (!isArcPage && !isStaticAsset) return;

  event.respondWith(
    (async () => {
      const cacheKey = isArcPage ? await scopedArcRequest(request) : request;
      if (!cacheKey) {
        try {
          return await fetch(request);
        } catch {
          if (request.mode === 'navigate') return offlineDocument();
          return Response.error();
        }
      }

      const cache = await caches.open(CACHE);
      const cached = await cache.match(cacheKey, { ignoreSearch: false });
      const network = fetch(request).then(async (response) => {
        if (response.ok && response.type === 'basic') {
          await cache.put(cacheKey, response.clone());
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
