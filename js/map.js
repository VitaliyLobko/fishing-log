// Карта водойми (Leaflet, лежить у vendor): схема OpenStreetMap або супутник Esri.
// Бібліотека й стилі вантажаться лише тоді, коли карту вперше відкрили.

let loading = null;

/** Leaflet — одним завантаженням на сесію; без мережі файли беруться з кешу service worker. */
export function loadLeaflet() {
  loading ??= new Promise((resolve, reject) => {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: './css/leaflet.css' }));
    const s = Object.assign(document.createElement('script'), { src: './js/vendor/leaflet.js' });
    s.onload = () => resolve(window.L);
    s.onerror = () => { loading = null; reject(new Error('map')); };
    document.head.append(s);
  });
  return loading;
}

const LAYERS = {
  sat: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 18,
    // Знімок без підписів — зверху прозорі шари Esri: дороги, назви міст і сіл
    over: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    ],
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxNativeZoom: 19,
  },
};

/** Україна цілком — коли ще немає жодної точки й телефон не дав місце. */
export const UA = { lat: 48.6, lon: 31.2, zoom: 6 };

/** Карта в елементі; layer — 'sat' чи 'osm', setLayer міняє підкладку. */
export function makeMap(L, el, { lat, lon, zoom, layer = 'sat', interactive = true }) {
  const map = L.map(el, {
    zoomControl: interactive, attributionControl: true, dragging: interactive, touchZoom: interactive,
    scrollWheelZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive, tap: interactive,
  }).setView([lat, lon], zoom);
  map.attributionControl.setPrefix(false);
  let shown = [];
  map.setLayer = (key) => {
    shown.forEach((l) => l.remove());
    const x = LAYERS[key] ?? LAYERS.sat;
    shown = [x.url, ...(x.over ?? [])].map((url, i) => L.tileLayer(url, {
      attribution: i ? undefined : x.attribution, maxNativeZoom: x.maxNativeZoom, maxZoom: 20,
    }).addTo(map));
  };
  map.setLayer(layer);
  return map;
}

const PIN = {
  water: '<path d="M12 3.5c3 3.6 5 6.4 5 9a5 5 0 0 1-10 0c0-2.6 2-5.4 5-9z"/>',
  park: '<path d="M5 17V12l2-5h10l2 5v5M5 17h14M5 17v2M19 17v2M5 12h14"/><circle cx="8.5" cy="14.5" r=".8"/><circle cx="15.5" cy="14.5" r=".8"/>',
  fish: '<path d="M3 12c3-4.5 9-5.5 14-2.5l4-2.5v10l-4-2.5C12 17.5 6 16.5 3 12z"/>',
};

/** Маркер-шпилька зі значком: вода — крапля, під'їзд — авто. */
export function pinIcon(L, kind) {
  return L.divIcon({
    className: `map-pin map-pin-${kind}`,
    html: `<span class="pin-body"><svg viewBox="0 0 24 24" aria-hidden="true">${PIN[kind]}</svg></span>`,
    iconSize: [36, 36],
    // Вістря краплі (кут, повернутий донизу) — трохи нижче квадрата
    iconAnchor: [18, 43],
  });
}

// ---------- листи карти глибин ----------
// Лист — картинка без координат. Дві пари точок «на листі ↔ на супутнику» задають подібність:
// масштаб, поворот і зсув у проєкції Меркатора (у ній лежить і сама карта). Атласи креслять за північчю
// сітки, а не справжньою — поворот на 1–2° дає ~100 м на краю листа, тому його не відкидаємо.

const R = 6378137;
const merc = ({ lat, lon }) => ({ x: R * lon * Math.PI / 180, y: R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) });
const unmerc = ({ x, y }) => ({ lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, lon: x / R * 180 / Math.PI });
const cmul = (a, b) => ({ x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x });
const cdiv = (a, b) => {
  const d = b.x * b.x + b.y * b.y;
  return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
};
const csub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const cadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
// Пікселі листа: y униз, а в Меркаторі — угору; без перевороту лист ліг би дзеркально
const flip = ({ x, y }) => ({ x, y: -y });

const pairDone = (p) => p && [p.x, p.y, p.lat, p.lon].every(Number.isFinite);

/** Чи задана прив'язка: дві повні пари, точки на листі не збігаються. */
export function sheetPinned(c) {
  const [a, b] = c?.pts ?? [];
  return Boolean(pairDone(a) && pairDone(b) && Math.hypot(a.x - b.x, a.y - b.y) > 1);
}

