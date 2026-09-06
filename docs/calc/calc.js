/* Калькулятор билдов Rogue Shard.
 *
 * Все данные — дерево, требования, описания, формулы — лежат в data.json и
 * вытащены из патченой игры. Здесь только правила прокачки и отрисовка.
 */
'use strict';

const ATTRS = ['STR', 'AGL', 'PRC', 'VIT', 'WIL'];

/* --- язык ---------------------------------------------------------------
 *
 * Выбор хранится под тем же ключом, что и на страницах снаряжения, поэтому
 * переключённый там язык остаётся переключённым и здесь.
 *
 * Названия навыков, их описания и названия веток приходят из игры сразу на
 * двух языках — их достаточно достать через loc(). Здесь лежит только то,
 * чего в игре нет: подписи самого калькулятора.
 */
let LANG = 'en';
try { if (localStorage.getItem('rs-lang') === 'ru') LANG = 'ru'; } catch (e) { /* приватное окно */ }

/** Значение из данных игры: {ru, en} — или уже готовая строка. */
function loc(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : (v[LANG] || v.en || '');
}

const T = {
  addTree:     ['+ add a skill tree…',    '+ добавить ветку…'],
  log:         ['Log',                    'Прокачка'],
  level:       ['Level',                  'Уровень'],
  skillPoints: ['Skill points',           'Очки способностей'],
  attrPoints:  ['Attribute points',       'Очки атрибутов'],
  levelUp:     ['Level up',               'Повысить уровень'],
  undo:        ['Undo',                   'Отменить'],
  reset:       ['Reset',                  'Сбросить'],
  formulas:    ['Show formulas instead of numbers', 'Показывать формулы вместо чисел'],
  share:       ['Copy build link',        'Скопировать ссылку'],
  shareDone:   ['Link copied',            'Ссылка скопирована'],
  shareFail:   ['Copy failed — the link is in the address bar',
                'Не скопировалось — ссылка в адресной строке'],
  title:       ['Build Calculator',       'Калькулятор билдов'],
  wiki:        ['Rogue Shard Wiki',       'Вики Rogue Shard'],
  close:       ['Close',                  'Закрыть'],
  passive:     ['Passive',                'Пассивная'],
  active:      ['Active',                 'Активная'],
  unlocksAt:   ['Unlocks at level',       'Открывается на уровне'],
  or:          ['or',                     'или'],
  over10:      ['over 10',                'сверх 10'],
  now:         ['now',                    'сейчас'],
  modifiedBy:  ['Modified by',            'Зависит от'],
  startSkill:  ['starting skill',         'стартовый навык'],
  noPoints:    ['No skill points left',   'Очков способностей не осталось'],
  requires:    ['Requires',               'Требуется'],
  levelWord:   ['level',                  'уровень'],
  oldLink:     ['This link is from an older version of the calculator — the build was restored only in part.',
                'Ссылка от старой версии калькулятора — билд восстановлен не полностью.'],
};

function t(key) { return pick(T[key] || ['', '']); }

/** Пара [en, ru] -> нужный язык. */
function pick(pair) { return Array.isArray(pair) ? pair[LANG === 'ru' ? 1 : 0] : pair; }

const ATTR_NAMES = {
  STR: ['Strength', 'Сила'],
  AGL: ['Agility', 'Ловкость'],
  PRC: ['Perception', 'Восприятие'],
  VIT: ['Vitality', 'Живучесть'],
  WIL: ['Willpower', 'Воля'],
};

function attrName(a) { return (ATTR_NAMES[a] || [a, a])[LANG === 'ru' ? 1 : 0]; }

// Оставлено ради мест, где имя атрибута нужно как обычная строка.
const ATTR_NAME = new Proxy({}, { get: (_, k) => attrName(String(k)) });

// Требования в игре записаны через Vitality, а не VIT.
const ATTR_ALIAS = { Vitality: 'VIT', VIT: 'VIT' };

