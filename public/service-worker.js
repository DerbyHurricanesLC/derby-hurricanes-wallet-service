const CACHE = 'dh-wallet-v61';
const STATIC = [
  '/styles.css?v=61',
  '/club-logo-full.png?v=61',
  '/wallet-logo.png?v=61',
  '/wallet-hero.jpg?v=61',
  '/apple-touch-icon.png?v=61'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
