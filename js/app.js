// Fishing Log: рибальські снасті — що є й де лежить. Місця вкладаються одне в одне, речі лежать у місцях.
// Інфраструктура (база, синхронізація, шторки, теми, «Що нового») — з fpv-log; фото речі — як у shooting-log.
import * as db from './db.js';
import * as sync from './sync.js';
import { t, lang, setLang, LANGS, collate, applyStatic } from './i18n.js';
import { prepare as preparePhoto } from './photos.js';
import { h, fmt, sheet, refreshSheets, toast, form, chips, confirmSheet, toolBtn, toolIcon, goTab, confirmed, fieldError, setUndo, swipeStep } from './ui.js';

let state = { places: [], gear: [], wishes: [], photos: [], prefs: [] };
let tab = 'gear';

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

/** Група, що згортається; розгорнуту пам'ятає між запусками. */
function fold(key, title, body) {
  const el = h('details', { class: 'ex-more', open: recall(`fishing-log:open:${key}`) === '1' }, h('summary', {}, title), body);
  el.addEventListener('toggle', () => remember(`fishing-log:open:${key}`, el.open ? '1' : ''));
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

function thumbImg(photoId, fallback = '') {
  const p = findPhoto(photoId);
  return p ? h('img', { class: 'thumb', src: p.thumb, alt: '' }) : h('span', { class: 'thumb mono', style: '--h: 25' }, fallback);
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


const monogram = (name) => String(name ?? '').split(/[\s-]+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';

// ---------- дані ----------

const findGear = (id) => (id ? state.gear.find((x) => x.id === id) : null);
const findPlace = (id) => (id ? state.places.find((x) => x.id === id) : null);
const findPhoto = (id) => (id ? state.photos.find((x) => x.id === id) : null);
const prefs = () => state.prefs.find((p) => p.id === 'settings') ?? { id: 'settings' };

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
  ['feeder', 'Фідер'], ['boxes', 'Коробки й ящики'], ['clothes', 'Одяг'], ['other', 'Інше']];
const QTY_GROUPS = ['lures', 'tackle', 'feeder'];
const CATS = [
  ['rod', 'Вудилище', 'rods'], ['reel', 'Котушка', 'reels'], ['line', 'Шнур / волосінь', 'lines'],
  ['wobbler', 'Воблер', 'lures'], ['spoon', 'Блешня', 'lures'], ['soft', 'Силікон', 'lures'], ['fly', 'Мушка', 'lures'], ['lure', 'Інша приманка', 'lures'],
  ['hook', 'Гачки', 'tackle'], ['jighead', 'Джиг-головки', 'tackle'], ['sinker', 'Грузила', 'tackle'], ['swivel', 'Вертлюжки й застібки', 'tackle'],
  ['leader', 'Повідці', 'tackle'], ['tackle', 'Інша оснастка', 'tackle'],
  // четвертий елемент — виняток із правила групи: род-под у «Фідері», але поштучно
  ['cage', 'Годівниця', 'feeder'], ['groundbait', 'Прикормка / каша', 'feeder'], ['additive', 'Ароматика й добавки', 'feeder'],
  ['hookbait', 'Насадка', 'feeder'], ['rodpod', 'Род-под / підставки', 'feeder', 'unit'],
  ['box', 'Коробка / ящик', 'boxes'], ['clothes', 'Одяг', 'clothes'], ['sonar', 'Ехолот', 'other'], ['net', 'Підсак', 'other'], ['other', 'Інше', 'other'],
];
const groupLabel = (g) => t(GROUPS.find(([k]) => k === g)?.[1] ?? 'Інше');
/** Вбудовані категорії + свої (⚙ → Свої категорії). */
const allCats = () => [...CATS.map(([id, name, group, kind]) => ({ id, name: t(name), group, ...(kind ? { kind } : {}) })), ...(prefs().cats ?? [])];
const catOf = (id) => allCats().find((c) => c.id === id) ?? { id: 'other', name: t('Інше'), group: 'other' };
const groupOf = (g) => catOf(g.cat).group;
const qtyCat = (c) => (c.kind ? c.kind === 'qty' : QTY_GROUPS.includes(c.group));
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
const catOptions = () => GROUPS.map(([g, label]) => ({ group: t(label), options: allCats().filter((c) => c.group === g).map((c) => [c.id, c.name]) }));

const STATUS = { have: 'В наявності', lost: 'Втрачено', broken: 'Зламано', sold: 'Продано', gift: 'Подаровано' };
const ACTIONS = [['', '—'], ['xfast', 'Екстрашвидкий'], ['fast', 'Швидкий'], ['mod', 'Середній'], ['slow', 'Повільний']];
const ROD_TYPES = [['', '—'], ['spin', 'Спінінг'], ['feeder', 'Фідер'], ['float', 'Поплавок'], ['fly', 'Нахлист'], ['other', 'Інше']];
const label = (list, k) => (k ? t(list.find(([x]) => x === k)?.[1] ?? '') : '');
// Поля, що показуються лише для своєї групи
const GROUP_FIELDS = { rods: ['length', 'test', 'action', 'pieces', 'rodType'], reels: ['size', 'ratio', 'spools'], lines: ['pe', 'mm', 'length'] };
const SPEC_FIELDS = [...new Set(Object.values(GROUP_FIELDS).flat())];

const active = (g) => (g.status ?? 'have') === 'have';
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
      toast(t('У буфері немає картинки — скопіюйте зображення'));
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
      h('div', { class: 'photo-pick-acts' },
        btn(`🔍 ${t('Знайти фото')}`, search, 'mini'),
        h('div', { class: 'photo-pick-icons' },
          navigator.clipboard?.read ? toolBtn('paste', t('Вставити'), paste) : null,
          toolBtn('gallery', t('З галереї'), () => input.click()),
          src ? toolBtn('delete', t('Прибрати фото'), () => { file = null; removed = true; paint(); }, 'danger') : null)),
      navigator.clipboard?.read ? h('p', { class: 'muted small photo-pick-hint' },
        t('У Google: довгий тап на картинці → «Копіювати зображення» → тут'), ' ', toolIcon('paste')) : null,
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
let groupFilter = recall('fishing-log:group') ?? '';
let picking = null; // Set id — режим «Вибрати» для перенесення кількох речей

function gearRow(g) {
  const qty = isQty(g);
  const sub = [weightText(g), [g.brand, g.model].filter(Boolean).join(' '), g.color, active(g) ? whereText(g) : t(STATUS[g.status])].filter(Boolean).join(' · ');
  const el = row(gearTitle(g), sub, qty ? qtyText(g) : '',
    () => {
      if (!picking) { gearDetail(g.id); return; }
      if (!picking.delete(g.id)) picking.add(g.id);
      paintGear();
    }, { id: g.id, cls: [picking?.has(g.id) ? 'picked' : '', active(g) ? '' : 'gone', isLow(g) ? 'low' : ''].join(' '), thumb: thumbImg(g.photoId, monogram(gearTitle(g))) });
  return el;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[’ʼ`']/g, "'");
const haystack = (g) => norm([g.name, g.brand, g.model, g.color, g.note, catOf(g.cat).name, weightText(g), whereText(g)].join(' '));
const byGroup = (a, b) => GROUPS.findIndex(([k]) => k === groupOf(a)) - GROUPS.findIndex(([k]) => k === groupOf(b)) || collate(gearTitle(a), gearTitle(b));

function shownGear() {
  const words = norm(query).split(/\s+/).filter(Boolean);
  return state.gear
    .filter((g) => (groupFilter === 'gone' ? !active(g) : active(g) && (!groupFilter || groupOf(g) === groupFilter)))
    .filter((g) => { const hs = haystack(g); return words.every((w) => hs.includes(w)); })
    .sort(byGroup);
}

let gearList = null;

function paintGear() {
  if (!gearList?.isConnected) return;
  const list = shownGear();
  const bar = picking ? h('div', { class: 'pick-bar' },
    h('span', {}, t('Вибрано: {n}', { n: picking.size })),
    h('div', { class: 'btn-row' },
      btn(t('Скасувати'), () => { picking = null; render(); }),
      btn(t('Перенести'), () => {
        if (!picking.size) { toast(t('Позначте хоча б одну річ')); return; }
        placePicker(t('Куди перенести'), (placeId) => moveGear([...picking].map(findGear).filter(Boolean), placeId));
      }, 'primary'))) : null;
  gearList.replaceChildren(bar ?? '', list.length ? h('div', { class: 'rows' }, list.map(gearRow))
    : h('p', { class: 'muted' }, query ? t('Нічого не знайдено') : t('У цьому розділі порожньо')));
}

function renderGear() {
  const all = state.gear.filter(active);
  $('subtitle').textContent = all.length ? t('позицій: {n} · місць: {m}', { n: all.length, m: state.places.length }) : '';
  if (!state.gear.length) {
    return empty(t('Ще немає снастей'), t('Спершу заведіть місця (гараж, шафа, ящик), потім додавайте речі кнопкою «+». Або завантажте демодані в «Ще».'),
      [btn(t('Додати'), () => gearForm(), 'primary add'), btn(t('Місця'), () => goTab('#places'))]);
  }
  const groups = GROUPS.filter(([g]) => all.some((x) => groupOf(x) === g)).map(([g, l]) => [g, t(l)]);
  const gone = state.gear.some((g) => !active(g));
  if (groupFilter && !groups.some(([g]) => g === groupFilter) && !(groupFilter === 'gone' && gone)) groupFilter = '';
  const c = chips([['', t('Усі')], ...groups, ...(gone ? [['gone', t('Списані')]] : [])], groupFilter, (v) => { groupFilter = v; remember('fishing-log:group', v); paintGear(); });
  c.classList.add('cat-filter');
  const search = h('input', {
    type: 'search', class: 'gear-search', placeholder: t('Пошук: назва, бренд, колір, місце…'), 'aria-label': t('Пошук'), enterkeyhint: 'search', autocomplete: 'off',
    oninput: (e) => { query = e.target.value; paintGear(); },
  });
  search.value = query;
  gearList = h('div');
  const tools = h('div', { class: 'btn-row' }, picking ? null : btn(t('Вибрати кілька'), () => { picking = new Set(); render(); }, 'quiet'));
  const out = h('div', {}, search, c, tools, gearList);
  queueMicrotask(paintGear);
  return out;
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

function gearForm(g = null, { preset = null, file = null, onSaved = null } = {}) {
  const src = g ?? preset ?? {};
  const f = form([
    { name: 'name', label: t('Назва'), value: src.name, required: true, placeholder: t('напр. Воблер Jackall Squad Minnow 95') },
    { name: 'cat', label: t('Категорія'), type: 'select', options: catOptions(), value: src.cat ?? 'other' },
    { name: 'qty', label: t('Кількість'), type: 'number', value: src.qty ?? 1, half: true },
    { name: 'unit', label: t('Одиниця'), type: 'select', options: UNITS.map(([k, l]) => [k, t(l)]), value: src.unit ?? 'pcs', half: true },
    { name: 'low', label: t('Поріг «мало»'), type: 'number', value: src.low ?? 0, half: true, hint: t('Стільки й менше — у «Докупити»') },
    { name: 'weight', label: t('Вага, г'), type: 'number', value: src.weight, half: true },
    { name: 'placeId', label: t('Де лежить'), type: 'select', options: placeOptions(), value: src.placeId ?? '', half: true },
    { name: 'brand', label: t('Бренд'), value: src.brand, half: true },
    { name: 'model', label: t('Модель'), value: src.model, half: true },
    { name: 'color', label: t('Колір'), value: src.color, half: true },
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
    { name: 'price', label: t('Ціна, грн'), type: 'number', value: src.price, half: true, hint: t('Для кількісних — за одиницю') },
    { name: 'buyDate', label: t('Куплено'), type: 'dmy', value: src.buyDate, half: true },
    { name: 'note', label: t('Нотатка'), type: 'textarea', rows: 2, value: src.note },
    { name: 'specs', label: t('Характеристики'), type: 'textarea', rows: 3, value: src.specs, placeholder: t('Скопіюйте з сайту виробника чи магазину') },
  ]);
  // Поля, що стосуються категорії: кількість — для приманок, оснастки й фідерного, свої — для вудилищ, котушок, шнурів
  const fit = () => {
    const c = catOf(f.inputs.cat.value);
    const own = new Set([...(GROUP_FIELDS[c.group] ?? []), ...(qtyCat(c) ? ['qty', 'unit', 'low'] : []), ...(hasWeight(c) ? ['weight'] : [])]);
    for (const n of [...SPEC_FIELDS, 'qty', 'unit', 'low', 'weight']) f.inputs[n].closest('.field').hidden = !own.has(n);
  };
  f.inputs.cat.addEventListener('change', fit);
  fit();
  const lookup = () => [f.inputs.brand.value, f.inputs.model.value, f.inputs.name.value, f.inputs.color.value].map((x) => x.trim()).filter(Boolean)
    .filter((x, i, a) => !a.slice(0, i).some((y) => y.toLowerCase().includes(x.toLowerCase()))).join(' ');
  const pick = photoPicker(findPhoto(g?.photoId), {
    file, query: lookup,
    onSearch: () => remember(PHOTO_FOR, JSON.stringify({ gearId: g?.id ?? null, draft: g ? null : f.values() })),
  });
  f.inputs.specs.closest('.field').after(h('div', { class: 'specs-find' }, btn(`🔍 ${t('Характеристики')}`, () => {
    const q = lookup();
    if (!q) { toast(t('Спершу впишіть назву')); return; }
    window.open(`https://www.google.com/search?q=${encodeURIComponent(`${q} ${t('характеристики')}`)}`, '_blank', 'noopener');
  }, 'mini')));
  let busy = false; // фото обробляється, форма ще відкрита — другий тап по «Зберегти» не запише вдруге
  const store = async (again) => {
    if (invalidField(f)) return;
    const v = f.values();
    const c = catOf(v.cat);
    const keep = new Set(GROUP_FIELDS[c.group] ?? []);
    for (const n of SPEC_FIELDS) if (!keep.has(n)) delete v[n];
    if (!hasWeight(c)) delete v.weight;
    if (qtyCat(c)) { v.qty = Math.max(0, num(v.qty)); v.low = Math.max(0, num(v.low)); } else { v.qty = null; delete v.unit; delete v.low; }
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
    onSaved?.(rec);
    if (again) gearForm(null, { preset: { cat: rec.cat, placeId: rec.placeId, brand: rec.brand } });
  };
  const close = sheet(g ? t('Змінити') : t('Нова річ'), h('div', {}, pick.el, f.el), {
    actions: [btn(t('Скасувати'), () => close()), g ? null : btn(t('Зберегти й ще'), () => store(true)), btn(t('Зберегти'), () => store(false), 'primary')].filter(Boolean),
  });
}