// Особые пулы очков. Обычные очки — это пул с пустым ключом.
// У Вельмира трофеи дают только очки атрибутов; переключение трофея меняет
// доступный пул, а потраченное в каждом запоминается.
const TROPHIES = {
  Velmir: [
    { key: 'troll', attr: 2,
      label: ['Bonus points for the Ancient Troll', 'Очки за Древнего тролля'],
      note: ['AP from the Ancient Troll', 'очки за Древнего тролля'] },
    { key: 'manticore', attr: 2,
      label: ['Bonus points for the Manticore', 'Очки за Мантикору'],
      note: ['AP from the Manticore', 'очки за Мантикору'] },
  ],
  Jorgrim: [
    { key: 'boss', attr: 3,
      label: ['Bonus points for boss trophies', 'Очки за трофеи боссов'],
      note: ['bonus AP from boss trophies', 'очки за трофеи боссов'] },
  ],
  Hilda: [
    { key: 'animal', attr: 2,
      label: ['Bonus points for animal trophies', 'Очки за трофеи зверей'],
      note: ['bonus AP from animal trophies', 'очки за трофеи зверей'] },
  ],
};

// Дирвин получает по очку способностей и атрибутов за каждый третий навык
// Выживания. Отдельной галочки у них нет — работают как обычные.
const DIRWIN_BRANCH = 'survival';

// Махир — за ветки, а не за отдельные навыки: как только в ветке выучено
// шесть навыков, она приносит одно очко способностей. Веток, которые могут
// заплатить, не больше пяти, и очка атрибутов среди наград нет.
//
// В перке (o_perk_lifelong_journey) это `categorySkillsOpenNonStart == 6` под
// проверками `SkillsOpened < 5` и «эта ветка ещё не платила»; стартовые навыки
// в счёт не идут — на то и NonStart.
const MAHIR_PER_BRANCH = 6;
const MAHIR_MAX_BRANCHES = 5;

// Потолок атрибута. Игра говорит об этом прямо в описании: «Макс. значение
// силы — 30 ед.»
const ATTR_CAP = 30;

// Потолок уровня — тоже 30.
const LEVEL_CAP = 30;

let DATA = null;
let S = null;

/* --- состояние --------------------------------------------------------- */

// Пул стартовых навыков: они выданы перком или всем сразу, очков не стоят и
// снять их нельзя.
const START = 'start';

function freshState(charKey) {
  const hero = DATA.characters.find((c) => c.key === charKey) || DATA.characters[0];

  const start = (hero.start || []).map((obj) => {
    const found = nodeOf(obj);
    return { obj, branch: found ? found.branch.key : '', level: 0, pool: START };
  });

  return {
    hero: hero.key,
    level: 1,
    learned: start,       // {obj, branch, level, pool}
    attrSpent: [],        // {attr, level, pool}
    granted: [],          // выданные трофейные пулы, в порядке нажатия
    open: [],             // открытые панели веток
    formulas: false,
    log: start.map((l) => ({
      id: 0,
      level: '',
      text: nodeOf(l.obj) ? loc(nodeOf(l.obj).node.name) : l.obj,
      note: t('startSkill'),
    })),
  };
}

function hero() { return DATA.characters.find((c) => c.key === S.hero); }

/** Сколько очков выдано в каждом пуле. */
function granted() {
  const out = { '': { skill: 2 + (S.level - 1), attr: S.level - 1 } };

  // Дирвин: каждый третий навык Выживания добавляет очко в обычный пул.
  //
  // Считается не «выученное за очки», а всё, что игра пропустила через
  // счётчик global.open_survival_skill. В o_skill_ico_Other_18 он растёт под
  // `if (!created_on_start)`, а этот флаг стоит ровно у одной Разделки.
  // Поэтому Привал, выданный Дирвину перком, в счёт идёт наравне с
  // выученными, а Разделка, которая есть у всех, — нет.
  if (S.hero === 'Dirwin') {
    const learnedHere = S.learned.filter(
      (l) => l.branch === DIRWIN_BRANCH && !(nodeOf(l.obj) || {}).node?.onStart);
    const n = Math.floor(learnedHere.length / 3);
    out[''].skill += n;
    out[''].attr += n;
  }

  // Махир: считаем ветки, где набралось шесть выученных навыков.
  if (S.hero === 'Mahir') {
    const perBranch = {};
    for (const l of S.learned) {
      if (l.pool === START) continue;
      perBranch[l.branch] = (perBranch[l.branch] || 0) + 1;
    }
    const paid = Object.values(perBranch).filter((n) => n >= MAHIR_PER_BRANCH).length;
    out[''].skill += Math.min(paid, MAHIR_MAX_BRANCHES);
  }

  // Трофейный пул существует только после нажатия кнопки.
  for (const t of TROPHIES[S.hero] || []) {
    out[t.key] = { skill: 0, attr: S.granted.includes(t.key) ? t.attr : 0 };
  }
  return out;
}

