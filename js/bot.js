// Бот Хобі-плану (Cloudflare Worker) як ШІ-помічник: з посилання на товар заповнює картку речі.
// Адреса й ключ — спільні для всіх застосунків автора на пристрої (bot-key.js): вставив в одному — підхоплюють усі.
import * as BK from './bot-key.js';

/** Адреса й ключ, які бот не відкидав; null — не підключено (або ключ уже не приймається — див. keyProblem). */
export const botConfig = () => BK.current(0);
export const keyProblem = () => BK.keyProblem(0);
export const setBot = (url, key) => BK.publish(url, key);

/** POST до бота: відповідь як є, помилка — Error з кодом (no-bot, offline, unauthorized, old-bot, fetch, limit…). */
async function post(path, body) {
  const cfg = botConfig();
  if (!cfg) throw new Error('no-bot');
  if (!navigator.onLine) throw new Error('offline');
  let r;
  try {
    r = await fetch(`${cfg.url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('network');
  }
  if (r.ok) { BK.markOk(cfg); return r; }
  const e = await r.json().catch(() => ({}));
  if (r.status === 401) BK.markBad(cfg);
  // Старий бот ще не знає цієї адреси — його треба перезалити
  throw new Error(r.status === 404 ? 'old-bot' : r.status === 401 ? 'unauthorized' : e.error || `HTTP ${r.status}`);
}

/** { url } або { text, url } + категорії → { item, image, note, source }. */
export const gearFromPage = async (body) => (await post('/api/gear-from-url', body)).json();

/** Фото товару через бота (магазин не віддасть його застосунку напряму) → File або null. */
export async function gearImage(url) {
  try {
    const blob = await (await post('/api/gear-image', { url })).blob();
    return blob.type.startsWith('image/') ? new File([blob], 'shop', { type: blob.type }) : null;
  } catch {
    return null;
  }
}
