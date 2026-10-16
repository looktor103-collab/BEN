// Offline shell for the PWA. API calls and uploaded images are never cached (private data).
const CACHE = 'ben-shell-v4';
const SHELL = ['/', '/style.css', '/extra.css', '/js/core.js', '/js/data.js', '/js/auth.js', '/js/dashboard.js', '/js/accounts.js', '/js/entry.js', '/js/nl.js', '/js/calendar.js', '/js/exports.js', '/js/chat.js', '/js/settings.js', '/js/main.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // network only

  // Same-origin shell + fonts/Chart.js/SheetJS CDNs: serve the cached copy fast, refresh in the background
  const cacheable = url.origin === location.origin || ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname);
  if (!cacheable) return;
  if (url.origin === location.origin) { // own files: network first so a deploy is never mixed with stale scripts
    e.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || caches.match('/'))));
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => hit || (req.mode === 'navigate' ? cache.match('/') : Response.error()));
      return hit || net;
    })
  );
});