function gearDetail(id) {
  const build = () => { const g = findGear(id); return g ? gearBody(g) : null; };
  sheet(() => gearTitle(findGear(id)), build(), {
    live: build,
    tools: [toolBtn('copy', t('Копіювати'), () => copyGear(findGear(id))), toolBtn('edit', t('Змінити'), () => gearForm(findGear(id))),
      toolBtn('delete', t('Видалити'), () => removeGear(findGear(id)), 'danger')],
  });
}

const link = (text, onclick) => h('button', { type: 'button', class: 'link-btn', onclick }, text);
const mountedOn = (g) => state.gear.filter((x) => x.onId === g.id);

function gearBody(g) {
  const photo = findPhoto(g.photoId);
  const host = findGear(g.onId);
  const group = groupOf(g);
  const qty = isQty(g);
  const where = host ? link(t('на «{name}»', { name: gearTitle(host) }), () => gearDetail(host.id))
    : g.placeId ? link(pathOf(g.placeId), () => placeDetail(g.placeId)) : t('без місця');
  // Що стоїть на вудилищі чи котушці: котушка й шнур на ній
  const chain = mountedOn(g).flatMap((x) => [x, ...mountedOn(x)]);
  const actions = [
    qty && pieces(g) ? btn(t('−1 Втратив'), () => lostOne(g), 'primary') : null,
    qty && !pieces(g) ? btn(t('Витратив'), () => spendSheet(g), 'primary') : null,
    qty ? btn(t('+ Купив'), () => buySheet(g)) : null,
    qty ? btn(t('Кількість'), () => qtySheet(g)) : null,
    btn(t('Перенести'), () => placePicker(t('Куди перенести'), (placeId) => moveGear([g], placeId))),
    group === 'reels' ? (host ? btn(t('Зняти з вудилища'), () => unmount(g)) : btn(t('На вудилище'), () => mountSheet(g, 'rods'))) : null,
    group === 'lines' ? (host ? btn(t('Змотати з котушки'), () => unmount(g)) : btn(t('Намотати на котушку'), () => mountSheet(g, 'reels'))) : null,
    active(g) ? btn(t('Списати'), () => statusSheet(g)) : btn(t('Повернути в наявні'), () => setStatus(g, 'have', t('Повернуто в наявні'))),
  ];
  return h('div', {},
    photo ? h('img', { class: 'item-photo', src: photo.thumb, alt: '', onclick: () => showPhoto(photo.id) }) : null,
    kv([
      [t('Категорія'), catOf(g.cat).name],
      [t('Де'), active(g) ? where : null],
      active(g) ? null : [t('Стан'), `${t(STATUS[g.status])}${g.statusDate ? ` · ${fmt.date(g.statusDate)}` : ''}`],
      qty ? [t('Кількість'), h('span', { class: isLow(g) ? 'warn-text' : '' }, `${qtyText(g)}${isLow(g) ? ` · ${t('докупити')}` : ''}`)] : null,
      qty && num(g.low) ? [t('Поріг «мало»'), `${fmt.num(g.low)} ${unitLabel(g)}`] : null,
      lostCount(g) ? [t('Втрачено'), `${fmt.num(lostCount(g))} ${unitLabel(g)}`] : null,
      [t('Вага'), weightText(g)],
      [t('Бренд'), g.brand], [t('Модель'), g.model], [t('Колір'), g.color],
      [t('Тип'), label(ROD_TYPES, g.rodType)], [t('Довжина'), g.length ? `${fmt.num(g.length)} ${t('м')}` : null], [t('Тест'), g.test ? `${g.test} ${t('г')}` : null],
      [t('Стрій'), label(ACTIONS, g.action)], [t('Колін'), g.pieces], [t('Розмір'), g.size], [t('Передавальне число'), g.ratio], [t('Запасних шпуль'), g.spools],
      [t('PE'), g.pe], [t('Діаметр'), g.mm ? `${fmt.num(g.mm)} ${t('мм')}` : null],
      host && group === 'lines' && g.onDate ? [t('Намотано'), fmt.date(g.onDate)] : null,
      [t('Ціна'), g.price ? fmt.money(g.price) : null], [t('Куплено'), g.buyDate ? fmt.date(g.buyDate) : null],
      [t('Нотатка'), g.note ? h('span', { class: 'pre' }, g.note) : null],
      [t('Характеристики'), g.specs ? h('span', { class: 'pre' }, g.specs) : null],
    ]),
    chain.length ? box(t('Стоїть'), h('div', { class: 'rows' }, chain.map((x) =>
      row(gearTitle(x), [catOf(x.cat).name, groupOf(x) === 'lines' && x.onDate ? t('намотано {date}', { date: fmt.date(x.onDate) }) : null].filter(Boolean).join(' · '), '', () => gearDetail(x.id), { thumb: thumbImg(x.photoId, monogram(gearTitle(x))) })))) : null,
    h('div', { class: 'btn-row' }, actions.filter(Boolean)),
    g.history?.length ? fold('gear-history', t('Історія'), historyList(g.history)) : null);
}

