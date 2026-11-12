// Погода виїзду з Open-Meteo (без ключа, з CORS) і фаза місяця — рахується тут, без мережі.
// Чисті функції без DOM: застосунок сам вирішує, що показати.

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const day = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const HPA_TO_MM = 0.750062;

/**
 * Погода на дату й годину в точці: { t, p, dp, w, wd, cc, rain } —
 * °C, тиск у мм рт. ст., його зміна за добу, вітер м/с, напрям °, хмарність %, опади за добу мм.
 * Недавні дати й прогноз — з api, давні (понад 60 днів) — з архіву; архів відстає на кілька днів.
 */
export async function weatherAt({ lat, lon }, date, hour = 8) {
  const old = (Date.now() - Date.parse(`${date}T00:00:00Z`)) / 864e5 > 60;
  const q = new URLSearchParams({
    latitude: Number(lat).toFixed(3), longitude: Number(lon).toFixed(3), timezone: 'auto', wind_speed_unit: 'ms',
    start_date: day(date, -1), end_date: date,
    hourly: 'temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation',
  });
  const x = (await getJson(`https://${old ? 'archive-api' : 'api'}.open-meteo.com/v1/${old ? 'archive' : 'forecast'}?${q}`)).hourly;
  const i = x.time.indexOf(`${date}T${String(Math.min(23, Math.max(0, hour))).padStart(2, '0')}:00`);
  const p = x.pressure_msl?.[i];
  if (i < 24 || p === null || p === undefined) throw new Error('no data');
  const start = x.time.indexOf(`${date}T00:00`);
  const mm = (hpa) => Math.round(hpa * HPA_TO_MM);
  return {
    t: x.temperature_2m[i], p: mm(p), dp: mm(p) - mm(x.pressure_msl[i - 24]),
    w: x.wind_speed_10m[i], wd: x.wind_direction_10m[i], cc: x.cloud_cover[i],
    rain: Math.round(x.precipitation.slice(start, start + 24).reduce((s, v) => s + (Number(v) || 0), 0) * 10) / 10,
  };
}

const SYNODIC = 29.530588853;
// Відомий молодик: 6 січня 2000, 18:14 UTC
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** Фаза місяця на дату: { idx: 0–7 (0 — молодик, 4 — повня), age: днів від молодика }. */
export function moonPhase(date) {
  const days = (Date.parse(`${date}T12:00:00Z`) - NEW_MOON) / 864e5;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  return { idx: Math.round((age / SYNODIC) * 8) % 8, age };
}

/** Напрям вітру — одна з 8 сторін: 0 — північ, 2 — схід… */
export const compass = (deg) => Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8;
