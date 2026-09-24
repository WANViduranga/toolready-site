/* ============================================
   SW.JS - Service Worker
   Lets the calculators work offline once visited (they're pure
   client-side math, so no server is ever needed to run them).

   Strategy: network-first, falling back to cache when offline.
   This keeps content fresh while online (every successful fetch
   updates the cache) while still working offline for anything
   already visited. Only same-origin requests are touched - ads,
   analytics, and Google Fonts always go straight to the network,
   untouched by this worker.
   ============================================ */
const CACHE_NAME = 'toolready-v1';
const PRECACHE_URLS = [
  '/index.html',
  '/assets/css/style.css',
  '/assets/js/tracking.js',
  '/assets/js/theme.js',
  '/assets/js/rates.js',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (ads, GA, fonts) pass through
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
  );
});
