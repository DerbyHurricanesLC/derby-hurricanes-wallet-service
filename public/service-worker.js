const CACHE = 'derby-hurricanes-card-v5-1';
const STATIC_ASSETS = ['/styles.css', '/club-logo.png', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === '/wallet') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
