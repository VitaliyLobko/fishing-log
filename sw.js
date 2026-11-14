importScripts('./version.js');

const CACHE = `fishing-log-${self.APP_VERSION}-${self.APP_BUILD}`;
const ASSETS = [
  './',
  './index.html',
  './version.js',
  './manifest.webmanifest',
  './demo.json',
  './starter.json',
  './css/app.css',
  './css/topo.svg',
  './css/topo-light.svg',
  './css/waves.svg',
  './css/lines.svg',
  './css/lines-acc.svg',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/sync.js',
  './js/google-token.js',
  './js/ui.js',
  './js/i18n.js',
  './js/photos.js',
  './js/changelog.js',
  './js/weather.js',
  './js/scenes.js',
  './js/bot.js',
  './js/nfc.js',
  './js/bot-key.js',
  './js/vendor/qrcode.js',
  './js/vendor/leaflet.js',
  './js/map.js',
  './css/leaflet.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/author.jpg',
  './icons/cat-portrait.png',
];

// Файли — повз HTTP-кеш браузера: GitHub Pages віддає max-age=600, і без reload
// оновлення 10 хвилин після релізу ставило б старі файли.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Лише свої старі версії: на vitaliylobko.github.io поруч живуть інші застосунки зі своїми кешами
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fishing-log-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// «Поділитися» → Fishing Log (share_target у manifest): картинку — у кеш, застосунок забере її за ?go=shared
async function receiveShare(request) {
  try {
    const data = await request.formData();
    const file = data.get('image');
    const cache = await caches.open('shared-image-fishing-log');
    if (file && file.size) await cache.put('shared', new Response(file, { headers: { 'Content-Type': file.type || 'image/jpeg' } }));
    else {
      // Поділились сторінкою: браузер дає адресу в url або в text разом із назвою
      const link = [data.get('url'), data.get('text'), data.get('title')].filter(Boolean).join(' ').trim();
      if (link) await cache.put('shared-link', new Response(link, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    }
  } catch { /* не вийшло — застосунок просто відкриється */ }
  return Response.redirect(new URL('?go=shared', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'POST' && new URL(request.url).searchParams.get('go') === 'shared') {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (err) {
      if (request.mode === 'navigate') return caches.match('./index.html');
      throw err;
    }
  })());
});
