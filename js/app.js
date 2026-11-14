// Fishing Log: рибальські снасті — що є й де лежить. Місця вкладаються одне в одне, речі лежать у місцях.
// Інфраструктура (база, синхронізація, шторки, теми, «Що нового») — з fpv-log; фото речі — як у shooting-log.
import * as db from './db.js';
import * as sync from './sync.js';
import * as bot from './bot.js';
import * as nfc from './nfc.js';
import { loadLeaflet, makeMap, pinIcon, UA } from './map.js';
import { t, lang, locale, collate, plural, applyStatic } from './i18n.js';
import { prepare as preparePhoto } from './photos.js';
import { weatherAt, moonPhase, compass } from './weather.js';
import { h, fmt, sheet, refreshSheets, toast, form, chips, confirmSheet, selectOptions, toolBtn, toolIcon, icon, goTab, confirmed, fieldError, setUndo, swipeStep, swipeable, pickStrip } from './ui.js';

let state = { places: [], gear: [], spots: [], trips: [], packs: [], wishes: [], photos: [], prefs: [] };
let tab = 'gear';
// Звідки відкрили налаштування — туди веде «Назад»
let backTab = 'gear';

const $ = (id) => document.getElementById(id);

// ---------- дрібниці ----------

function today(when = new Date()) {
  const d = new Date(when);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const addDays = (date, n) => new Date(Date.parse(date) + n * 864e5).toISOString().slice(0, 10);
const num = (v) => Number(v) || 0;

function remember(key, value) {
  try { localStorage.setItem(key, value ?? ''); } catch { /* приватний режим */ }
}

function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function btn(label, onclick, kind = '') {
  return h('button', { type: 'button', class: `btn ${kind}`, onclick }, label);
}

function box(title, content, tools = null) {
  return h('fieldset', { class: 'box' }, h('legend', {}, title, tools), content);
}

/**
 * Група, що згортається; розгорнуту пам'ятає між запусками. body-функція будує вміст лише при першому розгортанні;
 * has — id записів усередині: щоб «збережено» підсвітило заголовок згорнутої групи, коли рядків ще немає.
 */
function fold(key, title, body, cls = '', has = null) {
  const open = recall(`fishing-log:open:${key}`) === '1';
  const lazy = typeof body === 'function';
  let built = !lazy || open;
  const el = h('details', { class: `ex-more ${cls}`.trim(), open, dataset: has?.length ? { has: has.join(' ') } : null },
    h('summary', {}, title), lazy ? (open ? body() : null) : body);
  el.addEventListener('toggle', () => {
    if (el.open && !built) { built = true; el.append(body()); }
    remember(`fishing-log:open:${key}`, el.open ? '1' : '');
  });
  return el;
}

function empty(title, text, actions = []) {
  return h('div', { class: 'empty' }, h('h3', {}, title), h('p', { class: 'muted' }, text),
    actions.length ? h('div', { class: 'btn-row' }, actions) : null);
}

/** Рядок списку: назва, підпис, праворуч — значення. */
function row(title, sub, right, onclick, { id = null, cls = '', thumb = null } = {}) {
  return h('button', { type: 'button', class: `row ${cls}`, onclick, dataset: id ? { id } : undefined },
    thumb,
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), sub ? h('span', { class: 'muted small' }, sub) : null),
    right !== null && right !== undefined && right !== '' ? h('span', { class: 'row-qty' }, right) : null);
}

/**
 * Факти картки рядками з розділювачами: [підпис, значення, onclick?]. З onclick — увесь рядок кнопка зі «›»
 * (палець влучає в рядок 44+ px, а не в підкреслене слово); порожні значення пропускаються.
 */
function facts(rows) {
  const list = rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '');
  if (!list.length) return null;
  return h('div', { class: 'facts' }, list.map(([k, v, onclick]) => h(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: 'fact', onclick },
    h('span', { class: 'fact-k' }, k), h('span', { class: 'fact-v' }, v), onclick ? h('span', { class: 'fact-go', 'aria-hidden': 'true' }, '›') : null)));
}

function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter((p) => p && p[1] !== null && p[1] !== undefined && p[1] !== '')
    .map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function invalidField(f) {
  const bad = f.invalid();
  if (bad) fieldError(f.inputs[bad.name], t('Заповніть поле «{label}»', { label: bad.label }));
  return Boolean(bad);
}

/** Запис у власну історію: дата й текст. */
const logged = (rec, text, date = today()) => ({ ...rec, history: [...(rec.history ?? []), { date, text }] });


// ---------- фото ----------

/** Нове фото: запис із мініатюрою + файл. Повертає зміни для db.write і id. */
async function newPhoto(file, owner) {
  const { blob, thumb } = await preparePhoto(file);
  const id = db.uid();
  return { id, photos: { put: [{ id, owner, thumb, created: Date.now() }] }, blobs: { put: [{ id, blob }] } };
}

/** Прибрати фото: запис, файл і копію на Диску. */
function dropPhotos(ids) {
  const list = ids.map(findPhoto).filter(Boolean);
  list.forEach((p) => sync.trashPhoto(p.driveId));
  return list.length ? { photos: { del: list.map((p) => p.id) }, blobs: { del: list.map((p) => p.id) } } : {};
}

/** Мініатюра речі: фото, а без нього — значок її розділу (монограма «ГП» нічого не каже). */
function gearThumb(g) {
  // Значок розділу — лише коли фото немає: розбирати SVG для кожного рядка з фото — зайва робота
  if (findPhoto(g.photoId)) return thumbImg(g.photoId);
  const el = h('span', { class: 'thumb-ico', 'aria-hidden': 'true' });
  el.innerHTML = `<svg viewBox="0 0 24 24">${GROUP_ICONS[sectionOf(groupOf(g))?.icon] ?? GROUP_ICONS.other}</svg>`;
  return thumbImg(null, el);
}

// Мініатюра зберігається data-URL (~10–20 КБ тексту): у src щоразу копіювався б увесь рядок, тож один раз — blob-адреса
const thumbUrls = new Map();
function thumbUrl(p) {
  const was = thumbUrls.get(p.id);
  if (was?.src === p.thumb) return was.url;
  if (was) URL.revokeObjectURL(was.url);
  const m = /^data:([^;,]+);base64,(.*)$/.exec(p.thumb ?? '');
  if (!m) return p.thumb;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: m[1] }));
  thumbUrls.set(p.id, { src: p.thumb, url });
  return url;
}

// src — лише коли мініатюра підходить до екрана: інакше кожна з сотень у списку одразу починає вантажитись
const thumbWait = new Set();
const thumbIo = 'IntersectionObserver' in window ? new IntersectionObserver((list) => {
  for (const e of list) if (e.isIntersecting) { e.target.src = e.target.dataset.src; thumbIo.unobserve(e.target); thumbWait.delete(e.target); }
}, { rootMargin: '600px 300px' }) : null;
/** Мініатюри, що пішли зі сторінки (перемальовування, закритий аркуш), не показались — перестаємо стежити, щоб не тримати їх у пам'яті. */
function dropGoneThumbs() {
  for (const img of thumbWait) if (!img.isConnected) { thumbIo.unobserve(img); thumbWait.delete(img); }
}

function thumbImg(photoId, fallback = '') {
  const p = findPhoto(photoId);
  if (!p) return h('span', { class: 'thumb mono', style: '--h: 25' }, fallback);
  if (!thumbIo) return h('img', { class: 'thumb', src: thumbUrl(p), alt: '', decoding: 'async' });
  const img = h('img', { class: 'thumb', alt: '', decoding: 'async', dataset: { src: thumbUrl(p) } });
  thumbIo.observe(img);
  thumbWait.add(img);
  return img;
}

/** Фото на весь екран: двома пальцями — збільшити, подвійний тап — 1× / 2.5×, змах убік — сусіднє фото зі списку ids. */
function showPhoto(id, ids = [id]) {
  const list = ids.filter((x) => findPhoto(x));
  let at = Math.max(0, list.indexOf(id));
  if (!list.length) return;
  let url = null;
  const img = h('img', { class: 'photo-full', alt: '', draggable: 'false' });
  const count = h('p', { class: 'muted small photo-count' });
  let z = { s: 1, x: 0, y: 0 };
  const apply = () => { img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`; };
  const show = async () => {
    const p = findPhoto(list[at]);
    z = { s: 1, x: 0, y: 0 };
    apply();
    if (url) URL.revokeObjectURL(url);
    url = null;
    img.src = p.thumb;
    count.textContent = list.length > 1 ? `${at + 1} / ${list.length}` : '';
    const blob = await db.getBlob(p.id);
    if (blob && list[at] === p.id) { url = URL.createObjectURL(blob); img.src = url; }
  };
  const pts = new Map();
  let start = null;
  const snap = () => {
    const [a, b] = [...pts.values()];
    start = { ...z, a: { ...a }, dist: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, n: pts.size };
  };
  const wrap = h('div', {
    class: 'photo-wrap',
    onpointerdown: (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      snap();
      try { wrap.setPointerCapture(e.pointerId); } catch { /* вказівник уже відпущено */ }
    },
    onpointermove: (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pts.values()];
      if (b && start.dist) z.s = Math.min(5, Math.max(1, start.s * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist)));
      else if (!b && start.s > 1) { z.x = start.x + a.x - start.a.x; z.y = start.y + a.y - start.a.y; }
      apply();
    },
    ondblclick: () => { z = z.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }; apply(); },
  }, img);
  const up = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    pts.delete(e.pointerId);
    const dx = p.x - start.a.x;
    // Змах одним пальцем без збільшення — до сусіднього фото
    if (e.type === 'pointerup' && start.n === 1 && !pts.size && z.s === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(p.y - start.a.y)) {
      const next = at + (dx < 0 ? 1 : -1);
      if (next >= 0 && next < list.length) { at = next; show(); }
    }
    if (z.s <= 1) { z = { s: 1, x: 0, y: 0 }; apply(); }
    if (pts.size) snap();
  };
  wrap.addEventListener('pointerup', up);
  wrap.addEventListener('pointercancel', up);
  show();
  sheet(t('Фото'), h('div', { class: 'photo-view' }, wrap, count), { full: true, onClose: () => url && URL.revokeObjectURL(url) });
}



// ---------- дані ----------

// Пошук за id — через Map, що будується раз на завантаження: state після кожного збереження новий, масиви не міняються на місці
const indexes = new WeakMap();
function byId(list) {
  let map = indexes.get(list);
  if (!map) { map = new Map(list.map((x) => [x.id, x])); indexes.set(list, map); }
  return map;
}
const findGear = (id) => (id ? byId(state.gear).get(id) : null);
const findPlace = (id) => (id ? byId(state.places).get(id) : null);
const findPhoto = (id) => (id ? byId(state.photos).get(id) : null);
const prefs = () => byId(state.prefs).get('settings') ?? { id: 'settings' };

async function load() {
  state = await db.loadAll();
}

async function refresh() {
  await load();
  render();
  refreshSheets();
}

async function save(changes, ids = []) {
  await db.write(changes);
  await refresh();
  confirmed(ids);
}

/** Злити кілька наборів змін для db.write: { store: { put, del } } — списки складаються. */
function joinChanges(...list) {
  const out = {};
  for (const c of list) {
    for (const [store, ops] of Object.entries(c ?? {})) {
      out[store] ??= {};
      for (const [op, arr] of Object.entries(ops)) out[store][op] = [...(out[store][op] ?? []), ...arr];
    }
  }
  return out;
}

// ---------- категорії ----------

// Група — розділ у фільтрі; приманки, оснастка й фідерне рахуються кількістю, решта — поштучно
const GROUPS = [['rods', 'Вудилища'], ['reels', 'Котушки'], ['lines', 'Шнури й волосінь'], ['lures', 'Приманки'], ['tackle', 'Оснастка'],
  ['feeder', 'Фідер'], ['boxes', 'Коробки й ящики'], ['camp', 'Табір і туризм'], ['clothes', 'Одяг'], ['other', 'Інше']];
const QTY_GROUPS = ['lures', 'tackle', 'feeder'];
const CATS = [
  ['rod', 'Вудилище', 'rods'], ['reel', 'Котушка', 'reels'], ['line', 'Шнур / волосінь', 'lines'],
  ['wobbler', 'Воблер', 'lures'], ['spoon', 'Блешня', 'lures'], ['soft', 'Силікон', 'lures'], ['fly', 'Мушка', 'lures'], ['lure', 'Інша приманка', 'lures'],
  ['hook', 'Гачки', 'tackle'], ['jighead', 'Джиг-головки', 'tackle'], ['sinker', 'Грузила', 'tackle'], ['swivel', 'Вертлюжки й застібки', 'tackle'],
  ['leader', 'Повідці', 'tackle'], ['tackle', 'Інша оснастка', 'tackle'],
  // четвертий елемент — виняток із правила групи: род-под у «Фідері», але поштучно
  ['cage', 'Годівниця', 'feeder'], ['groundbait', 'Прикормка / каша', 'feeder'], ['additive', 'Ароматика й добавки', 'feeder'],
  ['hookbait', 'Насадка', 'feeder'], ['makukha', 'Макуха', 'feeder'], ['makush', 'Макушатник', 'feeder'],
  ['rodpod', 'Род-под / підставки', 'feeder', 'unit'],
  ['box', 'Коробка / ящик', 'boxes'],
  // Табір — усе, що береться на риболовлю з ночівлею: поштучно, як ящики
  ['tent', 'Намет', 'camp'], ['sleepbag', 'Спальник', 'camp'], ['mat', 'Каремат', 'camp'], ['chair', 'Крісло / стілець', 'camp'],
  ['table', 'Стіл', 'camp'], ['stove', 'Пальник / таганок', 'camp'], ['cookware', 'Посуд', 'camp'], ['light', 'Ліхтар', 'camp'],
  ['campgear', 'Інше спорядження', 'camp'],
  ['clothes', 'Одяг', 'clothes'], ['sonar', 'Ехолот', 'other'], ['net', 'Підсак', 'other'], ['other', 'Інше', 'other'],
];
/**
 * Розділи по порядку: вбудовані (GROUPS) і свої. prefs.sections — збережений список { key, name, icon, qty } у порядку показу;
 * вбудований, якого там ще немає (з'явився в новій версії), додається в кінець. Як «Групи» в «Заняттях» Хобі-плану.
 */
function buildSections() {
  const base = GROUPS.map(([key, name]) => ({ key, name: t(name), icon: key, builtin: true }));
  const own = prefs().sections ?? [];
  const seen = new Set(own.map((x) => x.key));
  return [...own.map((x) => ({ ...(base.find((b) => b.key === x.key) ?? {}), ...x, builtin: base.some((b) => b.key === x.key) })),
    ...base.filter((b) => !seen.has(b.key))];
}
/** Вбудовані категорії (назву можна змінити — prefs.catNames) + свої. */
const buildCats = () => [...CATS.map(([id, name, group, kind]) => ({ id, name: prefs().catNames?.[id] || t(name), group, builtin: true, ...(kind ? { kind } : {}) })),
  ...(prefs().cats ?? [])];

// Розділи й категорії залежать лише від налаштувань і мови — будуються раз на їх зміну, а не на кожен рядок і кожне порівняння сортування
let catsMemo = { prefs: null, lang: null };
function catsCache() {
  if (catsMemo.prefs !== state.prefs || catsMemo.lang !== lang()) {
    const secs = buildSections();
    const cats = buildCats();
    // Як find/findIndex: за однакового ключа перемагає перший
    const first = (list, key) => { const m = new Map(); list.forEach((x, i) => { if (!m.has(x[key])) m.set(x[key], [x, i]); }); return m; };
    const secs1 = first(secs, 'key');
    catsMemo = { prefs: state.prefs, lang: lang(), secs, cats, secByKey: new Map([...secs1].map(([k, [x]]) => [k, x])),
      secIndex: new Map([...secs1].map(([k, [, i]]) => [k, i])), catById: new Map([...first(cats, 'id')].map(([k, [x]]) => [k, x])) };
  }
  return catsMemo;
}
/** Розділи по порядку. Копія списку — щоб випадкова зміна масиву не зіпсувала кеш. */
const sections = () => [...catsCache().secs];
const sectionOf = (key) => catsCache().secByKey.get(key) ?? catsCache().secByKey.get('other');
const groupLabel = (g) => sectionOf(g)?.name ?? t('Інше');
const allCats = () => [...catsCache().cats];
const catOf = (id) => catsCache().catById.get(id) ?? { id: 'other', name: t('Інше'), group: 'other' };
const groupOf = (g) => catOf(g.cat).group;
// Кількістю: вбудовані приманки, оснастка й фідерне; свій розділ — якщо так позначено
const qtyCat = (c) => (c.kind ? c.kind === 'qty' : QTY_GROUPS.includes(c.group) || Boolean(sectionOf(c.group)?.qty));
const isQty = (g) => qtyCat(catOf(g.cat));
// Вага — у приманок, оснастки й годівниць: «Годівниця Method 30 г»
const hasWeight = (c) => ['lures', 'tackle'].includes(c.group) || c.id === 'cage';
const UNITS = [['pcs', 'шт'], ['kg', 'кг'], ['pack', 'уп'], ['l', 'л']];
const unitLabel = (g) => t(UNITS.find(([k]) => k === (g.unit || 'pcs'))?.[1] ?? 'шт');
const pieces = (g) => (g.unit || 'pcs') === 'pcs';
const qtyText = (g) => `${fmt.num(g.qty)} ${unitLabel(g)}`;
const weightText = (g) => (g.weight ? `${fmt.num(g.weight)} ${t('г')}` : null);
/** Закінчується: остаток не більший за поріг «мало» (без порога — коли 0). */
const isLow = (g) => isQty(g) && active(g) && num(g.qty) <= num(g.low);
const catOptions = () => sections().map((x) => ({ group: x.name, options: allCats().filter((c) => c.group === x.key).map((c) => [c.id, c.name]) }));

const STATUS = { have: 'В наявності', lost: 'Втрачено', broken: 'Зламано', sold: 'Продано', gift: 'Подаровано' };
const ACTIONS = [['', '—'], ['xfast', 'Екстрашвидкий'], ['fast', 'Швидкий'], ['mod', 'Середній'], ['slow', 'Повільний']];
const ROD_TYPES = [['', '—'], ['spin', 'Спінінг'], ['feeder', 'Фідер'], ['float', 'Поплавок'], ['donka', 'Донка'], ['fly', 'Нахлист'], ['other', 'Інше']];
const label = (list, k) => (k ? t(list.find(([x]) => x === k)?.[1] ?? '') : '');
// Поля, що показуються лише для своєї групи
const GROUP_FIELDS = {
  rods: ['length', 'test', 'action', 'pieces', 'rodType'], reels: ['size', 'ratio', 'spools'], lines: ['pe', 'mm', 'length'],
  lures: ['lureSize', 'sizeUnit'],
};
// Поля лише окремої категорії: у воблера — плавучість і заглиблення
const CAT_FIELDS = { wobbler: ['buoy', 'depth'] };
const SPEC_FIELDS = [...new Set([...Object.values(GROUP_FIELDS).flat(), ...Object.values(CAT_FIELDS).flat()])];
const SIZE_UNITS = [['mm', 'мм'], ['cm', 'см'], ['in', 'дюйми']];
const BUOYS = [['', '—'], ['F', 'F — плаває'], ['SP', 'SP — суспендер'], ['S', 'S — тоне'], ['SS', 'SS — повільно тоне']];
/** Розмір приманки: «95 мм», «3"». */
const sizeText = (g) => (num(g.lureSize) ? (g.sizeUnit === 'in' ? `${fmt.num(g.lureSize)}"` : `${fmt.num(g.lureSize)} ${t(g.sizeUnit === 'cm' ? 'см' : 'мм')}`) : null);

const active = (g) => (g.status ?? 'have') === 'have';

// Напрямок: хижак чи мирна риба; '' — універсальне (видно в обох)
// Табір — окремо: речі для ночівлі не хижацькі й не мирні, у фільтрах риби їх не видно
const DIRS = [['predator', 'Хижак'], ['peaceful', 'Мирна'], ['camp', 'Табір']];
/** Напрямок за замовчуванням — з категорії й типу вудилища; людина може змінити в картці. */
function inferDir(g) {
  const c = catOf(g.cat);
  if (c.group === 'lures' || g.cat === 'jighead') return 'predator';
  if (c.group === 'feeder') return 'peaceful';
  if (c.group === 'camp') return 'camp';
  if (c.group === 'rods') return ['spin', 'fly'].includes(g.rodType) ? 'predator' : ['feeder', 'float', 'donka'].includes(g.rodType) ? 'peaceful' : '';
  return '';
}
// Усе з розділу «Табір і туризм» — табір, що б не стояло в полі
const dirOf = (g) => (groupOf(g) === 'camp' ? 'camp' : g.dir ?? inferDir(g));
let dirFilter = DIRS.some(([k]) => k === recall('fishing-log:dir')) ? recall('fishing-log:dir') : '';
/** Хижак / мирна — свої й універсальні; табір — лише табірне. */
function inDir(g) {
  if (!dirFilter) return true;
  const d = dirOf(g);
  return dirFilter === 'camp' ? d === 'camp' : d === dirFilter || d === '';
}
/**
 * Варіанти вибору речі, згруповані за напрямком: хижак, мирна, універсальні, табір.
 * Напрямок самої речі — першим; одна група — простий список без підписів.
 */
function dirOptions(items, toOption, first = '') {
  const order = [...DIRS.map(([k]) => k), ''].sort((a, b) => (first ? (b === first) - (a === first) : 0));
  const caption = { predator: 'Хижак', peaceful: 'Мирна', camp: 'Табір', '': 'Універсальні' };
  const groups = order.map((d) => ({ group: t(caption[d]), options: items.filter((x) => dirOf(x) === d).map(toOption) }))
    .filter((gr) => gr.options.length);
  return groups.length > 1 ? groups : items.map(toOption);
}
const gearTitle = (g) => g?.name || [g?.brand, g?.model].filter(Boolean).join(' ') || catOf(g?.cat).name;

// ---------- місця ----------

/** Шлях місця: «Гараж → Шафа → Ящик №2». Захист від петлі — якщо дані зіпсовані синхронізацією. */
function pathOf(id) {
  const names = [];
  const seen = new Set();
  for (let p = findPlace(id); p && !seen.has(p.id); p = findPlace(p.parentId)) {
    seen.add(p.id);
    names.unshift(p.name);
  }
  return names.join(' → ');
}

/** Місце й усе вкладене в нього. */
function subtree(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of state.places) if (p.parentId && out.has(p.parentId) && !out.has(p.id)) { out.add(p.id); grew = true; }
  }
  return out;
}

/** Де річ фактично: котушка на вудилищі — там, де вудилище; шнур на котушці — там, де котушка. */
function placeOf(g, depth = 0) {
  const host = g.onId ? findGear(g.onId) : null;
  return host && depth < 3 ? placeOf(host, depth + 1) : g.placeId ?? null;
}

/** Підпис «де»: «на Shimano Sedona» для змонтованого, інакше шлях місця. */
function whereText(g) {
  const host = g.onId ? findGear(g.onId) : null;
  if (host) return t('на «{name}»', { name: gearTitle(host) });
  return g.placeId ? pathOf(g.placeId) : t('без місця');
}

const placeOptions = (exclude = new Set()) => [['', t('— без місця —')],
  ...state.places.filter((p) => !exclude.has(p.id)).map((p) => [p.id, pathOf(p.id)]).sort((a, b) => collate(a[1], b[1]))];

const countIn = (id) => {
  const ids = subtree(id);
  return state.gear.filter((g) => active(g) && ids.has(placeOf(g))).length;
};

// ---------- фото у формі (як у shooting-log) ----------

/**
 * Одне фото до запису: плитка-прев'ю (тап — фото на весь екран, порожня — вибрати), «Знайти фото» —
 * Google Картинки за назвою, «Вставити» — скопійоване зображення; на комп'ютері ще Ctrl+V і перетягування.
 */
function photoPicker(current, { file: preset = null, query = () => '', onSearch = null } = {}) {
  let file = preset;
  let removed = Boolean(preset);
  let url = null;
  const el = h('div', { class: 'photo-pick' });
  const take = (f) => {
    if (!f?.type?.startsWith('image/')) return false;
    file = f;
    removed = false;
    paint();
    return true;
  };
  const input = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { take(e.target.files[0]); e.target.value = ''; } });
  const search = () => {
    const q = query();
    if (!q) { toast(t('Спершу впишіть назву')); return; }
    onSearch?.();
    window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, '_blank', 'noopener');
  };
  const paste = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((x) => x.startsWith('image/'));
        if (type) { take(new File([await item.getType(type)], 'clip', { type })); return; }
      }
      // Порада, як скопіювати, — лише коли вставка не вдалася, а не постійним рядком під кнопками
      toast(t('У буфері немає картинки. У Google: довгий тап на картинці → «Копіювати зображення», тоді «Вставити»'));
    } catch {
      toast(t('Браузер не дав прочитати буфер — поділіться картинкою в застосунок або збережіть її в галерею'));
    }
  };
  // Ctrl+V, поки форма відкрита; закрилась — слухач знімає себе сам
  const onPaste = (e) => {
    if (!el.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f && take(f)) e.preventDefault();
  };
  document.addEventListener('paste', onPaste);
  const view = () => {
    if (file) sheet(t('Фото'), h('img', { class: 'photo-full', src: url, alt: '' }), { full: true });
    else showPhoto(current.id);
  };
  function paint() {
    if (url) URL.revokeObjectURL(url);
    url = file ? URL.createObjectURL(file) : null;
    const src = url ?? (removed ? null : current?.thumb);
    el.replaceChildren(
      h('button', {
        type: 'button', class: `photo-pick-thumb ${src ? '' : 'empty'}`, 'aria-label': t('Фото'),
        onclick: () => (src ? view() : input.click()),
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => { e.preventDefault(); take(e.dataTransfer?.files?.[0]); },
      }, src ? h('img', { src, alt: '' }) : h('span', {}, '+ ', t('Фото'))),
      // Кожна дія підписана: голі значки без підпису доводилось пояснювати рядком-інструкцією
      h('div', { class: 'photo-pick-acts' },
        btn([icon('search'), t('Знайти в Google')], search, 'mini with-ico'),
        navigator.clipboard?.read ? btn([icon('paste'), t('Вставити скопійоване')], paste, 'mini with-ico') : null,
        btn([icon('gallery'), t('З галереї')], () => input.click(), 'mini with-ico'),
        src ? btn([icon('delete'), t('Прибрати фото')], () => { file = null; removed = true; paint(); }, 'mini with-ico quiet danger') : null),
      input);
  }
  paint();
  return { el, value: () => ({ file, removed: removed || Boolean(file) }) };
}

// Перед переходом у Google запам'ятовуємо, куди повернути картинку, якою потім поділяться в застосунок
const PHOTO_FOR = 'fishing-log:photo-for';

/** Картинка, якою поділились у застосунок: service worker кладе її в кеш, тут — відкрити ту саму форму. */
async function takeSharedImage() {
  const cache = await caches.open('shared-image-fishing-log');
  // Поділились посиланням (сторінка магазину) — нова річ, одразу заповнюється з нього
  const shared = await cache.match('shared-link');
  if (shared) {
    await cache.delete('shared-link');
    const url = linkIn(await shared.text());
    if (url) { gearForm(null, { link: url, autoFill: true }); return; }
  }
  const res = await cache.match('shared');
  if (!res) return;
  await cache.delete('shared');
  const blob = await res.blob();
  const file = new File([blob], 'shared', { type: blob.type || 'image/jpeg' });
  let target = null;
  try { target = JSON.parse(recall(PHOTO_FOR) || 'null'); } catch { /* зіпсований запис — як немає */ }
  remember(PHOTO_FOR, '');
  if (!target) { toast(t('Відкрийте річ і натисніть «Знайти фото» — потім поділіться картинкою')); return; }
  const g = findGear(target.gearId);
  gearForm(g, { file, preset: g ? null : target.draft });
  toast(t('Картинку отримано — збережіть'));
}

/** Зміни фото речі для db.write: нове — записати, старе — прибрати (з кошиком Диска). */
async function photoChanges(g, change, ownerId) {
  if (!change?.removed) return { changes: {}, photoId: g?.photoId ?? null };
  const old = g?.photoId ? dropPhotos([g.photoId]) : {};
  if (!change.file) return { changes: old, photoId: null };
  const fresh = await newPhoto(change.file, ownerId);
  return { changes: joinChanges(old, { photos: fresh.photos, blobs: fresh.blobs }), photoId: fresh.id };
}

// ---------- снасті ----------

let query = '';
let picking = null; // Set id — режим «Вибрати» для перенесення кількох речей
let secOrder = null; // ключі розділів — режим «Змінити порядок»

// ---------- розділи: як групи в «Заняттях» Хобі-плану ----------

const saveSections = (list) => save({ prefs: { put: [{ ...prefs(), sections: list.map(({ key, name, icon, qty, color }) => ({ key, name, icon, ...(qty ? { qty } : {}), ...(color ? { color } : {}) })) }] } });