function historyList(list) {
  return h('ul', { class: 'changes' }, [...list].reverse().map((x) => h('li', {}, `${fmt.date(x.date)} — ${x.text}`)));
}

/** Та сама річ іншого кольору: копія без фото, історії й кольору. */
function copyGear(g) {
  const { id, photoId, history, created, updated, status, statusDate, onId, onDate, color, losses, buys, ...rest } = g;
  gearForm(null, { preset: rest });
}

/** Котушку — на вудилище, шнур — на котушку (з датою намотки). */
function mountSheet(g, hostGroup) {
  const hosts = state.gear.filter((x) => active(x) && groupOf(x) === hostGroup && x.id !== g.id).sort(byGroup);
  if (!hosts.length) { toast(hostGroup === 'rods' ? t('Спершу додайте вудилище') : t('Спершу додайте котушку')); return; }
  const f = form([
    { name: 'hostId', label: hostGroup === 'rods' ? t('Вудилище') : t('Котушка'), type: 'select', options: hosts.map((x) => [x.id, `${gearTitle(x)} · ${whereText(x)}`]) },
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
  c.classList.add('segmented');
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

/** «−1 Втратив»: одразу, без питань; причину можна дописати з тосту. */
async function lostOne(g) {
  if (!(num(g.qty) > 0)) { toast(t('Уже 0 — нічого втрачати')); return; }
  const entry = { id: db.uid(), date: today(), n: 1 };
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
function spendSheet(g) {
  const f = form([{ name: 'n', label: t('Скільки, {unit}', { unit: unitLabel(g) }), type: 'number', required: true }]);
  const close = sheet(t('Витратив'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const { n } = f.values();
      if (!(n > 0)) { fieldError(f.inputs.n, t('Більше нуля')); return; }
      close();
      await save({ gear: { put: [logged({ ...g, qty: Math.max(0, Math.round((num(g.qty) - n) * 1000) / 1000) }, t('Витрачено {n} {unit}', { n: fmt.num(n), unit: unitLabel(g) }))] } }, [g.id]);
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

function placeRows(parentId, depth) {
  return state.places.filter((p) => (p.parentId ?? null) === parentId).sort((a, b) => collate(a.name, b.name)).flatMap((p) => [
    (() => { const el = row(p.name, p.note || null, fmt.num(countIn(p.id)), () => placeDetail(p.id), { id: p.id, cls: 'tree-row' }); el.style.setProperty('--depth', depth); return el; })(),
    ...(depth < 20 ? placeRows(p.id, depth + 1) : []),
  ]);
}

function renderPlaces() {
  const loose = state.gear.filter((g) => active(g) && !placeOf(g));
  if (!state.places.length) {
    return empty(t('Ще немає місць'), t('Місця — це де лежать снасті: «Гараж → Шафа → Ящик Plano №2». Вкладайте одне в одне скільки завгодно.'),
      [btn(t('Додати'), () => placeForm(), 'primary add'), importBtn()]);
  }
  return h('div', {},
    h('div', { class: 'rows' }, placeRows(null, 0)),
    loose.length ? box(`${t('Без місця')} · ${loose.length}`, h('div', { class: 'rows' }, loose.sort(byGroup).map(gearRow))) : null,
    h('div', { class: 'btn-row' }, btn(t('Друк наклейок'), () => labelsSheet(state.places))));
}

function placeForm(p = null, { parentId = null, onSaved = null } = {}) {
  const f = form([
    { name: 'name', label: t('Назва'), value: p?.name, required: true, placeholder: t('напр. Ящик Plano №2') },
    { name: 'parentId', label: t('Усередині'), type: 'select', options: placeOptions(p ? subtree(p.id) : new Set()).map(([id, n]) => [id, id ? n : t('— верхній рівень —')]), value: p?.parentId ?? parentId ?? '' },
    { name: 'note', label: t('Нотатка'), type: 'textarea', rows: 2, value: p?.note },
  ]);
  const close = sheet(p ? t('Змінити') : t('Нове місце'), f.el, {
    actions: [btn(t('Скасувати'), () => close()), btn(t('Зберегти'), async () => {
      if (invalidField(f)) return;
      const v = f.values();
      const rec = { ...(p ?? { id: db.uid(), created: Date.now() }), ...v, parentId: v.parentId || null };
      close();
      await save({ places: { put: [rec] } }, [rec.id]);
      onSaved?.(rec);
    }, 'primary')],
  });
}

function placeDetail(id) {
  const build = () => { const p = findPlace(id); return p ? placeBody(p) : null; };
  sheet(() => findPlace(id)?.name, build(), {
    live: build,
    tools: [toolBtn('qr', t('Наклейка'), () => printLabels([findPlace(id)])), toolBtn('edit', t('Змінити'), () => placeForm(findPlace(id))),
      toolBtn('delete', t('Видалити'), () => removePlace(findPlace(id)), 'danger')],
  });
}

function placeBody(p) {
  const kids = state.places.filter((x) => x.parentId === p.id).sort((a, b) => collate(a.name, b.name));
  const items = state.gear.filter((g) => active(g) && placeOf(g) === p.id).sort(byGroup);
  return h('div', {},
    kv([[t('Шлях'), p.parentId ? pathOf(p.parentId) : null], [t('Нотатка'), p.note ? h('span', { class: 'pre' }, p.note) : null]]),
    h('div', { class: 'btn-row' },
      btn(t('+ Річ сюди'), () => gearForm(null, { preset: { placeId: p.id } }), 'primary'),
      btn(t('+ Вкладене місце'), () => placeForm(null, { parentId: p.id }))),
    kids.length ? box(t('Усередині'), h('div', { class: 'rows' }, kids.map((k) => row(k.name, k.note || null, fmt.num(countIn(k.id)), () => placeDetail(k.id))))) : null,
    items.length ? box(`${t('Речі')} · ${items.length}`, h('div', { class: 'rows' }, items.map(gearRow)))
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

// ---------- наклейки з QR ----------

/** Адреса місця для QR: камера телефона відкриє застосунок одразу на цьому місці. */
const placeUrl = (p) => `${location.origin}${location.pathname}#place=${encodeURIComponent(p.id)}`;

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
    h('span', { class: 'row-main', onclick: () => wishForm(w) },
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

function restockBox() {
  const list = state.gear.filter(isLow).sort(byGroup);
  if (!list.length) return null;
  return box(`${t('Докупити')} · ${list.length}`, h('div', { class: 'rows' }, list.map((g) => {
    const wished = state.wishes.some((w) => w.gearId === g.id);
    return h('div', { class: 'row slot low', dataset: { id: g.id } },
      h('span', { class: 'row-main', onclick: () => gearDetail(g.id) },
        h('span', { class: 'row-title' }, gearTitle(g)),
        h('span', { class: 'muted small' }, [weightText(g), g.color, t('лишилось {n}', { n: qtyText(g) })].filter(Boolean).join(' · '))),
      wished ? h('span', { class: 'muted small' }, t('у «Хочу»')) : btn(t('У «Хочу»'), () => save({
        wishes: { put: [{ id: db.uid(), created: Date.now(), gearId: g.id, price: g.price ?? null, name: [gearTitle(g), weightText(g), g.color].filter(Boolean).join(' · ') }] },
      }), 'quiet'));
  })));
}

// ---------- втрати ----------

const PERIODS = [['month', 'Місяць'], ['season', 'Сезон'], ['all', 'Усе']];
let lossPeriod = PERIODS.some(([k]) => k === recall('fishing-log:loss-period')) ? recall('fishing-log:loss-period') : 'season';

/** Кожна втрата: «−1 Втратив» з карток і речі, списані цілими як «Втрачено». */
const lossEntries = () => state.gear.flatMap((g) => [
  ...(g.losses ?? []).map((x) => ({ g, date: x.date, n: num(x.n) || 1, reason: x.reason })),
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
  return box([t('Втрати'), total ? fmt.money(total) : null].filter(Boolean).join(' · '), h('div', {}, c,
    list.length ? [
      kv([...byCat].sort((a, b) => b[1].n - a[1].n).map(([k, s]) => [k, `${fmt.num(s.n)} ${s.unit}${s.sum ? ` · ${fmt.money(s.sum)}` : ''}`])),
      fold('loss-list', t('Що саме'), h('div', { class: 'rows' }, list.map((x) => row(gearTitle(x.g),
        [fmt.date(x.date), weightText(x.g), x.g.color, label(REASONS, x.reason), x.whole ? t('списано цілим') : null].filter(Boolean).join(' · '),
        `−${fmt.num(x.n)}`, () => gearDetail(x.g.id))))),
    ] : h('p', { class: 'muted small' }, t('За цей період втрат немає')),
    h('p', { class: 'muted small' }, t('Сума — за ціною покупки. Витрачена прикормка сюди не входить.'))));
}

// ---------- свої категорії ----------

function catsRow() {
  const own = prefs().cats ?? [];
  const f = form([
    { name: 'name', label: t('Назва'), required: true, half: true, placeholder: t('напр. Мормишки') },
    { name: 'group', label: t('Розділ'), type: 'select', half: true, options: GROUPS.map(([k, l]) => [k, t(l)]), value: 'lures' },
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
  if (tab === 'more') render();
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

function switchLang(code) {
  setLang(code);
  applyStatic();
  renderSyncChip(sync.status);
  render();
}

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
  const el = h('div', { class: `set-row${open ? ' open' : ''}${danger ? ' danger' : ''}` });
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

function demoRow() {
  return setRow('demo', 'play', t('Демодані'), '', [
    h('p', { class: 'muted small' }, t('Вигадані гараж і машина з ящиками, спінінг із котушкою й шнуром, фідер, воблери, джиг і оснастка.')),
    h('div', { class: 'btn-row' }, btn(t('Завантажити демодані'), loadDemo))]);
}

function wipeRow() {
  return setRow('wipe', 'delete', t('Видалити дані з пристрою'), '',
    h('div', { class: 'btn-row' }, btn(t('Видалити дані з пристрою'), () => confirmSheet(t('Видалити дані з пристрою?'), sync.enabled()
      ? t('Дані буде видалено з цього пристрою. Копія на Google Диску залишиться й повернеться під час наступної синхронізації — щоб цього не сталося, спершу вимкніть синхронізацію.')
      : t('Снасті, місця, бажання й фото буде видалено з цього пристрою. Скасувати не можна.'), t('Видалити'), async () => {
      await db.clearAll(); await refresh(); toast(t('Дані видалено'));
    }), 'danger')),
    { danger: true });
}

function langRow() {
  const c = chips(Object.entries(LANGS), lang(), switchLang);
  c.classList.add('segmented');
  return setRow('lang', 'globe', 'Мова · Язык', LANGS[lang()], c);
}

function themeRow() {
  const themeChips = (special) => {
    const c = chips(THEMES.filter(([k]) => SPECIAL_THEMES.includes(k) === special).map(([k, label]) => [k, t(label)]), themePref(),
      (v) => { remember('fishing-log:theme', v); applyTheme(); render(); });
    c.classList.add('segmented');
    return c;
  };
  return setRow('theme', 'palette', t('Тема'), t(THEMES.find(([k]) => k === themePref())[1]), [
    themeChips(false),
    h('div', { class: 'field-label theme-group' }, t('Спецрежими')), themeChips(true),
    themePref() === 'night' ? h('label', { class: 'field night-level' }, h('span', {}, t('Яскравість червоного')),
      h('input', { type: 'range', min: '20', max: '100', step: '5', value: String(nightLevel()),
        oninput: (e) => { remember('fishing-log:night-level', e.target.value); applyTheme(); } })) : null]);
}

function backdropRow() {
  const fam = bgFamily(document.documentElement.dataset.theme);
  const list = BACKDROPS[fam];
  if (!list) return null;
  const now = backdropPref(fam);
  const c = chips(list.map(([k, label]) => [k, t(label)]), now, (v) => { remember(BG_KEY[fam], v); applyTheme(); render(); });
  c.classList.add('segmented');
  return setRow('backdrop', 'gallery', t('Фон'), t(list.find(([k]) => k === now)[1]), [c]);
}

function aboutPanel() {
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  return h('section', { class: 'panel about' },
    h('div', { class: 'about-head' },
      h('img', { src: './icons/icon-192.png', alt: '', width: 48, height: 48, class: 'app-icon big' }),
      h('div', {}, h('h3', {}, 'Fishing Log'),
        h('p', { class: 'muted small' }, t('Версія {v} · збірка {b}', { v: self.APP_VERSION, b: self.APP_BUILD ?? '—' })))),
    h('p', { class: 'muted small about-desc' }, t('Рибальські снасті: що є й де лежить. Працює без інтернету: усе зберігається на пристрої.')),
    h('div', { class: 'btn-row' }, btn(t('Перевірити оновлення'), () => checkUpdate()), btn(t('Що нового'), () => allChanges().then(changesSheet))),
    h('nav', { class: 'about-links' },
      link('https://github.com/VitaliyLobko/fishing-log/issues/new', t('Повідомити про помилку')),
      link('https://github.com/VitaliyLobko/fishing-log', t('Код')),
      link('https://github.com/VitaliyLobko/fishing-log/blob/main/LICENSE', t('Ліцензія MIT'))));
}

function renderSettings() {
  $('subtitle').textContent = t('версія {v}', { v: self.APP_VERSION });
  return h('div', { class: 'settings' },
    restockBox(),
    wishBox(),
    lossBox(),
    settingsGroup(t('Дані'), [syncRow(), backupRow(), demoRow(), wipeRow()]),
    settingsGroup(t('Снасті'), [catsRow()]),
    settingsGroup(t('Вигляд'), [langRow(), themeRow(), backdropRow()]),
    settingsGroup(t('Про застосунок'), [aboutPanel()]));
}

// ---------- навігація ----------

const VIEWS = {
  gear: { title: 'Снасті', render: renderGear, fab: () => gearForm() },
  places: { title: 'Місця', render: renderPlaces, fab: () => placeForm() },
  more: { title: 'Ще', render: renderSettings, fab: () => wishForm() },
};

function render() {
  const view = VIEWS[tab];
  $('title').textContent = t(view.title);
  $('subtitle').textContent = '';
  $('view').replaceChildren(view.render());
  $('fab').hidden = !view.fab || Boolean($('view').querySelector('.empty .btn.add'));
  $('fab').classList.remove('away');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
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
  const next = location.hash.slice(1);
  tab = VIEWS[next] ? next : 'gear';
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
showNews();
setTimeout(backupReminder, 1500);
sync.onStatus(renderSyncChip);
sync.preload();
sync.syncNow();