/** Из какого пула тратить следующее очко атрибутов: трофейные идут первыми. */
function attrPool() {
  const g = granted();
  for (const key of S.granted) {
    if ((g[key] || { attr: 0 }).attr - spent(key).attr > 0) return key;
  }
  return '';
}

function spent(pool) {
  return {
    skill: S.learned.filter((l) => l.pool === pool).length,
    attr: S.attrSpent.filter((a) => a.pool === pool).length,
  };
}

function left(kind) {
  const g = granted();
  if (kind === 'skill') return g[''].skill - spent('').skill;

  // Очки атрибутов показываются одним числом: обычные плюс невыбранные
  // трофейные. Откуда именно уйдёт следующее — решает attrPool.
  return Object.keys(g).reduce((t, key) => t + g[key].attr - spent(key).attr, 0);
}

function attrValue(attr) {
  return hero().attrs[attr] + S.attrSpent.filter((a) => a.attr === attr).length;
}

/* --- правила прокачки --------------------------------------------------- */

function nodeOf(obj) {
  for (const b of DATA.branches) {
    const n = b.nodes.find((x) => x.obj === obj);
    if (n) return { node: n, branch: b };
  }
  return null;
}

function isLearned(obj) { return S.learned.some((l) => l.obj === obj); }

/** Сумма атрибутов навыка сверх базовой десятки — так считает игра. */
function attrOver(node) {
  return (node.attrs || []).reduce(
    (t, a) => t + (attrValue(ATTR_ALIAS[a] || a) - 10), 0);
}

function requirementText(node, over) {
  const parts = [];
  if (node.level > 1) parts.push(`${t('levelWord')} ${node.level}`);
  if (node.attrValue > 0 && node.attrs.length) {
    const names = node.attrs.map((a) => attrName(ATTR_ALIAS[a] || a)).join(' + ');
    parts.push(`${names} ≥ ${node.attrValue} ${t('over10')} (${t('now')} ${over})`);
  }
  return `${t('requires')} ${parts.join(` ${t('or')} `)}`;
}

/** Почему навык нельзя взять — или null, если можно. */
function blockedBy(node) {
  if (isLearned(node.obj)) return 'learned';

  // Уровень и атрибуты — АЛЬТЕРНАТИВЫ: в o_skill_ico_Other_11 каждая проверка
  // снимает замок сама по себе. И считается не сумма атрибутов, а сумма
  // превышения над базовой десяткой: `_attributes_points += _attribute - 10`.
  // Первый тир ветки открыт всегда: scr_skill_open_from_array снимает с него
  // замок, и проверки уровня с атрибутами до него не доходят.
  const needLevel = !node.tier1 && node.level > 1;
  const needAttrs = !node.tier1 && node.attrValue > 0 && node.attrs.length > 0;
  if (needLevel || needAttrs) {
    const byLevel = needLevel && S.level >= node.level;
    const over = attrOver(node);
    const byAttrs = needAttrs && over >= node.attrValue;
    if (!byLevel && !byAttrs) return requirementText(node, over);
  }

  // needs — это группы: внутри группы нужны все навыки, а групп достаточно
  // любой (правило checkConnected из ctr_SkillConnection).
  const groups = node.needs || [];
  if (groups.length && !groups.some((g) => g.every(isLearned))) {
    const name = (o) => (nodeOf(o) ? loc(nodeOf(o).node.name) : o);
    const variants = groups.map((g) => g.map(name).join(' + '));
    return `${t('requires')} ${variants.join(` ${t('or')} `)}`;
  }

  if (left('skill') <= 0) return t('noPoints');
  return null;
}

/* --- действия ----------------------------------------------------------- */

// Откат снимками, а не обратными операциями: состояние маленькое, а обратная
// операция для каждого действия — отдельный источник ошибок (снятый навык
// тянет за собой очки, бонусы Дирвина и строки лога).
const HISTORY = [];
const TRACKED = ['level', 'learned', 'attrSpent', 'granted', 'log'];

function snapshot() {
  const keep = {};
  for (const k of TRACKED) keep[k] = S[k];
  HISTORY.push(JSON.stringify(keep));
  if (HISTORY.length > 300) HISTORY.shift();
}

function undo() {
  if (!HISTORY.length) return;
  Object.assign(S, JSON.parse(HISTORY.pop()));
  render();
}

