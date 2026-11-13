// Печиво з передбаченням (≈ раз на кілька запусків): світанок на озері, кладка, на рибальському ящику — печиво.
// Дотик — печиво розламується, поплавок пірнає, з води вистрибує риба, з печива — записка з передбаченням.
// Малюнок — SVG у коді (офлайн, без файлів); рух — лише transform/opacity; модуль вантажиться ліниво з app.js.

import { t } from './i18n.js';

const f1 = (x) => Math.round(x * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Відтворюваний «випадок»: той самий seed — той самий малюнок (очерет, листя не стрибають між показами). */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function star(cx, cy, R, r) {
  let d = '';
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r : R;
    d += `${k ? 'L' : 'M'}${f1(cx + Math.cos(a) * rr)} ${f1(cy + Math.sin(a) * rr)}`;
  }
  return `${d}Z`;
}

const FORTUNES = [
  'Сьогодні клюватиме навіть на голий гачок',
  'Риба вже чекає. А ти ще п’єш каву',
  'Найбільша риба попереду. Головне — не забути підсак',
  'Поплавок пірне саме тоді, коли ти відвернешся',
  'Клювання буде. Правда, у сусіда',
  'Удача любить тих, хто вчасно міняє приманку',
  'На котушці сьогодні жодної бороди',
  'Коряга сьогодні відпочиває. Закидай сміливо',
  'Вітер у спину — клювання в руку',
  'Хто рано встає, той бачить туман над водою. І щуку',
  'Риба не знає, що ти новачок. Не кажи їй',
  'Незабаром ти купиш ще одну коробку воблерів. Так написано',
  'Твій трофей уже плаває десь поруч. Він трохи нервує',
  'Тиск стабільний, настрій теж',
  'Вузол сьогодні не розв’яжеться',
  'Наступний закид буде точно під кущ. А не в кущ',
  'Та, що зійшла, завжди була трофейною. Не засмучуйся',
  'Черв’яки сьогодні особливо апетитні',
  'Удача поруч — у третій коробці зліва',
  'Підсак сьогодні знадобиться. Перевір, чи він у машині',
  'Риба клює на терпіння. І трохи на опариша',
  'Сусід по березі попросить гачок. Дай, і він повернеться рибою',
  'Комарі сьогодні обрали іншого рибалку',
  'Новий воблер окупиться першою ж щукою. Можливо',
  'Сьогодні знайдеш загублену блешню. У своїй же кишені',
  'Карась сьогодні в гарному настрої',
  'Окунь уже зібрав зграю. Чекають на тебе',
  'Щука сьогодні голодна й неуважна',
  'Судак з цікавістю придивляється до твого джигу',
  'Короп обходить чужі прикормки. Твою — ні',
  'Не кажи «останній закид». Риба чує',
  'Уранці туман, удень клювання',
  'Удача сидить на кінчику вудилища. Не злякай',
  'До водойми дорога легка, назад — важка. Від улову',
  'Додому повернешся пізно. І не з порожнім садком',
  'Сьогодні скажеш правду про розмір риби. Ну, майже',
  'Рибу міряють від носа до хвоста. Розповіді — від ліктя до ліктя',
  'Шнур сьогодні не заплутається. Але це не точно',
  'Чай у термосі буде гарячим до вечора',
  'Дощ пройде стороною. Клювання — ні',
  'Тобі всміхнеться удача. І сом з-під коряги',
  'Перший закид — пробний. Другий — уловистий',
  'Бутерброд сьогодні не з’їси: буде ніколи',
  'Знайдеш нове місце. Нікому не кажи',
  'Головне в рибалці — не риба. Але з рибою краще',
  'Гачок сьогодні гострий. Пальцем не перевіряй',
  'Підсічка буде вчасною. Навіть із чашкою чаю в руці',
  'Найкраща риба клює, щойно відкриєш термос',
  'Хтось на березі спитає: «Ну що, клює?» Скажеш: «Клює!»',
  'Твоє місце сьогодні ніхто не займе',
  'Риба теж дивиться прогноз. Сьогоднішній їй подобається',
  'Закинь туди, де вчора зачепився. Там і риба',
  'У цьому печиві немає черв’яка. Перевірено',
  'Не рахуй сходи. Рахуй рибу',
  'Котушка сьогодні крутиться м’яко, як нова',
  'Тиша, туман, поплавок. Що ще треба',
  'Удома сьогодні скажуть: «Їдь, звісно»',
  'Риба є. Питання лише — де',
  'Прикормка збере всіх лящів округи',
  'Підкрути фрикціон: сьогодні буде сильна риба',
  'Улов сьогодні потрапить у журнал. І в розповіді друзям',
  'Волосінь сьогодні витримає більше, ніж обіцяє пачка',
  'Сонце сяде, а клювання тільки почнеться',
  'Найкращий час для рибалки — зараз. Збиратися треба було вчора',
  'Зачепів сьогодні буде менше, ніж приманок у коробці',
];
// Золоте печиво — рідкісне (≈ 1 з 20): з води вистрибує золота рибка
const GOLD_FORTUNES = [
  'Золота рибка! Загадай три бажання. Одне вже пішло на це печиво',
  'Рідкісне печиво: сьогодні буде трофей',
  'Одне на двадцять. Як і справжня риба тижня',
  'Сфотографуй це печиво, бо скажуть, що вигадав',
  'Сьогодні клюне з першого закиду',
  'Золота рибка просила передати: щука на десять кіло вже в дорозі',
  'Удача вже на гачку. Тільки не зірви',
];

// «Щасливі числа» по-рибальськи: гачок, волосінь, грузило, глибина
const LUCKY = [
  ['№2', '№4', '№6', '№8', '№10', '№12', '№14', '1/0', '2/0'],
  ['0,10 мм', '0,12 мм', '0,14 мм', '0,16 мм', '0,18 мм', '0,20 мм', '0,25 мм', '0,30 мм'],
  ['3 г', '5 г', '7 г', '10 г', '14 г', '21 г', '28 г'],
  ['1,5 м', '2 м', '2,5 м', '3 м', '4 м', '5 м', '6 м', '8 м'],
];

// Передбачення з власного журналу (app.js: давно не їздив, уловиста приманка, рекорд…) — уже готові рядки
let fortuneSource = () => [];
export function setFortuneSource(fn) { fortuneSource = fn; }

const SEASONS = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

/** Печиво на цей показ; ?gold=1 ?event=drone ?tsunami=1 ?own=1 ?season=winter ?tod=night ?i=5 — для перегляду. */
function fortuneParams() {
  const q = new URLSearchParams(location.search), hr = new Date().getHours();
  const tsunami = q.has('tsunami') ? q.get('tsunami') === '1' : rollTsunami(q);
  const gold = !tsunami && (q.has('gold') ? q.get('gold') === '1' : Math.random() < 1 / 20);
  // золоте: класична золота рибка або одна з подій, порівну
  const roll = [null, ...GOLD_EVENTS][Math.floor(Math.random() * (GOLD_EVENTS.length + 1))];
  const event = tsunami ? 'tsunami' : gold ? (q.has('event') ? (GOLD_EVENTS.includes(q.get('event')) ? q.get('event') : null) : roll) : null;
  const mine = gold || event ? [] : fortuneSource();
  const own = mine.length && (q.get('own') === '1' || Math.random() < 0.4) ? mine[Math.floor(Math.random() * mine.length)] : null;
  const list = listOf({ gold, event });
  return {
    gold, event, own, i: q.has('i') ? Number(q.get('i')) : Math.floor(Math.random() * list.length), n: 1 + Math.floor(Math.random() * 1e6),
    season: q.get('season') ?? SEASONS[new Date().getMonth()],
    tod: q.get('tod') ?? (hr >= 21 || hr < 5 ? 'night' : hr < 10 ? 'morning' : hr < 17 ? 'day' : 'evening'),
  };
}

/** Усі передбачення для перегляду в схованій панелі: звичайні, золоті й ті, що зараз складаються з журналу. */
export function fortuneList() {
  return {
    plain: FORTUNES.map((x) => t(x)), gold: GOLD_FORTUNES.map((x) => t(x)), own: fortuneSource(),
    events: Object.entries(EVENTS).map(([key, e]) => ({ key, title: t(e.title), list: e.fortunes.map((x) => t(x)) })),
  };
}

function fortuneText(p) {
  const list = listOf(p);
  return p.own ?? t(list[((p.i ?? 0) % list.length + list.length) % list.length]);
}

/**
 * Рядки записки: кожне речення — з нового рядка; довге — на стільки рядків, скільки треба для ~24 літер,
 * слова розкладено рівно. Прийменник чи сполучник (до 2 літер) не лишається в кінці рядка, тире — на початку.
 */
