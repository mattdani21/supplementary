/* global self, caches, URL, fetch */
/**
 * GapOS service worker (E14 — offline polish).
 *
 * Strategy: stale-while-revalidate for same-origin GETs. The first visit populates the cache
 * (app shell pages, chunks, and the API responses the study flow reads); once populated, the
 * lesson for the current day renders from cache when the network is cut. Writes (POST/PUT)
 * always go to the network — offline, they fail loudly rather than pretending.
 */

const CACHE = 'gapos-v1';

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
      const cached = await caches.match(request, { ignoreSearch: false });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => undefined);
      return cached ?? (await network);
    })(),
  );
});