function learn(node, branch) {
  if (blockedBy(node)) return;
  snapshot();
  const id = ++logId;
  S.learned.push({ obj: node.obj, branch: branch.key, level: S.level, pool: '', logId: id });
  logLine(loc(node.name), '', id);
  render();
}

let logId = 0;

function unlearn(obj) {
  const own = S.learned.find((l) => l.obj === obj);
  if (own && own.pool === START) return;

  // Снять можно только навык, на котором ничего не держится.
  const dependents = S.learned.filter((l) => {
    const found = nodeOf(l.obj);
    return found && (found.node.needs || []).some((g) => g.includes(obj));
  });
  if (dependents.length) return;
  snapshot();
  // Строка лога снимается вместе с навыком, а не дописывается новой.
  const gone = S.learned.find((l) => l.obj === obj);
  S.learned = S.learned.filter((l) => l.obj !== obj);
  if (gone) S.log = S.log.filter((l) => l.id !== gone.logId);
  render();
}

function spendAttr(attr) {
  if (left('attr') <= 0 || attrValue(attr) >= ATTR_CAP) return;
  snapshot();
  const pool = attrPool();
  S.attrSpent.push({ attr, level: S.level, pool });
  logLine(`${ATTR_NAME[attr]} → ${attrValue(attr)}`, pool);
  render();
}

function levelUp() {
  // Отдельной строки про сам уровень в логе нет: номер уровня и так стоит
  // слева у каждой записи о трате.
  if (S.level >= LEVEL_CAP) return;
  snapshot();
  S.level += 1;
  render();
}

function logLine(text, pool, id) {
  const note = pool ? (TROPHIES[S.hero] || []).find((t) => t.key === pool) : null;
  S.log.push({ id, level: S.level, text, note: note ? pick(note.note) : '' });
}

/* --- отрисовка ---------------------------------------------------------- */

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

function renderHero() {
  const h = hero();
  document.getElementById('face').src = `icons/${h.avatar}.png`;
  document.getElementById('heroName').textContent = h.key;
  document.getElementById('heroClass').textContent = `${h.class} · ${h.country}`;
  document.getElementById('level').textContent = S.level;

  const ps = document.getElementById('pointSkill');
  const pa = document.getElementById('pointAttr');
  ps.querySelector('b').textContent = left('skill');
  pa.querySelector('b').textContent = left('attr');
  ps.classList.toggle('has', left('skill') > 0);
  pa.classList.toggle('has', left('attr') > 0);

  const list = document.getElementById('attrs');
  list.replaceChildren(...ATTRS.map((a) => {
    const gain = S.attrSpent.filter((x) => x.attr === a).length;
    return el('li', {},
      el('span', { class: 'a-name' }, ATTR_NAME[a]),
      el('span', { class: 'a-value' }, attrValue(a)),
      el('span', { class: 'a-gain' }, gain ? `+${gain}` : ''),
      el('button', {
        disabled: (left('attr') <= 0 || attrValue(a) >= ATTR_CAP) || null,
        title: attrValue(a) >= ATTR_CAP ? `Capped at ${ATTR_CAP}` : null,
        onclick: () => spendAttr(a),
      }, '+'));
  }));

  const box = document.getElementById('trophies');
  box.replaceChildren(...(TROPHIES[S.hero] || []).map((t) => {
    const given = S.granted.includes(t.key);
    return el('button', {
      class: `trophy${given ? ' given' : ''}`,
      disabled: given || null,
      onclick: () => {
        snapshot();
        S.granted.push(t.key);
        render();
      },
    },
      el('span', { class: 'trophy-label' }, pick(t.label)),
      el('span', { class: 'trophy-gain' }, given ? 'granted' : `+${t.attr} AP`));
  }));

  const undoBtn = document.getElementById('undo');
  undoBtn.disabled = HISTORY.length === 0;

  const levelBtn = document.getElementById('levelUp');
  levelBtn.disabled = S.level >= LEVEL_CAP;
  levelBtn.title = S.level >= LEVEL_CAP ? `Level ${LEVEL_CAP} is the cap` : '';

  const log = document.getElementById('log');
  log.replaceChildren(...S.log.map((l) => el('li', {},
    el('span', { class: 'lv' }, l.level),
    l.text,
    l.note ? el('span', { class: 'bonus' }, ` — ${l.note}`) : null)));
}

