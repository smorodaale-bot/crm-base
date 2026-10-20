/* Nova CRM PWA — never cache HTML; hashed /assets are immutable. */
const CACHE = 'nova-crm-v6';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHtml(request, url) {
  return (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname.endsWith('.html')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (isHtml(request, url) || url.pathname === '/sw.js') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() =>
        fetch(request).catch(
          () =>
            new Response(
              '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Nova CRM</title><p>Страница обновляется. <a href="/">Открыть снова</a></p></html>',
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
            )
        )
      )
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