/** Перетворення листа: toLatLng(x, y) з пікселів, toPx({lat, lon}) назад; null — лист не прив'язано. */
export function sheetGeo(c) {
  if (!sheetPinned(c)) return null;
  const [p1, p2] = c.pts;
  const m1 = merc(p1);
  const q1 = flip(p1);
  const a = cdiv(csub(merc(p2), m1), csub(flip(p2), q1));
  const b = csub(m1, cmul(a, q1));
  const toLatLng = (x, y) => unmerc(cadd(cmul(a, flip({ x, y })), b));
  const toPx = (ll) => flip(cdiv(csub(merc(ll), b), a));
  const corners = [[0, 0], [c.w, 0], [c.w, c.h], [0, c.h]].map(([x, y]) => toLatLng(x, y));
  const lats = corners.map((p) => p.lat);
  const lons = corners.map((p) => p.lon);
  return {
    toLatLng,
    toPx,
    corners,
    box: { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) },
    center: toLatLng(c.w / 2, c.h / 2),
    // Поворот листа відносно півночі, градуси — щоб показати, наскільки лист «косий»
    turn: Math.atan2(a.y, a.x) * 180 / Math.PI,
  };
}

/** Чи лежить точка на листі (у межах картинки). */
export function onSheet(c, geo, ll) {
  const p = geo.toPx(ll);
  return p.x >= 0 && p.y >= 0 && p.x <= c.w && p.y <= c.h;
}

/**
 * Шар Leaflet: картинка листа, розтягнута й повернута матрицею CSS за трьома кутами.
 * ImageOverlay так не вміє — він лише прямокутник «північ угорі».
 */
export function sheetLayer(L, url, c, geo) {
  const corners = (g) => [[0, 0], [c.w, 0], [0, c.h]].map(([x, y]) => {
    const p = g.toLatLng(x, y);
    return L.latLng(p.lat, p.lon);
  });
  let ll = corners(geo);
  const Layer = L.Layer.extend({
    onAdd(map) {
      this._img = L.DomUtil.create('img', `leaflet-image-layer depth-sheet ${map._zoomAnimated ? 'leaflet-zoom-animated' : 'leaflet-zoom-hide'}`);
      // Лист — кілька мегапікселів: розпаковувати у фоні, інакше перехід на сусідній лист смикає карту
      Object.assign(this._img, { decoding: 'async', src: url, alt: '', draggable: false });
      Object.assign(this._img.style, { width: `${c.w}px`, height: `${c.h}px`, opacity: this._opacity ?? 0.7 });
      map.getPanes().overlayPane.append(this._img);
      this._reset();
    },
    onRemove() { this._img.remove(); },
    getEvents() {
      const ev = { zoom: this._reset, viewreset: this._reset };
      if (this._map._zoomAnimated) ev.zoomanim = this._anim;
      return ev;
    },
    /** Нова прив'язка без перестворення картинки — щоб лист не блимав під час підгонки. */
    setGeo(g) {
      ll = corners(g);
      if (this._map) this._reset();
      return this;
    },
    setOpacity(v) {
      this._opacity = v;
      if (this._img) this._img.style.opacity = v;
      return this;
    },
    _place([tl, tr, bl]) {
      const m = [(tr.x - tl.x) / c.w, (tr.y - tl.y) / c.w, (bl.x - tl.x) / c.h, (bl.y - tl.y) / c.h, tl.x, tl.y];
      this._img.style.transform = `matrix(${m.join(',')})`;
    },
    // Без округлення до пікселя (latLngToLayerPoint округлює) — інакше на малому зумі кут і крок підгонки «стрибають»
    _reset() { this._place(ll.map((p) => this._map.project(p)._subtract(this._map.getPixelOrigin()))); },
    _anim(e) { this._place(ll.map((p) => this._map._latLngToNewLayerPoint(p, e.zoom, e.center))); },
  });
  return new Layer();
}

/** Метрів Меркатора в одному пікселі екрана на цьому зумі (плитка 256 px). */
export const mercPerPx = (zoom) => 2 * Math.PI * R / (256 * 2 ** zoom);

/**
 * Підгонка прив'язки: обидві точки на супутнику зсуваються на dx, dy (метри Меркатора: схід, північ)
 * і повертаються на turn градусів (проти годинникової) навколо center. Точки на листі не змінюються.
 */
export function nudgePts(pts, { dx = 0, dy = 0, turn = 0, center }) {
  const c = merc(center);
  const r = { x: Math.cos(turn * Math.PI / 180), y: Math.sin(turn * Math.PI / 180) };
  return pts.map((p) => {
    const ll = unmerc(cadd(cadd(cmul(r, csub(merc(p), c)), c), { x: dx, y: dy }));
    return { ...p, lat: ll.lat, lon: ll.lon };
  });
}