function renderTrees() {
  const grid = document.getElementById('treeGrid');
  grid.replaceChildren(...S.open.map(renderTree));

  // Ветки идут в том же порядке и теми же тремя группами, что в окне умений:
  // порядок задан в data.js, здесь он только разбивается на optgroup.
  const add = document.getElementById('addBranch');
  const groups = [];
  for (const b of DATA.branches) {
    if (S.open.includes(b.key)) continue;
    const title = loc(b.group);
    if (!groups.length || groups[groups.length - 1].title !== title) {
      groups.push({ title, items: [] });
    }
    groups[groups.length - 1].items.push(b);
  }
  add.replaceChildren(
    el('option', { value: '' }, t('addTree')),
    ...groups.map((g) => el('optgroup', { label: g.title },
      ...g.items.map((b) => el('option', { value: b.key }, loc(b.name).replace(/_/g, ' '))))));
}

// Во сколько раз игровые координаты крупнее на странице. 2.5 — размер, на
// котором дерево читается лучше всего; панель ветки выходит 408px.
const SCALE = 2.5;

/** Высота самой длинной ветки: по ней равняются все панели. */
function tallestBranch() {
  let tall = 0;
  for (const b of DATA.branches) {
    const ys = b.nodes.map((n) => n.y - n.geom[3]);
    const h = Math.max(...b.nodes.map((n) => n.y - n.geom[3] + n.geom[1]))
            - (Math.min(...ys) - 12) + 12;
    if (h > tall) tall = h;
  }
  return tall;
}

function renderTree(key) {
  const b = DATA.branches.find((x) => x.key === key);
  const scale = SCALE;

  // Габарит ветки, чтобы панель была ровно по содержимому.
  const xs = b.nodes.map((n) => n.x - n.geom[2]);
  const ys = b.nodes.map((n) => n.y - n.geom[3]);
  const minX = Math.min(...xs) - 12;
  const minY = Math.min(...ys) - 12;
  const w = Math.max(...b.nodes.map((n) => n.x - n.geom[2] + n.geom[0])) - minX + 12;
  const h = Math.max(...b.nodes.map((n) => n.y - n.geom[3] + n.geom[1])) - minY + 12;

  // Все панели одной высоты — по самой длинной ветке, иначе ряд выглядит
  // рваным. Лишнее место внизу просто остаётся фоном.
  const body = el('div', {
    class: 'tree-body',
    style: `width:${w * scale}px;height:${Math.max(h, tallestBranch()) * scale}px`,
  });

  for (const ln of b.lines) {
    const on = (ln.needs || []).some((g) => g.every(isLearned));
    body.append(el('img', {
      class: `line${on ? ' on' : ''}`,
      src: `icons/${ln.sprite}.png`,
      alt: '',
      style: `left:${(ln.x - ln.geom[2] - minX) * scale}px;top:${(ln.y - ln.geom[3] - minY) * scale}px;`
           + `width:${ln.geom[0] * scale}px;height:${ln.geom[1] * scale}px`,
    }));
  }

  for (const n of b.nodes) {
    const got = S.learned.find((l) => l.obj === n.obj);
    const can = !got && !blockedBy(n);
    const node = el('button', {
      class: `node${got ? ' got' : ''}${can ? ' can' : ''}`,
      style: `left:${(n.x - n.geom[2] - minX) * scale}px;top:${(n.y - n.geom[3] - minY) * scale}px;`
           + `width:${n.geom[0] * scale}px;height:${n.geom[1] * scale}px`,
      onclick: () => (got ? unlearn(n.obj) : learn(n, b)),
      onmouseenter: (e) => showTip(e, n),
      onmousemove: moveTip,
      onmouseleave: hideTip,
    }, el('img', { src: `icons/${n.icon}.png`, alt: '' }));

    if (got) {
      node.append(el('span', {
        class: `order${got.pool ? ' bonus' : ''}${got.pool === START ? ' start' : ''}`,
      }, got.pool === START ? '★' : (got.pool ? got.pool[0].toUpperCase() : got.level)));
    }
    body.append(node);
  }

  return el('section', { class: 'tree' },
    el('div', { class: 'tree-head' },
      el('span', { class: 'tree-title' }, loc(b.name).replace(/_/g, ' ')),
      el('button', {
        class: 'tree-close',
        title: t('close'),
        onclick: () => { S.open = S.open.filter((k) => k !== key); render(); },
      }, '✕')),
    body);
}

/* --- подсказка ---------------------------------------------------------- */