/** Позначити вибрану кнопку в групі-перемикачі. */
function markPicked(group, picked) {
  group.querySelectorAll('button').forEach((b) => { const on = b === picked; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
}

/** Значок і колір розділу — згорнутими рядками з поточним значенням, як у Хобі-плані; d змінюється на місці. */
function sectionLook(d) {
  const iconValue = h('span', { class: 'pick-value' });
  const colorValue = h('span', { class: 'pick-value' });
  // Групи з підзаголовками й пошук за назвою; назва групи теж шукається: «табір» показує всю групу
  const groups = ICON_GROUPS.map(([title, keys]) => {
    const el = h('div', { class: 'icon-group' }, h('div', { class: 'field-label' }, t(title)),
      h('div', { class: 'chips icon-pick', role: 'group', 'aria-label': t(title) }, keys.map((k) => {
        const b = h('button', { type: 'button', class: k === d.icon ? 'on' : '', 'aria-pressed': String(k === d.icon), 'aria-label': t(ICON_NAMES[k] ?? k), title: t(ICON_NAMES[k] ?? k),
          onclick: () => { d.icon = k; markPicked(icons, b); paint(); } });
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GROUP_ICONS[k]}</svg>`;
        b.dataset.find = norm(t(ICON_NAMES[k] ?? k));
        return b;
      })));
    el.dataset.find = norm(t(title));
    return el;
  });
  const empty = h('p', { class: 'muted small', hidden: true }, t('Нічого не знайдено'));
  const search = h('input', { type: 'search', class: 'icon-search', placeholder: t('Пошук: човен, ліхтар, щука…'), 'aria-label': t('Пошук значка'), enterkeyhint: 'search', autocomplete: 'off' });
  search.addEventListener('input', () => {
    const q = norm(search.value.trim());
    let shown = 0;
    for (const g of groups) {
      const whole = !q || g.dataset.find.includes(q);
      let inGroup = 0;
      for (const b of g.querySelectorAll('button')) { b.hidden = !(whole || b.dataset.find.includes(q)); if (!b.hidden) inGroup += 1; }
      g.hidden = !inGroup;
      shown += inGroup;
    }
    empty.hidden = shown > 0;
  });
  const icons = h('div', { class: 'icon-groups' }, search, empty, groups);
  // Шторка порівнює .chips за value: без нього зміна лише значка чи кольору не питала «Вийти без збереження?»
  for (const row of icons.querySelectorAll('.chips')) Object.defineProperty(row, 'value', { get: () => d.icon });
  const colors = h('div', { class: 'chips color-pick', role: 'group', 'aria-label': t('Колір') },
    [['', null, 'Без кольору'], ...SECTION_COLORS].map(([k, hex, name]) => {
      const b = h('button', { type: 'button', class: k === (d.color ?? '') ? 'on' : '', 'aria-pressed': String(k === (d.color ?? '')), 'aria-label': t(name), title: t(name),
        onclick: () => { d.color = k || null; markPicked(colors, b); paint(); } });
      if (hex) b.style.setProperty('--c', hex); else b.classList.add('none');
      return b;
    }));
  Object.defineProperty(colors, 'value', { get: () => d.color ?? '' });
  const paint = () => {
    const hex = sectionColor(d.color);
    iconValue.replaceChildren(secIco(d.icon, hex), h('span', {}, t(ICON_NAMES[d.icon] ?? '')));
    colorValue.replaceChildren(hex ? h('span', { class: 'swatch-dot' }) : '', h('span', {}, t(SECTION_COLORS.find(([k]) => k === d.color)?.[2] ?? 'Без кольору')));
    colorValue.style.setProperty('--c', hex ?? 'transparent');
    icons.style.setProperty('--c', hex ?? 'var(--accent-2)');
  };
  paint();
  const row = (title, value, body) => h('details', { class: 'ex-more pick-fold' }, h('summary', {}, h('span', { class: 'pick-title' }, title), value), body);
  return h('div', { class: 'pick-folds' }, row(t('Значок'), iconValue, icons), row(t('Колір'), colorValue, colors));
}

/**
 * «Змінити порядок»: розділи рядками — тягнути за ⋮⋮.
 * «Готово» зберігає, «Скасувати» — як було.
 */
function sectionOrder() {
  const byKey = new Map(sections().map((x) => [x.key, x]));
  const counts = new Map();
  for (const g of state.gear) if (active(g)) counts.set(groupOf(g), (counts.get(groupOf(g)) ?? 0) + 1);
  const list = h('div', { class: 'rows sec-order', role: 'list', 'aria-label': t('Порядок розділів') });
  // Перетягування: рядок їде за пальцем, сусіди міняються місцями, щойно палець перейшов їхню середину
  const drag = (row, e) => {
    e.preventDefault();
    // Слухаємо документ, а не ⋮⋮: перестановка рядка в DOM знімає з нього захоплення вказівника
    row.classList.add('dragging');
    const move = (ev) => {
      for (const other of list.children) {
        if (other === row) continue;
        const r = other.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const before = other.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING;
        if (before && ev.clientY > mid) { other.after(row); break; }
        if (!before && ev.clientY < mid) { other.before(row); break; }
      }
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      secOrder = [...list.children].map((x) => x.dataset.key);
      draw();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  };
  const draw = () => list.replaceChildren(...secOrder.map((key) => {
    const x = byKey.get(key);
    const row = h('div', { class: 'row sec-order-row', role: 'listitem', dataset: { key } });
    const grip = h('button', { type: 'button', class: 'sec-grip', 'aria-label': t('Перетягнути «{name}»', { name: x.name }), onpointerdown: (e) => drag(row, e) }, icon('grip'));
    row.append(grip, sectionHead(x.icon, x.name, counts.get(key) ?? 0, 0, null, sectionColor(x.color)));
    return row;
  }));
  draw();
  const done = async () => {
    const next = secOrder.map((k) => byKey.get(k)).filter(Boolean);
    secOrder = null;
    await saveSections(next);
    toast(t('Порядок збережено'));
  };
  const acts = () => h('div', { class: 'btn-row' }, btn(t('Скасувати'), () => { secOrder = null; render(); }), btn(t('Готово'), done, 'primary'));
  // Смуга не липне: інакше ховається під шапку; «Готово» ще й під списком — щоб не гортати назад
  return h('div', {},
    h('div', { class: 'pick-bar order-bar' }, h('span', {}, t('Тягніть розділ за ⋮⋮')), acts()),
    list, acts());
}

/** Розділ: назва, значок, колір, категорії (вбудовані — перейменувати, свої — ще й видалити), свій — видалити весь. */
function sectionForm(x) {
  const isNew = !x;
  const d = x ? { ...x } : { key: `s-${db.uid()}`, name: '', icon: 'star', qty: false };
  const f = form([
    { name: 'name', label: t('Назва'), value: d.name, required: true, placeholder: t('напр. Човен і мотор') },
    ...(d.builtin ? [] : [{ name: 'qty', label: t('Рахувати'), type: 'select', value: d.qty ? '1' : '', options: [['', t('Поштучно')], ['1', t('Кількістю')]] }]),
  ]);
  const look = sectionLook(d);
  const list = sections();
  const cats = allCats().filter((c) => c.group === d.key);
  // Після зміни категорії — те саме вікно зі свіжим списком
  const reopen = () => { close(); sectionForm(sections().find((y) => y.key === d.key)); };
  const catRows = isNew ? null : box(t('Категорії'), h('div', {},
    cats.length ? h('div', { class: 'rows' }, cats.map((c) => h('div', { class: 'row slot' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name),
        h('span', { class: 'muted small' }, (() => { const n = state.gear.filter((g) => g.cat === c.id).length; return n ? t('речей: {n}', { n }) : t('порожня'); })())),
      toolBtn('edit', t('Перейменувати «{name}»', { name: c.name }), () => catNameForm(c, null, reopen)),
      c.builtin ? null : toolBtn('delete', t('Видалити «{name}»', { name: c.name }), () => dropCat(c, reopen), 'danger')))) : h('p', { class: 'muted small' }, t('Ще немає категорій.')),
    h('div', { class: 'btn-row' }, btn(t('+ Категорія'), () => catNameForm(null, d.key, reopen)))));
  const close = sheet(isNew ? t('Новий розділ') : t('Розділ'), h('div', {},
    f.el, look,
    catRows,
    !isNew && !d.builtin ? h('div', { class: 'btn-row' }, btn(t('Видалити розділ'), () => removeSection(d), 'danger')) : null,
    d.builtin ? h('p', { class: 'muted small' }, t('Вбудований розділ можна перейменувати й переставити, але не видалити: на ньому тримаються поля вудилищ, котушок і шнурів.')) : null), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      const rec = { ...d, name: v.name, qty: d.builtin ? undefined : v.qty === '1', color: d.color || undefined };
      const next = isNew ? [...list, rec] : list.map((y) => (y.key === d.key ? rec : y));
      close();
      await saveSections(next);
      // Новий розділ одразу з категорією тієї ж назви — інакше його не вибрати в картці речі
      if (isNew) { const p = prefs(); await save({ prefs: { put: [{ ...p, cats: [...(p.cats ?? []), { id: `c-${db.uid()}`, name: v.name, group: d.key }] }] } }); }
    }, 'primary')],
  });
}

/** Назва категорії: своя — нова чи перейменувати, вбудована — лише перейменувати (prefs.catNames). */
function catNameForm(c, group = null, onDone = null) {
  const f = form([{ name: 'name', label: t('Назва'), value: c?.name, required: true, placeholder: t('напр. Мормишки') }]);
  const close = sheet(c ? t('Категорія') : t('Нова категорія'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const { name } = f.values();
      const p = prefs();
      close();
      if (!c) await save({ prefs: { put: [{ ...p, cats: [...(p.cats ?? []), { id: `c-${db.uid()}`, name, group }] }] } });
      else if (c.builtin) await save({ prefs: { put: [{ ...p, catNames: { ...(p.catNames ?? {}), [c.id]: name } }] } });
      else await save({ prefs: { put: [{ ...p, cats: (p.cats ?? []).map((x) => (x.id === c.id ? { ...x, name } : x)) }] } });
      onDone?.();
    }, 'primary')],
  });
}

async function dropCat(c, onDone = null) {
  if (state.gear.some((g) => g.cat === c.id)) { toast(t('Категорією користуються речі — спершу змініть їм категорію')); return; }
  const p = prefs();
  await save({ prefs: { put: [{ ...p, cats: (p.cats ?? []).filter((x) => x.id !== c.id) }] } });
  onDone?.();
}

/** Свій розділ видаляється, а його категорії переїжджають в «Інше» — речі нікуди не зникають. */
function removeSection(x) {
  const n = state.gear.filter((g) => groupOf(g) === x.key).length;
  confirmSheet(t('Видалити розділ «{name}»?', { name: x.name }), t('Речей у ньому: {n}. Вони й категорії розділу переїдуть в «Інше».', { n }), t('Видалити'), async () => {
    const p = prefs();
    await save({ prefs: { put: [{ ...p,
      sections: sections().filter((y) => y.key !== x.key).map(({ key, name, icon, qty }) => ({ key, name, icon, ...(qty ? { qty } : {}) })),
      cats: (p.cats ?? []).map((c) => (c.group === x.key ? { ...c, group: 'other' } : c)) }] } });
    document.querySelectorAll('#layer .backdrop').forEach((b) => b.remove());
    toast(t('Розділ «{name}» видалено', { name: x.name }));
  });
}

// ---------- обслуговування ----------

const monthsSince = (iso) => (Date.now() - Date.parse(`${iso}T12:00:00`)) / (30.44 * 864e5);
/** Як часто: котушку — обслуговувати, шнур — міняти (місяці; ⚙ → «Обслуговування»). */
const serviceMonths = () => ({ reel: num(prefs().serviceMonths?.reel) || 12, line: num(prefs().serviceMonths?.line) || 9 });
const SERVICE_KINDS = [['lube', 'Змащення'], ['clean', 'Чистка'], ['bearing', 'Підшипник'], ['other', 'Інше']];

/** Від якої дати рахувати: останнє обслуговування, інакше покупка. Без жодної дати — не нагадуємо (не знаємо). */
function serviceSince(g) {
  const last = (g.service ?? []).map((x) => x.date).filter(Boolean).sort().pop();
  return last ?? g.firstBuy?.date ?? g.buyDate ?? (num(g.created) > 0 ? today(new Date(g.created)) : null);
}

/** Що з річчю пора зробити, або null. */
function serviceDue(g) {
  if (!active(g)) return null;
  const m = serviceMonths();
  if (groupOf(g) === 'reels') {
    const since = serviceSince(g);
    const age = since ? monthsSince(since) : 0;
    return age >= m.reel ? t('не обслуговувалась {n} міс.', { n: Math.floor(age) }) : null;
  }
  if (groupOf(g) === 'lines' && g.onId && g.onDate) {
    const age = monthsSince(g.onDate);
    return age >= m.line ? t('намотано {n} міс. тому — час міняти', { n: Math.floor(age) }) : null;
  }
  return null;
}

function serviceSheet(g) {
  let kind = 'lube';
  const c = chips(SERVICE_KINDS.map(([k, l]) => [k, t(l)]), kind, (v) => { kind = v; });
  const f = form([{ name: 'date', label: t('Дата'), type: 'dmy', value: today(), required: true }, { name: 'note', label: t('Примітка'), placeholder: t('напр. мастило Shimano, шпуля') }]);
  const close = sheet(t('Обслужив'), h('div', {}, h('p', { class: 'muted small' }, gearTitle(g)), c, f.el), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      close();
      const rec = logged({ ...g, service: [...(g.service ?? []), { id: db.uid(), date: v.date, kind, note: v.note }] },
        [t('Обслуговано'), t(label(SERVICE_KINDS, kind)), v.note].filter(Boolean).join(': '), v.date);
      await save({ gear: { put: [rec] } }, [g.id]);
    }, 'primary')],
  });
}

/** Шнур перемотали чи поставили новий на ту саму котушку — відлік починається знову. */
async function rewound(g) {
  await save({ gear: { put: [logged({ ...g, onDate: today() }, t('Перемотано'))] } }, [g.id]);
  toast(t('Відлік шнура почався знову'));
}

function serviceDueBox() {
  const list = state.gear.filter(inDir).map((g) => ({ g, why: serviceDue(g) })).filter((x) => x.why).sort((a, b) => byGroup(a.g, b.g));
  if (!list.length) return null;
  // Картка, як розділи нижче, з жовтою смугою — а не дрібне посилання з лінією над пошуком
  return h('div', { class: 'gear-groups due-box' }, fold('service-due', `${t('Потребує уваги')} · ${list.length}`,
    h('div', { class: 'rows' }, list.map(({ g, why }) => row(gearTitle(g), why, '', () => gearDetail(g.id), { cls: 'low', thumb: gearThumb(g) })))));
}

function serviceRow() {
  const m = serviceMonths();
  const f = form([
    { name: 'reel', label: t('Котушку — раз на, міс.'), type: 'number', value: m.reel, half: true },
    { name: 'line', label: t('Шнур — міняти через, міс.'), type: 'number', value: m.line, half: true },
  ]);
  return setRow('service', 'wrench', t('Обслуговування'), t('{r} / {l} міс.', { r: m.reel, l: m.line }), [
    h('p', { class: 'muted small' }, t('Котушка, яку давно не змащували, і шнур, що відходив своє, з’являться вгорі «Снастей» у «Потребує уваги».')),
    f.el,
    h('div', { class: 'btn-row' }, btn(t('Зберегти'), () => {
      if (invalidField(f)) return;
      const v = f.values();
      if (!(v.reel > 0) || !(v.line > 0)) { toast(t('Більше нуля')); return; }
      save({ prefs: { put: [{ ...prefs(), serviceMonths: { reel: v.reel, line: v.line } }] } });
    }, 'primary'))]);
}

// ---------- уловистість ----------

/** Улов на цю приманку чи насадку: [{ tr, c }] від нових виїздів до старих. */
const caughtOn = (g) => state.trips.flatMap((tr) => (tr.catches ?? []).filter((c) => c.baitId === g.id).map((c) => ({ tr, c })))
  .sort((a, b) => collate(b.tr.date, a.tr.date));

// Скільки риб на кожну річ — раз на стан, а не обхід усіх виїздів для кожного рядка списку
let caughtMemo = { trips: null, map: new Map() };
function caughtCount(g) {
  if (caughtMemo.trips !== state.trips) {
    const map = new Map();
    for (const tr of state.trips) for (const c of tr.catches ?? []) if (c.baitId) map.set(c.baitId, (map.get(c.baitId) ?? 0) + (num(c.n) || 1));
    caughtMemo = { trips: state.trips, map };
  }
  return caughtMemo.map.get(g.id) ?? 0;
}

function catchBox(g) {
  const list = caughtOn(g);
  if (!list.length) return null;
  const bySpecies = new Map();
  for (const { c } of list) bySpecies.set(c.species, (bySpecies.get(c.species) ?? 0) + (num(c.n) || 1));
  const total = [...bySpecies.values()].reduce((s, n) => s + n, 0);
  // Найбільша — лише з поштучних записів: вага «разом» за кількох риб не про одну рибину
  const best = list.filter(({ c }) => (num(c.n) || 1) === 1 && num(c.weight)).sort((a, b) => num(b.c.weight) - num(a.c.weight))[0];
  return box([t('Уловистість'), h('span', { class: 'fish-count' }, icon('fish'), fmt.num(total))], h('div', {},
    kv([...[...bySpecies].sort((a, b) => b[1] - a[1]).map(([s, n]) => [s, fmt.num(n)]),
      best ? [t('Найбільша'), `${best.c.species} ${fmt.num(best.c.weight)} ${t('кг')} · ${fmt.date(catchDate(best.tr, best.c))}`] : null]),
    h('div', { class: 'rows' }, list.slice(0, 5).map(({ tr, c }) => row(
      `${c.species}${num(c.n) > 1 ? ` × ${fmt.num(c.n)}` : ''}`,
      [fmt.date(catchDate(tr, c)), tripTitle(tr), c.weight ? `${fmt.num(c.weight)} ${t('кг')}` : null].filter(Boolean).join(' · '),
      '', () => tripDetail(tr.id)))),
    list.length > 5 ? h('p', { class: 'muted small' }, t('Ще записів: {n}', { n: list.length - 5 })) : null));
}

/** here — список уже всередині місця речі: рядок «де лежить» зайвий (крім «на вудилищі»). */
function gearRow(g, opts) {
  const here = opts?.here && active(g) && !g.onId;
  const qty = isQty(g);
  const fish = caughtCount(g);
  const title = gearTitle(g);
  // Два рядки замість суцільного «· · ·» на 3–4 рядки: характеристики, потім де лежить; бренд і модель — лише коли їх немає в назві
  const bm = [g.brand, g.model].filter(Boolean).join(' ');
  const specs = [sizeText(g), weightText(g), bm && !norm(title).includes(norm(g.model || g.brand)) ? bm : null, g.color].filter(Boolean).join(' · ');
  const sub = [specs ? h('span', { class: 'row-line' }, specs) : null,
    here ? null : h('span', { class: 'row-line row-place' }, active(g) ? icon('pin') : null, h('span', {}, active(g) ? whereText(g) : t(STATUS[g.status])))];
  const side = qty || fish ? h('span', { class: 'row-side' }, qty ? h('b', {}, qtyText(g)) : null,
    fish ? h('span', { class: 'fish-count', title: t('Упіймано на неї') }, icon('fish'), fmt.num(fish)) : null) : '';
  const el = row(title, sub.some(Boolean) ? sub : null, side,
    () => {
      if (!picking) { gearDetail(g.id); return; }
      if (!picking.delete(g.id)) picking.add(g.id);
      paintGear();
    }, { id: g.id, cls: [picking?.has(g.id) ? 'picked' : '', active(g) ? '' : 'gone', isLow(g) ? 'low' : ''].join(' '), thumb: gearThumb(g) });
  if (picking) return el;
  // Свайп лише вправо — швидка дія; «Списати» — у картці (вліво дублювало «−1 Втратив»); тап — картка
  const body = h('div', { class: `${el.className} swipe-body`, role: 'button', dataset: { id: g.id } }, ...el.childNodes);
  const quick = quickAction(g);
  return swipeable(h('div', { class: 'gear-card', 'aria-label': gearTitle(g) }, body), {
    onTap: () => gearDetail(g.id),
    onRight: quick.fn, rightLabel: quick.label,
  });
}

/** Швидка дія свайпом вправо: що найчастіше роблять із цією річчю. */
function quickAction(g) {
  if (!active(g)) return { label: t('Повернути'), fn: () => setStatus(g, 'have', t('Повернуто в наявні')) };
  if (isQty(g)) return pieces(g) ? { label: t('−1 Втратив'), fn: () => lostOne(g) } : { label: t('Витратив'), fn: () => spendSheet(g) };
  return { label: t('Перенести'), fn: () => placePicker(t('Куди перенести'), (placeId) => moveGear([g], placeId)) };
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’ʼ`']/g, "'");
const haystack = (g) => norm([g.name, g.brand, g.model, g.color, g.note, catOf(g.cat).name, weightText(g), sizeText(g), g.buoy, whereText(g)].join(' '));
const sectionIndex = (key) => catsCache().secIndex.get(key) ?? 999;
const byGroup = (a, b) => sectionIndex(groupOf(a)) - sectionIndex(groupOf(b)) || collate(gearTitle(a), gearTitle(b));

/** Пошук — по речах у наявності; списані видно в своєму розділі. */
function shownGear() {
  const words = norm(query).split(/\s+/).filter(Boolean);
  return state.gear.filter((g) => active(g) && inDir(g)).filter((g) => { const hs = haystack(g); return words.every((w) => hs.includes(w)); }).sort(byGroup);
}

/** Значок розділу в плитці; color — розділ свого кольору. */
function secIco(iconKey, color = null) {
  const ico = h('span', { class: color ? 'sec-ico tinted' : 'sec-ico', 'aria-hidden': 'true' });
  ico.innerHTML = `<svg viewBox="0 0 24 24">${GROUP_ICONS[iconKey] ?? GROUP_ICONS.other}</svg>`;
  if (color) ico.style.setProperty('--c', color);
  return ico;
}

/** Заголовок розділу: значок, назва, під нею — «мало», праворуч — кількість. */
function sectionHead(iconKey, label, n, low = 0, onEdit = null, color = null) {
  // «мало: N» — другим рядком під назвою: поруч з нею стискало назву до «Прима…»
  return h('span', { class: 'sec-head' }, secIco(iconKey, color),
    h('span', { class: 'sec-text' }, h('span', { class: 'sec-name' }, label), low ? h('span', { class: 'sec-low' }, t('мало: {n}', { n: low })) : null),
    h('span', { class: 'sec-count' }, fmt.num(n)),
    // Олівець у заголовку — змінити розділ; розділ при цьому не згортається
    onEdit ? Object.assign(h('button', {
      type: 'button', class: 'icon-btn sec-edit', 'aria-label': t('Змінити розділ «{name}»', { name: label }),
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); onEdit(); },
    }), { innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>' }) : null);
}

let gearList = null;

function paintGear() {
  if (!gearList?.isConnected) return;
  // «+» у режимі порядку лише заважає — ховається, render() поверне
  if (secOrder) { gearList.replaceChildren(sectionOrder()); $('fab').hidden = true; return; }
  const list = shownGear();
  const bar = picking ? h('div', { class: 'pick-bar' },
    h('span', {}, t('Вибрано: {n}', { n: picking.size })),
    h('div', { class: 'btn-row' },
      btn(t('Скасувати'), () => { picking = null; render(); }),
      btn(t('Напрямок'), () => {
        if (!picking.size) { toast(t('Позначте хоча б одну річ')); return; }
        dirSheet([...picking].map(findGear).filter(Boolean));
      }),
      btn(t('Перенести'), () => {
        if (!picking.size) { toast(t('Позначте хоча б одну річ')); return; }
        placePicker(t('Куди перенести'), (placeId) => moveGear([...picking].map(findGear).filter(Boolean), placeId));
      }, 'primary'))) : null;
  // Без пошуку — розділи-картки (згорнуті, стан пам'ятається) і «Списані» наприкінці; пошук і «Вибрати» — плоский список
  const gone = state.gear.filter((g) => !active(g) && inDir(g)).sort(byGroup);
  // Напрямок звузив усе до одного розділу (у «Таборі» — лише «Табір і туризм»): картка розділу зайва, речі — одразу списком
  const used = new Set(list.map(groupOf));
  const only = dirFilter && used.size === 1 ? sectionOf([...used][0]) : null;
  const body = query || picking
    ? (list.length ? h('div', { class: 'rows' }, list.map(gearRow)) : h('p', { class: 'muted' }, t('Нічого не знайдено')))
    : h('div', { class: 'gear-groups' },
      only ? (only.key === 'lures' ? lureBody(list) : h('div', { class: 'rows' }, list.map(gearRow))) : sections().map((x) => {
        const items = list.filter((g) => groupOf(g) === x.key);
        // Порожній свій розділ теж видно — щоб змінити чи видалити, як порожні групи в Хобі-плані
        return items.length || !x.builtin ? fold(`gear-${x.key}`, sectionHead(x.icon, x.name, items.length, items.filter(isLow).length, () => sectionForm(x), sectionColor(x.color)),
          items.length ? () => (x.key === 'lures' ? lureBody(items) : h('div', { class: 'rows' }, items.map(gearRow)))
            : h('p', { class: 'muted small' }, t('Порожній: категорію розділу вибирають у картці речі, олівець — змінити розділ.')), '', items.map((g) => g.id)) : null;
      }),
      gone.length ? fold('gear-gone', sectionHead('gone', t('Списані'), gone.length), () => h('div', { class: 'rows' }, gone.map(gearRow)), '', gone.map((g) => g.id)) : null,
      h('div', { class: 'btn-row' }, btn(t('+ Розділ'), () => sectionForm(null), 'quiet'),
        btn([icon('grip'), t('Змінити порядок')], () => { secOrder = sections().map((x) => x.key); render(); window.scrollTo(0, 0); }, 'quiet with-ico')));
  // «Потребує уваги» — лише в огляді: під час пошуку й вибору воно заважає
  gearList.replaceChildren(bar ?? '', query || picking ? '' : serviceDueBox() ?? '', body);
  if (thumbIo) dropGoneThumbs();
}

// ---------- приманки: підгрупи й моделі ----------

/** Одна модель — бренд, модель (чи назва) і розмір; кольори — різні речі однієї моделі. */
const modelKey = (g) => norm([g.brand, g.model || g.name, num(g.lureSize) || '', g.sizeUnit || ''].join('|'));
const lureSort = (a, b) => collate(norm([a.brand, a.model || a.name].join(' ')), norm([b.brand, b.model || b.name].join(' ')))
  || num(a.lureSize) - num(b.lureSize) || collate(a.color ?? '', b.color ?? '');

/** «Приманки»: згорнуті підгрупи за категорією (воблери, блешні, силікон…), у кожній — моделі з кольорами. */
function lureBody(items) {
  const used = new Set(items.map((g) => g.cat));
  return h('div', { class: 'gear-groups sub-groups' }, allCats().filter((c) => used.has(c.id)).map((c) => {
    const its = items.filter((g) => g.cat === c.id).sort(lureSort);
    return fold(`lures-${c.id}`, sectionHead('lures', c.name, its.length, its.filter(isLow).length, null, sectionColor(sectionOf('lures')?.color)), () => h('div', { class: 'rows' }, modelRows(its)), '', its.map((g) => g.id));
  }));
}

/** Кілька кольорів однієї моделі — одним рядком, що розгортається; одинак — звичайний рядок. */
function modelRows(its) {
  const groups = new Map();
  for (const g of its) groups.set(modelKey(g), [...(groups.get(modelKey(g)) ?? []), g]);
  return [...groups.values()].map((gs) => (gs.length < 2 ? gearRow(gs[0])
    : fold(`model-${modelKey(gs[0])}`, modelHead(gs), () => h('div', { class: 'rows model-rows' }, gs.map(gearRow)), 'model-fold', gs.map((g) => g.id))));
}

function modelHead(gs) {
  const g = gs[0];
  const total = gs.reduce((s, x) => s + num(x.qty), 0);
  const low = gs.filter(isLow).length;
  return h('span', { class: 'sec-head model-head' }, modelThumbs(gs),
    h('span', { class: 'sec-name' }, [[g.brand, g.model].filter(Boolean).join(' ') || gearTitle(g), sizeText(g)].filter(Boolean).join(' · ')),
    low ? h('span', { class: 'sec-low' }, t('мало: {n}', { n: low })) : null,
    h('span', { class: 'sec-count' }, t('{c} кол. · {n} шт', { c: gs.length, n: fmt.num(total) })));
}

const MODEL_THUMBS = 3;

/** Зразки кольорів у заголовку моделі: фото кожного кольору віялом, понад MODEL_THUMBS — «+N»; без жодного фото — один значок. */
function modelThumbs(gs) {
  const shots = gs.filter((g) => findPhoto(g.photoId));
  if (!shots.length) return gearThumb(gs[0]);
  const more = shots.length - MODEL_THUMBS;
  return h('span', { class: 'model-thumbs', 'aria-hidden': 'true' },
    shots.slice(0, more > 0 ? MODEL_THUMBS - 1 : MODEL_THUMBS).map(gearThumb),
    more > 0 ? h('span', { class: 'thumb thumb-more' }, `+${more + 1}`) : null);
}

/** Тап по кольору в картці — усі речі цього кольору в «Снастях». */
function searchFor(text) {
  document.querySelectorAll('#layer .backdrop').forEach((b) => b.remove());
  query = text;
  if (location.hash !== '#gear') goTab('#gear'); else render();
}

// Значки розділів для чипів-фільтра (stroke, 24×24)
const GROUP_ICONS = {
  '': '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  rods: '<path d="M4 20L20 4"/><circle cx="8" cy="16" r="2.3"/><path d="M20 4v6"/>',
  reels: '<circle cx="11" cy="12" r="7"/><circle cx="11" cy="12" r="2"/><path d="M18 12h3.5M21.5 10v4"/>',
  lines: '<path d="M6 4h12M6 20h12M8 4v16M16 4v16M8 9l8 2M8 13l8 2"/>',
  lures: '<path d="M3 11c3.5-4 9-4.5 13.5-2.5L21 11l-4.5 2.5C12 15.5 6.5 15 3 11z"/><path d="M9 14.5v3a1.6 1.6 0 0 0 3.2 0"/><circle cx="6.5" cy="10.5" r=".6"/>',
  tackle: '<path d="M15 3v10.5a4 4 0 0 1-8 0V11"/><path d="M7 11l2.5 2"/><circle cx="15" cy="3" r=".8"/>',
  feeder: '<path d="M8 4h8v16H8zM8 8h8M8 12h8M8 16h8M12 4v16"/>',
  boxes: '<path d="M3 9h18v11H3zM8 9V5h8v4M3 14h18"/>',
  camp: '<path d="M2.5 20L12 4l9.5 16z"/><path d="M12 4v16M8.5 20L12 14l3.5 6"/>',
  clothes: '<path d="M8 4L3 7l2 4 3-1v10h8V10l3 1 2-4-5-3c-1 2-2 2.8-4 2.8S9 6 8 4z"/>',
  other: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  gone: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  // ще кілька — для своїх розділів
  fish: '<path d="M3 12c3-4.5 9-5.5 14-2.5l4-2.5v10l-4-2.5C12 17.5 6 16.5 3 12z"/><circle cx="7.5" cy="11.2" r=".8"/>',
  boat: '<path d="M3 15h18l-2.5 4.5H5.5zM12 15V4l6 8h-6M12 7L7 12h5"/>',
  bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  light: '<path d="M9 21h6M10 17h4v4h-4zM12 3a6 6 0 0 1 4 10.5c-.7.6-1 1.6-1 2.5H9c0-.9-.3-1.9-1-2.5A6 6 0 0 1 12 3z"/>',
  tool: '<path d="M14.5 3.5a5 5 0 0 0-5.6 6.7L3.5 15.6v4.9h4.9l5.4-5.4a5 5 0 0 0 6.7-5.6l-3 3-3.5-.5-.5-3.5z"/>',
  star: '<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 3 1.1-6.2L3 9.7l6.2-.9z"/>',
  float: '<path d="M12 2.5v4M9.5 6.5h5L13.5 12h-3zM10.5 12L12 20l1.5-8"/><path d="M4 20.5h16"/>',
  net: '<path d="M4 5h16a8 8 0 0 1-16 0z"/><path d="M8 5l4 8 4-8M6 9h12"/><path d="M12 13v8"/>',
  knife: '<path d="M4 20l8.5-8.5M12.5 11.5L20 4c.5 3-1 6.5-4 9.5l-1.5 1.5z"/>',
  fire: '<path d="M12 3c1.2 3 4.5 4.6 4.5 9a4.5 4.5 0 0 1-9 0c0-2 1-3.4 2.2-4.4.1 1.9 1 3 2.3 3 0-3-1.2-5 0-7.6z"/><path d="M5 21h14"/>',
  backpack: '<path d="M7 8a5 5 0 0 1 10 0v12H7zM9.5 8V6a2.5 2.5 0 0 1 5 0v2M7 13h10M10 13v2h4v-2"/>',
  pike: '<path d="M5.2 12C8 9.2 12.6 8 17.4 8.7l4.3 1.4-4.1 1.9 3.6 1.8C17 15.6 9.4 15.4 5.2 12z"/><path d="M5.2 12 2.2 8.9l.9 3.1-.9 3.1z"/><path d="M8 10.1 7.3 7.4l3.5 1.5M8 13.9l-.7 2.7 3.5-1.5"/><circle cx="15.6" cy="10.1" r=".6"/>',
  sinker: '<path d="M12 3v3"/><path d="M12 6c-3 3.2-4.6 6.2-4.6 8.8a4.6 4.6 0 0 0 9.2 0C16.6 12.2 15 9.2 12 6z"/>',
  makukha: '<path d="M4 9l8-4 8 4-8 4z"/><path d="M4 9v7l8 4 8-4V9M12 13v7"/><path d="M7.5 14.5v1.5M16.5 14.5v1.5"/>',
  sonar: '<path d="M4 4h16v12H4zM9 20h6M12 16v4"/><path d="M6.5 12.5c1.8-2.6 3.6-2.6 5.4-.6s3.6 1.8 5.6-1.6"/>',
  bucket: '<path d="M5 9h14l-1.6 11H6.6z"/><path d="M5 9c0-3 3.1-5 7-5s7 2 7 5"/>',
  thermos: '<path d="M8.5 8h7v12a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1z"/><path d="M10 3h4v5h-4zM8.5 12h7"/>',
  chair: '<path d="M7 3v9h11"/><path d="M8 12l9 8M17 12l-9 8"/>',
  hat: '<path d="M5 16a7 7 0 0 1 14 0"/><path d="M4 16h16v3.5H4z"/><circle cx="12" cy="6.2" r="1.6"/>',
  boots: '<path d="M7 3h6v11l6 2.5V20H7z"/><path d="M7 17h12M7 7h6"/>',
  // Звичайні речі — з Lucide v0.460.0 (https://lucide.dev), як у Хобі-плані; рибальське вище — своє, у Lucide такого немає.
  // ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
  // All other copyright (c) for Lucide are held by Lucide Contributors 2022. Permission to use, copy, modify,
  // and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above
  // copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR
  // DISCLAIMS ALL WARRANTIES.
  worm: '<path d="m19 12-1.5 3"/><path d="M19.63 18.81 22 20"/><path d="M6.47 8.23a1.68 1.68 0 0 1 2.44 1.93l-.64 2.08a6.76 6.76 0 0 0 10.16 7.67l.42-.27a1 1 0 1 0-2.73-4.21l-.42.27a1.76 1.76 0 0 1-2.63-1.99l.64-2.08A6.66 6.66 0 0 0 3.94 3.9l-.7.4a1 1 0 1 0 2.55 4.34z"/>',
  umbrella: '<path d="M22 12a10.06 10.06 1 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
  firstaid: '<path d="M12 11v4"/><path d="M14 13h-4"/><path d="M16 6V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M18 6v14"/><path d="M6 6v14"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  glasses: '<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M2.5 13 5 7c.7-1.3 1.4-2 3-2"/><path d="M21.5 13 19 7c-.7-1.3-1.5-2-3-2"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  anchor: '<path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/>',
  battery: '<path d="M15 7h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2"/><path d="M6 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1"/><path d="m11 7-3 5h4l-3 5"/><line x1="22" x2="22" y1="11" y2="13"/>',
  torch: '<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/>',
  pot: '<path d="M2 12h20"/><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="m4 8 16-4"/><path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8"/>',
  coffee: '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>',
  axe: '<path d="m14 12-8.5 8.5a2.12 2.12 0 1 1-3-3L11 9"/><path d="M15 13 9 7l4-4 6 6h3a8 8 0 0 1-7 7z"/>',
  compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
  binoculars: '<path d="M10 10h4"/><path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3"/><path d="M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z"/><path d="M 22 16 L 2 16"/><path d="M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z"/><path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3"/>',
  camping: '<circle cx="4" cy="4" r="2"/><path d="m14 5 3-3 3 3"/><path d="m14 10 3-3 3 3"/><path d="M17 14V2"/><path d="M17 14H7l-5 8h20Z"/><path d="M8 14v8"/><path d="m9 14 5 8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  snow: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  waves: '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  thermo: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  sailboat: '<path d="M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z"/><path d="M21 14 10 2 3 14h18Z"/><path d="M10 2v16"/>',
  bike: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  caravan: '<path d="M18 19V9a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v8a2 2 0 0 0 2 2h2"/><path d="M2 9h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2"/><path d="M22 17v1a1 1 0 0 1-1 1H10v-9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9"/><circle cx="8" cy="19" r="2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
};
// Значки розділу групами з підзаголовками, як у Хобі-плані; ключі вже збережених розділів не міняти
const ICON_GROUPS = [
  ['Снасті', ['rods', 'reels', 'lines', 'lures', 'tackle', 'sinker', 'float', 'feeder', 'makukha', 'worm', 'net', 'sonar', 'fish', 'pike']],
  ['Табір і похід', ['camp', 'camping', 'fire', 'backpack', 'bag', 'chair', 'umbrella', 'light', 'torch', 'pot', 'coffee', 'thermos', 'bucket', 'knife', 'axe', 'firstaid', 'map', 'compass', 'binoculars']],
  ['Одяг', ['clothes', 'hat', 'boots', 'glasses']],
  ['Погода й вода', ['sun', 'snow', 'waves', 'thermo']],
  ['Транспорт', ['boat', 'sailboat', 'car', 'caravan', 'bike', 'anchor', 'battery']],
  ['Інше', ['boxes', 'tool', 'camera', 'star', 'other']],
];
const ICON_NAMES = {
  rods: 'Вудилище', reels: 'Котушка', lines: 'Шнур', lures: 'Приманка', tackle: 'Гачок', feeder: 'Годівниця', boxes: 'Ящик', camp: 'Намет',
  clothes: 'Одяг', other: 'Інше', fish: 'Риба', boat: 'Човен', bag: 'Сумка', light: 'Ліхтар', tool: 'Інструмент', star: 'Зірка',
  float: 'Поплавок', net: 'Підсак', knife: 'Ніж', fire: 'Вогнище', backpack: 'Рюкзак',
  pike: 'Щука', sinker: 'Грузило', makukha: 'Макуха', sonar: 'Ехолот', bucket: 'Відро', thermos: 'Термос', chair: 'Крісло',
  umbrella: 'Парасоля', firstaid: 'Аптечка', map: 'Карта', hat: 'Шапка', boots: 'Чоботи', glasses: 'Окуляри', car: 'Авто',
  anchor: 'Якір', battery: 'Акумулятор', worm: 'Черв’як', torch: 'Ліхтарик', pot: 'Казанок', coffee: 'Кава', axe: 'Сокира',
  compass: 'Компас', binoculars: 'Бінокль', camping: 'Кемпінг', sun: 'Сонце', snow: 'Зима', waves: 'Хвилі', thermo: 'Термометр',
  sailboat: 'Вітрильник', bike: 'Велосипед', caravan: 'Будинок на колесах', camera: 'Камера',
};

// Кольори розділів — веселкою, як у Хобі-плані; середні тони читаються і в темній, і в світлій темі
const SECTION_COLORS = [
  ['red', '#e5534b', 'Червоний'], ['orange', '#ef8a3c', 'Помаранчевий'], ['amber', '#d6a01a', 'Бурштиновий'],
  ['lime', '#86b42c', 'Салатовий'], ['green', '#3fa45b', 'Зелений'], ['teal', '#1aa39a', 'Бірюзовий'],
  ['sky', '#2b9fd8', 'Блакитний'], ['blue', '#4f7fe0', 'Синій'], ['purple', '#9a62d8', 'Фіолетовий'],
  ['pink', '#e05a9a', 'Рожевий'], ['brown', '#a0704f', 'Коричневий'], ['slate', '#7c8a96', 'Сірий'],
];
const sectionColor = (key) => SECTION_COLORS.find(([k]) => k === key)?.[1] ?? null;


function renderGear() {
  const all = state.gear.filter(active);
  $('subtitle').textContent = all.length ? t('позицій: {n} · місць: {m}', { n: all.length, m: state.places.length }) : '';
  if (!state.gear.length) {
    // Без місць спершу — місце: інакше речі заводяться «без місця», а відповідь на «де лежить» загублена
    return state.places.length
      ? empty(t('Ще немає снастей'), t('Додавайте речі кнопкою «+» або з картки місця — «+ Річ сюди».'), [btn(t('Додати річ'), () => gearForm(), 'primary add')])
      : empty(t('Ще немає снастей'), t('Спершу заведіть місце, де вони лежать: гараж, шафа, ящик. Або завантажте демодані в ⚙.'),
        [btn(t('+ Місце'), () => placeForm(null, { onSaved: () => goTab('#places') }), 'primary add'), btn(t('Додати річ без місця'), () => gearForm())]);
  }
  const search = h('input', {
    type: 'search', class: 'gear-search', placeholder: t('Пошук: назва, бренд, колір, місце…'), 'aria-label': t('Пошук'), enterkeyhint: 'search', autocomplete: 'off',
    oninput: (e) => { query = e.target.value; paintGear(); },
  });
  search.value = query;
  gearList = h('div');
  // Пошук і «Вибрати» — одним рядком угорі; нижче — що потребує уваги, далі розділи
  const top = h('div', { class: 'search-row' }, search,
    picking || !nfc.supported() ? null : toolBtn('nfc', t('Знайти річ за NFC-міткою'), () => nfcStart(true), nfc.active() ? 'nfc-btn on' : 'nfc-btn'),
    picking ? null : btn(t('Вибрати'), () => { picking = new Set(); render(); }, 'quiet mini'));
  // Хижак / мирна: універсальне видно в обох; вибір пам'ятається
  const DIR_ICON = { '': 'all', predator: 'predator', peaceful: 'peaceful', camp: 'camp' };
  const dirs = chips([['', 'Усі'], ...DIRS].map(([k, l]) => [k, [icon(DIR_ICON[k]), h('span', {}, t(l))]]), dirFilter, (v) => { dirFilter = v; remember('fishing-log:dir', v); paintGear(); });
  dirs.classList.add('segmented', 'dir-switch');
  const out = h('div', {}, top, dirs, gearList);
  queueMicrotask(paintGear);
  return out;
}

/** Напрямок кільком речам одразу: хижак, мирна чи універсальне. */
function dirSheet(list) {
  const close = sheet(t('Напрямок: {n}', { n: list.length }), h('div', { class: 'btn-col' },
    [...DIRS, ['', 'Універсальне']].map(([k, l]) => btn(t(l), async () => {
      close();
      picking = null;
      await save({ gear: { put: list.map((g) => ({ ...g, dir: k })) } }, list.map((g) => g.id));
      toast(t('{l}: {n}', { l: t(l), n: list.length }));
    }, k ? 'primary' : ''))));
}

/** Перенести речі в місце (null — без місця); змонтовані знімаються з вудилища чи котушки. */
async function moveGear(list, placeId) {
  const to = placeId ? pathOf(placeId) : t('без місця');
  const put = list.map((g) => logged({ ...g, placeId, onId: null }, t('Перенесено: {from} → {to}', { from: whereText(g), to })));
  picking = null;
  await save({ gear: { put } }, put.map((g) => g.id));
  toast(t('Перенесено: {n}', { n: put.length }));
}

/** Вибір місця зі списку шляхів. */
function placePicker(title, onPick) {
  const opts = placeOptions();
  const close = sheet(title, h('div', { class: 'rows' }, opts.map(([id, name]) =>
    row(name, null, id ? fmt.num(countIn(id)) : '', () => { close(); onPick(id || null); }))), {
    actions: [btn(t('+ Нове місце'), () => { close(); placeForm(null, { onSaved: (p) => onPick(p.id) }); })],
  });
}

function gearForm(g = null, { preset = null, file = null, onSaved = null, link = '', filled = null, autoFill = false } = {}) {
  const src = g ?? preset ?? {};
  const f = form([
    { name: 'name', label: t('Назва'), value: src.name, required: true, placeholder: t('напр. Воблер Jackall Squad Minnow 95') },
    { name: 'cat', label: t('Категорія'), type: 'select', options: catOptions(), value: src.cat ?? (g ? 'other' : recall('fishing-log:last-cat') || 'other'), half: true },
    { name: 'dir', label: t('Напрямок'), type: 'select', options: [['', t('Універсальне')], ...DIRS.map(([k, l]) => [k, t(l)])], value: src.dir ?? inferDir({ cat: src.cat ?? (g ? 'other' : recall('fishing-log:last-cat') || 'other'), rodType: src.rodType }), half: true },
    { name: 'qty', label: t('Кількість'), type: 'number', value: src.qty ?? 1, half: true },
    { name: 'unit', label: t('Одиниця'), type: 'select', options: UNITS.map(([k, l]) => [k, t(l)]), value: src.unit ?? 'pcs', half: true },
    { name: 'low', label: t('Поріг «мало»'), type: 'number', value: src.low ?? 0, half: true },
    { name: 'weight', label: t('Вага, г'), type: 'number', value: src.weight, half: true },
    { name: 'lureSize', label: t('Розмір'), type: 'number', value: src.lureSize, half: true, placeholder: '95' },
    { name: 'sizeUnit', label: t('Одиниця розміру'), type: 'select', options: SIZE_UNITS.map(([k, l]) => [k, t(l)]), value: src.sizeUnit ?? 'mm', half: true },
    { name: 'placeId', label: t('Де лежить'), type: 'select', options: placeOptions(), value: src.placeId ?? (g ? '' : recall('fishing-log:last-place') || ''), half: true },
    { name: 'brand', label: t('Бренд'), value: src.brand, half: true },
    { name: 'model', label: t('Модель'), value: src.model, half: true },
    { name: 'color', label: t('Колір'), value: src.color, half: true, list: 'color-list' },
    { name: 'buoy', label: t('Плавучість'), type: 'select', options: BUOYS, value: src.buoy ?? '', half: true },
    { name: 'depth', label: t('Заглиблення, м'), value: src.depth, half: true, placeholder: '0.5–1.2' },
    { name: 'length', label: t('Довжина, м'), type: 'number', value: src.length, half: true },
    { name: 'test', label: t('Тест, г'), value: src.test, half: true, placeholder: '5–25' },
    { name: 'action', label: t('Стрій'), type: 'select', options: ACTIONS.map(([k, l]) => [k, k ? t(l) : l]), value: src.action ?? '', half: true },
    { name: 'pieces', label: t('Колін'), type: 'number', value: src.pieces, half: true },
    { name: 'rodType', label: t('Тип'), type: 'select', options: ROD_TYPES.map(([k, l]) => [k, k ? t(l) : l]), value: src.rodType ?? '', half: true },
    { name: 'size', label: t('Розмір'), value: src.size, half: true, placeholder: '2500' },
    { name: 'ratio', label: t('Передавальне число'), value: src.ratio, half: true, placeholder: '6.2:1' },
    { name: 'spools', label: t('Запасних шпуль'), type: 'number', value: src.spools, half: true },
    { name: 'pe', label: t('PE'), value: src.pe, half: true, placeholder: '0.8' },
    { name: 'mm', label: t('Діаметр, мм'), type: 'number', value: src.mm, half: true },
    { name: 'price', label: t('Ціна, грн'), type: 'number', value: src.price, half: true },
    { name: 'buyDate', label: t('Куплено'), type: 'dmy', value: src.buyDate, half: true },
    { name: 'note', label: t('Нотатка'), type: 'textarea', rows: 2, value: src.note },
    { name: 'specs', label: t('Характеристики'), type: 'textarea', rows: 3, value: src.specs, placeholder: t('Скопіюйте з сайту виробника чи магазину') },
  ]);
  const field = (name) => f.inputs[name].closest('.field');
  // «Скільки» — окремим блоком; підказка про поріг — під ним на всю ширину, сусідні поля не зсуває
  const lowNote = h('p', { class: 'muted small form-note' }, t('Поріг «мало»: стільки й менше — у «Докупити»'));
  const qtyBox = box(t('Скільки'), h('div', {}, h('div', { class: 'form' }, field('qty'), field('unit'), field('low'), field('weight')), lowNote));
  // Розмір приманки, місце й колір — сіткою після блоку
  const rest = h('div', { class: 'form' }, field('lureSize'), field('sizeUnit'), field('placeId'), field('color'));
  // Поля, що стосуються категорії: кількість — для приманок, оснастки й фідерного, свої — для вудилищ, котушок, шнурів
  const fit = () => {
    const c = catOf(f.inputs.cat.value);
    const own = new Set([...(GROUP_FIELDS[c.group] ?? []), ...(CAT_FIELDS[c.id] ?? []), ...(qtyCat(c) ? ['qty', 'unit', 'low'] : []), ...(hasWeight(c) ? ['weight'] : [])]);
    for (const n of [...SPEC_FIELDS, 'qty', 'unit', 'low', 'weight']) f.inputs[n].closest('.field').hidden = !own.has(n);
    f.inputs.dir.closest('.field').hidden = c.group === 'camp';
    f.inputs.price.closest('.field').querySelector('.field-label').textContent = qtyCat(c) ? t('Ціна за одиницю, грн') : t('Ціна, грн');
    lowNote.hidden = field('low').hidden;
    qtyBox.hidden = ['qty', 'unit', 'low', 'weight'].every((n) => field(n).hidden);
  };
  f.inputs.cat.addEventListener('change', fit);
  // Напрямок іде за категорією й типом вудилища, доки людина не вибрала його сама
  let dirTouched = Boolean(src.dir !== undefined && g);
  f.inputs.dir.addEventListener('change', () => { dirTouched = true; });
  const followDir = () => { if (!dirTouched) f.inputs.dir.value = inferDir({ cat: f.inputs.cat.value, rodType: f.inputs.rodType.value }); };
  f.inputs.cat.addEventListener('change', followDir);
  f.inputs.rodType.addEventListener('change', followDir);
  fit();
  // Головне — назва, категорія, кількість, місце; решта згорнута (стан пам'ятається)
  const moreBody = h('div', { class: 'form' });
  // Заповнене ШІ — розгорнуто, щоб людина бачила й перевірила всі поля
  const more = h('details', { class: 'ex-more form-more form-fold', open: Boolean(filled) || recall('fishing-log:open:gear-form-more') === '1' },
    h('summary', {}, t('Бренд, розміри, ціна, нотатка…')), moreBody);
  more.addEventListener('toggle', () => { if (!filled) remember('fishing-log:open:gear-form-more', more.open ? '1' : ''); });
  // Колір і розмір приманки — на виду; решта характеристик — у згорнутому
  for (const n of ['brand', 'model', ...SPEC_FIELDS.filter((x) => !['lureSize', 'sizeUnit'].includes(x)), 'price', 'buyDate', 'note', 'specs']) moreBody.append(f.inputs[n].closest('.field'));
  f.el.append(h('datalist', { id: 'color-list' }, [...new Set(state.gear.map((x) => x.color).filter(Boolean))].sort(collate).map((c) => h('option', { value: c }))));
  const lookup = () => [f.inputs.brand.value, f.inputs.model.value, f.inputs.name.value, f.inputs.color.value].map((x) => x.trim()).filter(Boolean)
    .filter((x, i, a) => !a.slice(0, i).some((y) => y.toLowerCase().includes(x.toLowerCase()))).join(' ');
  const pick = photoPicker(findPhoto(g?.photoId), {
    file, query: lookup,
    onSearch: () => remember(PHOTO_FOR, JSON.stringify({ gearId: g?.id ?? null, draft: g ? null : f.values() })),
  });
  f.inputs.specs.closest('.field').after(h('div', { class: 'specs-find' }, btn([icon('search'), t('Характеристики')], () => {
    const q = lookup();
    if (!q) { toast(t('Спершу впишіть назву')); return; }
    window.open(`https://www.google.com/search?q=${encodeURIComponent(`${q} ${t('характеристики')}`)}`, '_blank', 'noopener');
  }, 'mini')));
  let busy = false; // фото обробляється, форма ще відкрита — другий тап по «Зберегти» не запише вдруге
  const store = async (again) => {
    // Помилка в згорнутому полі — розгорнути, інакше її не видно
    const bad = f.invalid();
    if (bad) f.inputs[bad.name].closest('details')?.setAttribute('open', '');
    if (invalidField(f)) return;
    const v = f.values();
    const c = catOf(v.cat);
    const keep = new Set([...(GROUP_FIELDS[c.group] ?? []), ...(CAT_FIELDS[c.id] ?? [])]);
    for (const n of SPEC_FIELDS) if (!keep.has(n)) delete v[n];
    if (!hasWeight(c)) delete v.weight;
    if (qtyCat(c)) { v.qty = Math.max(0, num(v.qty)); v.low = Math.max(0, num(v.low)); } else { v.qty = null; delete v.unit; delete v.low; }
    // Перша покупка — для експорту в Марнотрат; після «+ Купив» ціна в картці вже не перша, її не чіпаємо
    if (!g?.buys?.length) v.firstBuy = v.price ? { date: v.buyDate || today(), n: g?.firstBuy?.n ?? (qtyCat(c) ? Math.max(1, num(v.qty)) : 1), price: v.price } : null;
    v.placeId = v.placeId || null;
    const id = g?.id ?? db.uid();
    // Фото — до закриття: не вдалося обробити, то форма лишається з усім введеним
    if (busy) return;
    busy = true;
    let photo;
    try { photo = await photoChanges(g, pick.value(), id); } catch (err) { toast(err.message); return; } finally { busy = false; }
    const { changes, photoId } = photo;
    close();
    let rec = g ? { ...g, ...v, photoId } : { id, created: Date.now(), status: 'have', history: [{ date: today(), text: t('Додано') }], ...v, photoId };
    // Змонтоване не має свого місця, доки стоїть; явно вибране інше місце знімає
    if (g && v.placeId !== (g.placeId ?? null)) rec = logged({ ...rec, onId: v.placeId ? null : rec.onId }, t('Перенесено: {from} → {to}', { from: whereText(g), to: v.placeId ? pathOf(v.placeId) : t('без місця') }));
    await save(joinChanges(changes, { gear: { put: [rec] } }), [rec.id]);
    if (!g) { remember('fishing-log:last-cat', rec.cat); remember('fishing-log:last-place', rec.placeId ?? ''); }
    onSaved?.(rec);
    if (again) gearForm(null, { preset: { cat: rec.cat, placeId: rec.placeId, brand: rec.brand } });
  };
  // Нова річ — з посилання на магазин: форма відкривається заново вже заповнена; місце, кількість і поріг лишаються вибрані
  const linkEl = g ? null : linkFill({
    link, autoFill,
    reopen: (item, shopFile, info) => {
      const cur = f.values();
      const keep = Object.fromEntries(['placeId', 'qty', 'unit', 'low', 'buyDate', 'note'].filter((k) => cur[k] !== '' && cur[k] != null).map((k) => [k, cur[k]]));
      close();
      gearForm(null, { preset: { ...keep, ...item }, file: shopFile ?? pick.value().file ?? null, onSaved, link: info.link, filled: info });
    },
  });
  const filledNote = filled ? h('p', { class: 'filled-note' }, icon('spark'),
    h('span', {}, t('Заповнено зі сторінки магазину — перевірте поля перед збереженням.'), filled.note ? ` ${filled.note}` : '')) : null;
  // Посилання — не перше поле: зазвичай починають з назви; прийшли з «Поділитися» — блок одразу розгорнутий
  const linkFold = linkEl ? formFold(t('Заповнити за посиланням'), linkEl) : null;
  if (linkFold && (link || autoFill)) linkFold.open = true;
  const close = sheet(g ? t('Змінити річ') : t('Нова річ'), h('div', { class: 'blocks-form' },
    filledNote, f.el, qtyBox, rest, box(t('Фото'), pick.el), linkFold, more), {
    // Нова річ — дві кнопки, а не три в стовпчик: «Скасувати» дублювала ✕ у шапці
    actions: g ? [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), () => store(false), 'primary')]
      : [btn(t('Зберегти й ще'), () => store(true)), btn(t('Зберегти'), () => store(false), 'primary')],
  });
}

// ---------- ШІ-помічник: річ з посилання на магазин ----------

/** Перше посилання з тексту («Поділитися» дає назву й адресу разом); без схеми — https. */
function linkIn(s) {
  const text = String(s ?? '').trim();
  const m = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (m) return m[0];
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text) ? `https://${text}` : '';
}

const BOT_ERRORS = {
  offline: 'Немає зв’язку — спробуйте, коли з’явиться інтернет',
  network: 'Бот не відповідає — перевірте інтернет і спробуйте ще раз',
  unauthorized: 'Бот не прийняв ключ — візьміть новий командою /key у боті',
  'old-bot': 'Бот ще не вміє читати сторінки — його треба оновити',
  limit: 'На сьогодні ліміт ШІ вичерпано — завтра знову',
};

/**
 * Посилання на товар + «Заповнити»: бот бере сторінку, ШІ розкладає характеристики по полях, reopen(item, file, info)
 * відкриває форму заново вже заповнену. Магазин не віддав сторінку боту — просимо вставити її текст.
 */
function linkFill({ link = '', autoFill = false, reopen }) {
  const input = h('input', { type: 'url', inputmode: 'url', placeholder: t('Посилання на товар у магазині'), autocomplete: 'off', enterkeyhint: 'go', 'aria-label': t('Посилання на товар') });
  input.value = link;
  const paste = h('textarea', { rows: 5, hidden: true, placeholder: t('Назва, опис і характеристики зі сторінки'), 'aria-label': t('Текст сторінки') });
  const status = h('p', { class: 'muted small link-status', 'aria-live': 'polite' });
  let busy = false;
  const run = async () => {
    if (busy) return;
    const url = linkIn(input.value);
    const text = paste.hidden ? '' : paste.value.trim();
    if (!url && !text) { toast(t('Вставте посилання на товар')); input.focus(); return; }
    if (!bot.botConfig()) { botSheet(run); return; }
    busy = true;
    go.disabled = true;
    status.textContent = text ? t('ШІ читає текст…') : t('Бот читає сторінку…');
    try {
      const res = await bot.gearFromPage({ ...(url ? { url } : {}), ...(text ? { text } : {}), cats: allCats().map(({ id, name, group }) => ({ id, name, group })) });
      if (!res.item?.name && !res.item?.brand) { status.textContent = res.note || t('На сторінці не знайшлося товару'); return; }
      status.textContent = res.image ? t('Беру фото…') : '';
      const shopFile = res.image ? await bot.gearImage(res.image) : null;
      const specs = [res.item.specs, url ? `${t('Джерело')}: ${url}` : ''].filter(Boolean).join('\n');
      reopen({ ...res.item, ...(specs ? { specs } : {}) }, shopFile, { link: url, note: res.note, source: res.source });
    } catch (err) {
      const code = err.message;
      if (code === 'fetch' || code === 'empty') {
        paste.hidden = false;
        status.textContent = code === 'fetch'
          ? t('Магазин не віддав сторінку боту. Відкрийте її, скопіюйте назву й характеристики і вставте сюди.')
          : t('Ця сторінка збирається в браузері — боту нічого не видно. Скопіюйте з неї назву й характеристики і вставте сюди.');
        paste.focus();
      } else {
        status.textContent = t(BOT_ERRORS[code] ?? 'ШІ не впорався — спробуйте ще раз');
        if (code === 'unauthorized') botSheet(run);
      }
    } finally {
      busy = false;
      go.disabled = false;
    }
  };
  const go = btn([icon('spark'), t('Заповнити')], run, 'mini primary');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  if (autoFill && link) queueMicrotask(run);
  return h('div', { class: 'link-fill' },
    h('div', { class: 'link-row' }, icon('link'), input, go),
    paste, status);
}

/** Адреса й ключ бота: ті самі, що в Хобі-плані, «Вазі» чи Марнотраті (на цьому пристрої підхоплюються самі). */
function botSheet(onDone = null) {
  const cur = bot.botConfig();
  const f = form([
    { name: 'url', label: t('Адреса бота'), value: cur?.url ?? '', required: true, placeholder: 'https://….workers.dev' },
    { name: 'key', label: t('Ключ'), value: cur?.key ?? '', required: true, placeholder: t('з команди /key у боті') },
  ]);
  const close = sheet(t('ШІ-помічник'), h('div', {},
    h('p', { class: 'muted small' }, t('Сторінки магазинів читає ваш Telegram-бот Хобі-плану, а заповнює поля ШІ. Адреса й ключ — ті самі, що в Хобі-плані, «Вазі» чи Марнотраті; ключ дає команда /key у боті.')),
    f.el), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), () => {
      if (invalidField(f)) return;
      const v = f.values();
      if (!/^https:\/\/\S+$/.test(v.url.trim())) { fieldError(f.inputs.url, t('Адреса починається з https://')); return; }
      bot.setBot(v.url, v.key);
      close();
      toast(t('Бота підключено'));
      render();
      onDone?.();
    }, 'primary')],
  });
}

function aiRow() {
  const on = Boolean(bot.botConfig());
  const value = on ? t('Підключено') : bot.keyProblem() ? t('Ключ не прийнято') : t('Не підключено');
  return setRow('ai', 'spark', t('ШІ-помічник'), value, [
    h('p', { class: 'muted small' }, t('У новій речі вставте посилання на товар у магазині й натисніть «Заповнити»: бот прочитає сторінку, ШІ заповнить назву, категорію, характеристики, ціну й фото. Перевірте й збережіть. Посиланням можна й поділитися в Fishing Log з браузера.')),
    h('div', { class: 'btn-row' }, btn(on ? t('Змінити адресу чи ключ') : t('Підключити бота'), () => botSheet(), on ? '' : 'primary'))]);
}

function gearDetail(id) {
  const build = () => { const g = findGear(id); return g ? gearBody(g) : null; };
  sheet(() => gearTitle(findGear(id)), build(), {
    live: build,
    full: true,
    tools: [nfc.supported() ? toolBtn('nfc', t('NFC-мітка'), () => nfcWriteSheet(itemUrl(findGear(id)), gearTitle(findGear(id)))) : null,
      toolBtn('copy', t('Копіювати'), () => copyGear(findGear(id))), toolBtn('edit', t('Змінити'), () => gearForm(findGear(id))),
      toolBtn('delete', t('Видалити'), () => removeGear(findGear(id)), 'danger')],
  });
}

const mountedOn = (g) => state.gear.filter((x) => x.onId === g.id);

/** Довжина вудилища у футах, як у назвах моделей: 1,73 м → 5'8". */
function feetText(m) {
  const inches = Math.round(num(m) / 0.0254);
  return inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : null;
}

/** Головні характеристики вудилища, котушки й шнура — плитками одразу під фото, а не в згорнутих «Деталях». */
function specTiles(g) {
  const tile = (name, value, sub = null) => (value ? h('div', { class: 'spec-tile' }, h('small', {}, name), h('b', {}, value), sub ? h('span', {}, sub) : null) : null);
  const group = groupOf(g);
  const tiles = group === 'rods' ? [
    tile(t('Довжина'), num(g.length) ? `${fmt.num(g.length)} ${t('м')}` : null, feetText(g.length)),
    tile(t('Тест'), g.test ? `${g.test} ${t('г')}` : null),
    tile(t('Стрій'), label(ACTIONS, g.action)),
    tile(t('Тип'), label(ROD_TYPES, g.rodType)),
    tile(t('Колін'), num(g.pieces) ? fmt.num(g.pieces) : null),
  ] : group === 'reels' ? [
    tile(t('Розмір'), g.size),
    tile(t('Передавальне'), g.ratio),
    tile(t('Запасних шпуль'), num(g.spools) ? fmt.num(g.spools) : null),
  ] : group === 'lines' ? [
    tile(t('PE'), g.pe),
    tile(t('Діаметр'), num(g.mm) ? `${fmt.num(g.mm)} ${t('мм')}` : null),
    tile(t('Довжина'), num(g.length) ? `${fmt.num(g.length)} ${t('м')}` : null),
  ] : [
    // Приманки, оснастка, фідерне: розмір, вага, у воблера — плавучість кодом (F, SP…) і словами
    tile(t('Розмір'), sizeText(g)),
    tile(t('Вага'), weightText(g)),
    tile(t('Плавучість'), g.buoy || null, g.buoy ? label(BUOYS, g.buoy).split('—')[1]?.trim() : null),
    tile(t('Заглиблення'), num(g.depth) ? `${fmt.num(g.depth)} ${t('м')}` : null),
  ];
  const list = tiles.filter(Boolean);
  return list.length ? h('div', { class: 'spec-tiles' }, list) : null;
}

/** Залишок приманки чи оснастки: велика цифра, «мало», втрати — і дії з кількістю тут же. */
function stockBox(g) {
  const low = isLow(g);
  const lost = lostCount(g);
  return h('div', { class: `stock${low ? ' low' : ''}` },
    h('div', { class: 'stock-head' },
      h('span', { class: 'stock-num' }, fmt.num(g.qty), h('small', {}, unitLabel(g))),
      h('span', { class: 'stock-meta' },
        low ? h('b', { class: 'warn-text' }, t('мало — докупити')) : h('b', {}, t('у наявності')),
        num(g.low) ? h('span', {}, t('поріг «мало» — {n}', { n: fmt.num(g.low) })) : null,
        lost ? h('span', {}, t('втрачено {n} {u}', { n: fmt.num(lost), u: unitLabel(g) })) : null)),
    h('div', { class: 'btn-row' },
      pieces(g) ? btn(t('−1 Втратив'), () => lostOne(g), 'primary') : btn(t('Витратив'), () => spendSheet(g), 'primary'),
      btn(t('+ Купив'), () => buySheet(g)),
      btn(t('Кількість'), () => qtySheet(g))));
}

/** Головні цифри котушки чи шнура одним рядком для «Стоїть»: «1000S · 5.2:1», «PE 0.1 · 0,05 мм · 150 м». */
function mountSpecs(x) {
  const group = groupOf(x);
  if (group === 'reels') return [x.size, x.ratio].filter(Boolean).join(' · ');
  if (group === 'lines') return [x.pe ? `PE ${x.pe}` : null, num(x.mm) ? `${fmt.num(x.mm)} ${t('мм')}` : null, num(x.length) ? `${fmt.num(x.length)} ${t('м')}` : null].filter(Boolean).join(' · ');
  return '';
}

function gearBody(g) {
  const photo = findPhoto(g.photoId);
  const specs = specTiles(g);
  const host = findGear(g.onId);
  const group = groupOf(g);
  const qty = isQty(g);
  // Що стоїть на вудилищі чи котушці: котушка й шнур на ній
  const chain = mountedOn(g).flatMap((x) => [x, ...mountedOn(x)]);
  // Дії з кількістю — у блоці залишку; тут — решта, «Списати» тихою кнопкою наприкінці (рідкісна дія)
  const actions = [
    btn(t('Перенести'), () => placePicker(t('Куди перенести'), (placeId) => moveGear([g], placeId))),
    group === 'reels' ? (host ? btn(t('Зняти з вудилища'), () => unmount(g)) : btn(t('На вудилище'), () => mountSheet(g, 'rods'))) : null,
    ['reels', 'rods'].includes(group) && active(g) ? btn(t('Обслужив'), () => serviceSheet(g)) : null,
    group === 'lines' && host ? btn(t('Перемотав'), () => rewound(g)) : null,
    group === 'lines' ? (host ? btn(t('Змотати з котушки'), () => unmount(g)) : btn(t('Намотати на котушку'), () => mountSheet(g, 'reels'))) : null,
    active(g) ? btn(t('Списати'), () => statusSheet(g)) : btn(t('Повернути в наявні'), () => setStatus(g, 'have', t('Повернуто в наявні')), 'primary'),
  ];
  const where = !active(g) ? null
    : host ? [t('Де лежить'), t('на «{name}»', { name: gearTitle(host) }), () => gearDetail(host.id)]
      : g.placeId ? [t('Де лежить'), pathOf(g.placeId), () => placeDetail(g.placeId)] : [t('Де лежить'), t('без місця')];
  // Бренд і модель, що вже стоять у назві картки, — не повторювати
  const inTitle = (x) => x && norm(gearTitle(g)).includes(norm(x));
  return h('div', { class: 'gear-sheet' },
    // Фото й характеристики поруч на широкому екрані, одне під одним — на телефоні
    photo || specs ? h('div', { class: `gear-hero${photo && specs ? ' two' : ''}` },
      photo ? h('button', { type: 'button', class: 'photo-btn', 'aria-label': t('Фото на весь екран'), onclick: () => showPhoto(photo.id) }, h('img', { class: 'item-photo', src: photo.thumb, alt: '' })) : null,
      specs) : null,
    qty ? stockBox(g) : null,
    // Головне — одразу видно списком; місце й колір — рядки на всю ширину зі «›»
    facts([
      where,
      [t('Що це'), [catOf(g.cat).name, label(DIRS, dirOf(g)) || t('Універсальне')].join(' · ')],
      g.color ? [t('Колір'), g.color, () => searchFor(g.color)] : null,
      [t('Бренд'), inTitle(g.brand) ? null : g.brand], [t('Модель'), inTitle(g.model) ? null : g.model],
      // Характеристики вудилища, котушки й шнура — у плитках угорі; тут лише те, чого плитки не показали
      ...(specs ? [] : [[t('Тип'), label(ROD_TYPES, g.rodType)], [t('Довжина'), g.length ? `${fmt.num(g.length)} ${t('м')}` : null], [t('Тест'), g.test ? `${g.test} ${t('г')}` : null],
        [t('Стрій'), label(ACTIONS, g.action)], [t('Колін'), g.pieces], [t('Розмір'), g.size], [t('Передавальне число'), g.ratio], [t('Запасних шпуль'), g.spools],
        [t('PE'), g.pe], [t('Діаметр'), g.mm ? `${fmt.num(g.mm)} ${t('мм')}` : null]]),
      [t('Ціна'), g.price ? fmt.money(g.price) : null], [t('Куплено'), g.buyDate ? fmt.date(g.buyDate) : null],
      active(g) ? null : [t('Стан'), `${t(STATUS[g.status])}${g.statusDate ? ` · ${fmt.date(g.statusDate)}` : ''}`],
      host && group === 'lines' && g.onDate ? [t('Намотано'), `${fmt.date(g.onDate)} · ${t('{n} міс. тому', { n: Math.floor(monthsSince(g.onDate)) })}`] : null,
      group === 'reels' ? [t('Обслуговано'), (g.service ?? []).length ? fmt.date(serviceSince(g)) : t('ще ні')] : null,
      serviceDue(g) ? [t('Увага'), h('span', { class: 'warn-text' }, serviceDue(g))] : null,
    ]),
    h('div', { class: 'btn-row' }, actions.filter(Boolean)),
    catchBox(g),
    chain.length ? box(t('Стоїть'), h('div', { class: 'rows' }, chain.map((x) =>
      row(gearTitle(x), [mountSpecs(x) || catOf(x.cat).name, groupOf(x) === 'lines' && x.onDate ? t('намотано {date}', { date: fmt.date(x.onDate) }) : null].filter(Boolean).join(' · '), '', () => gearDetail(x.id), { thumb: gearThumb(x) })))) : null,
    // Довгий текст — згорнуто, і лише коли він є
    g.note || g.specs ? fold('gear-details', g.specs ? t('Нотатка й характеристики') : t('Нотатка'), kv([
      [t('Нотатка'), g.note ? h('span', { class: 'pre' }, g.note) : null],
      [t('Характеристики'), g.specs ? h('span', { class: 'pre' }, g.specs) : null],
    ])) : null,
    g.history?.length ? fold('gear-history', t('Історія'), historyList(g.history)) : null);
}

function historyList(list) {
  return h('ul', { class: 'changes' }, [...list].reverse().map((x) => h('li', {}, `${fmt.date(x.date)} — ${x.text}`)));
}

/** Та сама річ іншого кольору: копія без фото, історії й кольору. */
async function copyGear(g) {
  const { id, photoId, history, created, updated, status, statusDate, onId, onDate, color, losses, buys, spends, firstBuy, ...rest } = g;
  gearForm(null, { preset: rest, file: await photoCopy(photoId) });
}

/** Фото для копії речі: повний файл, а якщо його на пристрої немає — мініатюра. Збережеться окремим фото. */
async function photoCopy(photoId) {
  const p = findPhoto(photoId);
  if (!p) return null;
  try {
    const blob = (await db.getBlob(p.id)) ?? dataUrlBlob(p.thumb);
    return blob ? new File([blob], 'copy', { type: blob.type || 'image/jpeg' }) : null;
  } catch {
    return null;
  }
}

/** data:image/jpeg;base64,… → Blob без fetch: CSP (connect-src) data: не пускає. */
function dataUrlBlob(url) {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(url ?? '');
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

/** Котушку — на вудилище, шнур — на котушку (з датою намотки). */
function mountSheet(g, hostGroup) {
  const hosts = state.gear.filter((x) => active(x) && groupOf(x) === hostGroup && x.id !== g.id).sort(byGroup);
  if (!hosts.length) { toast(hostGroup === 'rods' ? t('Спершу додайте вудилище') : t('Спершу додайте котушку')); return; }
  const f = form([
    { name: 'hostId', label: hostGroup === 'rods' ? t('Вудилище') : t('Котушка'), type: 'select', options: dirOptions(hosts, (x) => [x.id, `${gearTitle(x)} · ${whereText(x)}`], dirOf(g)) },
    ...(hostGroup === 'reels' ? [{ name: 'date', label: t('Намотано'), type: 'dmy', value: today() }] : []),
  ]);
  const close = sheet(hostGroup === 'rods' ? t('На вудилище') : t('Намотати на котушку'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      const host = findGear(v.hostId);
      // Те, що вже стояло на цьому місці, знімається туди, де лежить господар
      const prev = state.gear.filter((x) => x.onId === host.id && groupOf(x) === groupOf(g) && x.id !== g.id)
        .map((x) => logged({ ...x, onId: null, placeId: placeOf(host) }, t('Знято з «{name}»', { name: gearTitle(host) })));
      const rec = logged({ ...g, onId: host.id, onDate: v.date || null }, t('Поставлено на «{name}»', { name: gearTitle(host) }), v.date || today());
      close();
      await save({ gear: { put: [rec, ...prev] } }, [g.id]);
    }, 'primary')],
  });
}

