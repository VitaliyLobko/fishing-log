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