// Атрибуты, которые калькулятор знает. Остальное (Magic_Power и прочие
// производные) он посчитать не может — для таких формул показывается сама
// формула, а не выдуманное число.
const KNOWN = new Set(['STR', 'AGL', 'PRC', 'WIL', 'Vitality']);

function compute(expr) {
  const names = expr.match(/A\.(\w+)/g) || [];
  if (names.some((n) => !KNOWN.has(n.slice(2)))) return null;
  if (!/^[\sA-Za-z0-9._+\-*/()]*$/.test(expr)) return null;

  const A = {
    STR: attrValue('STR'), AGL: attrValue('AGL'), PRC: attrValue('PRC'),
    WIL: attrValue('WIL'), Vitality: attrValue('VIT'),
  };
  try {
    // eslint-disable-next-line no-new-func
    const v = Function('A', 'Math', `return (${expr});`)(A, Math);
    return typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : null;
  } catch (e) { return null; }
}

/** Описание из таблицы: цветовые теги, переносы и подстановка значений. */
function describe(node) {
  const raw = loc(node.desc) || '';
  const out = document.createElement('div');

  for (const chunk of raw.split('##')) {
    const p = el('p', {});
    for (const piece of chunk.split('#')) {
      if (p.childNodes.length) p.append(el('br', {}));
      // ~lg~текст~/~ — цветной кусок.
      // ~r~-6%~/~ — цветной кусок. Метки не перечисляем: их два десятка, и
      // список в коде разъезжался бы с игрой. Незнакомая метка просто даст
      // класс без правила, то есть обычный цвет, — но текст не потеряется.
      const parts = piece.split(/~(\w+)~|~\/~/);
      let cls = '';
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i];
        if (i % 2 === 1) { cls = t === undefined ? '' : `c-${t}`; continue; }
        if (!t) continue;
        p.append(el('span', { class: cls }, ...fillValues(t, node)));
      }
    }
    out.append(p);
  }
  return out;
}

// Заменяет плейсхолдер вида /*Ключ*/ на число или формулу.
function fillValues(text, node) {
  const bits = [];
  const re = /\/\*([^*]+)\*\//g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) bits.push(text.slice(last, m.index));
    const key = m[1];
    const expr = node.values ? node.values[key] : null;
    if (!expr) {
      bits.push(el('span', { class: 'formula' }, key));
    } else if (S.formulas) {
      bits.push(el('span', { class: 'formula' }, expr.replace(/A\./g, '')));
    } else {
      const v = compute(expr);
      bits.push(v === null
        ? el('span', { class: 'formula' }, expr.replace(/A\./g, ''))
        : String(v));
    }
    last = re.lastIndex;
  }
  if (last < text.length) bits.push(text.slice(last));
  return bits;
}

function showTip(e, node) {
  const tip = document.getElementById('tip');
  const blocked = blockedBy(node);
  const mods = (node.modifiedBy || []).map((a) => (ATTR_NAMES[ATTR_ALIAS[a] || a] ? attrName(ATTR_ALIAS[a] || a) : a.replace(/_/g, ' ')));

  // replaceChildren превращает null в текстовый узел «null», поэтому пустые
  // строки надо отсеять, а не просто вернуть null вместо элемента.
  const rows = [
    el('h4', {}, loc(node.name)),
    el('div', { class: 'kind' }, node.passive ? t('passive') : t('active')),
    el('hr', {}),
    !node.tier1 && node.level > 1
      ? el('div', { class: 'row' }, el('span', {}, t('unlocksAt')), el('b', {}, node.level))
      : null,
    !node.tier1 && node.level > 1 && node.attrValue > 0
      ? el('div', { class: 'row alt' }, el('span', {}, t('or')), el('b', {}, ''))
      : null,
    !node.tier1 && node.attrValue > 0
      ? el('div', { class: 'row' },
          el('span', {}, `${node.attrs.map((a) => ATTR_ALIAS[a] || a).join(' + ')} ${t('over10')}`),
          el('b', {}, `≥ ${node.attrValue} (${t('now')} ${attrOver(node)})`))
      : null,
    mods.length ? el('div', { class: 'row' }, el('span', {}, t('modifiedBy')), el('b', {}, mods.join(', '))) : null,
    el('hr', {}),
    describe(node),
    blocked && blocked !== 'learned' ? el('hr', {}) : null,
    blocked && blocked !== 'learned' ? el('div', { class: 'req no' }, blocked) : null,
  ];
  tip.replaceChildren(...rows.flat().filter(Boolean));

  tip.hidden = false;
  moveTip(e);
}