async function unmount(g) {
  const host = findGear(g.onId);
  await save({ gear: { put: [logged({ ...g, onId: null, onDate: null, placeId: host ? placeOf(host) : g.placeId }, t('Знято з «{name}»', { name: gearTitle(host) }))] } }, [g.id]);
}

async function setStatus(g, status, text, date = today()) {
  await save({ gear: { put: [logged({ ...g, status, statusDate: status === 'have' ? null : date }, text, date)] } }, [g.id]);
}

function statusSheet(g) {
  let status = 'lost';
  const c = chips(Object.entries(STATUS).filter(([k]) => k !== 'have').map(([k, l]) => [k, t(l)]), status, (v) => { status = v; });
  // Чотири довгі слова («Подаровано») сегментом на 360 px не влазять — звичайні чипи з переносом
  const f = form([{ name: 'date', label: t('Дата'), type: 'dmy', value: today(), required: true }, { name: 'note', label: t('Примітка') }]);
  const close = sheet(t('Списати'), h('div', {}, c, f.el), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), () => {
      if (invalidField(f)) return;
      const v = f.values();
      close();
      setStatus(g, status, [t(STATUS[status]), v.note].filter(Boolean).join(': '), v.date);
    }, 'primary')],
  });
}

const REASONS = [['break', 'Обрив'], ['snag', 'Зачеп'], ['gave', 'Віддав'], ['broke', 'Зламав']];
/** Скільки втрачено: «−1 Втратив» + списане цілим як «Втрачено». */
const lostCount = (g) => (g.losses ?? []).reduce((n, x) => n + (num(x.n) || 1), 0);

