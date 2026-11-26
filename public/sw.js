/* Online-first: public installation resources only. Never cache business data. */
const CACHE = 'atlas-public-pwa-v1';
const PUBLIC_FILES = ['/offline.html', '/install.html', '/install.js', '/favicon.svg', '/manifest.webmanifest', '/icons/atlas-192.png', '/icons/atlas-512.png', '/icons/atlas-maskable-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('atlas-public-pwa-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// No skipWaiting or automatic reload: updates activate after all app windows close.
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Do not store any HTML responses from authenticated routes or the owner panel.
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
  } else if (!url.search && PUBLIC_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).catch(() => caches.match(url.pathname)));
  }
});