function moveTip(e) {
  const tip = document.getElementById('tip');
  const pad = 16;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + tip.offsetWidth > window.innerWidth) x = e.clientX - tip.offsetWidth - pad;
  if (y + tip.offsetHeight > window.innerHeight) y = window.innerHeight - tip.offsetHeight - pad;
  tip.style.left = `${Math.max(pad, x)}px`;
  tip.style.top = `${Math.max(pad, y)}px`;
}

function hideTip() { document.getElementById('tip').hidden = true; }

/* --- ссылка на билд ------------------------------------------------------
 *
 * В адрес кладётся сам билд, а не ссылка на сохранённое где-то состояние:
 * страница статическая, сервера у неё нет, и делиться больше нечем.
 *
 * Навыки и ветки записаны номерами: имена объектов вроде
 * o_pass_skill_blow_after_blow длинные, а ссылку человеку ещё отправлять.
 * Номер — позиция в общем списке узлов; он держится, пока в дереве ничего не
 * переставляли, поэтому в начале стоит версия. Ссылка, собранная до
 * перестановки, восстановится частично и скажет об этом.
 */
const SHARE_VERSION = 1;

/** Плоский список всех узлов в порядке данных: индекс <-> объект. */
const FLAT = [];
const FLAT_INDEX = {};