/** «−1 Втратив»: одразу, без питань; причину можна дописати з тосту. tripId — втрата на виїзді. */
async function lostOne(g, tripId = null) {
  if (!(num(g.qty) > 0)) { toast(t('Уже 0 — нічого втрачати')); return; }
  const entry = { id: db.uid(), date: findTrip(tripId)?.date ?? today(), n: 1, ...(tripId ? { tripId } : {}) };
  await save({ gear: { put: [logged({ ...g, qty: num(g.qty) - 1, losses: [...(g.losses ?? []), entry] }, t('Втрачено 1 шт'))] } }, [g.id]);
  setUndo(t('Втрачено 1 шт'), () => save({ gear: { put: [{ ...findGear(g.id), qty: num(g.qty), losses: g.losses ?? [], history: g.history }] } }, [g.id]));
  const now = findGear(g.id);
  toast(t('Втрачено 1 · лишилось {n}', { n: qtyText(now) }), { action: t('Причина'), onAction: () => reasonSheet(g.id, entry.id) });
}

function reasonSheet(gearId, entryId) {
  const close = sheet(t('Причина'), chips(REASONS.map(([k, l]) => [k, t(l)]), '', async (reason) => {
    close();
    const g = findGear(gearId);
    if (!g) return;
    await save({ gear: { put: [{ ...g, losses: (g.losses ?? []).map((x) => (x.id === entryId ? { ...x, reason } : x)) }] } }, [g.id]);
  }));
}

/** Прикормка, насадка в кг, уп, л: витрачене — не втрата, просто менше лишилось. */
function spendSheet(g, tripId = null) {
  const f = form([{ name: 'n', label: t('Скільки, {unit}', { unit: unitLabel(g) }), type: 'number', required: true }]);
  const close = sheet(t('Витратив'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const { n } = f.values();
      if (!(n > 0)) { fieldError(f.inputs.n, t('Більше нуля')); return; }
      close();
      const spend = { id: db.uid(), date: findTrip(tripId)?.date ?? today(), n, ...(tripId ? { tripId } : {}) };
      await save({ gear: { put: [logged({ ...g, qty: Math.max(0, Math.round((num(g.qty) - n) * 1000) / 1000), spends: [...(g.spends ?? []), spend] }, t('Витрачено {n} {unit}', { n: fmt.num(n), unit: unitLabel(g) }))] } }, [g.id]);
    }, 'primary')],
  });
}

/** «+ Купив» ще таких самих: кількість росте, ціна й дата — останньої покупки, усе — в історію. */
function buySheet(g, { onSaved = null } = {}) {
  const f = form([
    { name: 'n', label: t('Скільки, {unit}', { unit: unitLabel(g) }), type: 'number', value: 1, required: true, half: true },
    { name: 'price', label: t('Ціна за одиницю, грн'), type: 'number', value: g.price, half: true },
    { name: 'date', label: t('Дата'), type: 'dmy', value: today(), required: true },
  ]);
  const close = sheet(t('+ Купив'), h('div', {}, h('p', { class: 'muted small' }, gearTitle(g)), f.el), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      if (!(v.n > 0)) { fieldError(f.inputs.n, t('Більше нуля')); return; }
      close();
      const price = v.price ?? g.price ?? null;
      const rec = logged({
        ...g, status: 'have', statusDate: null, qty: num(g.qty) + v.n, price, buyDate: v.date,
        buys: [...(g.buys ?? []), { date: v.date, n: v.n, price }],
      }, t('Куплено {n} {unit}', { n: fmt.num(v.n), unit: unitLabel(g) }) + (price ? ` · ${fmt.money(price)}` : ''), v.date);
      await save({ gear: { put: [rec] } }, [g.id]);
      onSaved?.();
    }, 'primary')],
  });
}

function qtySheet(g) {
  const f = form([{ name: 'qty', label: t('Скільки зараз'), type: 'number', value: g.qty, required: true }, { name: 'note', label: t('Примітка') }]);
  const close = sheet(t('Кількість'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      if (v.qty < 0) { fieldError(f.inputs.qty, t('Не менше нуля')); return; }
      close();
      await save({ gear: { put: [logged({ ...g, qty: v.qty }, `${fmt.num(g.qty)} → ${fmt.num(v.qty)} ${t('шт')}${v.note ? ` · ${v.note}` : ''}`)] } }, [g.id]);
    }, 'primary')],
  });
}

function removeGear(g) {
  confirmSheet(t('Видалити «{name}»?', { name: gearTitle(g) }), t('Якщо річ втрачено чи продано — краще «Списати»: вона залишиться в історії. Видалення скасувати не можна.'), t('Видалити'), async () => {
    const freed = mountedOn(g).map((x) => ({ ...x, onId: null, placeId: placeOf(g) }));
    await save(joinChanges(g.photoId ? dropPhotos([g.photoId]) : {}, { gear: { del: [g.id], put: freed } }));
    toast(t('Видалено'));
  });
}

// ---------- місця ----------

// Розгорнуті місця — на пристрої, як розділи «Снастей»; за замовчуванням усе згорнуте
const placeOpenKey = (id) => `fishing-log:open:place-${id}`;
const placeIsOpen = (id) => recall(placeOpenKey(id)) === '1';
const hasKids = (id) => state.places.some((x) => x.parentId === id);
const kidsOf = (id) => state.places.filter((p) => (p.parentId ?? null) === id).sort((a, b) => collate(a.name, b.name));
const itemsAt = (id) => state.gear.filter((g) => active(g) && placeOf(g) === id).sort(byGroup);

/** Заголовок місця: значок, назва, скільки речей усередині (з вкладеними) і кнопка картки — наклейка, NFC, змінити. */
function placeHead(p) {
  const head = sectionHead(p.icon || 'boxes', p.name, countIn(p.id), 0, null, sectionColor(p.color));
  head.append(Object.assign(h('button', {
    type: 'button', class: 'icon-btn sec-edit place-head-card', 'aria-label': t('Картка місця «{name}»', { name: p.name }),
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); placeDetail(p.id); },
  }), { innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>' }));
  return head;
}

/** Місце групою: розгорнули — вкладені місця (так само групами) і речі, що лежать саме тут. */
function placeFold(p, depth = 0) {
  const ids = subtree(p.id);
  const has = state.gear.filter((g) => active(g) && ids.has(placeOf(g))).map((g) => g.id);
  return fold(`place-${p.id}`, placeHead(p), () => {
    const kids = depth < 20 ? kidsOf(p.id) : [];
    const items = itemsAt(p.id);
    return h('div', { class: 'place-inner' },
      p.note ? h('p', { class: 'muted small place-note' }, p.note) : null,
      kids.length ? h('div', { class: 'gear-groups sub-groups' }, kids.map((k) => placeFold(k, depth + 1))) : null,
      items.length ? h('div', { class: 'rows' }, items.map((g) => gearRow(g, { here: true }))) : null,
      kids.length || items.length ? null : h('div', { class: 'place-empty' }, h('span', { class: 'muted small' }, t('Порожньо')),
        btn(t('+ Річ сюди'), () => gearForm(null, { preset: { placeId: p.id } }), 'quiet mini')));
  }, '', has);
}

/** Розгорнути чи згорнути всі місця, де щось є. */
function setPlacesOpen(ids, open) {
  ids.forEach((id) => remember(placeOpenKey(id), open ? '1' : ''));
  render();
}

/** Перемикач угорі вкладки: місця зберігання чи покупки; «+» додає те, що вибрано, вкладка пам'ятає вибір. */
const SHOP_SEG = 'fishing-log:shop-seg';
function shopSwitch() {
  const sw = chips([['places', t('Місця зберігання')], ['shop', t('Покупки')]], tab, (v) => goTab(`#${v}`));
  sw.classList.add('segmented');
  return sw;
}

function renderPlaces() {
  const loose = state.gear.filter((g) => active(g) && !placeOf(g));
  if (!state.places.length) {
    return h('div', {}, shopSwitch(),
      empty(t('Ще немає місць'), t('Місця — це де лежать снасті: «Гараж → Шафа → Ящик Plano №2». Вкладайте одне в одне скільки завгодно.'),
        [btn(t('Додати'), () => placeForm(), 'primary add'), importBtn()]));
  }
  const full = state.places.filter((p) => hasKids(p.id) || countIn(p.id)).map((p) => p.id);
  const allOpen = full.length > 0 && full.every(placeIsOpen);
  return h('div', {}, shopSwitch(),
    full.length > 1 ? h('div', { class: 'btn-row tree-tools' }, btn(allOpen ? t('Згорнути все') : t('Розгорнути все'), () => setPlacesOpen(full, !allOpen), 'quiet')) : null,
    h('div', { class: 'gear-groups' }, kidsOf(null).map((p) => placeFold(p)),
      loose.length ? fold('place-none', sectionHead('other', t('Без місця'), loose.length), () => h('div', { class: 'rows' }, loose.sort(byGroup).map((g) => gearRow(g, { here: true }))), '', loose.map((g) => g.id)) : null),
    h('div', { class: 'btn-row' }, btn(t('Друк наклейок'), () => labelsSheet(state.places))));
}

function placeForm(p = null, { parentId = null, onSaved = null } = {}) {
  const f = form([
    { name: 'name', label: t('Назва'), value: p?.name, required: true, placeholder: t('напр. Ящик Plano №2') },
    { name: 'parentId', label: t('Усередині'), type: 'select', options: placeOptions(p ? subtree(p.id) : new Set()).map(([id, n]) => [id, id ? n : t('— верхній рівень —')]), value: p?.parentId ?? parentId ?? '' },
    { name: 'note', label: t('Нотатка'), type: 'textarea', rows: 2, value: p?.note },
  ]);
  // Значок і колір — як у розділів снастей; без вибору — ящик
  const d = { icon: p?.icon ?? 'boxes', color: p?.color ?? null };
  const noteField = f.inputs.note.closest('.field');
  const close = sheet(p ? t('Змінити місце') : t('Нове місце'), h('div', {}, f.el, sectionLook(d), h('div', { class: 'form' }, noteField)), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      const rec = { ...(p ?? { id: db.uid(), created: Date.now() }), ...v, parentId: v.parentId || null, icon: d.icon, color: d.color || null };
      close();
      // Нове вкладене місце має бути видно одразу — розгортаємо гілку з ним
      for (let x = findPlace(rec.parentId), i = 0; x && i < 20; x = findPlace(x.parentId), i += 1) remember(placeOpenKey(x.id), '1');
      await save({ places: { put: [rec] } }, [rec.id]);
      onSaved?.(rec);
    }, 'primary')],
  });
}

function placeDetail(id) {
  const build = () => { const p = findPlace(id); return p ? placeBody(p) : null; };
  sheet(() => findPlace(id)?.name, build(), {
    live: build,
    full: true,
    tools: [toolBtn('qr', t('Наклейка'), () => printLabels([findPlace(id)])),
      nfc.supported() ? toolBtn('nfc', t('NFC-мітка'), () => nfcWriteSheet(placeUrl(findPlace(id)), findPlace(id).name)) : null,
      toolBtn('edit', t('Змінити'), () => placeForm(findPlace(id))),
      toolBtn('delete', t('Видалити'), () => removePlace(findPlace(id)), 'danger')],
  });
}

function placeBody(p) {
  const kids = state.places.filter((x) => x.parentId === p.id).sort((a, b) => collate(a.name, b.name));
  const items = state.gear.filter((g) => active(g) && placeOf(g) === p.id).sort(byGroup);
  return h('div', {},
    facts([p.parentId ? [t('Усередині'), pathOf(p.parentId), () => placeDetail(p.parentId)] : null, [t('Нотатка'), p.note ? h('span', { class: 'pre' }, p.note) : null]]),
    h('div', { class: 'btn-row' },
      btn(t('+ Річ сюди'), () => gearForm(null, { preset: { placeId: p.id } }), 'primary'),
      btn(t('+ Вкладене місце'), () => placeForm(null, { parentId: p.id }))),
    kids.length ? box(t('Усередині'), h('div', { class: 'rows' }, kids.map((k) => row(k.name, k.note || null, fmt.num(countIn(k.id)), () => placeDetail(k.id))))) : null,
    items.length ? box(`${t('Речі')} · ${items.length}`, h('div', { class: 'rows' }, items.map((g) => gearRow(g, { here: true }))))
      : kids.length ? null : h('p', { class: 'muted' }, t('Тут поки порожньо. «+ Річ сюди» — додавати одну за одною, місце підставиться саме.')));
}

/** Видалити місце: вкладені місця й речі переїжджають на рівень вище. */
function removePlace(p) {
  const kids = state.places.filter((x) => x.parentId === p.id);
  const items = state.gear.filter((g) => g.placeId === p.id);
  const up = p.parentId ? pathOf(p.parentId) : t('верхній рівень');
  confirmSheet(t('Видалити «{name}»?', { name: p.name }),
    kids.length || items.length ? t('Усе, що всередині (місць: {k}, речей: {n}), переїде в «{up}».', { k: kids.length, n: items.length, up }) : t('Місце порожнє.'),
    t('Видалити'), async () => {
      await save({
        places: { del: [p.id], put: kids.map((x) => ({ ...x, parentId: p.parentId ?? null })) },
        gear: { put: items.map((g) => logged({ ...g, placeId: p.parentId ?? null }, t('Місце «{name}» видалено', { name: p.name }))) },
      });
      toast(t('Видалено'));
    });
}

// ---------- водойми ----------

const findSpot = (id) => (id ? byId(state.spots).get(id) : null);
const findTrip = (id) => (id ? byId(state.trips).get(id) : null);
const hasCoords = (s) => Number.isFinite(Number(s?.lat)) && Number.isFinite(Number(s?.lon)) && s.lat !== null && s.lat !== '';

