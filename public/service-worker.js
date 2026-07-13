const CACHE_NAME = 'derby-hurricanes-wallet-v7';
const STATIC_ASSETS = [
  '/styles.css?v=70',
  '/club-logo-full.png?v=70',
  '/wallet-logo-192.png?v=70',
  '/wallet-logo-512.png?v=70',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.pathname === '/' ||
    url.pathname === '/wallet' ||
    url.pathname === '/wallet/google' ||
    url.pathname === '/wallet/sync' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(fetch(event.request));
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    })),
  );
});