function fortuneLines(text) {
  const MAX = 24;
  const greedy = (words) => words.reduce((out, w) => {
    if (out.length && `${out[out.length - 1]} ${w}`.length <= MAX) out[out.length - 1] += ` ${w}`;
    else out.push(w);
    return out;
  }, []).length;
  const glue = (words) => words.reduce((out, w) => {
    const prev = out[out.length - 1];
    if (prev && (/^[—–-]$/.test(w) || (/^\p{L}{1,2}$/u.test(prev.split(' ').pop()) && !/[.,!?…:;]$/.test(prev)))) out[out.length - 1] = `${prev} ${w}`;
    else out.push(w);
    return out;
  }, []);
  const widest = (ls) => Math.max(...ls.map((l) => l.length));
  const split = (words, k) => {
    if (k <= 1) return [words.join(' ')];
    let best = null;
    for (let i = 1; i <= words.length - k + 1; i++) {
      const cand = [words.slice(0, i).join(' '), ...split(words.slice(i), k - 1)];
      if (!best || widest(cand) < widest(best)) best = cand;
    }
    return best;
  };
  return text.split(/(?<=[.!?…])\s+(?=[«"А-ЯІЇЄҐA-Z])/u).flatMap((s) => {
    const words = glue(s.split(' '));
    return split(words, Math.min(greedy(s.split(' ')), words.length));
  });
}

// печиво спереду: два рум'яні пелюстки, загнуті до середини, між ними — складка в тіні; світло зліва
const COOKIE_ART = '<path d="M180 334Q148 329 139 349Q133 366 145 374Q158 363 172 367Q177 350 180 334Z" fill="url(#fc-ckl)"/>'
  + '<path d="M180 334Q212 329 221 349Q227 366 215 374Q202 363 188 367Q183 350 180 334Z" fill="url(#fc-ckr)"/>'
  + '<path d="M172 367Q176 350 180 334Q184 350 188 367Q180 373 172 367Z" fill="url(#fc-ckm)"/>'
  + '<path d="M145 374Q133 366 139 349Q148 329 180 334Q212 329 221 349Q227 366 215 374" fill="none" stroke="#a0621c" stroke-width="1.6" opacity=".6"/>'
  + '<path d="M145 374Q158 363 172 367M188 367Q202 363 215 374" fill="none" stroke="#b5732a" stroke-width="1.2" opacity=".7"/>'
  + '<path d="M172 367Q176 350 180 334Q184 350 188 367" fill="none" stroke="#8a5216" stroke-width="1.1" opacity=".8"/>'
  + '<path d="M144 352Q151 337 170 336" stroke="#fff3cf" stroke-width="3.2" fill="none" stroke-linecap="round" opacity=".85"/>'
  + '<path d="M148 362Q150 356 154 352" stroke="#fff3cf" stroke-width="2" fill="none" stroke-linecap="round" opacity=".5"/>'
  + '<path d="M194 338Q209 340 214 349" stroke="#fde1a2" stroke-width="2" fill="none" stroke-linecap="round" opacity=".55"/>'
  + '<g fill="#a8681f" opacity=".35"><circle cx="152" cy="346" r=".8"/><circle cx="160" cy="352" r=".7"/><circle cx="148" cy="365" r=".8"/>'
  + '<circle cx="165" cy="342" r=".6"/><circle cx="163" cy="359" r=".7"/><circle cx="198" cy="347" r=".8"/><circle cx="206" cy="355" r=".7"/>'
  + '<circle cx="212" cy="364" r=".8"/><circle cx="200" cy="360" r=".6"/><circle cx="208" cy="343" r=".6"/></g>';

// Риба на виході з води (дивиться ліворуч, центр — 0,0): срібна або золота з короною
const FISH = (gold) => `<path d="M-18 0Q-9-9 5-7L15-12Q12-4 13 0Q12 4 15 12L5 7Q-9 9-18 0Z" fill="url(#fc-fish)"/>
  <path d="M-12-4Q-2-10 6-7" stroke="${gold ? '#b8860b' : '#5d7180'}" stroke-width="1.6" fill="none" opacity=".7"/>
  <path d="M-2 6l-4 6 7-4z" fill="${gold ? '#e0a820' : '#8a9caa'}"/><path d="M-1-6l3-6 4 5z" fill="${gold ? '#e0a820' : '#7d909e'}"/>
  <circle cx="-12" cy="-1.6" r="1.7" fill="#1d2228"/><circle cx="-12.5" cy="-2.2" r=".5" fill="#fff"/>
  ${gold ? '<path d="M-15-6l1-5 2 3 2-4 2 4 2-3 .4 5z" fill="#ffd84a" stroke="#b8860b" stroke-width=".6"/>' : ''}`;

// Час доби: небо, вода, ліс на тому березі, сонце/місяць [x, y, r, колір]; shade — затемнення переднього плану
const PAL = {
  morning: { sky: ['#9fb6d6', '#f4c6b4', '#fde3c2'], water: ['#e6d8cf', '#9fb3c6', '#5d7690'], forest: '#5a6d70', hills: '#8c9fb2', sun: [96, 262, 24, '#ffd6a0'], shade: 0 },
  day: { sky: ['#5d9bd6', '#9cc8ec', '#d6ecf6'], water: ['#9cc6dc', '#4d88aa', '#2c5b7a'], forest: '#3d5a3a', hills: '#7a99a8', sun: [272, 96, 20, '#fff6d0'], shade: 0 },
  evening: { sky: ['#3f3a72', '#c8687a', '#f7a85e'], water: ['#e59a6a', '#8a5f7a', '#3d3a5e'], forest: '#2e2a3e', hills: '#6a5578', sun: [232, 284, 30, '#ff7a3c'], shade: 0.14 },
  night: { sky: ['#0b1230', '#1d2a5a', '#34427a'], water: ['#2a3866', '#1b2650', '#0f1838'], forest: '#0d1426', hills: '#26325a', sun: [262, 108, 15, '#f3ecd0'], shade: 0.32 },
};


// ---------- рідкісні події ----------

// Золоте печиво розігрує одну з подій замість звичайної золотої рибки (порівну з нею); цунамі — окремо й ще рідше
const EVENTS = {
  catfish: { title: 'Сом-велетень', fortunes: ['Тобі все одно ніхто не повірить'] },
  beaver: { title: 'Бобер', fortunes: ['Бобер узяв своє. Друга половина удачі — твоя', 'Половину печива з’їли. Удачу лишили тобі', 'Бобер без здобичі не лишається. І ти не лишишся'] },
  drone: { title: 'Дрон з прикормкою', fortunes: ['Прикормку доставлено. Точність — до поплавка', 'Згори видніше, де стоїть риба', 'Скид пройшов. Чекай поклювки'] },
  inspector: { title: 'Рибпатруль', fortunes: ['Путівку перевірено. Удачу дозволено', 'Порушень не виявлено. Клювання дозволено до заходу сонця', 'Улов у межах норми. Радість — без обмежень', 'Протокол: щасливий рибалка, одна штука'] },
  fishrain: { title: 'Рибний дощ', fortunes: ['Прогноз на сьогодні: опади рибою', 'Коли щастить, підсак не потрібен', 'Небо теж прикормлене'] },
  tsunami: { title: 'Цунамі', fortunes: ['Хвиля пішла, риба лишилась. Збирай', 'Кінець світу перенесли. Клювання — ні', 'Море саме принесло улов. Підсак не знадобився', 'Після такого будь-яка поклювка — дрібниця'] },
};
const GOLD_EVENTS = ['catfish', 'beaver', 'drone', 'inspector', 'fishrain'];

// Цунамі — як метеорит у Shooter's Log: не раніше TSUNAMI_GAP показів після попереднього, далі шанс TSUNAMI_CHANCE щоразу
const TSUNAMI_KEY = 'fishing-log:tsunami';
const TSUNAMI_GAP = 10, TSUNAMI_CHANCE = 1 / 30;

/** Чи накриває цунамі цей показ; випало, але печиво не розламали — накриє наступного разу. */
function rollTsunami(q) {
  if (q.has('scene') || matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try {
    const s = JSON.parse(localStorage.getItem(TSUNAMI_KEY) ?? 'null') ?? { n: 0 };
    s.n = (s.n ?? 0) + 1;
    s.due ||= s.n > TSUNAMI_GAP && Math.random() < TSUNAMI_CHANCE;
    localStorage.setItem(TSUNAMI_KEY, JSON.stringify(s));
    return !!s.due;
  } catch { return false; }
}

function tsunamiSeen() {
  try { localStorage.setItem(TSUNAMI_KEY, JSON.stringify({ n: 0 })); } catch { /* сховище недоступне — нічого */ }
}

/** Набір передбачень для цього печива: подія, золоте чи звичайне. */
const listOf = (p) => (EVENTS[p.event] ? EVENTS[p.event].fortunes : p.gold ? GOLD_FORTUNES : FORTUNES);

const CAGE = '<rect x="-4.5" y="-6.5" width="9" height="13" rx="2" fill="#4f6a3a" stroke="#c8d0d4" stroke-width=".8"/>'
  + '<path d="M-4.5-2.5h9M-4.5 1.5h9M-1.5-6.5v13M1.5-6.5v13" stroke="#c8d0d4" stroke-width=".5"/>';

// Малюнок подій: back — між кладкою й ящиком (тінь ночі лягає й на нього), front — над усім, крім записки
const EVENT_ART = {
  // Сом вилазить біля кладки й просить закурити
  catfish: ({ night, ringC }) => ({
    back: '',
    front: `<ellipse class="fc-ev-ring" cx="50" cy="401" rx="46" ry="4.5" fill="none" stroke="${ringC}" stroke-width="1.4" style="animation-delay:.62s"/>
  <ellipse class="fc-ev-ring" cx="50" cy="401" rx="46" ry="4.5" fill="none" stroke="${ringC}" stroke-width="1.1" style="animation-delay:.95s"/>
  <g clip-path="url(#fc-catclip)"><g class="fc-cat"><g transform="translate(14 401) rotate(-9) scale(1.35)"><g class="fc-cat-bob">
    <path d="M-16-44Q-6-58 10-47Z" fill="#2a3220"/>
    <path d="M-70 8Q-76-22-42-40Q-8-54 30-46Q57-38 63-17Q67-4 61 6Z" fill="url(#fc-catg)"/>
    <path d="M-58 6Q0-1 60 3L61 7H-60Z" fill="#a3a27c" opacity=".55"/>
    <g fill="#1f261a" opacity=".35"><circle cx="-30" cy="-30" r="3"/><circle cx="-12" cy="-38" r="2.4"/><circle cx="-44" cy="-18" r="2.6"/><circle cx="4" cy="-30" r="2"/></g>
    <path d="M63-9Q45-2 26-7" stroke="#151a10" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M62-11Q46-6 28-9" stroke="#c9c39a" stroke-width="1" fill="none" opacity=".5"/>
    <g class="fc-cat-eye">${night ? '<circle cx="35" cy="-28" r="9" fill="#ffe27a" opacity=".25"/>' : ''}<circle cx="35" cy="-28" r="4.2" fill="#e8d27a"/><circle cx="36" cy="-28" r="2.2" fill="#111"/><circle cx="35" cy="-29.6" r=".9" fill="#fff"/></g>
    <g fill="none" stroke="#232b1b" stroke-linecap="round">
      <path class="fc-cat-wh" d="M58-14Q92-26 98 4" stroke-width="2.4"/>
      <path class="fc-cat-wh" d="M55-11Q78-4 80 14" stroke-width="2" style="animation-delay:-.9s"/>
      <path d="M44 2q4 8 0 14M36 3q3 8-1 13M28 3q2 7-2 11" stroke-width="1.6"/>
    </g>
    <path d="M36 4Q52 0 66-9Q63 4 48 10Z" fill="#323b27"/>
  </g></g></g></g>
  <g class="fc-say"><path d="M24 294H164a10 10 0 0 1 10 10v16a10 10 0 0 1-10 10H110l-12 24-6-24H24a10 10 0 0 1-10-10v-16a10 10 0 0 1 10-10Z" fill="#fffdf5" stroke="#2a3a44" stroke-width="1.4"/>
    <text x="94" y="317" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#2a3a44">${esc(t('Закурити є?'))}</text></g>`,
  }),

  // Бобер підпливає, хапає половинку печива з ящика й пливе геть, ляснувши хвостом
  beaver: ({ ringC, splash, drops }) => ({
    back: '',
    front: `<g class="fc-splash" fill="none" stroke="${ringC}" stroke-width="1.3">${splash(110, 396, 2.45)}</g>
  <g class="fc-drops" fill="${ringC}">${drops(110, 396, 2.45, 51)}</g>
  <g class="fc-bvr"><g class="fc-bvr-face"><g transform="scale(1.3)">
    <path d="M-24 3L-62-4M-24 5L-60 13" stroke="${ringC}" stroke-width="1" opacity=".5" stroke-linecap="round"/>
    <ellipse cx="-32" cy="2" rx="11" ry="3.2" fill="#3a2a1c"/><path d="M-40 1h16M-38 3h12" stroke="#5a4430" stroke-width=".6"/>
    <ellipse cx="-12" cy="-1" rx="18" ry="6" fill="#6b4a2e"/>
    <ellipse cx="4" cy="-8" rx="11" ry="9" fill="#7a5434"/>
    <circle cx="-3" cy="-15.5" r="2.6" fill="#5a3a22"/>
    <ellipse cx="13" cy="-5" rx="6.5" ry="5" fill="#a07856"/>
    <ellipse cx="18.2" cy="-7.2" rx="2.3" ry="1.7" fill="#1a120c"/>
    <circle cx="7" cy="-12" r="1.6" fill="#111"/><circle cx="7.5" cy="-12.6" r=".55" fill="#fff"/>
    <rect x="13.6" y="-1.6" width="3.6" height="4.2" rx=".7" fill="#f2c46a" stroke="#8a5a1a" stroke-width=".4"/>
    <path d="M15-5l7-2M15-4l7 1" stroke="#2a1a10" stroke-width=".5"/>
    <path class="fc-bvr-ck" d="M17 1Q22-6 29-1Q24 4 17 1Z" fill="#e2a24c" stroke="#a0621c" stroke-width=".6"/>
    <ellipse cx="-6" cy="2.5" rx="30" ry="2.4" fill="none" stroke="${ringC}" stroke-width=".9" opacity=".55"/>
  </g></g></g>`,
  }),

  // FPV-дрон прилітає, скидає годівницю точно до поплавка й відлітає
  drone: ({ ringC, splash, drops }) => ({
    back: '',
    front: `<g class="fc-splash" fill="none" stroke="${ringC}" stroke-width="1.3">${splash(296, 356, 2.15)}</g>
  <g class="fc-drops" fill="${ringC}">${drops(296, 356, 2.15, 61)}</g>
  <g class="fc-feeder"><g transform="scale(1.4)">${CAGE}</g></g>
  <g class="fc-drone"><g transform="scale(1.4)">
    <g class="fc-drone-feed"><path d="M0 4V24" stroke="#e8e8e8" stroke-width=".7"/><g transform="translate(0 30)">${CAGE}</g></g>
    <path d="M-22-2L22-2M-15 3L15 3" stroke="#22282e" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="-24.5" y="-4.5" width="5" height="4" rx="1" fill="#3a4148"/><rect x="19.5" y="-4.5" width="5" height="4" rx="1" fill="#3a4148"/>
    <rect x="-17.5" y="1" width="5" height="4" rx="1" fill="#3a4148"/><rect x="12.5" y="1" width="5" height="4" rx="1" fill="#3a4148"/>
    <rect x="-10" y="-6" width="20" height="10" rx="3" fill="#2b3238"/>
    <rect x="-8" y="-7.4" width="16" height="2.6" rx="1.2" fill="#f07a2a"/>
    <rect x="8.5" y="-3.5" width="5" height="5" rx="1.2" fill="#111"/><circle cx="12.5" cy="-1" r="1.3" fill="#4a7ab0"/>
    <path d="M-7-7L-13-17" stroke="#777" stroke-width="1"/><circle cx="-13" cy="-17" r="1.2" fill="#d94a2a"/>
    <circle class="fc-led" cx="-9" cy="3" r="1.3" fill="#ff4a3a"/><circle class="fc-led" cx="9" cy="3" r="1.3" fill="#5aff7a" style="animation-delay:-.25s"/>
    <g fill="#d6dee2" opacity=".55"><ellipse class="fc-prop" cx="-22" cy="-6" rx="12" ry="1.6"/><ellipse class="fc-prop" cx="22" cy="-6" rx="12" ry="1.6" style="animation-delay:-.04s"/>
      <ellipse class="fc-prop" cx="-15" cy="-1" rx="10" ry="1.4" style="animation-delay:-.02s"/><ellipse class="fc-prop" cx="15" cy="-1" rx="10" ry="1.4" style="animation-delay:-.06s"/></g>
  </g></g>`,
  }),

  // Човен рибоохорони з маячком: підходить зліва, інспектор світить ліхтарем на кладку
  inspector: ({ ringC }) => ({
    back: `<g class="fc-insp"><g class="fc-insp-bob">
    <path d="M-60 2L-110-4M-60 5L-108 12" stroke="${ringC}" stroke-width="1" opacity=".45" stroke-linecap="round"/>
    <g transform="translate(-2 -29)"><path class="fc-beam" d="M0 0L132-34V40Z" fill="url(#fc-beam)"/></g>
    <path d="M-46-8H48Q53-6 51-2Q43 9 30 10H-36Q-46 8-46-8Z" fill="#f2f5f7"/>
    <path d="M-46-3.5H50" stroke="#1f5fae" stroke-width="3"/><path d="M-45 0H47" stroke="#f2c230" stroke-width="1"/>
    <text x="2" y="7.2" text-anchor="middle" font-family="system-ui, sans-serif" font-size="5.6" font-weight="800" fill="#1f3f6e" letter-spacing=".04em">${esc(t('РИБПАТРУЛЬ'))}</text>
    <rect x="-6" y="-20" width="16" height="12" rx="2" fill="#dfe6ea"/><path d="M10-20l6 12h-6z" fill="#9ec4dc"/>
    <circle class="fc-beacon" cx="1" cy="-23" r="8" fill="#3d8bff" opacity=".35"/><rect class="fc-beacon" x="-2" y="-25.5" width="6" height="5" rx="1.5" fill="#2d7cf0"/>
    <rect x="-30" y="-30" width="12" height="22" rx="3" fill="#1d2f4a"/><rect x="-30" y="-20" width="12" height="2" fill="#e8e870"/>
    <circle cx="-24" cy="-35.5" r="5" fill="#e0b48a"/><path d="M-29.5-37Q-24-44-18.5-37Z" fill="#1d2f4a"/><path d="M-19.5-37.4h5" stroke="#1d2f4a" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M-19-26l12-2" stroke="#1d2f4a" stroke-width="3.4" stroke-linecap="round"/><rect x="-9" y="-30.8" width="7" height="3.6" rx="1" fill="#3a3a3a"/>
    <ellipse cx="0" cy="9" rx="52" ry="3" fill="none" stroke="${ringC}" stroke-width=".9" opacity=".5"/>
  </g></g>`,
    front: '',
  }),

  // Небо темніє, з хмари сиплеться риба: у воду — з колами, на кладку — лишається й підстрибує
  fishrain: ({ night, gold, ringC, splash, edgeX }) => {
    const r = seeded(41);
    const all = [];
    let rings = '';
    for (let k = 0; k < 40; k++) {
      const pier = k < 10;
      const y1 = pier ? 420 + r() * 170 : 316 + r() * 70;
      const x1 = pier ? edgeX(y1, -1) + 14 + r() * (edgeX(y1, 1) - edgeX(y1, -1) - 28) : -20 + r() * 400;
      const x0 = x1 + (r() - 0.5) * 80, y0 = -90 - r() * 80;
      const d = 0.5 + r() * 2.3, dur = 1 + r() * 0.4;
      const r0 = r() * 360, r1 = pier ? (r() - 0.5) * 50 : 80 + r() * 20;
      const s = pier ? 0.55 + (y1 - 392) / 500 : 0.5 + (y1 - 300) / 300;
      const body = `<g transform="scale(${f1(s * 10) / 10})">${FISH(false)}</g>`;
      all.push([y1, `<g class="fc-rain-f ${pier ? 'on' : 'in'}" style="--x0:${f1(x0)}px;--y0:${f1(y0)}px;--r0:${f1(r0)}deg;--x1:${f1(x1)}px;--y1:${f1(y1)}px;--r1:${f1(r1)}deg;animation-delay:${d.toFixed(2)}s;animation-duration:${dur.toFixed(2)}s">${
        pier ? `<g class="fc-flop" style="animation-delay:${(d + dur).toFixed(2)}s">${body}</g>` : body}</g>`]);
      if (!pier) rings += splash(f1(x1), f1(y1 + 4), Math.round((d + dur * 0.92) * 100) / 100);
    }
    const cl = seeded(43);
    let cloud = '';
    for (let x = -260; x < 640; x += 26 + cl() * 22) cloud += `<circle cx="${f1(x)}" cy="${f1(36 + cl() * 40)}" r="${f1(30 + cl() * 26)}"/>`;
    return {
      back: '',
      front: `<rect class="fc-dark" x="-1400" y="-700" width="3160" height="2000" fill="#0b1626"/>
  <g class="fc-rcloud" fill="${night ? '#141b2a' : '#4a5260'}">${cloud}<rect x="-1400" y="-700" width="3160" height="740"/></g>
  <g class="fc-splash" fill="none" stroke="${ringC}" stroke-width="1.1">${rings}</g>
  ${all.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join('')}`,
    };
  },

  // Апокаліпсис: гуркіт, на обрії росте хвиля, накриває все піною; коли відступає — на кладці б'ється риба
  tsunami: ({ night }) => {
    const foam = '#eef8fb';
    const crest = [[-420, -170], [-220, -250], [-20, -290], [150, -325], [290, -375], [390, -405]];
    const crestY = (x) => {
      for (let i = 1; i < crest.length; i++) {
        if (x <= crest[i][0]) {
          const [xa, ya] = crest[i - 1], [xb, yb] = crest[i];
          return ya + ((x - xa) / (xb - xa)) * (yb - ya);
        }
      }
      return crest[crest.length - 1][1];
    };
    const b = seeded(71);
    let bubbles = '', spray = '';
    for (let k = 0; k < 30; k++) { const x = -410 + b() * 790; bubbles += `<circle cx="${f1(x)}" cy="${f1(crestY(x) + b() * 10)}" r="${f1(4 + b() * 7)}"/>`; }
    for (let k = 0; k < 22; k++) { const x = -380 + b() * 760; spray += `<circle cx="${f1(x)}" cy="${f1(crestY(x) - 12 - b() * 40)}" r="${f1(1.5 + b() * 2.5)}"/>`; }
    // риба, що лишилась після хвилі: [x, y, кут, масштаб; мінус — дивиться праворуч]
    const lying = [[158, 452, 12, 1.1], [212, 486, -16, -1.2], [116, 528, 24, 1.3], [256, 566, -18, 1.4], [178, 604, 10, -1.5], [196, 366, -6, 0.8], [110, 470, 30, -1]];
    const fish = lying.map(([x, y, a, s], k) => `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s} ${Math.abs(s)})"><g class="fc-flop" style="animation-delay:${(2.9 + k * 0.23).toFixed(2)}s">${FISH(false)}</g></g>`).join('');
    let churn = '';
    for (let x = -430; x < 800; x += 14 + b() * 10) churn += `<circle cx="${f1(x)}" cy="${f1(-2 - b() * 8)}" r="${f1(8 + b() * 9)}"/>`;
    return {
      back: `<g class="fc-wave">
    <path d="M-420 0V-170Q-220-250-20-290Q150-325 290-375Q390-412 445-355Q480-305 425-275Q480-255 540-232Q650-200 780-168V0Z" fill="url(#fc-waveg)"/>
    <g fill="none" stroke="#9fd6e4" opacity="${night ? 0.18 : 0.3}" stroke-width="3"><path d="M-400-110Q-100-190 280-300"/><path d="M-380-60Q0-140 420-220"/><path d="M-300-20Q100-80 700-120"/></g>
    <path d="M-420-170Q-220-250-20-290Q150-325 290-375Q390-412 445-355" fill="none" stroke="${foam}" stroke-width="10" stroke-linecap="round"/>
    <path d="M404-330Q420-352 445-355Q452-328 432-302Q410-306 404-330Z" fill="#0a2a40" opacity=".45"/><path d="M445-355Q472-318 442-292" fill="none" stroke="${foam}" stroke-width="9" stroke-linecap="round"/>
    <path d="M425-275Q480-255 540-232Q650-200 780-168" fill="none" stroke="${foam}" stroke-width="7" opacity=".75"/>
    <g fill="${foam}">${bubbles}</g><g fill="${foam}" opacity=".8">${spray}</g>
    <g fill="${foam}" opacity=".9">${churn}</g>
  </g>`,
      front: `<rect class="fc-dark" x="-1400" y="-700" width="3160" height="2000" fill="#0b1626"/>
  <g class="fc-after">
    <g fill="#cfeaf3" opacity=".35"><ellipse cx="170" cy="470" rx="26" ry="4"/><ellipse cx="232" cy="545" rx="32" ry="5"/><ellipse cx="140" cy="590" rx="30" ry="5"/></g>
    <g fill="none" stroke="#3f7a3a" stroke-width="2.4" stroke-linecap="round" opacity=".9"><path d="M140 371q6 9 0 18t2 16"/><path d="M214 371q-5 8 1 16t-3 14"/><path d="M303 330q6 10 0 20t3 14"/></g>
    ${fish}
  </g>
  <rect class="fc-foam" x="-1400" y="-700" width="3160" height="2000" fill="${night ? '#b9d4dd' : '#e6f4f8'}"/>`,
    };
  },
};

function fortuneCookie(p = {}) {
  const rnd = seeded(77), pick = seeded(p.n ?? 1), season = SEASONS.includes(p.season) ? p.season : 'summer', gold = !!p.gold;
  const tod = PAL[p.tod] ? p.tod : 'day', pal = PAL[tod], night = tod === 'night', dusk = night || tod === 'evening';
  const [sunX, sunY, sunR, sunC] = pal.sun;
  const lucky = LUCKY.map((list) => list[Math.floor(pick() * list.length)]);

  let stars = '';
  if (night) for (let j = 0; j < 160; j++) stars += `<circle cx="${f1(-700 + rnd() * 1760)}" cy="${f1(-400 + rnd() * 680)}" r="${f1(0.4 + rnd() * 0.9)}" opacity="${f1(0.4 + rnd() * 0.6)}"/>`;

  // ліс на тому березі — купки крон по всій ширині; той самий ліс віддзеркалюється у воді
  let forest = '';
  for (let x = -1400; x < 1760; x += 9 + rnd() * 12) {
    const r = 7 + rnd() * 9, y = 300 - r * 0.5 - rnd() * 6;
    forest += rnd() < 0.18
      ? `<path d="M${f1(x)} ${f1(y - r * 2.4)}L${f1(x + r * 0.7)} 301H${f1(x - r * 0.7)}Z"/>`
      : `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(r)}" ry="${f1(r * 1.1)}"/>`;
  }
  forest += '<rect x="-1400" y="292" width="3160" height="10"/>';
  // дальній ряд лісу — світліший, вищий, щоб берег мав глибину
  const fr = seeded(31);
  let farForest = '';
  for (let x = -1400; x < 1760; x += 12 + fr() * 14) {
    const r = 8 + fr() * 10, y = 294 - r * 0.6 - fr() * 8;
    farForest += fr() < 0.2 ? `<path d="M${f1(x)} ${f1(y - r * 2.2)}L${f1(x + r * 0.7)} 300H${f1(x - r * 0.7)}Z"/>`
      : `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(r)}" ry="${f1(r * 1.05)}"/>`;
  }
  // купчасті хмари: кілька кіл на пласкій основі, низ у тіні; повільно пливуть
  const CLOUD = { morning: ['#fff1ea', '#f2c7bc'], day: ['#ffffff', '#dbe8f2'], evening: ['#ffc59a', '#c9727e'], night: ['#36457a', '#26335f'] }[tod];
  const cr = seeded(17);
  const cloud = (cx, cy, w) => {
    let top = '', base = '';
    const n = 4 + Math.floor(cr() * 3);
    for (let k = 0; k < n; k++) {
      const x = cx - w / 2 + (k + 0.5) * (w / n) + (cr() - 0.5) * 6, r = w / n * (0.7 + cr() * 0.6) * (k === 0 || k === n - 1 ? 0.75 : 1.1);
      top += `<circle cx="${f1(x)}" cy="${f1(cy - r * 0.55)}" r="${f1(r)}"/>`;
    }
    base = `<rect x="${f1(cx - w / 2)}" y="${f1(cy - w * 0.12)}" width="${f1(w)}" height="${f1(w * 0.12)}" rx="${f1(w * 0.06)}"/>`;
    return `<g fill="${CLOUD[1]}" transform="translate(0 3)">${top}${base}</g><g fill="${CLOUD[0]}">${top}${base}</g>`;
  };
  const clouds = [[40, 150, 110], [250, 70, 80], [300, 210, 70], [-160, 90, 120], [560, 130, 110], [-420, 190, 90], [820, 80, 100]]
    .map(([x, y, w]) => cloud(x, y, w)).join('');
  // чайки вранці й удень: летять через небо, махають крилами
  const gull = (x, y, d) => `<g transform="translate(${x} ${y})"><path class="fc-wing" d="M-9 0Q-5-5 0 0Q5-5 9 0" style="animation-delay:-${d}s"/></g>`;
  const gulls = tod === 'day' || tod === 'morning' ? `<g class="fc-gulls" fill="none" stroke="${tod === 'day' ? '#4a5a68' : '#6a5a68'}" stroke-width="1.5" stroke-linecap="round">${gull(0, 180, 0)}${gull(-24, 192, 0.35)}${gull(-44, 174, 0.6)}</g>` : '';
  // ледь помітні брижі на воді: тонкі світлі риски, ближче — довші
  const wr2 = seeded(23);
  let ripples = '';
  for (let j = 0; j < 60; j++) {
    const y = 308 + wr2() ** 1.6 * 420, w = 6 + (y - 300) * 0.08 + wr2() * 10;
    ripples += `<path d="M${f1(-300 + wr2() * 960)} ${f1(y)}h${f1(w)}"/>`;
  }
  const hillsD = (() => {
    let d = 'M-1400 300';
    for (let x = -1400; x <= 1760; x += 160) d += `Q${x + 80} ${f1(250 + rnd() * 30)} ${x + 160} ${f1(276 + rnd() * 12)}`;
    return `${d}V300Z`;
  })();

  // доріжка сонця чи місяця на воді
  let glints = '';
  for (let j = 0; j < 12; j++) {
    const w = 22 - j * 1.4, off = (rnd() - 0.5) * 12;
    glints += `<path d="M${f1(sunX + off - w)} ${306 + j * 8}h${f1(2 * w)}" stroke-width="${f1(2.6 - j * 0.12)}" style="animation-delay:-${(rnd() * 1.6).toFixed(2)}s"/>`;
  }

  // кола на воді — гуляє риба; два кільця одне за одним
  const rings = [[60, 336, 0], [214, 318, 2.4], [-150, 352, 4.6], [470, 340, 1.2], [-420, 330, 3.3], [700, 356, 5.5]]
    .map(([x, y, d]) => `<g transform="translate(${x} ${y})"><ellipse rx="13" ry="2.8" style="animation-delay:-${d}s"/><ellipse rx="13" ry="2.8" style="animation-delay:-${f1(d + 3.4)}s"/></g>`).join('');

  // очерет і рогіз: купки обабіч кладки (на широкому екрані — ще й далі); листя — тонкі загострені смуги
  const REED = {
    spring: ['#7fa64a', '#9cc05a', '#5f8a3a'], summer: ['#4f7f36', '#6a9a40', '#3b6a2c'],
    autumn: ['#a8904a', '#c2a256', '#8a7438'], winter: ['#c9b98a', '#d8cba0', '#a99a70'],
  }[season];
  const reed = (x, y, h, lean, k, tail) => {
    const tx = x + lean, ty = y - h;
    let s = `<path d="M${f1(x - 1.8)} ${y}Q${f1(x + lean * 0.3 - 1)} ${f1(y - h * 0.5)} ${f1(tx)} ${f1(ty)}Q${f1(x + lean * 0.3 + 1)} ${f1(y - h * 0.5)} ${f1(x + 1.8)} ${y}Z" fill="${REED[k % 3]}"/>`;
    if (tail) {
      const cx = x + lean * 0.8, cy = y - h * 0.8, a = (Math.atan2(lean, h) * 180) / Math.PI;
      s += `<ellipse cx="${f1(cx)}" cy="${f1(cy)}" rx="2.8" ry="9" transform="rotate(${f1(a)} ${f1(cx)} ${f1(cy)})" fill="${season === 'winter' ? '#8a6a4a' : '#6b4226'}"/>`;
      if (season === 'winter') s += `<ellipse cx="${f1(cx + lean * 0.02)}" cy="${f1(cy - 8)}" rx="2.6" ry="1.6" fill="#f4f7fb"/>`;
    }
    return s;
  };
  const clump = (x0, y0, n, seed, dir) => {
    const r = seeded(seed);
    let s = '';
    for (let k = 0; k < n; k++) {
      const x = x0 + (r() - 0.5) * 70, h = 70 + r() * 110, lean = (r() - 0.5) * 40 + dir * 14;
      s += reed(x, y0 + r() * 16, h, lean, k, r() < 0.28);
    }
    return s;
  };
  const reedsL = clump(22, 470, 22, 3, -1) + clump(-210, 455, 18, 4, -1) + clump(-470, 450, 16, 5, 1);
  const reedsR = clump(380, 476, 20, 6, 1) + clump(560, 458, 18, 7, 1) + clump(820, 452, 16, 8, -1);

  // латаття влітку: листки з вирізом і біла квітка
  const pad = (x, y, s, flower) => `<g transform="translate(${x} ${y}) scale(${s} ${s * 0.38})"><path d="M0 0L14 -3A15 15 0 1 1 13 4Z" fill="#4f8a3a"/><path d="M0 0L14 -3" stroke="#3a6a2a" stroke-width="1"/></g>`
    + (flower ? `<g transform="translate(${x - 2} ${y - 4})"><path d="M-6 0Q0-10 6 0Q0 3-6 0Z" fill="#fbf7ee"/><path d="M-3 0Q0-7 3 0Z" fill="#fff"/><circle cy="-1" r="1.6" fill="#f2c94c"/></g>` : '');
  const lilies = season === 'summer' ? pad(72, 352, 1, true) + pad(98, 362, 0.8, false) + pad(36, 344, 0.7, false) + pad(-120, 360, 1, true) + pad(520, 350, 0.9, true) : '';

  // листя по сезону — для того, що летить і пливе по воді
  const LEAF = { spring: ['#a6c86a', '#c2da84', '#8fb85a'], summer: ['#5f8f3e', '#78a84c', '#4a7a32'], autumn: ['#e0a830', '#d4782a', '#c9b040'], winter: [] }[season];

  // що летить через увесь кадр за вітром: осінь — листя, зима — сніг, весна — пух; влітку тихо
  const fall = {
    autumn: (x, y, j) => `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="1.8" ry="4" fill="${LEAF[j % 3]}"`,
    // сніжинки м'які й різні за розміром (ближчі — більші), щоб уночі їх не плутали з зірками
    winter: (x, y, j) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1([2.4, 3.2, 4.4][j % 3])}" fill="url(#fc-flake)"`,
    spring: (x, y) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="1.3" fill="#fffbe6" opacity=".85"`,
    summer: (x, y, j) => `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="1.6" ry="4" fill="${LEAF[j % 3]}"`,
  }[season];
  let falling = '';
  const nFall = { autumn: 16, winter: 44, spring: 12, summer: 0 }[season];
  for (let j = 0; j < nFall; j++) {
    const x = -200 + rnd() * 760, y = -120 + rnd() * 80;
    falling += `${fall(x, y, j)} style="animation-duration:${(7 + rnd() * 5).toFixed(1)}s;animation-delay:-${(rnd() * 11).toFixed(1)}s"/>`;
  }
  let afloat = '';
  if (season === 'autumn') for (let j = 0; j < 8; j++) afloat += `${fall(-60 + rnd() * 140 + (j > 4 ? 330 : 0), 318 + rnd() * 60, j)} style="animation-delay:-${(rnd() * 6).toFixed(1)}s"/>`;

  // світлячки — літнього вечора й уночі; ореол — градієнтом, без CSS-фільтрів (фільтр гальмує слабкі телефони)
  let fireflies = '';
  if (season === 'summer' && dusk) {
    for (let j = 0; j < 14; j++) {
      const x = f1(-20 + rnd() * 400), y = f1(250 + rnd() * 160);
      fireflies += `<g style="animation-delay:-${(rnd() * 3).toFixed(2)}s;animation-duration:${(2 + rnd() * 2).toFixed(1)}s"><circle cx="${x}" cy="${y}" r="5" fill="url(#fc-ffglow)"/><circle cx="${x}" cy="${y}" r="1.5"/></g>`;
    }
  }

  // крихти від розламу
  let crumbs = '';
  for (let j = 0; j < 16; j++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 3.6, r = 30 + rnd() * 60;
    crumbs += `<circle cx="180" cy="360" r="${f1(1.2 + rnd() * 2)}" style="--dx:${f1(Math.cos(a) * r)}px;--dy:${f1(Math.sin(a) * r)}px;animation-delay:${(0.1 + rnd() * 0.08).toFixed(2)}s"/>`;
  }
  // бризки там, де риба виринає (FX0) і пірнає (FX1)
  const FX0 = [300, 362], FX1 = [228, 362];
  const drops = (cx, cy, at, seed) => {
    const r = seeded(seed);
    let s = '';
    for (let j = 0; j < 10; j++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.4, d = 16 + r() * 26;
      s += `<circle cx="${cx}" cy="${cy}" r="${f1(1 + r() * 1.4)}" style="--dx:${f1(Math.cos(a) * d)}px;--dy:${f1(Math.sin(a) * d)}px;animation-delay:${(at + r() * 0.06).toFixed(2)}s"/>`;
    }
    return s;
  };
  const splash = (cx, cy, at) => `<g transform="translate(${cx} ${cy})"><ellipse rx="12" ry="2.8" style="animation-delay:${at}s"/><ellipse rx="12" ry="2.8" style="animation-delay:${f1(at + 0.25)}s"/></g>`;

  // записка: передбачення, щасливі числа дрібно внизу
  const lines = fortuneLines(fortuneText(p));
  const slipH = 16 + lines.length * 13 + 20, top = -slipH / 2;
  const slipText = lines.map((l, k) => `<text y="${f1(top + 17 + k * 13)}">${esc(l)}</text>`).join('');
  let twinkles = '';
  for (let j = 0; j < 6; j++) {
    const a = (j / 6 + 1 / 12) * 2 * Math.PI;
    twinkles += `<path d="${star(Math.cos(a) * 104, Math.sin(a) * (slipH / 2 + 12), 4, 1.4)}" style="animation-delay:-${(j * 0.27).toFixed(2)}s"/>`;
  }
  const rays = gold ? `<g class="fc-rays-in"><g class="fc-rays" fill="url(#fc-ray)">${
    Array.from({ length: 18 }, (_, k) => `<path d="M177 362L169 172H191L183 362Z" transform="rotate(${k * 20} 180 362)"/>`).join('')}</g></g>` : '';

  // Кладка: дошки вздовж, сходяться до дальнього краю (128…232 на y 392)
  const PIER = { y: 392, l: 128, r: 232, ny: 1100, nl: -150, nr: 510 };
  const edgeX = (y, side) => (side < 0 ? PIER.l - (y - PIER.y) * ((PIER.l - PIER.nl) / (PIER.ny - PIER.y)) : PIER.r + (y - PIER.y) * ((PIER.nr - PIER.r) / (PIER.ny - PIER.y)));
  // дошка k: смуга між швами k і k+1; відтінки чергуються, щоб настил не був одним шматком
  const plankX = (k, far) => (far ? PIER.l + (k * (PIER.r - PIER.l)) / 8 : PIER.nl + (k * (PIER.nr - PIER.nl)) / 8);
  let planks = '';
  for (let k = 0; k < 8; k++) {
    planks += `<path d="M${f1(plankX(k, true))} ${PIER.y}H${f1(plankX(k + 1, true))}L${f1(plankX(k + 1, false))} ${PIER.ny}H${f1(plankX(k, false))}Z" fill="${['#fff', '#000'][k % 2]}" opacity="${[0.06, 0.07, 0.03, 0.1, 0.05, 0.08, 0.02, 0.09][k]}"/>`;
  }
  // палі під кладкою: видно знизу між настилом і водою; з брижами біля води
  const pile = (y, side) => {
    const x = edgeX(y, side) + side * -6, w = 5 + (y - PIER.y) * 0.03, h = 10 + (y - PIER.y) * 0.08;
    return `<rect x="${f1(x - w / 2)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${wood[1]}"/><path d="M${f1(x - w)} ${f1(y + h)}h${f1(w * 2)}" stroke="#fff" stroke-width="1" opacity=".35"/>`;
  };
  const piles = () => [420, 470, 560, 700, 900].map((y) => pile(y, -1) + pile(y, 1)).join('');
  let seams = '';
  for (let k = 1; k < 8; k++) seams += `<path d="M${f1(PIER.l + (k * (PIER.r - PIER.l)) / 8)} ${PIER.y}L${f1(PIER.nl + (k * (PIER.nr - PIER.nl)) / 8)} ${PIER.ny}"/>`;
  let nails = '';
  for (const y of [430, 520, 640]) for (let k = 0; k <= 8; k++) {
    const x = edgeX(y, -1) + (k * (edgeX(y, 1) - edgeX(y, -1))) / 8;
    nails += `<circle cx="${f1(x + (k === 0 ? 4 : k === 8 ? -4 : 0))}" cy="${y}" r="${f1(0.6 + (y - 392) / 300)}"/>`;
  }
  const wood = night ? ['#5a4632', '#3e2f22'] : tod === 'evening' ? ['#9a6a48', '#5e3f2a'] : ['#b48a5e', '#7a5636'];

  // вудилище на рогатці праворуч: від комля (232,660) до кінчика (318,262), волосінь до поплавка (300,352)
  const B = [232, 660], T = [318, 262];
  const rodPoly = (() => {
    const dx = T[0] - B[0], dy = T[1] - B[1], len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    return `M${f1(B[0] + nx * 3.6)} ${f1(B[1] + ny * 3.6)}L${f1(T[0] + nx * 0.6)} ${f1(T[1] + ny * 0.6)}L${f1(T[0] - nx * 0.6)} ${f1(T[1] - ny * 0.6)}L${f1(B[0] - nx * 3.6)} ${f1(B[1] - ny * 3.6)}Z`;
  })();
  const along = (k) => [B[0] + (T[0] - B[0]) * k, B[1] + (T[1] - B[1]) * k];
  const [rx, ry] = along(0.24), [hx, hy] = along(0.42);

  // подія замість риби, що вистрибує (золоте печиво чи цунамі)
  const ringC = night ? '#c9d4f2' : '#ffffff';
  const ev = EVENT_ART[p.event]?.({ night, gold, ringC, splash, drops, edgeX }) ?? { back: '', front: '' };
  const jump = p.event ? '' : `<g class="fc-splash" fill="none" stroke="${ringC}" stroke-width="1.3">${splash(...FX0, 0.36)}${splash(...FX1, 1.22)}</g>
  <g class="fc-drops" fill="${ringC}">${drops(...FX0, 0.36, 21)}${drops(...FX1, 1.22, 22)}</g>
  <g clip-path="url(#fc-above)"><g class="fc-fish">${FISH(gold)}</g></g>
  ${gold ? `<g class="fc-fish-sparks" fill="#fff3b0">${[0, 1, 2, 3, 4, 5].map((k) => `<path d="${star(236 + k * 13, 288 + (k % 2) * 16, 3.6, 1.2)}" style="animation-delay:${(0.75 + k * 0.06).toFixed(2)}s"/>`).join('')}</g>` : ''}`;

  const layer = (cls) => `<svg class="fc-layer ${cls}" viewBox="0 0 360 640" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;
  return `
${layer('fc-back')}
  <defs>
    <linearGradient id="fc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal.sky[0]}"/><stop offset=".65" stop-color="${pal.sky[1]}"/><stop offset="1" stop-color="${pal.sky[2]}"/></linearGradient>
    <linearGradient id="fc-water" gradientUnits="userSpaceOnUse" x1="0" y1="300" x2="0" y2="760"><stop offset="0" stop-color="${pal.water[0]}"/><stop offset=".35" stop-color="${pal.water[1]}"/><stop offset="1" stop-color="${pal.water[2]}"/></linearGradient>
    <radialGradient id="fc-sunglow"><stop offset=".3" stop-color="${sunC}" stop-opacity=".6"/><stop offset="1" stop-color="${sunC}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="-1400" y="-700" width="3160" height="1002" fill="url(#fc-sky)"/>
  <g fill="#fff6dc">${stars}</g>
  <circle cx="${sunX}" cy="${sunY}" r="${sunR * 3}" fill="url(#fc-sunglow)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="${sunC}"/>${night ? `<circle cx="${sunX - 5}" cy="${sunY - 4}" r="3.6" fill="#ddd3b0"/><circle cx="${sunX + 5}" cy="${sunY + 5}" r="2.4" fill="#ddd3b0"/>` : ''}
  <path d="${hillsD}" fill="${pal.hills}" opacity=".7"/>
  <g fill="${pal.hills}">${farForest}</g>
  <g fill="${pal.forest}">${forest}</g>
  ${season === 'winter' ? `<path d="${hillsD}" fill="#f4f7fb" opacity=".35"/>` : ''}
  <rect x="-1400" y="300" width="3160" height="900" fill="url(#fc-water)"/>
  <g fill="${pal.forest}" opacity=".32" transform="translate(0 602) scale(1 -1)">${forest}</g>
  <g stroke="${night ? '#6a7ab0' : '#ffffff'}" stroke-width="1" stroke-linecap="round" opacity="${night ? 0.25 : 0.22}">${ripples}</g>
  ${season === 'winter' ? '<path d="M-1400 300H1760V306Q900 312 0 305T-1400 308Z" fill="#e8eef6" opacity=".8"/>' : ''}
</svg>
${layer('fc-water-fx')}
  <defs><radialGradient id="fc-flake"><stop offset=".35" stop-color="#fff"/><stop offset="1" stop-color="#eaf2ff" stop-opacity="0"/></radialGradient><radialGradient id="fc-ffglow"><stop offset=".3" stop-color="#fff38a" stop-opacity=".8"/><stop offset="1" stop-color="#fff38a" stop-opacity="0"/></radialGradient></defs>
  <g class="fc-clouds">${clouds}</g>
  ${gulls}
  <g class="fc-glints" stroke="${night ? '#f3ecd0' : tod === 'evening' ? '#ffc08a' : '#fffaf0'}" stroke-linecap="round" opacity=".6">${glints}</g>
  <g class="fc-rings" fill="none" stroke="${night ? '#9fb0de' : '#f4f8fb'}" stroke-width="1">${rings}</g>
  ${tod === 'morning' ? '<g class="fc-mist" fill="#fff" opacity=".55"><rect x="-1400" y="294" width="1700" height="9" rx="4.5"/><rect x="60" y="308" width="1700" height="7" rx="3.5"/><rect x="-1400" y="322" width="1620" height="6" rx="3"/></g>' : ''}
  <g class="fc-boat" transform="translate(40 303)"><path d="M-16 0Q0 5 18 0L15-3Q0 1-13-3Z" fill="${pal.forest}"/><circle cx="2" cy="-9" r="2.6" fill="${pal.forest}"/><path d="M0-7v5h5v-5z" fill="${pal.forest}"/><path d="M4-6L26-30" stroke="${pal.forest}" stroke-width=".9"/></g>
  ${lilies}
  ${afloat ? `<g class="fc-afloat">${afloat}</g>` : ''}
  <g class="fc-reeds fc-reeds-l">${reedsL}</g>
  <g class="fc-reeds fc-reeds-r">${reedsR}</g>
  ${fireflies ? `<g class="fc-ff" fill="#fff7a0">${fireflies}</g>` : ''}
</svg>
${layer('fc-front')}
  <defs>
    <linearGradient id="fc-wood" gradientUnits="userSpaceOnUse" x1="0" y1="392" x2="0" y2="760"><stop offset="0" stop-color="${wood[0]}"/><stop offset="1" stop-color="${wood[1]}"/></linearGradient>
    <linearGradient id="fc-ckl" x1="0" y1="0" x2=".5" y2="1">${gold ? '<stop offset="0" stop-color="#fff4b8"/><stop offset=".55" stop-color="#f3c93e"/><stop offset="1" stop-color="#c4921a"/>' : '<stop offset="0" stop-color="#fcdc96"/><stop offset=".55" stop-color="#eaad50"/><stop offset="1" stop-color="#c88430"/>'}</linearGradient>
    <linearGradient id="fc-ckr" x1="1" y1="0" x2=".5" y2="1">${gold ? '<stop offset="0" stop-color="#fbe07a"/><stop offset=".55" stop-color="#dcac28"/><stop offset="1" stop-color="#a57a0e"/>' : '<stop offset="0" stop-color="#f0bf68"/><stop offset=".55" stop-color="#d4943c"/><stop offset="1" stop-color="#ad6e24"/>'}</linearGradient>
    <linearGradient id="fc-ckm" x1="0" y1="0" x2="0" y2="1">${gold ? '<stop offset="0" stop-color="#c9961a"/><stop offset="1" stop-color="#7f5c08"/>' : '<stop offset="0" stop-color="#c47f2c"/><stop offset="1" stop-color="#8c5418"/>'}</linearGradient>
    <linearGradient id="fc-fish" x1="0" y1="0" x2="0" y2="1">${gold && !p.event ?'<stop offset="0" stop-color="#ffe680"/><stop offset=".5" stop-color="#f5b82a"/><stop offset="1" stop-color="#d98a10"/>' : '<stop offset="0" stop-color="#7d93a3"/><stop offset=".45" stop-color="#dfe8ee"/><stop offset="1" stop-color="#f6f8f9"/>'}</linearGradient>
    <linearGradient id="fc-ray" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff3b8" stop-opacity=".85"/><stop offset=".6" stop-color="#ffe27a" stop-opacity=".2"/><stop offset="1" stop-color="#ffe27a" stop-opacity="0"/></linearGradient>
    <radialGradient id="fc-gglow"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#ffe27a" stop-opacity="0"/></radialGradient>
    <radialGradient id="fc-lamp"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".9"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    <clipPath id="fc-l"><rect x="0" y="300" width="180" height="100"/></clipPath>
    <clipPath id="fc-r"><rect x="180" y="300" width="180" height="100"/></clipPath>
    <clipPath id="fc-above"><rect x="-1400" y="-700" width="3160" height="1065"/></clipPath>
    <clipPath id="fc-catclip"><rect x="-1400" y="-700" width="3160" height="1103"/></clipPath>
    <linearGradient id="fc-catg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${night ? '#2a3122' : '#46523a'}"/><stop offset=".6" stop-color="${night ? '#323a28' : '#56603f'}"/><stop offset="1" stop-color="${night ? '#4a4a38' : '#7c7a58'}"/></linearGradient>
    <linearGradient id="fc-beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff6c8" stop-opacity=".75"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></linearGradient>
    <linearGradient id="fc-waveg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${night ? '#1d4f66' : '#3a95ac'}"/><stop offset=".5" stop-color="${night ? '#123a52' : '#1f6a86'}"/><stop offset="1" stop-color="${night ? '#0a2236' : '#0f3f5a'}"/></linearGradient>
  </defs>
  ${jump}
  <path d="M${PIER.l - 2} ${PIER.y + 4}L${PIER.nl - 60} ${PIER.ny}H${PIER.nl + 40}L${PIER.l + 6} ${PIER.y + 2}Z" fill="#0b1626" opacity=".18"/>
  <path d="M${PIER.r + 2} ${PIER.y + 4}L${PIER.nr + 60} ${PIER.ny}H${PIER.nr - 40}L${PIER.r - 6} ${PIER.y + 2}Z" fill="#0b1626" opacity=".18"/>
  ${piles()}
  <path d="M${PIER.l} ${PIER.y}L${PIER.nl} ${PIER.ny}V${PIER.ny + 40}L${PIER.l} ${PIER.y + 3}Z" fill="${wood[1]}"/>
  <path d="M${PIER.r} ${PIER.y}L${PIER.nr} ${PIER.ny}V${PIER.ny + 40}L${PIER.r} ${PIER.y + 3}Z" fill="${wood[1]}"/>
  <path d="M${PIER.l} ${PIER.y}H${PIER.r}L${PIER.nr} ${PIER.ny}H${PIER.nl}Z" fill="url(#fc-wood)"/>
  ${planks}
  <g stroke="${wood[1]}" stroke-width="1.4" opacity=".7">${seams}</g>
  <g fill="#2a1d14" opacity=".55">${nails}</g>
  <path d="M${PIER.l} ${PIER.y}H${PIER.r}" stroke="${wood[1]}" stroke-width="2"/>
  <rect x="${PIER.l - 5}" y="374" width="7" height="22" rx="1.5" fill="${wood[1]}"/><rect x="${PIER.r - 2}" y="374" width="7" height="22" rx="1.5" fill="${wood[1]}"/>
  ${season === 'winter' ? `<path d="M${PIER.l} ${PIER.y}H${PIER.r}L${PIER.nr} ${PIER.ny}H${PIER.nl}Z" fill="#f4f7fb" opacity=".35"/><path d="M${PIER.l - 6} 374h9v-2.5h-9zM${PIER.r - 3} 374h9v-2.5h-9z" fill="#f4f7fb"/>` : ''}
  ${ev.back}
  ${pal.shade ? `<rect x="-1400" y="-700" width="3160" height="1800" fill="#0b1230" opacity="${pal.shade}"/>` : ''}
  <g class="fc-rod">
    <path d="M${T[0]} ${T[1]}Q312 300 300 348" stroke="${night ? '#c9d4f2' : '#fbfbf6'}" stroke-width=".8" fill="none" opacity=".75"/>
    <path d="M${f1(hx)} ${f1(hy + 2)}V${f1(hy + 40)}M${f1(hx)} ${f1(hy + 2)}l-6-8M${f1(hx)} ${f1(hy + 2)}l6-6" stroke="#4a3622" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="${rodPoly}" fill="#1f2a30"/>
    <path d="M${f1(B[0])} ${f1(B[1])}L${f1(along(0.2)[0])} ${f1(along(0.2)[1])}" stroke="#c49a6c" stroke-width="7" stroke-linecap="round"/>
    <path d="M${f1(B[0])} ${f1(B[1])}L${f1(along(0.2)[0])} ${f1(along(0.2)[1])}" stroke="#e0bd8e" stroke-width="2" stroke-linecap="round" opacity=".6" transform="translate(-1.5 0)"/>
    ${[0.42, 0.56, 0.68, 0.78, 0.86, 0.93].map((k, i) => { const [x, y] = along(k); return `<circle cx="${f1(x - 2.5)}" cy="${f1(y + 0.5)}" r="${f1(2.6 - i * 0.3)}" fill="none" stroke="#9aa6ad" stroke-width=".9"/>`; }).join('')}
    <path d="M${f1(T[0])} ${f1(T[1])}L${f1(along(0.86)[0])} ${f1(along(0.86)[1])}" stroke="#d94a2a" stroke-width="1.6" stroke-linecap="round"/>
    <g transform="translate(${f1(rx + 8)} ${f1(ry)})"><circle r="9" fill="#2c3a44"/><circle r="6" fill="#56707f"/><circle r="2" fill="#c9d3d8"/><path d="M0 0l11 6" stroke="#2c3a44" stroke-width="2.4" stroke-linecap="round"/><circle cx="11" cy="6" r="2.4" fill="#d94a2a"/></g>
  </g>
  <g class="fc-float"><g class="fc-bob"><g transform="translate(300 352)">
    <ellipse cy="3" rx="7" ry="1.6" fill="none" stroke="${night ? '#9fb0de' : '#ffffff'}" stroke-width=".8" opacity=".7"/>
    <path d="M0-14v-6" stroke="#2a2a2a" stroke-width="1.2"/>
    <path d="M0-14Q4-8 3.4 0Q0 4-3.4 0Q-4-8 0-14Z" fill="#e8442c"/><path d="M-3.4 0Q0 4 3.4 0L3 1.6Q0 5-3 1.6Z" fill="#fbfbf6"/>
    ${dusk ? '<circle cy="-21" r="2" fill="#bfff6a"/><circle cy="-21" r="6" fill="#bfff6a" opacity=".25"/>' : ''}
  </g></g></g>
  ${dusk ? '<ellipse cx="94" cy="540" rx="60" ry="14" fill="url(#fc-lamp)" opacity=".7"/><circle cx="94" cy="508" r="34" fill="url(#fc-lamp)" opacity=".55"/><g transform="translate(94 512)"><rect x="-7" y="-2" width="14" height="22" rx="2" fill="#ffd27a" opacity=".9"/><path d="M-9-4h18v4h-18zM-9 20h18v4h-18zM-5-10q5-6 10 0" fill="none" stroke="#2a2a2a" stroke-width="2"/><path d="M-9-4h18v3h-18zM-9 20h18v3h-18z" fill="#2a2a2a"/></g>' : ''}
  <g transform="translate(110 436)"><path d="M0 0h15v18H0z" fill="#3a4c5c"/><path d="M0 0h15v3H0z" fill="#56707f"/><path d="M15 4q5 1 4 7q-1 4-4 4" fill="none" stroke="#3a4c5c" stroke-width="2"/>
    <path class="fc-steam" d="M5-2q-3-5 0-10t0-10" stroke="#fff8ea" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7"/>
    <path class="fc-steam" d="M10-2q3-5 0-10t0-10" stroke="#fff8ea" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".7" style="animation-delay:-1.2s"/></g>
  <g transform="translate(238 430)">
    <path class="fc-worm" d="M8 0q-5-9 1-12q6-2 4 6" stroke="#d9817a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="8" cy="0" rx="9" ry="2.6" fill="#7d868e"/><path d="M-1 0v18q9 4 18 0V0q-9 4-18 0z" fill="#b8bec4"/><path d="M-1 6q9 4 18 0v6q-9 4-18 0z" fill="#3f7ab0"/>
    <path d="M3 9.5l2.5 1.5 3-2 3 2" stroke="#fff" stroke-width="1" fill="none"/></g>
  <ellipse cx="180" cy="411" rx="62" ry="5" fill="#1a120c" opacity=".35"/>
  ${rays}
  ${gold ? `<circle cx="180" cy="356" r="64" fill="url(#fc-gglow)" opacity=".7"/><g class="fc-gold" fill="#fff3b0">${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<path d="${star(180 + Math.cos(k * 0.785) * 52, 356 + Math.sin(k * 0.785) * 34, 4, 1.4)}" style="animation-delay:-${(k * 0.2).toFixed(1)}s"/>`).join('')}</g>` : ''}
  <path d="M128 380h104v29H128z" fill="#2f6f63"/><path d="M134 370h92l6 10H128z" fill="#3f8a7b"/>
  <path d="M128 380h104" stroke="#6fb3a3" stroke-width="1.2"/><path d="M128 380v29" stroke="#3f8a7b" stroke-width="1.4"/><path d="M232 380v29" stroke="#1f4f46" stroke-width="1.4"/>
  <path d="M232 386q7 0 7 6t-7 6" fill="none" stroke="#1f4f46" stroke-width="2.4"/><path d="M128 386q-7 0-7 6t7 6" fill="none" stroke="#25594f" stroke-width="2.4"/>
  <path d="M128 392h104" stroke="#e8782a" stroke-width="3"/><path d="M128 380h104" stroke="#25594f" stroke-width="1"/>
  <rect x="146" y="381" width="9" height="6" rx="1" fill="#c9d3d0"/><rect x="205" y="381" width="9" height="6" rx="1" fill="#c9d3d0"/>
  ${season === 'winter' ? '<path d="M134 370h92l2 3H131z" fill="#f4f7fb"/>' : ''}
  <path d="M140 371h80l4 5H136z" fill="#ece6d6"/><path d="M146 373h30M184 373h32" stroke="#b9b2a2" stroke-width=".8"/>
  <g class="fc-cookie">
    <g class="fc-ck-l"><g clip-path="url(#fc-l)">${COOKIE_ART}</g></g>
    <g class="fc-ck-r"><g clip-path="url(#fc-r)">${COOKIE_ART}</g></g>
    <path class="fc-crease" d="M180 370Q179 352 180 336" stroke="#7a4612" stroke-width="1" fill="none" opacity=".6"/>
    <path class="fc-tip" d="M172 368.5l14-1.6 1 6.2-14 1.6z" fill="#fffdf5"/><path class="fc-tip" d="M172 368.5l14-1.6" stroke="#d9cdb2" stroke-width=".6"/>
  </g>
  <g class="fc-crumbs" fill="#d9a050">${crumbs}</g>
  <g class="fc-fall">${falling}</g>
  ${ev.front}
  <g class="fc-hint"><g class="fc-hint-in">
    <rect x="48" y="458" width="264" height="36" rx="18" fill="#1a120c" opacity=".78"/>
    <text x="180" y="482" text-anchor="middle" font-family="system-ui, sans-serif" font-size="17" font-weight="700" fill="#fff6e0">${esc(t('Торкніться, щоб розламати'))}</text>
  </g></g>
  <g transform="translate(180 236)"><g class="fc-slip">
    <g class="fc-twinkles" fill="#fff1c4">${twinkles}</g>
    <rect x="-88" y="${f1(top)}" width="176" height="${f1(slipH)}" rx="2" fill="#fffdf5"${gold ? ' stroke="#d9a520" stroke-width="2"' : ''}/>
    <path d="M-88 ${f1(top)}h176" stroke="#e8e0cc" stroke-width="1"/>
    <g text-anchor="middle" font-family="system-ui, sans-serif" font-size="10.5" font-weight="700" fill="#2a3a44">${slipText}</g>
    <path d="M-60 ${f1(top + slipH - 19)}h120" stroke="#e2dccb" stroke-width=".8"/>
    <text y="${f1(top + slipH - 7)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="6.2" font-weight="700" fill="#2f6f63" letter-spacing=".03em">${esc(t('Щасливі числа').toUpperCase())}: <tspan fill="#2a3a44">${esc(lucky.join(' · '))}</tspan></text>
  </g></g>
</svg>`;
}

// ---------- показ ----------

// Звук синтезується тут же, без файлів, і лише після дотику (раніше браузер і не дасть):
// хрускіт печива, тихий «бульк» поплавка, бубонці на вершинці від поклювки, сплеск риби; золоте — ще й дзвіночки
export const SOUND_OFF = 'fishing-log:fortune-sound-off';
let audio = null;

function audioOut() {
  try { if (localStorage.getItem(SOUND_OFF) === '1') return null; } catch { /* сховище недоступне — звук як за замовчуванням */ }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    audio ??= new Ctx();
    if (audio.state === 'suspended') audio.resume();
    const out = audio.createGain();
    out.gain.value = 0.35;
    out.connect(audio.destination);
    return out;
  } catch { return null; }
}

/** Шум крізь смуговий фільтр — хрускіт і бризки. */
function noise(out, at, dur, freq, vol) {
  const rate = audio.sampleRate, buf = audio.createBuffer(1, Math.ceil(rate * dur), rate), data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = buf;
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  g.gain.value = vol;
  src.connect(filter).connect(g).connect(out);
  src.start(at);
}

/** «Бульк»: синус, що швидко падає тоном, — так звучить крапля чи поплавок. */
function plop(out, at, f0, f1, vol) {
  const osc = audio.createOscillator(), g = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, at);
  osc.frequency.exponentialRampToValueAtTime(f1, at + 0.12);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + 0.2);
}

/** Удар по металу: синус із миттєвим наростанням і згасанням за dur. */
function ring(out, at, freq, vol, dur) {
  const osc = audio.createOscillator(), g = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

const bell = (out, at, freq, vol) => ring(out, at, freq, vol, 1.2);

// Два бубонці, трохи різні за тоном; обертони негармонійні — тому звучить металом, а не дудочкою
const JINGLE_BELLS = [2480, 2930];
const JINGLE_PARTIALS = [[1, 1, 0.3], [2.37, 0.45, 0.16], [4.1, 0.22, 0.09]];
const JINGLE_HITS = [0, 0.055, 0.1, 0.17, 0.22, 0.3, 0.37, 0.47, 0.6, 0.78];

/** Бубонці на вершинці: вудилище смикнулось від поклювки, кулька тріпоче й поступово стихає. */
function jingle(out, at, vol) {
  JINGLE_HITS.forEach((dt, k) => {
    const v = vol * (1 - k / JINGLE_HITS.length) ** 1.4 * (0.75 + Math.random() * 0.5);
    const base = JINGLE_BELLS[k % 2] * (0.99 + Math.random() * 0.02);
    for (const [mul, amp, dur] of JINGLE_PARTIALS) ring(out, at + dt, base * mul, v * amp, dur);
    noise(out, at + dt, 0.012, 5200, v * 0.5);
  });
}

/** Шум, що наростає й спадає: гуркіт, рев хвилі, дощ. */
function swell(out, at, dur, freq, vol, attack = 0.6, type = 'bandpass') {
  const rate = audio.sampleRate, buf = audio.createBuffer(1, Math.ceil(rate * dur), rate), data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource(), filter = audio.createBiquadFilter(), g = audio.createGain();
  src.buffer = buf;
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = 0.7;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + dur * attack);
  g.gain.linearRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(out);
  src.start(at);
}

/** Гудіння дрона: три «пилки» крізь фільтр; підлітає — гучнішає, відлітає — тон і гучність падають. */
function buzz(out, at, dur, vol) {
  const g = audio.createGain(), filter = audio.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + dur * 0.35);
  g.gain.setValueAtTime(vol, at + dur * 0.6);
  g.gain.linearRampToValueAtTime(0.0001, at + dur);
  filter.connect(g).connect(out);
  for (const f of [196, 199, 294]) {
    const osc = audio.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * 1.06, at);
    osc.frequency.linearRampToValueAtTime(f, at + dur * 0.35);
    osc.frequency.setValueAtTime(f, at + dur * 0.6);
    osc.frequency.linearRampToValueAtTime(f * 0.9, at + dur);
    osc.connect(filter);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }
}

/** Мотор човна: глухі поштовхи, що стихають. */
function putt(out, at, dur, vol) {
  const n = Math.floor(dur / 0.085);
  for (let k = 0; k < n; k++) noise(out, at + k * 0.085, 0.05, 140, vol * (1 - k / n) ** 0.7);
}

/** Коротка «крякалка» рибоохорони: тон угору й униз двічі. */
function whoop(out, at, vol) {
  const osc = audio.createOscillator(), g = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(620, at);
  for (const d of [0, 0.32]) {
    osc.frequency.linearRampToValueAtTime(980, at + d + 0.16);
    osc.frequency.linearRampToValueAtTime(620, at + d + 0.3);
  }
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.03);
  g.gain.setValueAtTime(vol, at + 0.58);
  g.gain.linearRampToValueAtTime(0.0001, at + 0.64);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + 0.7);
}

// Звук кожної події після хрускоту й бубонців; t0 — мить розламу
const EVENT_SOUND = {
  catfish: (out, t0) => {
    plop(out, t0 + 0.62, 200, 50, 0.8);
    noise(out, t0 + 0.62, 0.5, 500, 0.6);
    [1.6, 1.75, 1.95].forEach((d) => plop(out, t0 + d, 320, 140, 0.25));
  },
  beaver: (out, t0) => {
    swell(out, t0 + 0.4, 1.6, 700, 0.12);
    [2.22, 2.3, 2.38].forEach((d) => noise(out, t0 + d, 0.04, 2600, 0.5));
    noise(out, t0 + 2.45, 0.12, 1100, 1);
    plop(out, t0 + 2.46, 300, 90, 0.5);
  },
  drone: (out, t0) => {
    buzz(out, t0 + 0.35, 3, 0.09);
    plop(out, t0 + 2.15, 520, 160, 0.5);
    noise(out, t0 + 2.15, 0.25, 1300, 0.5);
  },
  inspector: (out, t0) => {
    putt(out, t0 + 0.4, 1.7, 0.6);
    whoop(out, t0 + 2, 0.08);
  },
  fishrain: (out, t0) => {
    swell(out, t0 + 0.4, 3.2, 5000, 0.08, 0.3, 'highpass');
    for (let k = 0; k < 24; k++) plop(out, t0 + 1.3 + Math.random() * 2.6,500 + Math.random() * 400, 180, 0.15 + Math.random() * 0.15);
  },
  tsunami: (out, t0) => {
    swell(out, t0 + 0.25, 2.4, 70, 1.4, 0.85, 'lowpass');
    swell(out, t0 + 0.4, 2.2, 150, 0.8, 0.85);
    swell(out, t0 + 1, 1.6, 420, 0.7, 0.9);
    noise(out, t0 + 2.45, 1.4, 350, 1.1);
    noise(out, t0 + 2.45, 0.9, 1600, 0.6);
    [3.1, 3.3, 3.6].forEach((d) => plop(out, t0 + d, 600, 250, 0.25));
  },
};

function crackFeedback({ gold, event }) {
  navigator.vibrate?.(event === 'tsunami' ? [20, 60, 14, 400, 300, 80, 400, 80, 700] : gold ? [18, 60, 14, 900, 30] : [20, 60, 14, 1000, 24]);
  const out = audioOut();
  if (!out) return;
  try {
    const t0 = audio.currentTime + 0.02;
    noise(out, t0, 0.09, 2400, 0.9);
    plop(out, t0 + 0.14, 700, 240, 0.35);
    jingle(out, t0 + 0.18, 0.16);
    if (!event) {
      noise(out, t0 + 0.36, 0.25, 1500, 0.45);
      noise(out, t0 + 1.22, 0.35, 900, 0.7);
      plop(out, t0 + 1.24, 420, 120, 0.6);
    }
    if (gold) [1318.5, 1568, 1760, 2093].forEach((f, k) => bell(out, t0 + 0.7 + k * 0.11, f, 0.18));
    EVENT_SOUND[event]?.(out, t0);
  } catch { /* без звуку — вібрації досить */ }
}

// Коли з'являється записка: подія спершу відіграє своє (типово — 0,85 с після розламу)
const SLIP_AT = { catfish: 3.3, beaver: 3, drone: 3.2, inspector: 2.9, fishrain: 3.8, tsunami: 3.9 };

/** Програти печиво; params — для перегляду (?gold=1…), інакше випадкові. Повертає проміс закриття. */
export function playFortune(params = {}) {
  const p = { ...fortuneParams(), ...params };
  const el = document.createElement('div');
  el.className = 'scene scene-fortune';
  const stage = document.createElement('div');
  const button = (label, kind, onclick) => Object.assign(document.createElement('button'), { type: 'button', className: `btn ${kind}`, textContent: label, onclick });
  const bar = document.createElement('div');
  bar.className = 'scene-bar';
  let resolve;
  const done = new Promise((ok) => { resolve = ok; });
  // «Ще одне» — нове печиво: інше передбачення, інша риба (золота — як випаде)
  bar.append(button(t('Ще одне'), '', () => { Object.assign(p, fortuneParams(), params); play(); }),
    button(t('Закрити'), 'primary', () => close()));
  el.append(stage, bar);
  const isFinite = (a) => a.effect?.getComputedTiming().endTime !== Infinity;
  const finite = () => el.getAnimations({ subtree: true }).filter(isFinite);
  let run = 0;
  const play = () => {
    const id = ++run;
    el.classList.remove('done', ...Object.keys(EVENTS).map((k) => `ev-${k}`));
    el.classList.add('wait');
    if (p.event) el.classList.add('ev', `ev-${p.event}`); else el.classList.remove('ev');
    el.style.setProperty('--slip', `${SLIP_AT[p.event] ?? 0.85}s`);
    stage.innerHTML = fortuneCookie(p);
    const cap = document.createElement('p');
    cap.className = 'scene-cap';
    // заголовок видно; саме передбачення — на записці, а в підписі — для читача екрана
    cap.append(...[t(p.gold ? 'Золоте печиво' : 'Печиво з передбаченням'), fortuneText(p)].map((line) => Object.assign(document.createElement('span'), { textContent: line })));
    stage.append(cap);
    // стоїть на паузі, доки людина сама не торкнеться — не мультик, а дія
    stage.getAnimations({ subtree: true }).filter(isFinite).forEach((a) => a.pause());
    Promise.all(finite().map((a) => a.finished)).then(() => {
      if (id !== run) return;
      el.classList.add('done');
      bar.querySelector('.primary').focus({ preventScroll: true });
    }, () => {});
  };
  const start = () => {
    el.classList.remove('wait');
    if (p.event === 'tsunami') tsunamiSeen();
    crackFeedback(p);
    stage.getAnimations({ subtree: true }).forEach((a) => {
      // безкінечні із затримкою (риба б'ється на кладці, моргає сом) — відлік від дотику, а не від появи сцени
      if (!isFinite(a) && a.effect.getTiming().delay > 0) a.currentTime = 0;
      a.play();
    });
  };
  // перший дотик — розлам, наступний — одразу останній кадр; закривається лише кнопкою чи Esc
  stage.addEventListener('pointerdown', () => (el.classList.contains('wait') ? start() : finite().forEach((a) => a.finish())));
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if ((e.key === 'Enter' || e.key === ' ') && el.classList.contains('wait')) { e.preventDefault(); start(); }
  };
  const close = () => {
    if (el.classList.contains('out')) return;
    run++;
    el.classList.add('out');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => { el.remove(); resolve(); }, 380);
  };
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  play();
  return done;
}