/** «50.4501, 30.5234», посилання Google Maps (@50.45,30.52 чи q=50.45,30.52) → { lat, lon } або null. */
function parseCoords(text) {
  const m = String(text ?? '').match(/(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)/);
  if (!m) return null;
  const [lat, lon] = [m[1], m[2]].map((x) => Number(x.replace(',', '.')));
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

const coordsText = (s) => (hasCoords(s) ? `${Number(s.lat).toFixed(5)}, ${Number(s.lon).toFixed(5)}` : '');
// Під'їзд — де лишити авто; маршрут веде сюди, бо точка на воді часто без дороги
const parkOf = (s) => (hasCoords({ lat: s?.pLat, lon: s?.pLon }) ? { lat: s.pLat, lon: s.pLon } : null);

const SPOT_KINDS = [['river', 'Річка'], ['lake', 'Озеро'], ['pond', 'Ставок'], ['reservoir', 'Водосховище'], ['quarry', 'Кар’єр'], ['canal', 'Канал'], ['sea', 'Море, лиман'], ['other', 'Інше']];
const ACCESS = [['car', 'Авто до води'], ['walk', 'Пішки'], ['shore', 'З берега'], ['boat', 'З човна'], ['ice', 'По льоду']];
const PAY = [['free', 'Безкоштовно'], ['paid', 'Платно']];

// Виїзди за водоймами — один прохід на завантаження (state.trips міняється лише через refresh)
const spotTripsIdx = new WeakMap();
function spotTrips(spotId) {
  let map = spotTripsIdx.get(state.trips);
  if (!map) {
    map = new Map();
    for (const tr of state.trips) if (tr.spotId) map.set(tr.spotId, [...(map.get(tr.spotId) ?? []), tr]);
    for (const list of map.values()) list.sort((a, b) => collate(b.date, a.date) || collate(b.from ?? '', a.from ?? ''));
    spotTripsIdx.set(state.trips, map);
  }
  return [...(map.get(spotId) ?? [])];
}

const spotPrice = (s) => (s.pay === 'paid' ? (num(s.price) ? t('путівка {s}', { s: fmt.money(s.price) }) : t('платно')) : s.pay === 'free' ? t('безкоштовно') : null);
// Google Maps — посиланням у новій вкладці: сам застосунок координати нікуди не шле
const mapUrl = (s) => `https://www.google.com/maps/search/?api=1&query=${Number(s.lat)},${Number(s.lon)}`;
const routeUrl = (s) => {
  const to = parkOf(s) ?? s;
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(to.lat)},${Number(to.lon)}`;
};
const hasPlace = (s) => hasCoords(s) || Boolean(parkOf(s));

function spotRow(s) {
  const trips = spotTrips(s.id);
  const fish = trips.reduce((n, x) => n + tripCatch(x), 0);
  const sub = [label(SPOT_KINDS, s.kind), trips.length ? t('виїздів: {n}, останній {d}', { n: fmt.num(trips.length), d: fmt.date(trips[0].date) }) : t('ще не їздив'), spotPrice(s)];
  return row(s.name, sub.filter(Boolean).join(' · '),
    fish ? h('span', { class: 'fish-count' }, icon('fish'), fmt.num(fish)) : '',
    () => spotDetail(s.id), { id: s.id, thumb: findPhoto(s.photoId) ? thumbImg(s.photoId) : null });
}

function renderSpots() {
  // Спершу ті, куди їздив нещодавно; нові й забуті — за назвою внизу
  const last = (s) => spotTrips(s.id)[0]?.date ?? '';
  const list = [...state.spots].sort((a, b) => collate(last(b), last(a)) || collate(a.name, b.name));
  if (list.length) $('subtitle').textContent = t('водойм: {n}', { n: fmt.num(list.length) });
  return list.length ? h('div', { class: 'rows' }, list.map(spotRow))
    : empty(t('Ще немає водойм'), t('Де ловите: тип, як дістатися, чи платно, координати для погоди й маршруту. Тут же — улов, уловисті приманки й де обриваєте.'),
      [btn(t('Додати'), () => spotForm(), 'primary add')]);
}

/** Де зараз телефон: { lat, lon } або null (з підказкою, чому ні). */
function myPosition() {
  if (!navigator.geolocation) { toast(t('Телефон не дає місце')); return Promise.resolve(null); }
  toast(t('Шукаю місце…'));
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => { toast(t('Не вдалося визначити місце — дозвольте доступ до геолокації')); resolve(null); },
    { enableHighAccuracy: true, timeout: 15000 }));
}

const MAP_LAYER = 'fishing-log:map-layer';
const mapLayer = () => (recall(MAP_LAYER) === 'osm' ? 'osm' : 'sat');

/** Карта на весь екран: торкання ставить вибрану точку — водойму чи під'їзд; шпильки можна перетягувати. */
async function mapPicker(start, onDone) {
  let L;
  try { L = await loadLeaflet(); } catch { toast(t('Карта не завантажилась — перевірте інтернет')); return; }
  const pts = { water: start.water ?? null, park: start.park ?? null };
  let mode = pts.water && !pts.park ? 'park' : 'water';
  const tip = h('p', { class: 'muted small map-tip' });
  const markers = {};
  // Прибрати — ту точку, що вибрана вгорі; кнопка каже яку й видна, лише коли точка стоїть
  const clear = btn('', () => {
    markers[mode]?.remove();
    delete markers[mode];
    pts[mode] = null;
    hint();
  }, 'quiet mini');
  const hint = () => {
    tip.textContent = mode === 'water' ? t('Торкніться води, де ловите') : t('Торкніться місця, де лишаєте авто');
    clear.textContent = mode === 'water' ? t('Прибрати водойму') : t('Прибрати під’їзд');
    clear.hidden = !pts[mode];
  };
  const modes = chips([['water', [icon('drop'), h('span', {}, t('Водойма'))]], ['park', [icon('car'), h('span', {}, t('Під’їзд'))]]], mode, (v) => { mode = v; hint(); });
  modes.classList.add('segmented', 'map-modes');
  const setMode = (v) => { mode = v; modes.value = v; modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === v)); hint(); };
  hint();
  const el = h('div', { class: 'map-box' });
  let map = null;
  const layers = chips([['sat', t('Супутник')], ['osm', t('Схема')]], mapLayer(), (v) => { map?.setLayer(v); remember(MAP_LAYER, v); });
  layers.classList.add('segmented', 'map-layers');
  const put = (kind, at) => {
    pts[kind] = { lat: at.lat, lon: at.lng ?? at.lon };
    const ll = [pts[kind].lat, pts[kind].lon];
    if (!markers[kind]) {
      // Торкнулися шпильки — вибрали її: далі «Прибрати…» прибере саме її
      markers[kind] = L.marker(ll, { icon: pinIcon(L, kind), draggable: true, keyboard: false })
        .on('dragend', (e) => { const p = e.target.getLatLng(); pts[kind] = { lat: p.lat, lon: p.lng }; })
        .on('click', () => setMode(kind))
        .addTo(map);
    } else markers[kind].setLatLng(ll);
    hint();
  };
  const me = btn([icon('pin'), t('Я тут')], async () => {
    const pos = await myPosition();
    if (pos && map) map.setView([pos.lat, pos.lon], Math.max(map.getZoom(), 15));
  }, 'mini');
  const close = sheet(t('Водойма на карті'), h('div', { class: 'map-picker' }, modes, tip, el,
    h('div', { class: 'map-tools' }, layers, h('div', { class: 'btn-row' }, me, clear))), {
    full: true,
    dirty: false,
    onClose: () => map?.remove(),
    actions: [btn(t('Скасувати'), () => close()), btn(t('Готово'), () => { close(); onDone({ ...pts }); }, 'primary')],
  });
  // Карта міряє себе при створенні — тож коли шторка вже на екрані
  requestAnimationFrame(() => {
    const c = pts.water ?? pts.park;
    map = makeMap(L, el, c ? { lat: c.lat, lon: c.lon, zoom: 15, layer: mapLayer() } : { lat: UA.lat, lon: UA.lon, zoom: UA.zoom, layer: mapLayer() });
    for (const k of ['water', 'park']) if (pts[k]) put(k, pts[k]);
    if (pts.water && pts.park) map.fitBounds([[pts.water.lat, pts.water.lon], [pts.park.lat, pts.park.lon]], { padding: [48, 48], maxZoom: 17 });
    map.on('click', (e) => {
      put(mode, e.latlng);
      // Поставили воду, а під'їзду ще немає — одразу пропонуємо його
      if (mode === 'water' && !pts.park) setMode('park');
    });
    setTimeout(() => map.invalidateSize(), 250);
  });
}

/** Мала карта з точками води й під'їзду, без керування; onclick — що робить торкання. */
function miniMap(water, park, onclick, label) {
  const a = water ?? park;
  const el = h('div', { class: 'map-mini' });
  const wrap = h('button', { type: 'button', class: 'map-mini-btn', 'aria-label': label, onclick }, el);
  loadLeaflet().then((L) => requestAnimationFrame(() => {
    if (!el.isConnected) return;
    const map = makeMap(L, el, { lat: a.lat, lon: a.lon, zoom: 14, layer: mapLayer(), interactive: false });
    if (water) L.marker([water.lat, water.lon], { icon: pinIcon(L, 'water'), interactive: false, keyboard: false }).addTo(map);
    if (park) L.marker([park.lat, park.lon], { icon: pinIcon(L, 'park'), interactive: false, keyboard: false }).addTo(map);
    if (water && park) map.fitBounds([[water.lat, water.lon], [park.lat, park.lon]], { padding: [36, 36], maxZoom: 16 });
    setTimeout(() => map.invalidateSize(), 250);
  })).catch(() => wrap.remove());
  return wrap;
}

/** Мала карта в картці водойми: вода й під'їзд; торкання — відкрити в Google Maps. */
function spotMiniMap(s) {
  const water = hasCoords(s) ? { lat: Number(s.lat), lon: Number(s.lon) } : null;
  const park = parkOf(s);
  return miniMap(water, park, () => window.open(mapUrl(water ?? park), '_blank', 'noopener'), t('Відкрити «{name}» у Google Maps', { name: s.name }));
}

/** Згорнутий блок форми карткою: заголовок із підсумком, розгорнули — вміст. */
function formFold(title, body) {
  return h('details', { class: 'ex-more form-fold' }, h('summary', {}, title), body);
}

/**
 * Водойма: блоками, а не стіною полів — назва й тип, «На карті» (мала карта, одна кнопка, координати вручну — згорнуто),
 * «Риболовля», «Хто водиться» (згорнуто), фото, нотатка.
 */
function spotForm(s = null, { onSaved = null } = {}) {
  const f = form([
    { name: 'name', label: t('Назва'), value: s?.name, required: true, placeholder: t('напр. Дніпро, Козачий острів') },
    { name: 'kind', label: t('Тип'), type: 'select', options: [['', t('— не вказано —')], ...SPOT_KINDS.map(([k, l]) => [k, t(l)])], value: s?.kind ?? '', half: true },
    { name: 'depth', label: t('Глибини, м'), value: s?.depth, half: true, placeholder: t('напр. 2–6') },
    { name: 'coords', label: t('Водойма'), value: coordsText(s), placeholder: '50.45012, 30.52341', hint: t('Координати чи посилання з Google Maps; точка на воді — для погоди') },
    { name: 'park', label: t('Під’їзд'), value: coordsText(parkOf(s)), placeholder: '50.44870, 30.51920', hint: t('Де лишити авто — сюди веде маршрут') },
    { name: 'pay', label: t('Риболовля'), type: 'chips', options: PAY.map(([k, l]) => [k, t(l)]), value: s?.pay ?? '' },
    { name: 'price', label: t('Путівка, грн'), type: 'number', value: s?.price, half: true },
    { name: 'note', label: t('Нотатка'), type: 'textarea', rows: 3, value: s?.note, placeholder: t('ями, коряжник, хто сторожує, де краще стати') },
  ]);
  const field = (name) => f.inputs[name].closest('.field');
  // Обгортки полів, що переїдуть у блоки окремо від своїх підписів
  const payField = field('pay');
  const noteField = field('note');
  // «На карті»: що позначено — малою картою й рядком; координати вручну — для тих, хто вставляє з Google Maps
  const here = (input) => btn([icon('pin'), t('Звідси')], async () => {
    const pos = await myPosition();
    if (pos) { input.value = `${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`; paintMap(); toast(t('Місце знайдено')); }
  }, 'mini with-ico');
  const preview = h('div', { class: 'spot-map-preview' });
  const pickBtn = h('div', { class: 'btn-row' }, btn([icon('map'), t('Змінити на карті')], () => openPicker(), 'with-ico'));
  const status = h('p', { class: 'muted small map-status' });
  const paintMap = () => {
    const water = parseCoords(f.inputs.coords.value);
    const park = parseCoords(f.inputs.park.value);
    preview.replaceChildren(water || park ? miniMap(water, park, openPicker, t('Змінити точки на карті')) : h('button', { type: 'button', class: 'map-empty', onclick: openPicker }, icon('map'), h('b', {}, t('Вибрати на карті')), h('span', { class: 'muted small' }, t('де вода й де лишити авто'))));
    // Порожньо — лише одна велика кнопка; позначено — карта, що саме є, і кнопка «Змінити»
    status.hidden = pickBtn.hidden = !(water || park);
    status.textContent = `${t('Водойма')}: ${water ? '✓' : '—'} · ${t('Під’їзд')}: ${park ? '✓' : '—'}`;
  };
  const openPicker = () => mapPicker(
    { water: parseCoords(f.inputs.coords.value), park: parseCoords(f.inputs.park.value) },
    ({ water, park }) => {
      f.inputs.coords.value = water ? `${water.lat.toFixed(5)}, ${water.lon.toFixed(5)}` : '';
      f.inputs.park.value = park ? `${park.lat.toFixed(5)}, ${park.lon.toFixed(5)}` : '';
      paintMap();
    });
  f.inputs.coords.addEventListener('change', paintMap);
  f.inputs.park.addEventListener('change', paintMap);
  const manual = formFold(t('Координати вручну'), h('div', { class: 'form' },
    field('coords'), h('div', { class: 'specs-find' }, here(f.inputs.coords)),
    field('park'), h('div', { class: 'specs-find' }, here(f.inputs.park))));
  const mapBox = box(t('На карті'), h('div', {}, preview, status, pickBtn, manual));
  paintMap();
  // «Риболовля»: безкоштовно / платно перемикачем, путівка — лише коли платно; як дістатися — тут же
  f.inputs.pay.classList.add('segmented');
  const fitPrice = () => { field('price').hidden = f.inputs.pay.value !== 'paid'; };
  f.inputs.pay.addEventListener('click', fitPrice);
  fitPrice();
  const access = multiChips(ACCESS.map(([k, l]) => [k, t(l)]), s?.access ?? []);
  const fishBox = box(t('Риболовля'), h('div', {},
    h('div', { class: 'form' }, f.inputs.pay, field('price')),
    h('div', { class: 'field-label' }, t('Як дістатися й ловити')), access.el));
  // «Хто водиться» — довгий список риб: згорнуто, у заголовку — скільки вибрано
  const fishHere = multiChips([...new Set([...allSpecies(), ...(s?.species ?? [])])].map((x) => [x, x]), s?.species ?? []);
  const speciesTitle = h('span', {});
  const paintSpecies = () => { const n = fishHere.value().length; speciesTitle.textContent = n ? t('Хто водиться · {n}', { n }) : t('Хто водиться'); };
  fishHere.el.addEventListener('click', () => requestAnimationFrame(paintSpecies));
  paintSpecies();
  const species = formFold(speciesTitle, fishHere.el);
  const pick = photoPicker(findPhoto(s?.photoId), { query: () => f.inputs.name.value.trim() });
  // Поля з форми переїхали в блоки; у сітці лишаються назва, тип і глибини
  payField.remove();
  noteField.remove();
  noteField.querySelector('.field-label')?.remove();
  const close = sheet(s ? t('Змінити водойму') : t('Нова водойма'), h('div', { class: 'blocks-form spot-form' },
    f.el, mapBox, fishBox, species,
    box(t('Фото'), pick.el),
    box(t('Нотатка'), noteField)), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      const c = v.coords ? parseCoords(v.coords) : null;
      const pk = v.park ? parseCoords(v.park) : null;
      if ((v.coords && !c) || (v.park && !pk)) manual.open = true;
      if (v.coords && !c) { fieldError(f.inputs.coords, t('Не схоже на координати')); return; }
      if (v.park && !pk) { fieldError(f.inputs.park, t('Не схоже на координати')); return; }
      const id = s?.id ?? db.uid();
      let photo;
      try { photo = await photoChanges(s, pick.value(), id); } catch (err) { toast(err.message); return; }
      const rec = {
        ...(s ?? { id, created: Date.now() }), name: v.name, kind: v.kind || null, note: v.note, lat: c?.lat ?? null, lon: c?.lon ?? null, pLat: pk?.lat ?? null, pLon: pk?.lon ?? null,
        pay: v.pay || null, price: v.pay === 'paid' ? v.price : null, depth: v.depth, access: access.value(), species: fishHere.value(), photoId: photo.photoId,
      };
      close();
      await save(joinChanges(photo.changes, { spots: { put: [rec] } }), [rec.id]);
      onSaved?.(rec);
    }, 'primary')],
  });
}

function removeSpot(s) {
  confirmSheet(t('Видалити «{name}»?', { name: s.name }), t('Виїзди залишаться, але без водойми.'), t('Видалити'), async () => {
    await save(joinChanges(s.photoId ? dropPhotos([s.photoId]) : {}, { spots: { del: [s.id] } }));
    toast(t('Видалено'));
  });
}

function spotDetail(id) {
  const build = () => { const s = findSpot(id); return s ? spotBody(s) : null; };
  sheet(() => findSpot(id)?.name, build(), {
    live: build,
    full: true,
    tools: [toolBtn('edit', t('Змінити'), () => spotForm(findSpot(id))), toolBtn('delete', t('Видалити'), () => removeSpot(findSpot(id)), 'danger')],
  });
}

/** Приманки, на які тут ловилось: річ зі «Снастей» або вписане словами — { name, n, g }. */
function spotBaits(trips) {
  const by = new Map();
  for (const tr of trips) {
    for (const c of tr.catches ?? []) {
      const g = findGear(c.baitId);
      const name = baitText(c);
      if (!name) continue;
      const key = g ? g.id : `txt:${norm(name)}`;
      const cur = by.get(key) ?? { name, n: 0, g };
      cur.n += num(c.n) || 1;
      by.set(key, cur);
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n || collate(a.name, b.name));
}

const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
// Частина доби за годиною улову: з 5 — ранок, з 10 — день, з 17 — вечір, з 22 — ніч
const DAYPARTS = [['morning', 'Ранок', 5], ['day', 'День', 10], ['evening', 'Вечір', 17], ['night', 'Ніч', 22]];
const daypart = (time) => {
  const hh = Number(String(time).slice(0, 2));
  return [...DAYPARTS].reverse().find(([, , from]) => hh >= from) ?? DAYPARTS[3];
};

/** Смужки «скільки» — частка від найбільшого; підпис ліворуч, число праворуч. */
function bars(list) {
  const max = Math.max(...list.map((x) => x.n), 1e-9);
  return h('div', { class: 'bars' }, list.map((x) => h('div', { class: 'bar' },
    h('span', { class: 'bar-label' }, x.label),
    h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${Math.max(4, Math.round((x.n / max) * 100))}%` })),
    h('span', { class: 'bar-num' }, x.text ?? fmt.num(x.n)))));
}

/** Хто ловиться на водоймі: вид → { n, best } — кількість і найбільша рибина (поштучні записи). */
function spotSpecies(trips) {
  const map = new Map();
  for (const tr of trips) {
    for (const c of tr.catches ?? []) {
      const cur = map.get(c.species) ?? { n: 0, best: null };
      cur.n += num(c.n) || 1;
      const one = (num(c.n) || 1) === 1;
      if (one && (num(c.weight) > num(cur.best?.weight) || (!num(cur.best?.weight) && !num(c.weight) && num(c.length) > num(cur.best?.length)))) cur.best = c;
      map.set(c.species, cur);
    }
  }
  return map;
}

function spotBody(s) {
  const photo = findPhoto(s.photoId);
  const trips = spotTrips(s.id);
  const fish = trips.reduce((n, x) => n + tripCatch(x), 0);
  const kg = trips.reduce((n, x) => n + tripKg(x), 0);
  const blank = trips.filter((x) => !tripCatch(x)).length;
  const cost = trips.reduce((n, x) => n + tripCost(x).total, 0);
  const tile = (name, value, sub = null) => h('div', { class: 'spec-tile' }, h('small', {}, name), h('b', {}, value), sub ? h('span', {}, sub) : null);
  const tiles = trips.length ? h('div', { class: 'spec-tiles' },
    tile(t('Виїздів'), fmt.num(trips.length), t('останній {d}', { d: fmt.date(trips[0].date) })),
    tile(t('Риб'), fmt.num(fish), kg ? `${fmt.num(Math.round(kg * 10) / 10)} ${t('кг')}` : null),
    tile(t('За виїзд'), fmt.num(Math.round((fish / trips.length) * 10) / 10), blank ? t('без улову: {n}', { n: fmt.num(blank) }) : t('завжди з уловом')),
    cost ? tile(t('Витрати, грн'), fmt.num(Math.round(cost)), fish ? t('{s} грн за рибину', { s: fmt.num(Math.round(cost / fish)) }) : null) : null) : null;
  const meta = facts([
    [t('Тип'), s.kind ? label(SPOT_KINDS, s.kind) : null],
    [t('Риболовля'), spotPrice(s) || null],
    [t('Глибини'), s.depth ? `${s.depth} ${t('м')}` : null],
    [t('Як дістатися'), (s.access ?? []).map((k) => label(ACCESS, k)).join(', ')],
    hasPlace(s) ? null : [t('На карті'), t('не позначено'), () => spotForm(s)],
    [t('Нотатка'), s.note ? h('span', { class: 'pre' }, s.note) : null],
  ]);
  const open = (url) => window.open(url, '_blank', 'noopener');
  const species = spotSpecies(trips);
  const caught = [...species].sort((a, b) => b[1].n - a[1].n || collate(a[0], b[0]));
  const unseen = (s.species ?? []).filter((x) => !species.has(x));
  const baits = spotBaits(trips).slice(0, 6);
  // Коли клює: риб на виїзд по місяцях; час доби — з улову, де вказано «Коли»
  const months = new Map();
  for (const tr of trips) {
    const m = Number(tr.date.slice(5, 7)) - 1;
    const cur = months.get(m) ?? { trips: 0, n: 0 };
    cur.trips += 1;
    cur.n += tripCatch(tr);
    months.set(m, cur);
  }
  const parts = new Map();
  for (const tr of trips) {
    for (const c of tr.catches ?? []) {
      if (!c.time) continue;
      const [key, name] = daypart(c.time);
      parts.set(key, { label: t(name), n: (parts.get(key)?.n ?? 0) + (num(c.n) || 1) });
    }
  }
  // Що обриваю саме тут
  const lost = new Map();
  for (const tr of trips) {
    for (const x of tripLosses(tr.id)) {
      const cur = lost.get(x.g.id) ?? { g: x.g, n: 0 };
      cur.n += num(x.n) || 1;
      lost.set(x.g.id, cur);
    }
  }
  const losses = [...lost.values()].sort((a, b) => b.n - a.n);
  const lostTotal = losses.reduce((n, x) => n + x.n, 0);
  return h('div', { class: 'gear-sheet spot-sheet' },
    photo ? h('button', { type: 'button', class: 'photo-btn', 'aria-label': t('Фото на весь екран'), onclick: () => showPhoto(photo.id) },
      h('img', { class: 'item-photo spot-photo', src: photo.thumb, alt: '' })) : null,
    hasPlace(s) ? spotMiniMap(s) : null,
    h('div', { class: 'btn-row spot-acts' },
      hasPlace(s) ? btn([icon('route'), t('Маршрут')], () => open(routeUrl(s)), 'primary') : null,
      btn(t('+ Виїзд сюди'), () => tripForm(null, { spotId: s.id, cost: s.pay === 'paid' && num(s.price) ? s.price : null }))),
    meta,
    tiles,
    caught.length || unseen.length ? box(t('Хто ловиться'), h('div', {},
      caught.length ? bars(caught.map(([sp, x]) => ({ label: sp, n: x.n, text: [fmt.num(x.n), x.best ? fishSize(x.best).split(' · ')[0] : null].filter(Boolean).join(' · ') }))) : null,
      unseen.length ? h('p', { class: 'muted small' }, t('Водиться, ще не ловив: {list}', { list: unseen.join(', ') })) : null)) : null,
    baits.length ? box(t('Уловисті приманки тут'), h('div', { class: 'rows' }, baits.map((x) => row(x.name,
      x.g ? [catOf(x.g.cat).name, weightText(x.g), !active(x.g) ? t('вже немає') : isQty(x.g) ? t('є {n}', { n: qtyText(x.g) }) : null].filter(Boolean).join(' · ') : t('вписано в улові'),
      h('span', { class: 'fish-count' }, icon('fish'), fmt.num(x.n)), x.g ? () => gearDetail(x.g.id) : null,
      { thumb: x.g ? gearThumb(x.g) : null, cls: x.g ? '' : 'static' })))) : null,
    months.size > 1 || parts.size ? box(t('Коли клює'), h('div', {},
      months.size > 1 ? [h('div', { class: 'field-label' }, t('Риб за виїзд по місяцях')),
        bars([...months].sort((a, b) => a[0] - b[0]).map(([m, x]) => ({ label: t(MONTHS[m]), n: x.n / x.trips, text: fmt.num(Math.round((x.n / x.trips) * 10) / 10) })))] : null,
      parts.size ? [h('div', { class: 'field-label' }, t('Час доби — з улову, де вказано «Коли»')),
        bars(DAYPARTS.map(([k]) => parts.get(k)).filter(Boolean))] : null)) : null,
    losses.length ? box(t('Що тут обриваю · {n}', { n: fmt.num(lostTotal) }), h('div', { class: 'rows' }, losses.slice(0, 6).map((x) => row(gearTitle(x.g),
      [weightText(x.g), x.g.color].filter(Boolean).join(' · ') || null, `−${fmt.num(x.n)}`, () => gearDetail(x.g.id), { thumb: gearThumb(x.g) })))) : null,
    trips.length ? fold('spot-trips', `${t('Виїзди')} · ${trips.length}`, () => h('div', { class: 'rows' }, trips.map(tripRow))) : null,
    hasPlace(s) ? h('p', { class: 'muted small' }, [hasCoords(s) ? t('Водойма: {c} — для погоди у виїздах.', { c: coordsText(s) }) : null,
      parkOf(s) ? t('Під’їзд: {c} — маршрут веде сюди.', { c: coordsText(parkOf(s)) }) : null].filter(Boolean).join(' ')) : null);
}

// ---------- погода й місяць ----------

const MOON = [['🌑', 'Молодик'], ['🌒', 'Молодий місяць'], ['🌓', 'Перша чверть'], ['🌔', 'Місяць росте'], ['🌕', 'Повня'], ['🌖', 'Місяць спадає'], ['🌗', 'Остання чверть'], ['🌘', 'Старий місяць']];
const WINDS = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];
// Емодзі фази — лише картинка поруч із назвою: читачу екрана досить назви
const moonText = (date) => { const [e, l] = MOON[moonPhase(date).idx]; return h('span', {}, h('span', { 'aria-hidden': 'true' }, `${e} `), t(l)); };
const trend = (dp) => (dp > 0 ? `↗ +${dp}` : dp < 0 ? `↘ −${-dp}` : '→ 0');
const shortWeather = (w) => (w ? [`${Math.round(w.t)}°`, `${fmt.num(Math.round(w.w))} ${t('м/с')}`, `${w.p} ${trend(w.dp)}`].join(' · ') : null);

/** Підтягнути погоду виїзду: потрібні координати водойми; тихо — для автоматичного виклику після збереження. */
async function loadTripWeather(tripId, { quiet = false } = {}) {
  const tr = findTrip(tripId);
  const s = findSpot(tr?.spotId);
  if (!tr || !hasCoords(s)) { if (!quiet) toast(t('У водойми немає координат')); return; }
  if (tr.date > addDays(today(), 15)) { if (!quiet) toast(t('Прогноз — лише на 16 днів уперед')); return; }
  try {
    const hour = Number((tr.from || '08').slice(0, 2));
    const weather = { ...(await weatherAt(s, tr.date, hour)), spotId: s.id, date: tr.date, hour };
    if (await db.patch('trips', tr.id, { weather })) await refresh();
  } catch {
    if (!quiet) toast(navigator.onLine ? t('Погоди на цю дату ще немає — архів відстає на кілька днів') : t('Немає інтернету'));
  }
}

// ---------- виїзди ----------

const KINDS = [['spin', 'Спінінг'], ['feeder', 'Фідер'], ['float', 'Поплавок'], ['donka', 'Донка'], ['makush', 'Макушатник'], ['fly', 'Нахлист'], ['other', 'Інше']];
const SPECIES = ['Щука', 'Окунь', 'Судак', 'Жерех', 'Сом', 'Головень', 'Короп', 'Карась', 'Лящ', 'Плітка', 'Краснопірка', 'Лин', 'Синець', 'Густера', 'Чехоня', 'Йорж', 'Форель'];
const allSpecies = () => [...new Set([...SPECIES.map((x) => t(x)), ...(prefs().species ?? [])])];

const tripCatch = (tr) => (tr.catches ?? []).reduce((n, c) => n + (num(c.n) || 1), 0);
const tripKg = (tr) => (tr.catches ?? []).reduce((s, c) => s + num(c.weight), 0);
// Втрати й витрати за виїздами — один прохід по речах на завантаження, а не на кожен виїзд у списку
const tripLogs = new WeakMap();
function tripLog(field, tripId) {
  let all = tripLogs.get(state.gear);
  if (!all) { all = {}; tripLogs.set(state.gear, all); }
  if (!all[field]) {
    const map = new Map();
    for (const g of state.gear) for (const x of g[field] ?? []) if (x.tripId) map.set(x.tripId, [...(map.get(x.tripId) ?? []), { g, ...x }]);
    all[field] = map;
  }
  return [...(all[field].get(tripId) ?? [])];
}
const tripLosses = (tripId) => tripLog('losses', tripId);
const tripSpends = (tripId) => tripLog('spends', tripId);
const tripTitle = (tr) => findSpot(tr.spotId)?.name ?? t('Без водойми');

// Виїзд на кілька днів: date — перший день, dateTo — останній (порожньо — один день)
const tripEnd = (tr) => (tr.dateTo && tr.dateTo > tr.date ? tr.dateTo : tr.date);
const daySpan = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
const tripDays = (tr) => daySpan(tr.date, tripEnd(tr));
const daysText = (n) => `${fmt.num(n)} ${plural(n, [t('день'), t('дні'), t('днів')])}`;
const dayLabel = (iso) => new Date(`${iso}T12:00`).toLocaleDateString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit' });
/** Коли впіймав: день улову, якщо виїзд на кілька днів і день у його межах, інакше — перший день. */
const catchDate = (tr, c) => (c.date && c.date >= tr.date && c.date <= tripEnd(tr) ? c.date : tr.date);

/** «14.11.2026», на кілька днів — «14–16.11.2026», через місяць — «30.11–02.12.2026». */
function tripWhen(tr) {
  const a = fmt.date(tr.date);
  const end = tripEnd(tr);
  if (end === tr.date) return a;
  const b = fmt.date(end);
  if (tr.date.slice(0, 7) === end.slice(0, 7)) return `${a.slice(0, 2)}–${b}`;
  if (tr.date.slice(0, 4) === end.slice(0, 4)) return `${a.slice(0, 5)}–${b}`;
  return `${a}–${b}`;
}

function tripRow(tr) {
  const n = tripCatch(tr);
  const lost = tripLosses(tr.id).reduce((s, x) => s + (num(x.n) || 1), 0);
  return row(tripTitle(tr),
    [tripWhen(tr), (tr.kinds ?? []).map((k) => label(KINDS, k)).join(', '), shortWeather(tr.weather)].filter(Boolean).join(' · '),
    h('span', { class: 'row-side' }, n ? h('span', { class: 'fish-count' }, icon('fish'), fmt.num(n)) : h('span', { class: 'muted small' }, t('без улову')),
      lost ? h('span', { class: 'muted small' }, `−${fmt.num(lost)}`) : null),
    () => tripDetail(tr.id), { id: tr.id, thumb: findPhoto(tr.photoIds?.[0]) ? thumbImg(tr.photoIds[0]) : null });
}

function renderTrips() {
  const list = [...state.trips].sort((a, b) => collate(b.date, a.date) || collate(b.from ?? '', a.from ?? ''));
  const year = today().slice(0, 4);
  const season = list.filter((x) => x.date.startsWith(year));
  $('subtitle').textContent = season.length ? t('сезон {y}: виїздів {n}, риб {f}', { y: year, n: season.length, f: fmt.num(season.reduce((s, x) => s + tripCatch(x), 0)) }) : '';
  return h('div', {},
    packBox(),
    seasonBox(),
    recordsBox(),
    list.length ? byMonth(list).map(([head, rows]) => [h('h3', { class: 'list-head' }, head), h('div', { class: 'rows' }, rows.map(tripRow))])
      : empty(t('Ще немає виїздів'), t('Риболовля: де, коли, погода сама з координат водойми, улов і що обірвав.'), [btn(t('Додати'), () => tripForm(), 'primary add')]));
}

/** Кілька значень чипами: повертає { el, value() }. */
function multiChips(options, selected = []) {
  const on = new Set(selected);
  const el = h('div', { class: 'chips check' }, options.map(([k, l]) => h('button', {
    type: 'button', class: on.has(k) ? 'on' : '', onclick: (e) => { if (!on.delete(k)) on.add(k); e.currentTarget.classList.toggle('on', on.has(k)); },
  }, l)));
  // value на самому елементі — щоб шторка помітила зміну й спитала перед виходом
  Object.defineProperty(el, 'value', { get: () => [...on].join(',') });
  return { el, value: () => options.map(([k]) => k).filter((k) => on.has(k)) };
}

/**
 * Речі чипами без стіни: вибрані й кілька останніх — одразу, решта — «＋ …» зі списком і пошуком.
 * Коли речей мало (≤ 6), показуємо всі.
 */
function gearChips(list, selected, recent, addLabel, pickTitle) {
  const ids = new Set(list.map((g) => g.id));
  const on = new Set(selected.filter((id) => ids.has(id)));
  const few = list.length <= 6;
  const shown = few ? list.map((g) => g.id) : [...new Set([...on, ...recent.filter((id) => ids.has(id)).slice(0, 4)])];
  const el = h('div', { class: 'chips check' });
  const paint = () => {
    el.replaceChildren(...shown.map((id) => h('button', {
      type: 'button', class: on.has(id) ? 'on' : '',
      onclick: (e) => { if (!on.delete(id)) on.add(id); e.currentTarget.classList.toggle('on', on.has(id)); },
    }, gearTitle(findGear(id)))),
    // replaceChildren не пропускає null (вставив би текст «null») — тому розгорнутий порожній масив
    ...(few || shown.length >= list.length ? [] : [h('button', {
      type: 'button', class: 'add',
      onclick: () => gearPickSheet(pickTitle, list.filter((g) => !shown.includes(g.id)).sort(byGroup), (g) => {
        on.add(g.id); shown.push(g.id); paint();
      }),
    }, `＋ ${addLabel}`)]));
  };
  paint();
  Object.defineProperty(el, 'value', { get: () => [...on].join(',') });
  return { el, value: () => shown.filter((id) => on.has(id)) };
}

/** preset — для нового виїзду, напр. вудилища зі збору. */
function tripForm(tr = null, preset = {}) {
  const byDate = [...state.trips].sort((a, b) => collate(b.date, a.date));
  const last = byDate[0];
  const spotOpts = () => [['', '—'], ...[...state.spots].sort((a, b) => collate(a.name, b.name)).map((s) => [s.id, s.name])];
  // «Коли» — дата й години одним рядком; «По» — лише для виїзду на кілька днів
  const when = form([
    { name: 'date', label: t('Дата'), type: 'dmy', value: tr?.date ?? today(), required: true, half: true },
    { name: 'from', label: t('З'), type: 'time', value: tr?.from ?? '', half: true },
    { name: 'to', label: t('До'), type: 'time', value: tr?.to ?? '', half: true },
    { name: 'dateTo', label: t('По'), type: 'dmy', value: tr && tripDays(tr) > 1 ? tr.dateTo : '', half: true },
  ]);
  when.el.classList.add('when3');
  const daysNote = h('span', { class: 'days-note' });
  const paintDays = () => {
    const { date, dateTo } = when.values();
    const n = typeof date === 'string' && typeof dateTo === 'string' && date && dateTo > date ? daySpan(date, dateTo) : 0;
    daysNote.textContent = n ? daysText(n) : '';
  };
  const oneDay = h('button', { type: 'button', class: 'btn mini quiet', onclick: () => setMulti(false) }, t('Один день'));
  const multi = h('div', { class: 'form multi-day' }, when.inputs.dateTo.closest('.field'), h('div', { class: 'days-side' }, daysNote, oneDay));
  const moreDays = h('button', {
    type: 'button', class: 'btn mini quiet days-add',
    onclick: () => {
      const { date } = when.values();
      if (typeof date === 'string' && date) when.inputs.dateTo.value = fmt.date(addDays(date, 1));
      setMulti(true);
      when.inputs.dateTo.focus();
    },
  }, t('＋ Кілька днів'));
  function setMulti(on) {
    multi.hidden = !on;
    moreDays.hidden = on;
    if (!on) when.inputs.dateTo.value = '';
    paintDays();
  }
  when.inputs.date.addEventListener('input', paintDays);
  when.inputs.dateTo.addEventListener('input', paintDays);
  setMulti(Boolean(when.inputs.dateTo.value));
  const f = form([
    { name: 'spotId', label: t('Водойма'), type: 'select', options: spotOpts(), value: tr?.spotId ?? preset.spotId ?? last?.spotId ?? '' },
    { name: 'waterT', label: t('Вода, °C'), type: 'number', value: tr?.waterT, half: true },
    { name: 'cost', label: t('Інші витрати, грн'), type: 'number', value: tr?.cost ?? preset.cost, half: true, placeholder: t('бензин, путівка') },
    { name: 'note', label: t('Нотатка'), type: 'textarea', rows: 2, value: tr?.note, placeholder: t('що спрацювало, де стояв') },
  ]);
  const field = (name) => f.inputs[name].closest('.field');
  const spotField = field('spotId');
  const noteField = field('note');
  const addSpot = h('button', {
    type: 'button', class: 'icon-btn add-inline', 'aria-label': t('Нова водойма'), title: t('Нова водойма'),
    onclick: () => spotForm(null, { onSaved: (s) => { f.inputs.spotId.replaceChildren(...selectOptions(spotOpts(), s.id)); f.inputs.spotId.value = s.id; } }),
  }, '＋');
  const spotRow = h('div', { class: 'with-add' }, spotField, addSpot);
  const kinds = multiChips(KINDS.map(([k, l]) => [k, t(l)]), tr?.kinds ?? (preset.kinds?.length ? preset.kinds : null) ?? last?.kinds ?? []);
  const rods = state.gear.filter((g) => active(g) && ['rods'].includes(groupOf(g))).sort(byGroup);
  const recentRods = byDate.flatMap((x) => x.gearIds ?? []);
  const used = gearChips(rods, tr?.gearIds ?? preset.gearIds ?? [], recentRods, t('Вудилище'), t('Чим ловив'));
  // Вода — про водойму в цей день, тому одразу під нею; «Інші витрати» — окремо, перед нотаткою
  const waterRow = h('div', { class: 'form' }, field('waterT'));
  const costRow = h('div', { class: 'form' }, field('cost'));
  const close = sheet(tr ? t('Змінити виїзд') : t('Новий виїзд'), h('div', { class: 'blocks-form' },
    when.el, moreDays, multi, spotRow, waterRow,
    h('div', { class: 'field-label' }, t('Як ловив')), kinds.el,
    rods.length ? [h('div', { class: 'field-label' }, t('Чим ловив')), used.el] : null,
    costRow, noteField), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(when) || invalidField(f)) return;
      const v = { ...when.values(), ...f.values() };
      if (v.dateTo && v.dateTo < v.date) { fieldError(when.inputs.dateTo, t('Раніше за початок виїзду')); return; }
      const rec = { ...(tr ?? { id: db.uid(), created: Date.now(), catches: [], photoIds: [] }), ...v, dateTo: v.dateTo > v.date ? v.dateTo : null, spotId: v.spotId || null, kinds: kinds.value(), gearIds: used.value() };
      // Інша дата, година чи водойма — стара погода вже не про цей виїзд
      const w = rec.weather;
      if (w && (w.date !== rec.date || w.spotId !== rec.spotId || w.hour !== Number((rec.from || '08').slice(0, 2)))) rec.weather = null;
      close();
      await save({ trips: { put: [rec] } }, [rec.id]);
      if (!tr) tripDetail(rec.id);
      if (!rec.weather) loadTripWeather(rec.id, { quiet: true });
    }, 'primary')],
  });
}

