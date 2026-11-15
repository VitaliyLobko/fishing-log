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

// Плитки карти (супутник Esri, схема OSM), які людина вже бачила, — щоб на воді без мережі карта була.
// Назва кешу — не з «fishing-log-»: activate чистить такі при кожному оновленні. Райони, збережені кнопкою
// в картці водойми, лежать окремо («tiles-area-fishing-log-<id>») і звідси не витісняються.
const TILES = 'tiles-fishing-log';
const TILE_HOSTS = new Set(['server.arcgisonline.com', 'tile.openstreetmap.org']);
// Свіжа плитка (до тижня) — з кешу, без мережі: OSM просить кешувати щонайменше 7 днів, а на воді так і швидше
const TILE_FRESH = 7 * 864e5;
// ≈ 4000 плиток по 10–25 КБ — до ~100 МБ; найстаріші витісняються
const TILE_MAX = 4000;
// Стара плитка вже є — по нову мережу чекаємо недовго, інакше на слабкому зв'язку карта стоїть сірою
const TILE_WAIT = 6000;
let tilePuts = 0;

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  // keys() — у порядку додавання (перезапис ставить у кінець): спершу найстаріші
  for (const k of keys.slice(0, Math.max(0, keys.length - TILE_MAX))) await cache.delete(k);
}

async function tile(event, request) {
  const hit = await caches.match(request);
  const age = hit ? Date.now() - Date.parse(hit.headers.get('date') ?? '') : Infinity;
  if (hit && age < TILE_FRESH) return hit;
  const ctl = new AbortController();
  const timer = hit ? setTimeout(() => ctl.abort(), TILE_WAIT) : null;
  try {
    const res = await fetch(request, { signal: ctl.signal });
    // Лише відповіді CORS: «непрозорі» Chrome рахує в квоті як ~7 МБ кожну
    if (res.ok && res.type === 'cors') {
      const cache = await caches.open(TILES);
      await cache.put(request, res.clone());
      tilePuts += 1;
      if (tilePuts % 200 === 0) event.waitUntil(trimTiles());
    }
    return res;
  } catch (err) {
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Плитки, які показує карта (img); завантаження району з картки водойми йде fetch-ем повз цей кеш
  if (request.method === 'GET' && request.destination === 'image' && TILE_HOSTS.has(url.hostname)) {
    event.respondWith(tile(event, request));
    return;
  }
  if (request.method === 'POST' && new URL(request.url).searchParams.get('go') === 'shared') {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
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