function buildFlat() {
  FLAT.length = 0;
  for (const b of DATA.branches) {
    for (const n of b.nodes) {
      FLAT_INDEX[n.obj] = FLAT.length;
      FLAT.push({ obj: n.obj, branch: b.key });
    }
  }
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const pad = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBuild() {
  const trophies = TROPHIES[S.hero] || [];
  const short = {
    v: SHARE_VERSION,
    h: S.hero,
    l: S.level,
    // Стартовые навыки не пишем: их выдаёт сам персонаж, и при разборе
    // ссылки они появятся снова.
    s: S.learned.filter((x) => x.pool !== START)
        .map((x) => (x.pool ? [FLAT_INDEX[x.obj], x.level, x.pool]
                            : [FLAT_INDEX[x.obj], x.level])),
    a: S.attrSpent.map((x) => (x.pool ? [ATTRS.indexOf(x.attr), x.level, x.pool]
                                      : [ATTRS.indexOf(x.attr), x.level])),
    g: S.granted.map((k) => trophies.findIndex((t) => t.key === k)),
    o: S.open.map((k) => DATA.branches.findIndex((b) => b.key === k)),
  };
  return toBase64Url(JSON.stringify(short));
}

/** Разбирает ссылку в состояние. Возвращает false, если данные не подошли. */
function decodeBuild(code) {
  let d;
  try { d = JSON.parse(fromBase64Url(code)); } catch (e) { return false; }
  if (!d || d.v !== SHARE_VERSION) return false;
  if (!DATA.characters.some((c) => c.key === d.h)) return false;

  const trophies = TROPHIES[d.h] || [];
  const state = freshState(d.h);
  let complete = true;

  state.level = Math.min(Math.max(1, d.l | 0), LEVEL_CAP);
  state.granted = (d.g || []).map((i) => (trophies[i] || {}).key).filter(Boolean);
  state.open = (d.o || []).map((i) => (DATA.branches[i] || {}).key).filter(Boolean);
  if (state.open.length !== (d.o || []).length) complete = false;

  for (const [index, level, pool] of d.s || []) {
    const flat = FLAT[index];
    if (!flat) { complete = false; continue; }
    state.learned.push({ obj: flat.obj, branch: flat.branch, level, pool: pool || '' });
  }
  for (const [index, level, pool] of d.a || []) {
    const attr = ATTRS[index];
    if (!attr) { complete = false; continue; }
    state.attrSpent.push({ attr, level, pool: pool || '' });
  }

  S = state;
  rebuildLog();
  return complete;
}

/** Лог собирается заново: по уровням, внутри уровня сперва навыки.
 *
 * Порядок внутри одного уровня в ссылке не хранится — он ничего не решает
 * в самом билде, а ссылку укоротил заметно.
 */
function rebuildLog() {
  const start = S.learned.filter((l) => l.pool === START);
  S.log = start.map((l) => ({
    id: 0,
    level: '',
    text: nodeOf(l.obj) ? loc(nodeOf(l.obj).node.name) : l.obj,
    note: t('startSkill'),
  }));

  const trophies = TROPHIES[S.hero] || [];
  const noteOf = (pool) => {
    const found = pool ? trophies.find((x) => x.key === pool) : null;
    return found ? pick(found.note) : '';
  };

  const base = { STR: 0, AGL: 0, PRC: 0, VIT: 0, WIL: 0 };
  for (const a of ATTRS) base[a] = hero().attrs[a];

  for (let level = 1; level <= S.level; level++) {
    for (const l of S.learned) {
      if (l.pool === START || l.level !== level) continue;
      l.logId = ++logId;
      S.log.push({ id: l.logId, level, text: nodeOf(l.obj) ? loc(nodeOf(l.obj).node.name) : l.obj,
                   note: noteOf(l.pool) });
    }
    for (const a of S.attrSpent) {
      if (a.level !== level) continue;
      base[a.attr] += 1;
      S.log.push({ id: ++logId, level, text: `${attrName(a.attr)} → ${base[a.attr]}`,
                   note: noteOf(a.pool) });
    }
  }
}

function shareLink() {
  const code = encodeBuild();
  // location.origin у файла с диска — строка "null", поэтому адрес берётся
  // целиком и у него отрезается старый хэш.
  const url = `${location.href.split('#')[0]}#b=${code}`;
  try { history.replaceState(null, '', `#b=${code}`); } catch (e) { /* file:// */ }
  const note = document.getElementById('shareNote');
  const show = (text) => {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(shareLink.timer);
    shareLink.timer = setTimeout(() => { note.hidden = true; }, 2500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => show(t('shareDone')),
                                            () => show(t('shareFail')));
  } else {
    show(t('shareFail'));
  }
}

/* --- переключатель языка ------------------------------------------------- */

function applyStaticText() {
  document.title = `${t('title')} — Rogue Shard Wiki`;
  document.documentElement.lang = LANG;
  for (const node of document.querySelectorAll('[data-t]')) {
    node.textContent = t(node.getAttribute('data-t'));
  }
  for (const button of document.querySelectorAll('#lang button')) {
    button.classList.toggle('on', button.getAttribute('data-lang') === LANG);
  }
}

function setLang(next) {
  if (next === LANG) return;
  LANG = next;
  try { localStorage.setItem('rs-lang', next); } catch (e) { /* приватное окно */ }
  applyStaticText();
  rebuildLog();
  render();
}

/* --- запуск ------------------------------------------------------------- */

function render() { renderHero(); renderTrees(); }

function boot() {
  DATA = window.CALC_DATA;

  // Порядок героев не трогаем: он идёт из scr_classCreate, то есть тот же,
  // в каком они стоят в меню выбора персонажа. Класс виден в панели ниже.
  const heroPick = document.getElementById('character');
  heroPick.replaceChildren(...DATA.characters.map((c) =>
    el('option', { value: c.key }, c.key)));

  buildFlat();
  applyStaticText();

  S = freshState(DATA.characters[0].key);

  // Ссылка на билд: если она в адресе, начинаем не с чистого листа.
  const shared = /[#&]b=([A-Za-z0-9\-_]+)/.exec(location.hash);
  if (shared) {
    const complete = decodeBuild(shared[1]);
    if (!complete) {
      const note = document.getElementById('shareNote');
      note.textContent = t('oldLink');
      note.hidden = false;
    }
  }

  heroPick.value = S.hero;
  heroPick.addEventListener('change', () => {
    HISTORY.length = 0;
    const open = S.open;
    S = freshState(heroPick.value);
    S.open = open;
    render();
  });
  document.getElementById('share').addEventListener('click', shareLink);
  document.getElementById('lang').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-lang]');
    if (button) setLang(button.getAttribute('data-lang'));
  });
  document.getElementById('levelUp').addEventListener('click', levelUp);
  document.getElementById('undo').addEventListener('click', undo);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });
  document.getElementById('reset').addEventListener('click', () => {
    HISTORY.length = 0;
    const open = S.open;
    S = freshState(S.hero);
    S.open = open;
    render();
  });
  document.getElementById('formulaMode').addEventListener('change', (e) => {
    S.formulas = e.target.checked;
  });
  document.getElementById('addBranch').addEventListener('change', (e) => {
    if (e.target.value) S.open.push(e.target.value);
    render();
  });

  render();
}

boot();