function tripDetail(id) {
  const build = () => { const tr = findTrip(id); return tr ? tripBody(tr) : null; };
  sheet(() => { const tr = findTrip(id); return tr ? `${tripTitle(tr)} · ${tripWhen(tr)}` : ''; }, build(), {
    live: build,
    full: true,
    tools: [toolBtn('edit', t('Змінити'), () => tripForm(findTrip(id))), toolBtn('delete', t('Видалити'), () => removeTrip(findTrip(id)), 'danger')],
  });
}

function tripBody(tr) {
  const s = findSpot(tr.spotId);
  const w = tr.weather;
  const losses = tripLosses(tr.id);
  const spends = tripSpends(tr.id);
  const catches = tr.catches ?? [];
  const photos = (tr.photoIds ?? []).filter(findPhoto);
  return h('div', {},
    facts([
      // Дата — у назві картки; тут години, а для кількох днів — скільки днів і коли почав та закінчив
      [t('Коли'), tripDays(tr) > 1
        ? [daysText(tripDays(tr)), tr.from ? t('початок о {time}', { time: tr.from }) : null, tr.to ? t('кінець о {time}', { time: tr.to }) : null].filter(Boolean).join(' · ')
        : [tr.from, tr.to].filter(Boolean).join('–') || null],
      s ? [t('Водойма'), s.name, () => spotDetail(s.id)] : [t('Водойма'), t('Без водойми')],
      [t('Як ловив'), (tr.kinds ?? []).map((k) => label(KINDS, k)).join(', ')],
      [t('Чим ловив'), (tr.gearIds ?? []).map(findGear).filter(Boolean).map(gearTitle).join(', ')],
      [t('Вода'), tr.waterT !== null && tr.waterT !== undefined && tr.waterT !== '' ? `${fmt.num(tr.waterT)} °C` : null],
      (() => {
        const c = tripCost(tr);
        if (!c.total) return null;
        const parts = [c.lost ? t('втрати {s}', { s: fmt.money(c.lost) }) : null, c.spent ? t('прикормка {s}', { s: fmt.money(c.spent) }) : null, c.other ? t('інше {s}', { s: fmt.money(c.other) }) : null].filter(Boolean);
        return [t('Вартість'), `${fmt.money(c.total)}${parts.length > 1 ? ` (${parts.join(', ')})` : ''}`];
      })(),
      [t('Нотатка'), tr.note ? h('span', { class: 'pre' }, tr.note) : null],
    ]),
    fold('trip-weather', [t('Погода'), w ? shortWeather(w) : null].filter(Boolean).join(' · '), h('div', {},
      w ? kv([
        [t('Повітря'), `${fmt.num(Math.round(w.t))} °C`],
        [t('Тиск'), `${w.p} ${t('мм рт. ст.')} · ${t('за добу')} ${trend(w.dp)}`],
        [t('Вітер'), `${fmt.num(Math.round(w.w * 10) / 10)} ${t('м/с')} · ${t(WINDS[compass(w.wd)])}`],
        [t('Хмарність'), `${fmt.num(w.cc)} %`],
        [t('Опади за добу'), `${fmt.num(w.rain)} ${t('мм')}`],
        [t('Фаза місяця'), moonText(tr.date)],
      ]) : [kv([[t('Фаза місяця'), moonText(tr.date)]]),
        h('p', { class: 'muted small' }, hasCoords(s) ? t('Погода ще не завантажена.') : t('Додайте водоймі координати — погода підтягнеться сама.'))],
      hasCoords(s) ? h('div', { class: 'btn-row' }, btn(w ? t('Оновити погоду') : t('Завантажити погоду'), () => loadTripWeather(tr.id), 'quiet')) : null,
      w ? h('p', { class: 'muted small' }, tripDays(tr) > 1
        ? t('Open-Meteo, {d} на {h}:00', { d: fmt.date(w.date).slice(0, 5), h: String(w.hour).padStart(2, '0') })
        : t('Open-Meteo, на {h}:00', { h: String(w.hour).padStart(2, '0') })) : null)),
    box([t('Улов'), catches.length ? fmt.num(tripCatch(tr)) : null, tripKg(tr) ? `${fmt.num(Math.round(tripKg(tr) * 100) / 100)} ${t('кг')}` : null].filter(Boolean).join(' · '), h('div', {},
      catches.length ? h('div', { class: 'rows' }, catches.map((c) => row(
        `${c.species}${num(c.n) > 1 ? ` × ${fmt.num(c.n)}` : ''}`,
        [tripDays(tr) > 1 ? dayLabel(catchDate(tr, c)) : null, c.weight ? `${fmt.num(c.weight)} ${t('кг')}` : null, c.length ? `${fmt.num(c.length)} ${t('см')}` : null, baitText(c), c.released ? t('відпустив') : t('забрав')].filter(Boolean).join(' · '),
        '', () => catchForm(tr, c), { thumb: c.photoId ? thumbImg(c.photoId) : null }))) : h('p', { class: 'muted small' }, t('Без улову — теж запис.')),
      h('div', { class: 'btn-row' }, btn(t('+ Улов'), () => catchForm(tr), 'primary')))),
    box(t('Втрати й витрати'), h('div', {},
      losses.length || spends.length ? h('div', { class: 'rows' }, [
        ...losses.map((x) => row(gearTitle(x.g), [weightText(x.g), x.g.color, label(REASONS, x.reason)].filter(Boolean).join(' · '), `−${fmt.num(num(x.n) || 1)}`, () => gearDetail(x.g.id))),
        ...spends.map((x) => row(gearTitle(x.g), t('витрачено'), `−${fmt.num(x.n)} ${unitLabel(x.g)}`, () => gearDetail(x.g.id))),
      ]) : null,
      h('div', { class: 'btn-row' },
        btn(t('−1 Втратив'), () => pickConsumable(t('Що втратив'), (g) => g && pieces(g), (g) => lostOne(g, tr.id), tr)),
        btn(t('Витратив'), () => pickConsumable(t('Що витратив'), (g) => g && !pieces(g), (g) => spendSheet(g, tr.id), tr))))),
    box(photos.length ? `${t('Фото')} · ${photos.length}` : t('Фото'), h('div', {},
      photos.length ? h('div', { class: 'photo-strip' }, photos.map((pid) => h('button', { type: 'button', class: 'photo-btn', 'aria-label': t('Фото на весь екран'), onclick: () => showPhoto(pid, photos) }, h('img', { src: findPhoto(pid).thumb, alt: '' })))) : null,
      h('div', { class: 'btn-row' }, btn(t('+ Фото'), () => addTripPhoto(tr))))));
}

const baitText = (c) => (c.baitId ? (findGear(c.baitId) ? [gearTitle(findGear(c.baitId)), findGear(c.baitId).color].filter(Boolean).join(' ') : null) : c.bait) || null;

const BAIT_CHIPS = 6;

/**
 * «На що» в улові — один ряд чипів з мініатюрами: приманки цього виїзду (на що ловив, що втратив чи витратив),
 * найуловистіші, нещодавно втрачені; далі «Усі приманки» з пошуком і «Інше, впишу» — лише тоді з'являється поле тексту.
 * select лишається джерелом значення (схований), чипи його лише виставляють; onOther — показати поле тексту.
 */
function baitChips(select, baits, tr, onOther) {
  const field = select.closest('.field');
  field.hidden = true;
  const own = new Map();
  [...(tr.catches ?? [])].reverse().forEach((x, i) => { if (x.baitId && !own.has(x.baitId)) own.set(x.baitId, i); });
  [...tripLosses(tr.id), ...tripSpends(tr.id)].forEach(({ g }) => { if (!own.has(g.id)) own.set(g.id, own.size + 1000); });
  const recent = (g) => Math.max(0, ...[...(g.losses ?? []), ...(g.spends ?? [])].map((x) => Date.parse(x.date) || 0));
  const ranked = [...baits].sort((a, b) => (own.get(a.id) ?? 1e9) - (own.get(b.id) ?? 1e9) || caughtCount(b) - caughtCount(a) || recent(b) - recent(a) || byGroup(a, b));
  const name = (g) => (g.model ? [g.brand, g.model, sizeText(g)].filter(Boolean).join(' ') : gearTitle(g));
  const full = (g) => [gearTitle(g), weightText(g), g.color].filter(Boolean).join(' · ');
  const note = h('p', { class: 'muted small bait-note' });
  const wrap = h('div', { class: 'field bait-pick' }, h('span', { class: 'field-label' }, t('На що')));
  const set = (x) => { select.value = x; select.dispatchEvent(new Event('change')); paint(); };
  const paint = () => {
    const v = select.value;
    const g = findGear(v);
    const shown = ranked.slice(0, BAIT_CHIPS);
    if (g && !shown.includes(g)) shown.unshift(g);
    note.replaceChildren(...(g ? [full(g), caughtCount(g) ? h('span', { class: 'fish-count' }, icon('fish'), fmt.num(caughtCount(g))) : null].filter(Boolean)
      .flatMap((x, i) => (i ? [' · ', x] : [x])) : []));
    wrap.replaceChildren(wrap.firstChild, h('div', { class: 'chips bait-chips' },
      shown.map((x) => h('button', { type: 'button', class: x.id === v ? 'on' : '', onclick: () => set(x.id) },
        h('span', { class: 'bait-sw', 'aria-hidden': 'true' }, gearThumb(x)), h('span', {}, name(x)), x.color ? h('small', {}, x.color) : null)),
      ranked.length > shown.length ? h('button', { type: 'button', class: 'add', onclick: () => gearPickSheet(t('На що'), ranked, (x) => set(x.id)) },
        t('Усі приманки ({n})', { n: ranked.length })) : null,
      h('button', { type: 'button', class: v ? 'add' : 'on', onclick: () => { set(''); onOther?.(); } }, t('Інше, впишу'))),
    ...(g ? [note] : []));
  };
  field.after(wrap);
  paint();
}

/**
 * Вибір кількісної речі: лише те, що є (0 шт не втратиш); зверху — з цього виїзду (на що ловив, що вже втрачав чи брав),
 * далі що втрачали чи брали нещодавно, потім усе за розділами.
 */
function pickConsumable(title, fits, onPick, tr = null) {
  const list = state.gear.filter((g) => active(g) && isQty(g) && num(g.qty) > 0 && fits(g));
  if (!list.length) { toast(t('Немає підхожих речей')); return; }
  const here = new Set(tr ? [...(tr.catches ?? []).map((c) => c.baitId), ...tripLosses(tr.id).map((x) => x.g.id), ...tripSpends(tr.id).map((x) => x.g.id)].filter(Boolean) : []);
  const recent = (g) => Math.max(0, ...[...(g.losses ?? []), ...(g.spends ?? [])].map((x) => Date.parse(x.date) || 0));
  gearPickSheet(title, [...list].sort((a, b) => Number(here.has(b.id)) - Number(here.has(a.id)) || recent(b) - recent(a) || byGroup(a, b)), onPick);
}

/** Аркуш вибору речі з пошуком; sorted — у потрібному порядку. */
function gearPickSheet(title, sorted, onPick) {
  const search = h('input', { type: 'search', class: 'gear-search', placeholder: t('Пошук'), autocomplete: 'off' });
  const rows = h('div', { class: 'rows' });
  const paint = () => {
    const words = norm(search.value).split(/\s+/).filter(Boolean);
    rows.replaceChildren(...sorted.filter((g) => { const hs = haystack(g); return words.every((w) => hs.includes(w)); }).map((g) =>
      row(gearTitle(g), [weightText(g), g.color].filter(Boolean).join(' · '), qtyText(g), () => { close(); onPick(g); }, { thumb: gearThumb(g) })));
    if (thumbIo) dropGoneThumbs();
  };
  search.addEventListener('input', paint);
  paint();
  const close = sheet(title, h('div', {}, search, rows));
}

function catchForm(tr, c = null) {
  const baits = state.gear.filter((g) => active(g) && ['lures', 'feeder'].includes(groupOf(g)) && !['rodpod', 'makush'].includes(g.cat)).sort(byGroup);
  const f = form([
    { name: 'species', label: t('Риба'), value: c?.species, required: true, list: 'species-list', placeholder: t('Щука') },
    { name: 'n', label: t('Скільки'), type: 'number', value: c?.n ?? 1, half: true },
    { name: 'weight', label: t('Вага, кг'), type: 'number', value: c?.weight, half: true },
    { name: 'time', label: t('Коли'), type: 'time', value: c?.time ?? '', half: true },
    { name: 'baitId', label: t('На що'), type: 'select', value: c?.baitId ?? '',
      options: [['', t('— інше, впишу —')], ...sections().map(({ key: gk, name: gl }) => ({ group: gl, options: baits.filter((g) => groupOf(g) === gk).map((g) => [g.id, [gearTitle(g), weightText(g), g.color].filter(Boolean).join(' · ')]) }))] },
    { name: 'bait', label: t('Приманка чи насадка'), value: c?.bait, placeholder: t('напр. опариш + кукурудза') },
    { name: 'length', label: t('Довжина, см'), type: 'number', value: c?.length, half: true },
  ]);
  f.el.classList.add('trio');
  f.el.append(h('datalist', { id: 'species-list' }, allSpecies().map((x) => h('option', { value: x }))));
  const field = (name) => f.inputs[name].closest('.field');
  const baitField = field('bait');
  const lengthField = field('length');
  const fitBait = () => { baitField.hidden = Boolean(f.inputs.baitId.value); };
  f.inputs.baitId.addEventListener('change', fitBait);
  // Нова рибина — найчастіше на ту саму приманку, що й попередня в цьому виїзді
  if (!c) f.inputs.baitId.value = [...(tr.catches ?? [])].reverse().find((x) => findGear(x.baitId) && active(findGear(x.baitId)))?.baitId ?? '';
  const baitBlock = h('div', { class: 'form' }, field('baitId'), baitField);
  baitChips(f.inputs.baitId, baits, tr, () => requestAnimationFrame(() => f.inputs.bait.focus()));
  fitBait();
  let released = c?.released ?? true;
  const rel = chips([['1', t('Відпустив')], ['0', t('Забрав')]], released ? '1' : '0', (v) => { released = v === '1'; });
  rel.classList.add('segmented');
  // Виїзд на кілька днів — у який день упіймав; нова рибина — сьогодні, якщо сьогодні в межах виїзду
  const days = tripDays(tr) > 1 ? Array.from({ length: tripDays(tr) }, (_, i) => addDays(tr.date, i)) : [];
  let day = c ? catchDate(tr, c) : days.includes(today()) ? today() : (tr.catches ?? []).map((x) => catchDate(tr, x)).pop() ?? tr.date;
  const dayChips = days.length ? chips(days.map((d) => [d, dayLabel(d)]), day, (v) => { day = v; }) : null;
  if (dayChips && days.length <= 4) dayChips.classList.add('segmented');
  const pick = photoPicker(findPhoto(c?.photoId), { query: () => f.inputs.species.value.trim() });
  // Довжина й фото — на березі рідко: згорнуто, у заголовку — що вже є
  const moreSum = h('span', { class: 'fold-sum' });
  const paintMore = () => {
    const v = [f.inputs.length.value.trim() && `${f.inputs.length.value.trim()} ${t('см')}`, findPhoto(c?.photoId) ? t('фото') : null].filter(Boolean);
    moreSum.textContent = v.length ? v.join(' · ') : t('не вказано');
  };
  f.inputs.length.addEventListener('input', paintMore);
  paintMore();
  const more = formFold([t('Довжина й фото'), moreSum], h('div', {}, h('div', { class: 'form' }, lengthField), pick.el));
  more.open = Boolean(c?.length || c?.photoId);
  const close = sheet(c ? t('Змінити улов') : t('Новий улов'), h('div', { class: 'blocks-form' },
    f.el, h('p', { class: 'muted small form-note' }, t('Вага для кількох — разом')),
    dayChips ? [h('div', { class: 'field-label' }, t('День')), dayChips] : null,
    baitBlock, rel, more), {
    tools: c ? [toolBtn('delete', t('Видалити'), () => confirmSheet(t('Видалити улов «{name}»?', { name: c.species }), t('Скасувати не можна.'), t('Видалити'), async () => {
      close();
      await save(joinChanges(c.photoId ? dropPhotos([c.photoId]) : {}, { trips: { put: [{ ...findTrip(tr.id), catches: (findTrip(tr.id).catches ?? []).filter((x) => x.id !== c.id) }] } }));
    }), 'danger')] : [],
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      let photo;
      try { photo = await photoChanges(c, pick.value(), tr.id); } catch (err) { toast(err.message); return; }
      close();
      const rec = { ...(c ?? { id: db.uid() }), ...v, n: Math.max(1, num(v.n) || 1), baitId: v.baitId || null, bait: v.baitId ? '' : v.bait, released, photoId: photo.photoId, date: days.length ? day : null };
      const prev = catchRecords().get(v.species);
      const now = findTrip(tr.id);
      const catches = c ? (now.catches ?? []).map((x) => (x.id === c.id ? rec : x)) : [...(now.catches ?? []), rec];
      // Новий вид — у свій список, щоб наступного разу підказувався
      const own = prefs().species ?? [];
      const known = allSpecies().some((x) => x.toLowerCase() === v.species.toLowerCase());
      await save(joinChanges(photo.changes, { trips: { put: [{ ...now, catches }] } }, known ? {} : { prefs: { put: [{ ...prefs(), species: [...own, v.species] }] } }));
      // Рекорд — лише якщо був попередній і цей його побив (перша рибина виду — ще не подія)
      const nowBest = catchRecords().get(v.species);
      if (prev && nowBest?.c.id === rec.id && prev.c.id !== rec.id) toast(t('Новий рекорд: {s} — {w}!', { s: v.species, w: fishSize(rec) }));
    }, 'primary')],
  });
}

function addTripPhoto(tr) {
  const input = h('input', {
    type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
      const file = e.target.files[0];
      input.remove();
      if (!file) return;
      try {
        const p = await newPhoto(file, tr.id);
        const now = findTrip(tr.id);
        await save({ photos: p.photos, blobs: p.blobs, trips: { put: [{ ...now, photoIds: [...(now.photoIds ?? []), p.id] }] } });
      } catch (err) { toast(err.message); }
    },
  });
  document.body.append(input);
  input.click();
}

function removeTrip(tr) {
  confirmSheet(t('Видалити виїзд {date}?', { date: tripWhen(tr) }), t('Улов і фото виїзду буде видалено. Втрати снастей залишаться в їхній історії.'), t('Видалити'), async () => {
    const photos = [...(tr.photoIds ?? []), ...(tr.catches ?? []).map((c) => c.photoId)].filter(Boolean);
    await save(joinChanges(dropPhotos(photos), { trips: { del: [tr.id] } }));
    toast(t('Видалено'));
  });
}

// ---------- збори ----------

const findPack = (id) => (id ? byId(state.packs).get(id) : null);
const packKey = (it) => it.gearId ?? it.id;

/** Пункти збору по порядку обходу: за шляхом місця, де лежить річ; вільні пункти — наприкінці. */
function packItems(p) {
  return (p.items ?? []).map((it) => ({ it, g: findGear(it.gearId) }))
    .filter((x) => !x.it.gearId || x.g)
    .sort((a, b) => (a.g ? 0 : 1) - (b.g ? 0 : 1) || collate(a.g ? whereText(a.g) : '', b.g ? whereText(b.g) : '') || collate(a.g ? gearTitle(a.g) : a.it.text, b.g ? gearTitle(b.g) : b.it.text));
}

/** Виїзди за місяцями: [«Листопад 2026», [виїзди]] — у тому ж порядку, що й список. */
function byMonth(list) {
  const out = [];
  for (const tr of list) {
    const ym = tr.date.slice(0, 7);
    if (out.at(-1)?.[0] !== ym) out.push([ym, []]);
    out.at(-1)[1].push(tr);
  }
  return out.map(([ym, rows]) => {
    const m = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString(locale(), { month: 'long' });
    return [`${m.charAt(0).toUpperCase()}${m.slice(1)} ${ym.slice(0, 4)}`, rows];
  });
}

/** Збори — згорнутим рядком, як «Сезон» і «Рекорди»: шаблон «що беру» не має займати перший екран виїздів. */
function packBox() {
  const list = [...state.packs].sort((a, b) => collate(a.name, b.name));
  return fold('packs', `${t('Збори')} · ${list.length}`, h('div', {},
    list.length ? h('div', { class: 'rows' }, list.map((p) => {
      const items = packItems(p);
      const done = items.filter((x) => (p.checked ?? []).includes(packKey(x.it))).length;
      const low = items.filter((x) => x.g && isLow(x.g)).length;
      return row(p.name, [t('зібрано {d} з {n}', { d: done, n: items.length }), low ? t('мало: {n}', { n: low }) : null].filter(Boolean).join(' · '), '', () => packDetail(p.id), { cls: low ? 'low' : '' });
    })) : h('p', { class: 'muted small' }, t('Шаблон «що беру»: «Фідер на річці», «Щука з човна». Галочки, де що лежить і чого мало.')),
    h('div', { class: 'btn-row' }, btn(t('+ Збір'), () => packForm()))));
}

function packForm(p = null) {
  const f = form([{ name: 'name', label: t('Назва'), value: p?.name, required: true, placeholder: t('напр. Фідер на річці') }]);
  const close = sheet(p ? t('Змінити збір') : t('Новий збір'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const rec = { ...(p ?? { id: db.uid(), created: Date.now(), items: [], checked: [] }), name: f.values().name };
      close();
      await save({ packs: { put: [rec] } }, [rec.id]);
      if (!p) packDetail(rec.id);
    }, 'primary')],
  });
}

function packDetail(id) {
  const build = () => { const p = findPack(id); return p ? packBody(p) : null; };
  sheet(() => findPack(id)?.name, build(), {
    live: build,
    full: true,
    tools: [toolBtn('edit', t('Змінити'), () => packForm(findPack(id))),
      toolBtn('delete', t('Видалити'), () => confirmSheet(t('Видалити «{name}»?', { name: findPack(id).name }), t('Речі нікуди не дінуться — зникне лише список.'), t('Видалити'), () => save({ packs: { del: [id] } })), 'danger')],
  });
}

const savePack = (p, fields) => save({ packs: { put: [{ ...p, ...fields }] } }, [p.id]);

function packBody(p) {
  const items = packItems(p);
  const checked = new Set(p.checked ?? []);
  const toggle = (k) => { if (!checked.delete(k)) checked.add(k); savePack(p, { checked: [...checked] }); };
  const drop = async (k, name) => {
    await savePack(p, { items: (p.items ?? []).filter((it) => packKey(it) !== k), checked: [...checked].filter((x) => x !== k) });
    setUndo(t('Прибрано «{name}»', { name }), () => savePack(findPack(p.id), { items: p.items, checked: p.checked }));
  };
  const rods = items.filter((x) => x.g && groupOf(x.g) === 'rods').map((x) => x.g.id);
  return h('div', {},
    items.length ? h('p', { class: 'muted small' }, t('Зібрано {d} з {n} · по порядку місць, де лежить', { d: items.filter((x) => checked.has(packKey(x.it))).length, n: items.length })) : null,
    items.length ? h('div', { class: 'rows' }, items.map(({ it, g }) => {
      const k = packKey(it);
      const on = checked.has(k);
      return h('div', { class: `row slot pack-row${on ? ' done' : ''}${g && isLow(g) ? ' low' : ''}` },
        h('span', { class: 'row-main', role: 'checkbox', 'aria-checked': String(on), tabindex: '0', onclick: () => toggle(k), onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(k); } } },
          h('span', { class: 'row-title' }, h('span', { class: `box-check${on ? ' on' : ''}`, 'aria-hidden': 'true' }), g ? gearTitle(g) : it.text),
          g ? h('span', { class: 'muted small' }, [weightText(g), g.color, whereText(g), isQty(g) ? `${qtyText(g)}${isLow(g) ? ` — ${t('мало!')}` : ''}` : null].filter(Boolean).join(' · ')) : null),
        h('button', { type: 'button', class: 'btn quiet', 'aria-label': t('Прибрати «{name}» зі збору', { name: g ? gearTitle(g) : it.text }), onclick: () => drop(k, g ? gearTitle(g) : it.text) }, '×'));
    })) : h('p', { class: 'muted' }, t('Порожньо. Додайте речі зі снастей і вільні пункти — термос, стілець, ліхтарик.')),
    h('div', { class: 'btn-row' },
      btn(t('+ Річ'), () => pickGear(t('Додати до збору'), (g) => !(findPack(p.id)?.items ?? []).some((it) => it.gearId === g.id), (g) => savePack(findPack(p.id), { items: [...(findPack(p.id).items ?? []), { gearId: g.id }] }))),
      btn(t('+ Пункт'), () => textItemForm(p))),
    h('div', { class: 'btn-row' },
      checked.size ? btn(t('Скинути галочки'), () => savePack(p, { checked: [] })) : null,
      // Вид ловлі — з типів вудилищ у зборі: фідерний збір — «Фідер», а не те, що було минулого разу
      btn(t('Зібрав → виїзд'), () => tripForm(null, { gearIds: rods, kinds: [...new Set(rods.map((r) => findGear(r)?.rodType).filter((k) => KINDS.some(([x]) => x === k)))] }), 'primary')));
}

function textItemForm(p) {
  const f = form([{ name: 'text', label: t('Що взяти'), required: true, placeholder: t('напр. термос') }]);
  const close = sheet(t('+ Пункт'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Додати'), () => {
      if (invalidField(f)) return;
      close();
      const now = findPack(p.id);
      savePack(now, { items: [...(now.items ?? []), { id: db.uid(), text: f.values().text }] });
    }, 'primary')],
  });
}

/** Вибір будь-якої речі в наявності з пошуком; після вибору список лишається відкритим — додавати кілька поспіль. */
function pickGear(title, fits, onPick) {
  const search = h('input', { type: 'search', class: 'gear-search', placeholder: t('Пошук: назва, бренд, колір, місце…'), autocomplete: 'off' });
  const rows = h('div', { class: 'rows' });
  const paint = () => {
    const words = norm(search.value).split(/\s+/).filter(Boolean);
    rows.replaceChildren(...state.gear.filter((g) => active(g) && fits(g)).filter((g) => { const hs = haystack(g); return words.every((w) => hs.includes(w)); }).sort(byGroup)
      .map((g) => row(gearTitle(g), [weightText(g), g.color, whereText(g)].filter(Boolean).join(' · '), isQty(g) ? qtyText(g) : '',
        async () => { await onPick(g); paint(); }, { thumb: gearThumb(g) })));
  };
  search.addEventListener('input', paint);
  paint();
  sheet(title, h('div', {}, search, rows));
}

// ---------- сезон: ціна риболовлі ----------

/** Що коштував виїзд: втрачене й витрачене на ньому за ціною покупки + інші витрати (бензин, путівка). */
function tripCost(tr) {
  const lost = tripLosses(tr.id).reduce((s, x) => s + (num(x.n) || 1) * num(x.g.price), 0);
  const spent = tripSpends(tr.id).reduce((s, x) => s + num(x.n) * num(x.g.price), 0);
  const other = num(tr.cost);
  return { lost, spent, other, total: Math.round((lost + spent + other) * 100) / 100 };
}

function seasonBox() {
  const year = today().slice(0, 4);
  const trips = state.trips.filter((x) => x.date.startsWith(year));
  if (!trips.length) return null;
  const fish = trips.reduce((s, x) => s + tripCatch(x), 0);
  const kg = trips.reduce((s, x) => s + tripKg(x), 0);
  const onTrips = trips.reduce((s, x) => s + tripCost(x).total, 0);
  const gear = purchases().filter((x) => x.date.startsWith(year)).reduce((s, x) => s + x.amount, 0);
  const days = trips.reduce((s, x) => s + tripDays(x), 0);
  return fold('season', t('Сезон {y}: {n} виїздів · {f} риб', { y: year, n: trips.length, f: fmt.num(fish) }), h('div', {},
    kv([
      // Лише коли є виїзди на кілька днів — інакше днів стільки ж, скільки виїздів
      days > trips.length ? [t('Днів на воді'), fmt.num(days)] : null,
      [t('Улов'), [fmt.num(fish), kg ? `${fmt.num(Math.round(kg * 10) / 10)} ${t('кг')}` : null].filter(Boolean).join(' · ')],
      [t('На виїздах'), onTrips ? fmt.money(onTrips) : '—'],
      [t('Покупки снастей'), gear ? fmt.money(gear) : '—'],
      [t('Разом'), fmt.money(onTrips + gear)],
      fish ? [t('Ціна однієї рибини'), h('b', {}, fmt.money((onTrips + gear) / fish))] : null,
      fish && onTrips && gear ? [t('Без покупок'), fmt.money(onTrips / fish)] : null,
    ]),
    h('p', { class: 'muted small' }, t('На виїздах — втрачене й прикормка за ціною покупки плюс «Інші витрати» виїзду. Покупки — з карток снастей і «+ Купив».'))));
}

// ---------- рекорди ----------

/** Найбільша рибина кожного виду: за вагою, а якщо ваги немає ні в кого — за довжиною. Лише поштучні записи. */
function catchRecords() {
  const best = new Map();
  for (const tr of state.trips) {
    for (const c of tr.catches ?? []) {
      if ((num(c.n) || 1) !== 1 || !(num(c.weight) || num(c.length))) continue;
      const cur = best.get(c.species);
      const better = !cur || num(c.weight) > num(cur.c.weight) || (!num(c.weight) && !num(cur.c.weight) && num(c.length) > num(cur.c.length));
      if (better) best.set(c.species, { c, tr });
    }
  }
  return best;
}

const fishSize = (c) => [num(c.weight) ? `${fmt.num(c.weight)} ${t('кг')}` : null, num(c.length) ? `${fmt.num(c.length)} ${t('см')}` : null].filter(Boolean).join(' · ');

function recordsBox() {
  const best = [...catchRecords()].sort((a, b) => num(b[1].c.weight) - num(a[1].c.weight) || collate(a[0], b[0]));
  const year = today().slice(0, 4);
  const top = state.trips.filter((x) => x.date.startsWith(year) && tripCatch(x)).sort((a, b) => tripKg(b) - tripKg(a) || tripCatch(b) - tripCatch(a))[0];
  if (!best.length && !top) return null;
  return fold('records', `${t('Рекорди')} · ${best.length}`, h('div', {},
    best.length ? h('div', { class: 'rows' }, best.map(([sp, { c, tr }]) => row(`${sp} — ${fishSize(c)}`,
      [fmt.date(catchDate(tr, c)), tripTitle(tr), baitText(c)].filter(Boolean).join(' · '), '', () => tripDetail(tr.id)))) : null,
    top ? [h('div', { class: 'field-label' }, t('Найкращий виїзд сезону')),
      h('div', { class: 'rows' }, row(`${tripTitle(top)} · ${tripWhen(top)}`,
        [t('риб: {n}', { n: fmt.num(tripCatch(top)) }), tripKg(top) ? `${fmt.num(Math.round(tripKg(top) * 10) / 10)} ${t('кг')}` : null].filter(Boolean).join(' · '),
        '', () => tripDetail(top.id)))] : null));
}

// ---------- печиво з передбаченням ----------

// Печиво при запуску: як у Shooter's Log, ≈ раз на шість запусків; вимикається в «Вигляді» (рядок «Сценки при запуску»).
// Модуль сценки (js/scenes.js) вантажиться лише тоді, коли печиво справді показуємо.
const FORTUNE_OFF = 'fishing-log:fortune-off';
const FORTUNE_SOUND_OFF = 'fishing-log:fortune-sound-off'; // той самий ключ, що SOUND_OFF у scenes.js
const fortuneOn = () => recall(FORTUNE_OFF) !== '1';

/** Передбачення з власного журналу: давно не їздив, уловиста приманка, рекорд, мало приманок, коряга, котушка. */
function myFortunes() {
  const out = [];
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  const trips = [...state.trips].sort((a, b) => collate(b.date, a.date));
  if (trips[0]) {
    const days = Math.round((Date.parse(today()) - Date.parse(trips.map(tripEnd).sort().pop())) / 864e5);
    if (days >= 14) out.push(t('Вудки сумують: {n} дн. без виїзду. Вода чекає', { n: fmt.num(days) }));
  }
  const baits = new Map();
  for (const tr of state.trips) for (const c of tr.catches ?? []) {
    const g = findGear(c.baitId);
    if (g && active(g)) baits.set(g.id, (baits.get(g.id) ?? 0) + (num(c.n) || 1));
  }
  const [bestBait, caught] = [...baits].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (caught >= 3) out.push(t('Твоя найуловистіша — {name}. Не забудь її сьогодні', { name: gearTitle(findGear(bestBait)) }));
  const low = state.gear.filter(isLow);
  if (low.length) out.push(t('Запас «{name}» закінчується. Докупи, поки клює', { name: gearTitle(pickOne(low)) }));
  const records = [...catchRecords()];
  if (records.length) {
    const [sp, { c }] = pickOne(records);
    out.push(t('Твій рекорд — {sp}, {size}. Сьогодні він нервує', { sp: sp.toLowerCase(), size: fishSize(c) }));
  }
  const bySpot = new Map();
  for (const x of lossEntries()) {
    const sp = findSpot(findTrip(x.tripId)?.spotId);
    if (sp) bySpot.set(sp.name, (bySpot.get(sp.name) ?? 0) + x.n);
  }
  const [snagSpot, lost] = [...bySpot].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (lost >= 3) out.push(t('На «{spot}» коряга забрала вже {n} шт. Сьогодні вона відпочиває', { spot: snagSpot, n: fmt.num(lost) }));
  const good = state.spots.map((s) => ({ s, trips: spotTrips(s.id) })).filter((x) => x.trips.length >= 3)
    .map((x) => ({ ...x, rate: x.trips.reduce((n, tr) => n + tripCatch(tr), 0) / x.trips.length })).sort((a, b) => b.rate - a.rate)[0];
  if (good?.rate >= 1) out.push(t('Найкраще клює на «{spot}». Туди й їдь', { spot: good.s.name }));
  const reel = state.gear.find((g) => groupOf(g) === 'reels' && serviceDue(g));
  if (reel) out.push(t('Котушка {name} просить мастила. Кажуть, після цього краще клює', { name: gearTitle(reel) }));
  return out;
}

function playFortune(params) {
  return import('./scenes.js').then((m) => {
    m.setFortuneSource(myFortunes);
    return m.playFortune(params);
  }).catch((err) => toast(err.message));
}

/** При запуску: ?scene=fortune — показати одразу (перегляд); інакше — випадково, якщо ввімкнено. */
function fortuneOnStart(newsDue) {
  const q = new URLSearchParams(location.search);
  if (q.get('scene') === 'fortune') { playFortune(); return; }
  if (newsDue || !fortuneOn() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!state.gear.length && !state.trips.length) return;
  // Як у Shooter's Log: ≈ раз на 6 запусків, без паузи між показами
  if (Math.random() >= 1 / 6) return;
  setTimeout(() => playFortune(), 500);
}

// Панель сценок — лише для автора: вмикається на пристрої 7 тапами по Гомерчику за 3 с (як режим розробника в Android)
const SCENES_PANEL_KEY = 'fishing-log:scenes-panel';
let authorTaps = [];
// що показати в панелі: час доби й пора року ('' — як зараз)
const preview = { tod: '', season: '' };

/** Тап по аватару: щоразу кліпає, сьомий за 3 с перемикає панель сценок. */
function authorTap(e) {
  avatarHi(e);
  const now = Date.now();
  authorTaps = [...authorTaps.filter((x) => now - x < 3000), now];
  if (authorTaps.length < 7) return;
  authorTaps = [];
  const on = recall(SCENES_PANEL_KEY) !== '1';
  remember(SCENES_PANEL_KEY, on ? '1' : '');
  toast(on ? t('Сценки й передбачення — у «Вигляді»') : t('Сценки й передбачення сховано'));
  render();
}

/** Параметри перегляду: обраний час і пора року плюс те, що задає кнопка. */
const previewParams = (extra) => ({ ...(preview.tod ? { tod: preview.tod } : {}), ...(preview.season ? { season: preview.season } : {}), ...extra });

function scenesRow() {
  if (recall(SCENES_PANEL_KEY) !== '1') return null;
  const tod = chips([['', t('Зараз')], ['morning', t('Ранок')], ['day', t('День')], ['evening', t('Вечір')], ['night', t('Ніч')]], preview.tod, (v) => { preview.tod = v; });
  const season = chips([['', t('Зараз')], ['spring', t('Весна')], ['summer', t('Літо')], ['autumn', t('Осінь')], ['winter', t('Зима')]], preview.season, (v) => { preview.season = v; });
  return setRow('scenes', 'play', t('Сценки й передбачення'), '', [
    h('p', { class: 'muted small' }, t('Сховано від усіх: 7 тапів по Гомерчику в «Про застосунок» прибирають цей рядок.')),
    h('div', { class: 'field-label' }, t('Час доби')), tod,
    h('div', { class: 'field-label' }, t('Пора року')), season,
    h('div', { class: 'btn-row' },
      btn(t('Печиво'), () => playFortune(previewParams({ gold: false, event: null })), 'primary'),
      btn(t('Золоте'), () => playFortune(previewParams({ gold: true, own: null }))),
      btn(t('З журналу'), () => fortunesOwn()),
      btn(t('Усі передбачення'), fortunesSheet)),
    h('div', { class: 'field-label' }, t('Рідкісні події')),
    h('div', { class: 'btn-row' }, SCENE_EVENTS.map(([event, label]) =>
      btn(t(label), () => playFortune(previewParams({ gold: event !== 'tsunami', event, own: null })))))]);
}

// Події золотого печива й цунамі — для перегляду в панелі (ключі — EVENTS у scenes.js)
const SCENE_EVENTS = [['catfish', 'Сом'], ['beaver', 'Бобер'], ['drone', 'Дрон'], ['inspector', 'Рибпатруль'], ['fishrain', 'Рибний дощ'], ['tsunami', 'Цунамі']];

/** Печиво з передбаченням із журналу — якщо зараз нічого не складається, так і кажемо. */
function fortunesOwn() {
  const own = myFortunes();
  if (!own.length) { toast(t('Зараз з журналу нічого не складається')); return; }
  playFortune(previewParams({ gold: false, event: null, own: own[Math.floor(Math.random() * own.length)] }));
}

/** Усі передбачення списком: тап — це печиво зі сценкою. */
function fortunesSheet() {
  import('./scenes.js').then((m) => {
    m.setFortuneSource(myFortunes);
    const { plain, gold, own, events } = m.fortuneList();
    // own: null — щоб випадковий вибір не підмінив обране «своїм» передбаченням
    const part = (title, list, params) => [h('h3', { class: 'fortune-head' }, `${title} · ${fmt.num(list.length)}`),
      list.length
        ? h('ol', { class: 'fortune-list' }, list.map((text, i) => h('li', {},
          h('button', { type: 'button', onclick: () => playFortune(previewParams(params(text, i))) }, text))))
        : h('p', { class: 'muted' }, t('Зараз з журналу нічого не складається'))];
    sheet(t('Усі передбачення'), h('div', {},
      ...part(t('Звичайні'), plain, (_, i) => ({ gold: false, event: null, own: null, i })),
      ...part(t('Золоті'), gold, (_, i) => ({ gold: true, event: null, own: null, i })),
      ...events.flatMap((e) => part(e.title, e.list, (_, i) => ({ gold: e.key !== 'tsunami', event: e.key, own: null, i }))),
      ...part(t('З журналу'), own, (text) => ({ gold: false, event: null, own: text }))));
  }).catch((err) => toast(err.message));
}

/** Сценки при запуску — показувати чи ні; як у Shooter's Log, без подробиць, що саме буде: це сюрприз. */
function fortuneRow() {
  const sound = recall(FORTUNE_SOUND_OFF) !== '1';
  const row = chips([['on', t('Показувати')], ['off', t('Не показувати')]], fortuneOn() ? 'on' : 'off', (v) => { remember(FORTUNE_OFF, v === 'off' ? '1' : ''); render(); });
  row.classList.add('segmented');
  const snd = chips([['on', t('Зі звуком')], ['off', t('Без звуку')]], sound ? 'on' : 'off', (v) => { remember(FORTUNE_SOUND_OFF, v === 'off' ? '1' : ''); render(); });
  snd.classList.add('segmented');
  const value = fortuneOn() ? [t('Показувати'), sound ? null : t('без звуку')].filter(Boolean).join(' · ') : t('Не показувати');
  return setRow('fortune', 'spark', t('Сценки при запуску'), value, [
    h('p', { class: 'muted small' }, t('Маленькі сюрпризи, коли відкриваєте застосунок.')),
    row, fortuneOn() ? snd : null]);
}

// ---------- NFC-мітки ----------

/** Картка речі чи місця з мітки або посилання; запис могли видалити — тоді підказка. */
function openTagged(kind, id) {
  if (kind === 'item') {
    if (findGear(id)) gearDetail(id); else toast(t('Річ з мітки не знайдено — можливо, її видалено'));
  } else if (findPlace(id)) placeDetail(id); else toast(t('Місце з наклейки не знайдено'));
}

/** Дотик мітки, поки застосунок відкритий: посилання Fishing Log — одразу картка. */
function onNfcTag(urls) {
  for (const u of urls) {
    const m = /#(item|place)=([^&]+)$/.exec(u);
    if (m) { openTagged(m[1], decodeURIComponent(m[2])); return; }
  }
  toast(urls.length ? t('Мітка не з Fishing Log') : t('Мітка порожня. Запишіть її з картки речі: значок NFC угорі'));
}

/** Значок NFC натискали в цій сесії — після згортання читання відновлюється саме. */
let nfcWanted = false;

/** Слухати мітки; з кнопки — ще й підказати, що робити, і показати, чому не вийшло. */
async function nfcStart(fromButton = false) {
  try {
    await nfc.listen(onNfcTag);
    nfcWanted = true;
    document.querySelectorAll('.nfc-btn').forEach((b) => b.classList.add('on'));
    if (fromButton) toast(t('Піднесіть телефон до мітки'));
  } catch (err) {
    nfcWanted = false;
    document.querySelectorAll('.nfc-btn').forEach((b) => b.classList.remove('on'));
    if (fromButton) toast(err.name === 'NotAllowedError' ? t('Дозвольте NFC для цього сайту в налаштуваннях Chrome') : t('NFC недоступний: увімкніть його в налаштуваннях телефона'));
  }
}

/** Записати на мітку посилання: торкання мітки відкриватиме цю річ чи місце. */
function nfcWriteSheet(url, name) {
  const ctrl = new AbortController();
  const close = sheet(t('NFC-мітка'), h('div', { class: 'nfc-write' },
    h('div', { class: 'nfc-wave', 'aria-hidden': 'true' }, icon('nfc')),
    h('p', {}, t('Прикладіть мітку до задньої кришки телефона й потримайте секунду.')),
    h('p', { class: 'muted small' }, t('На мітку запишеться посилання на «{name}». Далі досить торкнутися її телефоном — відкриється ця картка, навіть коли застосунок закритий. Те, що було на мітці, буде замінено.', { name }))), {
    actions: [btn(t('Скасувати'), () => close())],
    onClose: () => ctrl.abort(),
  });
  nfc.writeUrl(url, ctrl.signal).then(() => {
    close();
    toast(t('Мітку записано: {name}', { name }));
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    close();
    toast(err.name === 'NotAllowedError' ? t('Дозвольте NFC для цього сайту в налаштуваннях Chrome')
      : err.name === 'NotSupportedError' ? t('Ця мітка не підходить для запису') : t('Не вдалося записати мітку: {e}', { e: err.message }));
  });
}

// ---------- наклейки з QR ----------

/** Адреса місця для QR: камера телефона відкриє застосунок одразу на цьому місці. */
const placeUrl = (p) => `${location.origin}${location.pathname}#place=${encodeURIComponent(p.id)}`;
/** Адреса речі — для NFC-мітки: телефон відкриє застосунок одразу на картці. */
const itemUrl = (g) => `${location.origin}${location.pathname}#item=${encodeURIComponent(g.id)}`;

function labelsSheet(list) {
  const sorted = [...list].sort((a, b) => collate(pathOf(a.id), pathOf(b.id)));
  const picked = new Set();
  const pick = h('div', { class: 'chips check' }, sorted.map((p) => h('button', {
    type: 'button', onclick: (e) => { if (!picked.delete(p.id)) picked.add(p.id); e.currentTarget.classList.toggle('on', picked.has(p.id)); },
  }, pathOf(p.id))));
  const close = sheet(t('Друк наклейок'), h('div', {},
    h('p', { class: 'muted small' }, t('Наклейка — на ящик чи тубус. QR камерою телефона відкриває місце: видно все, що всередині.')), pick), {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Друкувати'), async () => {
      const list2 = sorted.filter((p) => picked.has(p.id));
      if (!list2.length) { toast(t('Позначте хоча б одне місце')); return; }
      close();
      await printLabels(list2);
    }, 'primary')],
  });
}

async function printLabels(places) {
  const { default: qrcode } = await import('./vendor/qrcode.js');
  const qr = (text) => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const el = h('span', { class: 'label-qr' });
    el.innerHTML = q.createSvgTag({ cellSize: 1, margin: 2, scalable: true });
    return el;
  };
  const sheetEl = h('div', { id: 'labels' }, places.map((p) => h('div', { class: 'label' },
    h('span', { class: 'label-text' }, h('b', {}, p.name), p.parentId ? h('span', {}, pathOf(p.parentId)) : null),
    qr(placeUrl(p)))));
  document.getElementById('labels')?.remove();
  document.body.append(sheetEl);
  document.body.classList.add('printing');
  const done = () => { sheetEl.remove(); document.body.classList.remove('printing'); };
  window.addEventListener('afterprint', done, { once: true });
  window.print();
}

// ---------- хочу купити ----------

function wishRow(w) {
  return h('div', { class: 'row slot', dataset: { id: w.id } },
    h('button', { type: 'button', class: 'row-main', onclick: () => wishForm(w) },
      h('span', { class: 'row-title' }, w.name),
      h('span', { class: 'muted small' }, [w.price ? fmt.money(w.price) : null, w.note].filter(Boolean).join(' · '))),
    btn(t('Купив'), () => (findGear(w.gearId) ? buySheet(findGear(w.gearId), { onSaved: () => save({ wishes: { del: [w.id] } }) }) : gearForm(null, {
      preset: { name: w.name, price: w.price, buyDate: today(), note: [w.link, w.note].filter(Boolean).join('\n') },
      onSaved: () => save({ wishes: { del: [w.id] } }),
    })), 'quiet'));
}

function wishForm(w = null) {
  const f = form([
    { name: 'name', label: t('Що'), value: w?.name, required: true, placeholder: t('напр. Котушка Shimano Vanford 2500') },
    { name: 'link', label: t('Посилання'), value: w?.link, placeholder: 'https://' },
    { name: 'price', label: t('Орієнтовна ціна, грн'), type: 'number', value: w?.price },
    { name: 'note', label: t('Нотатка'), type: 'textarea', rows: 2, value: w?.note },
  ]);
  const close = sheet(w ? t('Хочу купити') : t('Нове бажання'), f.el, {
    tools: w ? [toolBtn('delete', t('Видалити'), () => confirmSheet(t('Видалити «{name}»?', { name: w.name }), '', t('Видалити'), async () => {
      close();
      await save({ wishes: { del: [w.id] } });
    }), 'danger')] : [],
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const rec = { ...(w ?? { id: db.uid(), created: Date.now() }), ...f.values() };
      close();
      await save({ wishes: { put: [rec] } }, [rec.id]);
    }, 'primary')],
  });
}

function wishBox() {
  const list = [...state.wishes].sort((a, b) => collate(a.name, b.name));
  const sum = list.reduce((s, w) => s + num(w.price), 0);
  return box([t('Хочу купити'), list.length || null, sum ? fmt.money(sum) : null].filter(Boolean).join(' · '),
    h('div', {}, list.length ? h('div', { class: 'rows' }, list.map(wishRow))
      : h('p', { class: 'muted small' }, t('Що придивилися: назва, посилання, ціна. «Купив» — одразу в снасті.')),
    h('div', { class: 'btn-row' }, btn(t('+ Бажання'), () => wishForm()))));
}

// ---------- докупити ----------

/**
 * Докупити — за розділами, як у «Снастях» (у магазині шукають за відділом, а не за брендом);
 * «у Хочу» — значком у рядку, а не словом, що забирало місце в назви.
 */
function restockBox() {
  const list = state.gear.filter(isLow).sort(byGroup);
  if (!list.length) return null;
  const restockRow = (g) => {
    const wished = state.wishes.some((w) => w.gearId === g.id);
    return h('div', { class: 'row slot low', dataset: { id: g.id } },
      h('button', { type: 'button', class: 'row-main', onclick: () => gearDetail(g.id) },
        h('span', { class: 'row-title' }, gearTitle(g)),
        h('span', { class: 'muted small' }, [weightText(g), g.color, t('лишилось {n}', { n: qtyText(g) })].filter(Boolean).join(' · '))),
      wished ? h('span', { class: 'wish-mark', title: t('у «Хочу»'), 'aria-label': t('у «Хочу»') }, '✓')
        : h('button', {
          type: 'button', class: 'icon-btn wish-add', 'aria-label': t('У «Хочу»: {name}', { name: gearTitle(g) }), title: t('У «Хочу»'),
          onclick: () => save({ wishes: { put: [{ id: db.uid(), created: Date.now(), gearId: g.id, price: g.price ?? null, name: [gearTitle(g), weightText(g), g.color].filter(Boolean).join(' · ') }] } }),
        }, '＋'));
  };
  const groups = sections().map((sec) => [sec, list.filter((g) => sectionOf(groupOf(g)).key === sec.key)]).filter(([, xs]) => xs.length);
  // Один розділ — без зайвої згортки
  const body = groups.length === 1 ? h('div', { class: 'rows' }, list.map(restockRow))
    : h('div', { class: 'gear-groups restock-groups' }, groups.map(([sec, xs]) => fold(`restock:${sec.key}`,
      sectionHead(sec.icon, sec.name, xs.length, 0, null, sectionColor(sec.color)), () => h('div', { class: 'rows' }, xs.map(restockRow)))));
  return box(`${t('Докупити')} · ${list.length}`, h('div', {}, body,
    h('p', { class: 'muted small restock-hint' }, t('«＋» праворуч — додати в «Хочу купити», ✓ — уже там.'))));
}

// ---------- втрати ----------

const PERIODS = [['month', 'Місяць'], ['season', 'Сезон'], ['all', 'Усе']];
let lossPeriod = PERIODS.some(([k]) => k === recall('fishing-log:loss-period')) ? recall('fishing-log:loss-period') : 'season';

/** Кожна втрата: «−1 Втратив» з карток і речі, списані цілими як «Втрачено». */
const lossEntries = () => state.gear.flatMap((g) => [
  ...(g.losses ?? []).map((x) => ({ g, date: x.date, n: num(x.n) || 1, reason: x.reason, tripId: x.tripId })),
  ...(g.status === 'lost' ? [{ g, date: g.statusDate, n: isQty(g) ? Math.max(1, num(g.qty)) : 1, whole: true }] : []),
]);

function lossBox() {
  const all = lossEntries();
  if (!all.length) return null;
  const from = lossPeriod === 'month' ? `${today().slice(0, 7)}-01` : lossPeriod === 'season' ? `${today().slice(0, 4)}-01-01` : '';
  const list = all.filter((x) => (x.date ?? '') >= from).sort((a, b) => collate(b.date, a.date));
  const c = chips(PERIODS.map(([k, l]) => [k, t(l)]), lossPeriod, (v) => { lossPeriod = v; remember('fishing-log:loss-period', v); render(); });
  c.classList.add('segmented');
  const byCat = new Map();
  for (const x of list) {
    const k = catOf(x.g.cat).name;
    const s = byCat.get(k) ?? { n: 0, sum: 0, unit: unitLabel(x.g) };
    s.n += x.n;
    s.sum += x.n * num(x.g.price);
    byCat.set(k, s);
  }
  const total = list.reduce((s, x) => s + x.n * num(x.g.price), 0);
  // Де обриваю найбільше: втрати з виїздів за водоймою
  const bySpot = new Map();
  for (const x of list) {
    const sp = findSpot(findTrip(x.tripId)?.spotId);
    if (sp) bySpot.set(sp.name, (bySpot.get(sp.name) ?? 0) + x.n);
  }
  return box([t('Втрати'), total ? fmt.money(total) : null].filter(Boolean).join(' · '), h('div', {}, c,
    list.length ? [
      kv([...byCat].sort((a, b) => b[1].n - a[1].n).map(([k, s]) => [k, `${fmt.num(s.n)} ${s.unit}${s.sum ? ` · ${fmt.money(s.sum)}` : ''}`])),
      bySpot.size ? [h('div', { class: 'field-label' }, t('Де обриваю найбільше')),
        kv([...bySpot].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => [k, `−${fmt.num(n)}`]))] : null,
      fold('loss-list', t('Що саме'), h('div', { class: 'rows' }, list.map((x) => row(gearTitle(x.g),
        [fmt.date(x.date), weightText(x.g), x.g.color, label(REASONS, x.reason), findSpot(findTrip(x.tripId)?.spotId)?.name, x.whole ? t('списано цілим') : null].filter(Boolean).join(' · '),
        `−${fmt.num(x.n)}`, () => gearDetail(x.g.id))))),
    ] : h('p', { class: 'muted small' }, t('За цей період втрат немає')),
    h('p', { class: 'muted small' }, t('Сума — за ціною покупки. Витрачена прикормка сюди не входить.'))));
}

// ---------- свої категорії ----------

function catsRow() {
  const own = prefs().cats ?? [];
  const f = form([
    { name: 'name', label: t('Назва'), required: true, half: true, placeholder: t('напр. Мормишки') },
    { name: 'group', label: t('Розділ'), type: 'select', half: true, options: sections().map((x) => [x.key, x.name]), value: 'lures' },
  ]);
  const drop = (c) => {
    if (state.gear.some((g) => g.cat === c.id)) { toast(t('Категорією користуються речі — спершу змініть їм категорію')); return; }
    save({ prefs: { put: [{ ...prefs(), cats: own.filter((x) => x.id !== c.id) }] } });
  };
  return setRow('cats', 'filter', t('Свої категорії'), own.length ? fmt.num(own.length) : '', [
    h('p', { class: 'muted small' }, t('Вбудовані категорії не змінюються; свої додаються в обраний розділ. Приманки й оснастка рахуються кількістю.')),
    own.length ? h('div', { class: 'rows' }, own.map((c) => h('div', { class: 'row slot' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name), h('span', { class: 'muted small' }, groupLabel(c.group))),
      btn(t('Видалити'), () => drop(c), 'quiet')))) : null,
    f.el,
    h('div', { class: 'btn-row' }, btn(t('Додати'), () => {
      if (invalidField(f)) return;
      const v = f.values();
      save({ prefs: { put: [{ ...prefs(), cats: [...own, { id: `c-${db.uid()}`, name: v.name, group: v.group }] }] } });
    }, 'primary'))]);
}

// ---------- налаштування: копія, імпорт, демо ----------

function download(name, content) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Файл — через «Поділитися» (на телефоні: Telegram, Диск…), де не вміє — завантаженням; false — скасували. */
async function offerFile(name, content, type, share = true) {
  if (share) {
    const file = new File([content], name, { type });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
  }
  download(name, new Blob([content], { type }));
  return true;
}

const BACKUP_KEY = 'fishing-log:backup-at';
const BACKUP_EVERY = 30;

async function exportData(share) {
  const payload = JSON.stringify({ app: 'fishing-log', format: 1, exportedAt: new Date().toISOString(), data: state }, null, 1);
  if (await offerFile(`fishing-log-${today()}.json`, payload, 'application/json', share)) remember(BACKUP_KEY, today());
}

/** Без Google Диска раз на місяць: дані лише на пристрої — нагадати зберегти копію. */
function backupReminder() {
  const own = db.DATA_STORES.reduce((n, s) => n + state[s].filter((x) => !/^(demo|st)-/.test(String(x.id))).length, 0);
  const last = [recall(BACKUP_KEY), recall('fishing-log:backup-reminded')].filter(Boolean).sort().pop();
  if (sync.enabled() || own < 10 || (last && addDays(last, BACKUP_EVERY) > today())) return;
  remember('fishing-log:backup-reminded', today());
  toast(t('Дані лише на цьому пристрої — збережіть копію'), { action: t('Зберегти'), onAction: () => exportData(true), reminder: true });
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); } catch { toast(t('Файл не схожий на JSON')); return; }
    importParsed(parsed);
  };
  reader.readAsText(file);
}

function importBtn() {
  const input = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { if (e.target.files[0]) importData(e.target.files[0]); } });
  return btn(t('Імпорт'), () => input.click());
}

function importChanges(data) {
  const validId = (id) => (typeof id === 'string' && id !== '') || Number.isFinite(id);
  return Object.fromEntries(db.STORES.map((s) => [s, { put: (data[s] ?? []).filter((x) => x && validId(x.id)) }]));
}

const isEmpty = () => !db.DATA_STORES.some((s) => state[s]?.length);

function importParsed(parsed) {
  const data = parsed?.data;
  if (parsed?.app !== 'fishing-log' || !data || !db.STORES.every((s) => !data[s] || Array.isArray(data[s]))) {
    toast(t('Це не файл Fishing Log'));
    return;
  }
  const count = db.DATA_STORES.reduce((s, k) => s + (data[k]?.length ?? 0), 0);
  const changes = importChanges(data);
  const merge = async () => { await db.mergeImport(changes); await refresh(); toast(t('Імпортовано')); };
  // база порожня — об'єднувати нічого: без шторки
  if (isEmpty()) { merge(); return; }
  const close = sheet(t('Імпорт'), h('div', {},
    h('p', {}, t('У файлі записів: {n}.', { n: count })),
    h('p', { class: 'muted small' }, t('«Об’єднати» — додасть нові записи й оновить ті, що у файлі новіші. «Замінити все» — спершу видалить поточні дані.')),
    sync.enabled() ? h('p', { class: 'muted small' }, t('Увімкнено синхронізацію: «Замінити все» замінить дані й на Google Диску, і на інших пристроях.')) : null), {
    actions: [
      btn(t('Скасувати'), () => close()),
      btn(t('Об’єднати'), () => { close(); merge(); }),
      btn(t('Замінити все'), () => {
        close();
        confirmSheet(t('Замінити всі дані?'), t('Поточні дані буде видалено. Спершу зробіть експорт, якщо вони потрібні.'), t('Замінити'), async () => {
          sync.markRestore(await db.replaceAll(changes));
          await refresh();
          toast(t('Дані замінено'));
        });
      }, 'danger'),
    ],
  });
}

async function loadDemo() {
  try {
    const res = await fetch('./demo.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    importParsed(await res.json());
  } catch {
    toast(t('Не вдалося завантажити демодані'));
  }
}

// ---------- синхронізація ----------

function syncTime(ms) {
  if (!ms) return t('ще не було');
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? t('сьогодні о {time}', { time: fmt.time(ms) })
    : `${fmt.date(new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10))} ${fmt.time(ms)}`;
}

function connectGoogle() {
  sync.connect().then(() => toast(t('Google Диск підключено'))).catch((err) => toast(err.message));
}

function syncBody() {
  const s = sync.status;
  const panel = h('div', { class: 'set-sub' });
  if (!sync.configured()) {
    panel.append(h('p', { class: 'muted small' }, t('Не налаштовано: у js/config.js не вказано Google Client ID.')));
  } else if (!sync.enabled()) {
    panel.append(
      h('p', { class: 'muted small' }, t('Дані зберігатимуться у файлі fishing-log.json на вашому Google Диску й збігатимуться на телефоні та комп’ютері. Застосунок бачить лише свої файли.')),
      h('div', { class: 'btn-row' }, btn(t('Підключити Google Диск'), connectGoogle, 'primary')));
  } else {
    panel.append(
      kv([[t('Акаунт'), s.email ?? '—'], [t('Остання'), syncTime(s.lastSync)], [t('Статус'), s.message || null]]),
      h('div', { class: 'btn-row' },
        s.state === 'auth' ? btn(t('Увійти в Google'), connectGoogle, 'primary') : btn(t('Синхронізувати'), () => sync.syncNow(), 'primary'),
        btn(t('Вимкнути'), () => confirmSheet(t('Вимкнути синхронізацію?'), t('Дані залишаться і на пристрої, і на Google Диску, просто перестануть обмінюватися.'), t('Вимкнути'), () => sync.disconnect()))));
  }
  return panel;
}

const CHIP = {
  idle: () => `☁ ✓ ${fmt.time(sync.status.lastSync)}`,
  syncing: () => '☁ ',
  offline: () => t('☁ офлайн'),
  auth: () => t('☁ увійти'),
  error: () => t('☁ помилка'),
};

function renderSyncChip(s) {
  const chip = $('sync-chip');
  chip.hidden = !CHIP[s.state];
  if (CHIP[s.state]) {
    chip.textContent = CHIP[s.state]();
    if (s.state === 'syncing') chip.append(h('span', { class: 'sync-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
    chip.className = `sync-chip ${s.state}`;
    chip.title = s.message || t('Синхронізація з Google Диском');
  }
  if (tab === 'settings') render();
}

function onSyncChip() {
  const { state: st, message } = sync.status;
  if (st === 'auth') connectGoogle();
  else if (st === 'offline') toast(t('Немає інтернету — синхронізація відбудеться, коли з’явиться зв’язок'));
  else if (st === 'error') { toast(message || t('Помилка синхронізації')); sync.syncNow(); } else sync.syncNow();
}

// ---------- тема й мова ----------

// Тема: auto — як у системі. Першу розстановку до малювання робить скрипт в index.html.
const THEMES = [['auto', 'Авто'], ['dark', 'Темна'], ['light', 'Світла'], ['lime', 'Лайм'], ['night', 'Нічна'], ['phosphor', 'Фосфор'], ['amber', 'Бурштин'], ['white', 'Білий фосфор']];
const SPECIAL_THEMES = ['night', 'phosphor', 'amber', 'white'];
const lightScheme = matchMedia('(prefers-color-scheme: light)');

function themePref() {
  const v = recall('fishing-log:theme');
  return THEMES.some(([k]) => k === v) ? v : 'auto';
}

/** Яскравість червоного в нічній темі, 20–100 %. */
function nightLevel() {
  const v = Number(recall('fishing-log:night-level'));
  return v >= 20 && v <= 100 ? v : 80;
}

// Фон під картками: темний набір — для «Темної» й «Лайму» (спільний вибір), світлий — для «Світлої», у спецрежимах немає
const BACKDROPS = {
  dark: [['waves', 'Хвилі'], ['map', 'Ізобати'], ['acc-lines', 'З акцентом'], ['plain', 'Без малюнка']],
  light: [['l-waves', 'Хвилі'], ['l-map', 'Ізобати'], ['l-acc-lines', 'З акцентом'], ['l-plain', 'Без малюнка']],
};
const bgFamily = (theme) => (theme === 'light' ? 'light' : theme === 'dark' || theme === 'lime' ? 'dark' : null);
const BG_KEY = { dark: 'fishing-log:bg', light: 'fishing-log:bg-light' };

function backdropPref(fam) {
  const list = BACKDROPS[fam];
  if (!list) return null;
  const v = recall(BG_KEY[fam]);
  return list.some(([k]) => k === v) ? v : list[0][0];
}

function applyTheme() {
  const pref = themePref();
  const theme = pref === 'auto' ? (lightScheme.matches ? 'light' : 'dark') : pref;
  document.documentElement.dataset.theme = theme;
  const bg = backdropPref(bgFamily(theme));
  if (bg && !bg.endsWith('plain')) document.documentElement.dataset.bg = bg; else delete document.documentElement.dataset.bg;
  const k = nightLevel() / 100;
  document.querySelector('#night-red feColorMatrix')?.setAttribute('values',
    `${(0.5 * k).toFixed(3)} ${(0.6 * k).toFixed(3)} ${(0.1 * k).toFixed(3)} 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0b1d26');
}

lightScheme.addEventListener('change', applyTheme);

// ---------- що нового ----------

const SEEN_KEY = 'fishing-log:seen-version';
const allChanges = () => import('./changelog.js').then((m) => m.CHANGES);
const verParts = (v) => String(v).split('.').map(Number);

/** a новіша за b (версії виду 0.1.0). */
function newer(a, b) {
  const [x, y] = [verParts(a), verParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

function changesSheet(list) {
  const close = sheet(t('Що нового'), h('div', {}, list.map((c) => box(`${c.v} · ${fmt.date(c.date)}`,
    h('ul', { class: 'changes' }, (c[lang()] ?? c.uk).map((x) => h('li', {}, x)))))),
  { actions: [btn(t('Зрозуміло'), () => close(), 'primary')] });
}

function showNews() {
  const seen = recall(SEEN_KEY);
  remember(SEEN_KEY, self.APP_VERSION);
  if (!seen || !newer(self.APP_VERSION, seen)) return;
  allChanges().then((all) => {
    const list = all.filter((c) => newer(c.v, seen));
    if (list.length) changesSheet(list);
  }).catch(() => {});
}

async function checkUpdate() {
  if (!('serviceWorker' in navigator)) { toast(t('Оновлення працюють лише через https')); return; }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { toast(t('Застосунок ще не встановлено як офлайн-копію')); return; }
  if (!navigator.onLine) { toast(t('Немає зв’язку із сервером')); return; }
  toast(t('Перевіряю оновлення…'));
  try {
    const res = await fetch('./version.js', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    await reg.update();
  } catch {
    toast(t('Немає зв’язку із сервером'));
    return;
  }
  if (reg.installing || reg.waiting) toast(t('Є нова версія — натисніть «Оновити» вгорі'));
  else toast(t('У вас найновіша версія'));
}

// ---------- налаштування ----------

const SET_OPEN_KEY = 'fishing-log:set-open';

function settingsGroup(title, items) {
  const list = items.filter(Boolean);
  return list.length ? h('fieldset', { class: 'box settings-group' }, h('legend', {}, title), list) : null;
}

/** Рядок налаштувань: іконка, назва й поточне значення; тап розгортає керування. Відкритий — один. */
function setRow(key, ico, title, value, body, { tone = '', danger = false } = {}) {
  const open = recall(SET_OPEN_KEY) === key;
  const el = h('div', { class: `set-row${open ? ' open' : ''}${danger ? ' danger' : ''}`, dataset: { key } });
  const head = h('button', {
    type: 'button', class: 'set-head', 'aria-expanded': String(open), onclick: () => {
      const opening = !el.classList.contains('open');
      document.querySelectorAll('.set-row.open').forEach((r) => setOpen(r, false));
      setOpen(el, opening);
      remember(SET_OPEN_KEY, opening ? key : '');
    },
  }, toolIcon(ico), h('span', { class: 'set-title' }, title),
  h('span', { class: `set-val${tone ? ` ${tone}` : ''}` }, value), h('span', { class: 'set-chev', 'aria-hidden': 'true' }, '›'));
  el.append(head, h('div', { class: 'set-body', inert: !open }, h('div', { class: 'set-inner' }, h('div', { class: 'set-pane' }, body))));
  return el;
}

function setOpen(el, open) {
  el.classList.toggle('open', open);
  el.querySelector('.set-head').setAttribute('aria-expanded', String(open));
  el.querySelector('.set-body').inert = !open;
}

function shortWhen(ms) {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? fmt.time(ms)
    : fmt.date(new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
}

function syncRow() {
  const s = sync.status;
  const on = sync.configured() && sync.enabled();
  const bad = on && (s.state === 'auth' || s.state === 'error');
  const value = !sync.configured() ? t('Не налаштовано') : !on ? t('Вимкнено')
    : s.state === 'auth' ? t('Увійти') : s.state === 'error' ? t('Похибка') : s.state === 'offline' ? t('Офлайн')
      : s.lastSync ? shortWhen(s.lastSync) : t('Ще не було');
  return setRow('sync', 'cloud', t('Google Диск'), value, syncBody(), { tone: bad ? 'bad' : on ? 'ok' : '' });
}

function backupRow() {
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; } });
  const last = recall(BACKUP_KEY);
  return setRow('backup', 'save', t('Резервна копія'), last ? fmt.date(last) : t('Ще не було'), [
    h('p', { class: 'muted small' }, sync.enabled()
      ? t('Основна копія — на Google Диску. Файл нижче — додатковий знімок про всяк випадок.')
      : t('Без синхронізації дані зберігаються лише на цьому пристрої. Час від часу зберігайте копію — наприклад, «Поділитися» → Google Диск або Telegram «Збережене».')),
    h('p', { class: 'muted small' }, t('У файл копії потрапляють лише мініатюри фото. «Імпорт» приймає й стартовий набір (starter.json).')),
    h('div', { class: 'btn-row' },
      btn(t('Поділитися копією'), () => exportData(true), 'primary'),
      btn(t('Завантажити файл'), () => exportData(false)),
      btn(t('Імпорт'), () => fileInput.click())),
    fileInput]);
}

// ---------- експорт у Марнотрат ----------

const round2 = (n) => Math.round(num(n) * 100) / 100;

/**
 * Покупки: перша (з картки) і кожна «+ Купив» — { id, date, amount, n, g }. id сталі, тож повторний імпорт у Марнотрат не дублює.
 * Речі, заведені до 0.5.0, без firstBuy: ціна × кількість на дату покупки з картки, якщо докупівель ще не було.
 */
function purchases() {
  return state.gear.flatMap((g) => {
    const first = g.firstBuy ?? (!g.buys?.length && g.price && g.buyDate ? { date: g.buyDate, n: isQty(g) ? Math.max(1, num(g.qty)) : 1, price: g.price } : null);
    return [
      ...(first ? [{ id: `${g.id}-0`, date: first.date, n: first.n, amount: round2(num(first.n) * num(first.price)), g }] : []),
      ...(g.buys ?? []).map((b, i) => ({ id: `${g.id}-b${i}`, date: b.date, n: b.n, amount: round2(num(b.n) * num(b.price)), g })),
    ].filter((x) => x.amount > 0 && x.date);
  });
}

/**
 * Копія у форматі Марнотрата для «Резервна копія → Додати до наявних»: { app: 'marnotrat', coins, ops }.
 * Монети зливаються за видом і назвою (наявні «Готівка» й «Риболовля» беруться ті самі), операції з відомим id пропускаються.
 */
function marnotratFile(list, accName, catName) {
  const coin = (id, kind, name, icon, order) => ({ id, kind, name, icon, currency: 'UAH', budget: 0, start: 0, order, archived: false });
  const acc = coin('fishing-log-account', 'account', accName, 'wallet', 0);
  const cat = coin('fishing-log-category', 'expense', catName, 'fish', 1);
  const ops = list.map((x, i) => ({
    id: `fishing-log-${x.id}`, from: acc.id, to: cat.id, amount: x.amount, date: x.date, tags: [],
    comment: `${gearTitle(x.g)}${num(x.n) > 1 ? ` × ${fmt.num(x.n)}` : ''}`.slice(0, 200), created: Date.now() + i,
  }));
  return { app: 'marnotrat', version: `fishing-log ${self.APP_VERSION}`, exported: new Date().toISOString(), coins: [acc, cat], ops };
}

function marnotratRow() {
  const f = form([
    { name: 'from', label: t('Від'), type: 'dmy', value: `${today().slice(0, 4)}-01-01`, required: true, half: true },
    { name: 'to', label: t('До'), type: 'dmy', value: today(), required: true, half: true },
    { name: 'acc', label: t('Рахунок у Марнотраті'), value: recall('fishing-log:mn-acc') || 'Готівка', required: true, half: true },
    { name: 'cat', label: t('Категорія'), value: recall('fishing-log:mn-cat') || 'Риболовля', required: true, half: true },
  ]);
  return setRow('marnotrat', 'share', t('Експорт у Марнотрат'), '', [
    h('p', { class: 'muted small' }, t('Покупки за період — перша з картки речі й кожна «+ Купив» — витратами з рахунку в категорію. У Марнотраті: Резервна копія → файл → «Додати до наявних»; повторний імпорт не дублює.')),
    f.el,
    h('div', { class: 'btn-row' }, btn(t('Зберегти файл'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      const list = purchases().filter((x) => x.date >= v.from && x.date <= v.to).sort((a, b) => collate(a.date, b.date));
      if (!list.length) { toast(t('За цей період покупок немає')); return; }
      remember('fishing-log:mn-acc', v.acc);
      remember('fishing-log:mn-cat', v.cat);
      const file = JSON.stringify(marnotratFile(list, v.acc, v.cat), null, 1);
      if (await offerFile(`marnotrat-fishing-${v.from}-${v.to}.json`, file, 'application/json')) {
        toast(t('Покупок: {n}, разом {sum}', { n: list.length, sum: fmt.money(list.reduce((s, x) => s + x.amount, 0)) }));
      }
    }, 'primary'))]);
}

function demoRow() {
  return setRow('demo', 'play', t('Демодані'), '', [
    h('p', { class: 'muted small' }, t('Вигадані гараж і машина з ящиками, спінінг із котушкою й шнуром, фідерне, воблери, джиг, водойми й виїзди з уловом і погодою.')),
    h('div', { class: 'btn-row' }, btn(t('Завантажити демодані'), loadDemo))]);
}

function wipeRow() {
  return setRow('wipe', 'delete', t('Видалити дані з пристрою'), '',
    h('div', { class: 'btn-row' }, btn(t('Видалити дані з пристрою'), () => confirmSheet(t('Видалити дані з пристрою?'), sync.enabled()
      ? t('Дані буде видалено з цього пристрою. Копія на Google Диску залишиться й повернеться під час наступної синхронізації — щоб цього не сталося, спершу вимкніть синхронізацію.')
      : t('Снасті, місця, виїзди, збори, бажання й фото буде видалено з цього пристрою. Скасувати не можна.'), t('Видалити'), async () => {
      await db.clearAll(); await refresh(); toast(t('Дані видалено'));
    }), 'danger')),
    { danger: true });
}

/** Плитка-зразок теми: фон, кнопка акцентом і дві картки; спецрежими — тим самим фільтром, що й уся сторінка. */
function themeSwatch(k) {
  return h('span', { class: 'bg-sw theme-sw', dataset: { th: k }, 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
}

/** Тема — стрічкою плиток-зразків; застосовується, коли стрічка зупинилась, без перемальовування сторінки. */
function themeRow() {
  const night = h('label', { class: 'field night-level', hidden: themePref() !== 'night' }, h('span', {}, t('Яскравість червоного')),
    h('input', { type: 'range', min: '20', max: '100', step: '5', value: String(nightLevel()),
      oninput: (e) => { remember('fishing-log:night-level', e.target.value); applyTheme(); } }));
  const strip = pickStrip(THEMES.map(([k, label]) => [k, t(label), themeSwatch(k)]), themePref(), (v) => {
    remember('fishing-log:theme', v);
    applyTheme();
    row.querySelector('.set-val').textContent = t(THEMES.find(([k]) => k === v)[1]);
    night.hidden = v !== 'night';
    // Набір фонів залежить від теми (у спецрежимах його немає) — рядок «Фон» міняємо на місці
    const old = document.querySelector('.set-row[data-key="backdrop"]');
    const next = backdropRow();
    if (old && next) old.replaceWith(next);
    else if (old) old.remove();
    else if (next) row.after(next);
  }, { label: t('Тема'), live: false });
  const row = setRow('theme', 'palette', t('Тема'), t(THEMES.find(([k]) => k === themePref())[1]), [strip, night]);
  return row;
}

/** Фон під картками — плитки з самим фоном; гортаєш — фон міняється наживо. Набір — для поточної теми, у спецрежимах немає. */
function backdropRow() {
  const fam = bgFamily(document.documentElement.dataset.theme);
  const list = BACKDROPS[fam];
  if (!list) return null;
  const label = (k) => t(list.find(([x]) => x === k)[1]);
  const strip = pickStrip(list.map(([k, name]) => [k, t(name), h('span', { class: 'bg-sw', dataset: { bg: k }, 'aria-hidden': 'true' })]), backdropPref(fam), (v) => {
    remember(BG_KEY[fam], v);
    applyTheme();
    row.querySelector('.set-val').textContent = label(v);
  }, { label: t('Фон') });
  const row = setRow('backdrop', 'gallery', t('Фон'), label(backdropPref(fam)), [strip]);
  return row;
}

/** Довгий текст під розкриттям. */
const more = (title, node) => h('details', { class: 'ex-more' }, h('summary', {}, title), node);

// Кружка кави в куті портрета котика: пара — два завитки, що здіймаються й тануть
const CUP_SVG = '<svg viewBox="0 0 16 20" aria-hidden="true">'
  + '<path class="st" d="M6 8.5c-2-2 2-3 0-6"/><path class="st" d="M10 8.5c-2-2 2-3 0-6"/>'
  + '<path d="M3 10h9v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#f4f1ea" stroke="#3a2a1c"/>'
  + '<path d="M12 11.5h1.2a2 2 0 0 1 0 4H12" fill="none" stroke="#3a2a1c"/><ellipse cx="7.5" cy="10.4" rx="4" ry=".9" fill="#6b3f1f"/></svg>';

// Аватар автора кліпає: шар поверх фото (координати фото 233×233). Контур — білки очей, обведені з самого фото,
// тож повіки не заходять на обведення. Верхня повіка з опуклою кромкою опускається, нижня трохи підіймається
// назустріч; зімкнуті — на нижній третині ока, кромка лишається лінією вій. Праве око перше: ліве його перекриває.
const AVATAR_EYES = [
  { d: 'M114 63L114 65L117 71L117 78L121 78L122 77L126 77L127 76L132 76L135 79L137 79L139 77L140 72L141 71L141 68L140 67L140 64L135 59L131 57L122 57L118 59Z', box: [114, 57, 142, 80] },
  { d: 'M99 60L98 61L94 61L87 67L85 71L85 79L87 83L90 86L94 88L102 89L110 86L115 79L115 69L109 62Z', box: [85, 60, 116, 90] },
];
const AVATAR_SVG = '<svg viewBox="0 0 233 233" aria-hidden="true"><defs>'
  + AVATAR_EYES.map(({ d }, i) => `<clipPath id="av-eye${i}"><path d="${d}"/></clipPath>`).join('')
  + '</defs>'
  + AVATAR_EYES.map(({ box: [x0, y0, x1, y1] }, i) => {
    const h = y1 - y0, e = y0 + h * 0.6, k = h * 0.26, cx = (x0 + x1) / 2, l = x0 - 3, r = x1 + 3;
    const edge = `M${l} ${e}Q${cx} ${e + k} ${r} ${e}`;
    return `<g clip-path="url(#av-eye${i})" fill="#fcd901">`
      + `<path class="av-lid low" style="--o:${(y1 - e + 3).toFixed(1)}px" d="${edge}V${y1 + 3}H${l}Z"/>`
      + `<g class="av-lid" style="--o:-${(e + k - y0 + 3).toFixed(1)}px"><path d="M${l} ${y0 - 3}H${r}V${e}Q${cx} ${e + k} ${l} ${e}Z"/>`
      + `<path d="${edge}" fill="none" stroke="#1d1d1d" stroke-width="2.6" stroke-linecap="round"/></g></g>`;
  }).join('')
  + '</svg>';

/** Тап по аватару — кліпнути одразу, не чекаючи свого часу. */
function avatarHi(e) {
  const el = e.currentTarget;
  el.classList.remove('hi');
  void el.offsetWidth;
  el.classList.add('hi');
  clearTimeout(el.hiTimer);
  el.hiTimer = setTimeout(() => el.classList.remove('hi'), 600);
}

/** «Про застосунок» — як у Shooter’s Log: аватар автора, що кліпає, «На каву автору», як почати й де дані. */
function aboutPanel() {
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  return h('section', { class: 'panel about' },
    h('div', { class: 'about-head' },
      h('button', { type: 'button', class: 'about-avatar', 'aria-label': t('Автор — тапніть, щоб кліпнув'), onclick: authorTap },
        h('img', { src: './icons/author.jpg', alt: '', width: 64, height: 64, loading: 'lazy' }),
        Object.assign(h('span', { class: 'av-live' }), { innerHTML: AVATAR_SVG })),
      h('div', {}, h('h3', {}, 'Fishing Log'),
        h('p', { class: 'muted small' }, t('Версія {v} · збірка {b}', { v: self.APP_VERSION, b: self.APP_BUILD ?? '—' })))),
    h('p', { class: 'muted small about-desc' }, t('Рибальські снасті: що є й де лежить, виїзди з погодою й уловом, що втратив і що докупити. Працює без інтернету: усе зберігається на пристрої.')),
    h('div', { class: 'btn-row' }, btn(t('Перевірити оновлення'), () => checkUpdate()), btn(t('Що нового'), () => allChanges().then(changesSheet))),
    // Банка Монобанку — звичайне посилання, без сторонніх скриптів: CSP і обіцянка «дані нікуди не йдуть» лишаються
    h('a', { class: 'donate-card', href: 'https://send.monobank.ua/jar/XJKDMyVfW', target: '_blank', rel: 'noopener' },
      h('span', { class: 'donate-art' },
        h('span', { class: 'donate-cat' }, h('img', { src: './icons/cat-portrait.png', alt: '', width: 50, height: 50 }),
          Object.assign(h('span', { class: 'donate-cup' }), { innerHTML: CUP_SVG })),
        h('span', { class: 'donate-plate', 'aria-hidden': 'true' }, 'mono')),
      h('span', { class: 'donate-text' }, h('b', {}, t('На каву автору')), h('small', {}, t('Безкоштовно й без реклами — тримається на вашій підтримці'))),
      h('span', { class: 'donate-go', 'aria-hidden': 'true' }, '→')),
    more(t('Встановлення на телефон'), h('div', { class: 'muted small' },
      h('p', {}, t('Chrome → меню ⋮ → «Додати на головний екран» / «Установити застосунок». Після встановлення працює без інтернету, а в «Поділитися» з’явиться Fishing Log — так зручно передавати фото снастей.')),
      h('p', {}, t('iPhone: Safari → «Поділитися» → «На початковий екран». Відкривайте застосунок із цієї іконки, а не з вкладки Safari — інакше Safari може стерти дані сайту, якщо тиждень не заходити.')))),
    more(t('Де мої дані'), h('div', { class: 'muted small' },
      h('p', {}, t('Записи й фото лежать у браузері на цьому пристрої. Сервера застосунок не має, автор не отримує ні даних, ні статистики.')),
      h('p', {}, t('Погоду дає Open-Meteo — він отримує лише координати водойми й дату. Google Диск під’єднується за бажанням: копія лягає у ваш Диск, застосунок бачить лише свої файли.')),
      h('p', {}, t('Резервна копія — ⚙ → «Резервна копія». Вона ж переносить дані на інший пристрій через «Імпорт».')))),
    more(t('З чого почати'), h('ol', { class: 'ex-rules' },
      h('li', {}, t('«Місця» → «+»: гараж, шафа, ящик — вкладайте одне в одне.')),
      h('li', {}, t('Відкрийте місце й додавайте речі кнопкою «+ Річ сюди» — місце підставиться саме. «Зберегти й ще» — наступна одразу.')),
      h('li', {}, t('Приманкам і оснастці поставте поріг «мало» — що закінчується, з’явиться в «Склад» → «Покупки» → «Докупити».')),
      h('li', {}, t('«Місця» → «Друк наклейок»: QR на ящик відкриває його вміст камерою телефона.')),
      nfc.supported() ? h('li', {}, t('NFC-мітка: у картці речі значок NFC записує на мітку посилання. Торкнулися мітки телефоном — відкрилася ця річ.')) : null,
      h('li', {}, t('На риболовлі — «Виїзди» → «+»: улов, «−1 Втратив…»; погода підтягнеться сама, якщо в водойми є координати.')),
      h('li', {}, t('Хочете спершу подивитися — ⚙ → «Демодані». Перед своїми записами видаліть демо: ⚙ → «Видалити дані з пристрою».')))),
    h('nav', { class: 'about-links' },
      link('https://github.com/VitaliyLobko/fishing-log/issues/new', t('Повідомити про помилку')),
      link('https://github.com/VitaliyLobko/fishing-log', t('Код')),
      link('https://github.com/VitaliyLobko/fishing-log/blob/main/LICENSE', t('Ліцензія MIT'))));
}

/** Покупки: що закінчується, що хочу, що втратив і скільки це коштує, експорт витрат. */
function renderShop() {
  const lost = lossBox();
  const nothing = !state.gear.some(isLow) && !state.wishes.length && !lost;
  return h('div', { class: 'settings' },
    shopSwitch(),
    // «Хочу» — першим: його ведуть руками й він коротший за «Докупити»
    wishBox(),
    restockBox(),
    lost,
    nothing ? h('p', { class: 'muted small' }, t('Тут з’явиться, що закінчується (поріг «мало» в картці речі) і що втрачено.')) : null,
    settingsGroup(t('Витрати'), [marnotratRow()]));
}

function renderSettings() {
  // Те, по що заходять (копія, синхронізація, категорії), — першим; «Про застосунок» з версією — наприкінці, версія лише там
  return h('div', { class: 'settings' },
    settingsGroup(t('Дані'), [syncRow(), backupRow(), demoRow(), wipeRow()]),
    settingsGroup(t('Снасті'), [catsRow(), serviceRow(), aiRow()]),
    settingsGroup(t('Вигляд'), [themeRow(), backdropRow(), fortuneRow(), scenesRow()].filter(Boolean)),
    settingsGroup(t('Про застосунок'), [aboutPanel()]));
}

// ---------- навігація ----------

const VIEWS = {
  gear: { title: 'Снасті', render: renderGear, fab: () => gearForm() },
  trips: { title: 'Виїзди', render: renderTrips, fab: () => tripForm() },
  spots: { title: 'Водойми', render: renderSpots, fab: () => spotForm() },
  places: { title: 'Місця зберігання', render: renderPlaces, fab: () => placeForm() },
  shop: { title: 'Покупки', render: renderShop, fab: () => wishForm() },
  settings: { title: 'Налаштування', render: renderSettings },
};

function render() {
  const view = VIEWS[tab];
  $('title').textContent = t(view.title);
  $('subtitle').textContent = '';
  $('view').replaceChildren(view.render());
  if (thumbIo) dropGoneThumbs();
  $('fab').hidden = !view.fab || Boolean($('view').querySelector('.empty .btn.add'));
  $('fab').classList.remove('away');
  // Місця зберігання — друга половина вкладки «Склад»
  const navTab = tab === 'places' ? 'shop' : tab;
  // Вкладка внизу відкриває ту половину, де були востаннє; спершу — місця
  if (navTab === 'shop') remember(SHOP_SEG, tab);
  document.querySelector('.tabs a[data-tab="shop"]').setAttribute('href', `#${recall(SHOP_SEG) === 'shop' ? 'shop' : 'places'}`);
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === navTab));
  // Налаштування — не в нижньому меню, а шестернею вгорі (як у Shooter's Log); у них — «Назад» туди, звідки прийшли
  const gearBtn = $('settings-btn');
  gearBtn.classList.toggle('active', tab === 'settings');
  if (tab === 'settings' && !gearBtn.dataset.on) { gearBtn.classList.remove('play'); void gearBtn.offsetWidth; gearBtn.classList.add('play'); }
  gearBtn.dataset.on = tab === 'settings' ? '1' : '';
  $('back-btn').hidden = tab !== 'settings';
  $('back-btn').href = `#${backTab}`;
}

function route() {
  // QR з наклейки: #place=<id> — картка місця з усім, що всередині; адреса стає звичайною вкладкою
  const place = location.hash.match(/^#place=(.+)$/)?.[1];
  if (place) {
    history.replaceState(null, '', '#places');
    tab = 'places';
    render();
    const p = findPlace(decodeURIComponent(place));
    if (p) placeDetail(p.id); else toast(t('Місце з наклейки не знайдено'));
    return;
  }
  // NFC-мітка на речі: #item=<id> — картка речі поверх «Снастей»
  const item = location.hash.match(/^#item=(.+)$/)?.[1];
  if (item) {
    history.replaceState(null, '', '#gear');
    tab = 'gear';
    render();
    openTagged('item', decodeURIComponent(item));
    return;
  }
  const next = location.hash.slice(1);
  const to = VIEWS[next] ? next : 'gear';
  if (to === 'settings' && tab !== 'settings' && VIEWS[tab]) backTab = tab;
  tab = to;
  render();
  window.scrollTo(0, 0);
}

// ?go=… в адресі: shared — картинка, якою поділились у застосунок («Поділитися» → Fishing Log)
const SHORTCUTS = {
  shared: () => takeSharedImage().catch((err) => toast(err.message)),
};

/** Дія з ?go=…, а сам параметр прибираємо — оновлення сторінки не повторить її. */
function runShortcut() {
  const go = new URLSearchParams(location.search).get('go');
  if (!go) return;
  history.replaceState(history.state, '', location.pathname + location.hash);
  SHORTCUTS[go]?.();
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Локальна розробка: без worker і його кешу, щоб правки видно було одразу; офлайн перевіряти з ?sw
  if (['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname) && !new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    return;
  }
  const offer = (worker) => {
    $('update').hidden = false;
    $('update-btn').onclick = () => worker.postMessage('skipWaiting');
  };
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    reg.update().catch(() => {});
  }).catch((err) => console.warn('SW registration failed', err));
  // Перший візит: worker щойно взяв сторінку під контроль — це не оновлення, перезавантажувати нічого
  let controlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

applyStatic();
applyTheme();
$('fab').addEventListener('click', () => VIEWS[tab].fab?.());
let fabY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const end = y + innerHeight >= document.documentElement.scrollHeight - 40;
  if (Math.abs(y - fabY) < 12 && !end) return;
  $('fab').classList.toggle('away', y > fabY && y > 80 && !end);
  fabY = y;
}, { passive: true });
$('sync-chip').addEventListener('click', onSyncChip);
window.addEventListener('hashchange', route);
swipeStep(document.querySelector('.tabs'), (dir) => {
  const links = [...document.querySelectorAll('.tabs a')];
  const next = links[links.findIndex((a) => a.classList.contains('active')) + dir];
  if (next) goTab(next.getAttribute('href'));
  return Boolean(next);
});
if (window.visualViewport) {
  const placeTabs = () => {
    const vv = window.visualViewport;
    const gap = Math.round(document.documentElement.clientHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--vv-gap', `${gap > 0 && gap < 120 ? gap : 0}px`);
  };
  window.visualViewport.addEventListener('resize', placeTabs);
  window.visualViewport.addEventListener('scroll', placeTabs);
  placeTabs();
}
window.addEventListener('sync-applied', refresh);
window.addEventListener('unhandledrejection', (e) => {
  const err = e.reason;
  if (err?.name === 'AbortError') return;
  console.error(err);
  toast(err?.name === 'QuotaExceededError'
    ? t('Не збереглося: на пристрої скінчилося місце')
    : t('Помилка: {msg}', { msg: err?.message || String(err) }), { timeout: 9000 });
});
window.addEventListener('db-blocked', () => toast(t('Закрийте інші вкладки застосунку — база оновлюється')));
registerWorker();
navigator.storage?.persist?.().catch(() => {});
try {
  await load();
} catch (err) {
  window.removeEventListener('hashchange', route);
  $('fab').hidden = true;
  $('view').replaceChildren(h('div', { class: 'empty' },
    h('h3', {}, t('Не вдалося відкрити дані на пристрої')),
    h('p', { class: 'muted' }, err?.message || String(err)),
    btn(t('Спробувати ще раз'), () => location.reload(), 'primary')));
  throw err;
}
route();
runShortcut();
const newsDue = Boolean(recall(SEEN_KEY)) && newer(self.APP_VERSION, recall(SEEN_KEY));
showNews();
fortuneOnStart(newsDue);
setTimeout(backupReminder, 1500);
sync.onStatus(renderSyncChip);
// Увійшли в Google в іншому застосунку автора (Shooter's Log, «Вага»…) — Диск тут підключається сам
const googleFromOtherApp = () => {
  if (sync.autoConnect()) { toast(t('Google Диск підключено — вхід з іншого вашого застосунку')); sync.syncNow(); }
};
googleFromOtherApp();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') googleFromOtherApp(); });
// NFC: читання вмикає лише значок — сам scan() при вимкненому NFC показує вікно Chrome.
// Згорнули — читання зупиняється; повернулися — відновлюється, якщо значок уже натискали
if (nfc.supported()) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') nfc.stop(); else if (nfcWanted) nfcStart();
  });
}
sync.preload();
sync.syncNow();
