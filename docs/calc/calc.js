/* Калькулятор билдов Rogue Shard.
 *
 * Все данные — дерево, требования, описания, формулы — лежат в data.json и
 * вытащены из патченой игры. Здесь только правила прокачки и отрисовка.
 */
'use strict';

const ATTRS = ['STR', 'AGL', 'PRC', 'VIT', 'WIL'];
const ATTR_NAME = { STR: 'Strength', AGL: 'Agility', PRC: 'Perception', VIT: 'Vitality', WIL: 'Willpower' };

// Требования в игре записаны через Vitality, а не VIT.
const ATTR_ALIAS = { Vitality: 'VIT', VIT: 'VIT' };

// Особые пулы очков. Обычные очки — это пул с пустым ключом.
// У Вельмира трофеи дают только очки атрибутов; переключение трофея меняет
// доступный пул, а потраченное в каждом запоминается.
const TROPHIES = {
  Velmir: [
    { key: 'troll', label: 'Bonus points for the Ancient Troll', attr: 2, note: 'AP from the Ancient Troll' },
    { key: 'manticore', label: 'Bonus points for the Manticore', attr: 2, note: 'AP from the Manticore' },
  ],
  Jorgrim: [
    { key: 'boss', label: 'Bonus points for boss trophies', attr: 3, note: 'bonus AP from boss trophies' },
  ],
  Hilda: [
    { key: 'animal', label: 'Bonus points for animal trophies', attr: 2, note: 'bonus AP from animal trophies' },
  ],
};

// Дирвин получает по очку способностей и атрибутов за каждый третий навык
// Выживания. Отдельной галочки у них нет — работают как обычные.
const DIRWIN_BRANCH = 'survival';

let DATA = null;
let S = null;

/* --- состояние --------------------------------------------------------- */

function freshState(charKey) {
  const hero = DATA.characters.find((c) => c.key === charKey) || DATA.characters[0];
  return {
    hero: hero.key,
    level: 1,
    learned: [],          // {obj, branch, level, pool}
    attrSpent: [],        // {attr, level, pool}
    trophy: null,         // активный трофей или null
    open: [],             // открытые панели веток
    formulas: false,
    log: [],
  };
}

function hero() { return DATA.characters.find((c) => c.key === S.hero); }

/** Сколько очков выдано в каждом пуле. */
function granted() {
  const out = { '': { skill: 2 + (S.level - 1), attr: S.level - 1 } };

  // Дирвин: каждый третий навык Выживания добавляет очко в обычный пул.
  if (S.hero === 'Dirwin') {
    const n = Math.floor(S.learned.filter((l) => l.branch === DIRWIN_BRANCH).length / 3);
    out[''].skill += n;
    out[''].attr += n;
  }

  for (const t of TROPHIES[S.hero] || []) out[t.key] = { skill: 0, attr: t.attr };
  return out;
}

function spent(pool) {
  return {
    skill: S.learned.filter((l) => l.pool === pool).length,
    attr: S.attrSpent.filter((a) => a.pool === pool).length,
  };
}

/** Пул, из которого сейчас тратим: активный трофей или обычный. */
function activePool() { return S.trophy || ''; }

function left(kind) {
  // Трофейные пулы — только про атрибуты: очки способностей всегда берутся из
  // обычного пула, даже когда галочка трофея включена.
  const pool = kind === 'attr' ? activePool() : '';
  const g = granted()[pool] || { skill: 0, attr: 0 };
  return g[kind] - spent(pool)[kind];
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
  if (node.level > 1) parts.push(`level ${node.level}`);
  if (node.attrValue > 0 && node.attrs.length) {
    const names = node.attrs.map((a) => ATTR_NAME[ATTR_ALIAS[a] || a] || a).join(' + ');
    parts.push(`${names} ≥ ${node.attrValue} over 10 (now ${over})`);
  }
  return `Requires ${parts.join(' or ')}`;
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
    const name = (o) => (nodeOf(o) ? nodeOf(o).node.name.en : o);
    const variants = groups.map((g) => g.map(name).join(' + '));
    return `Requires ${variants.join(' or ')}`;
  }

  if (left('skill') <= 0) return 'No skill points left';
  return null;
}

/* --- действия ----------------------------------------------------------- */

function learn(node, branch) {
  if (blockedBy(node)) return;
  const id = ++logId;
  S.learned.push({ obj: node.obj, branch: branch.key, level: S.level, pool: '', logId: id });
  logLine(`${node.name.en}`, '', id);
  render();
}

let logId = 0;

function unlearn(obj) {
  // Снять можно только навык, на котором ничего не держится.
  const dependents = S.learned.filter((l) => {
    const found = nodeOf(l.obj);
    return found && (found.node.needs || []).some((g) => g.includes(obj));
  });
  if (dependents.length) return;
  // Строка лога снимается вместе с навыком, а не дописывается новой.
  const gone = S.learned.find((l) => l.obj === obj);
  S.learned = S.learned.filter((l) => l.obj !== obj);
  if (gone) S.log = S.log.filter((l) => l.id !== gone.logId);
  render();
}

function spendAttr(attr) {
  if (left('attr') <= 0) return;
  const pool = activePool();
  S.attrSpent.push({ attr, level: S.level, pool });
  logLine(`${ATTR_NAME[attr]} → ${attrValue(attr)}`, pool);
  render();
}

function levelUp() {
  S.level += 1;
  S.log.push({ level: S.level, text: `— level ${S.level} —`, head: true });
  render();
}

function logLine(text, pool, id) {
  const note = pool ? (TROPHIES[S.hero] || []).find((t) => t.key === pool) : null;
  S.log.push({ id, level: S.level, text, note: note ? note.note : '' });
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
        disabled: left('attr') <= 0 || null,
        onclick: () => spendAttr(a),
      }, '+'));
  }));

  const box = document.getElementById('trophies');
  box.replaceChildren(...(TROPHIES[S.hero] || []).map((t) => {
    const used = spent(t.key).attr;
    return el('label', {},
      el('input', {
        type: 'checkbox',
        checked: S.trophy === t.key || null,
        onchange: (e) => { S.trophy = e.target.checked ? t.key : null; render(); },
      }),
      el('span', {}, `${t.label} (${t.attr - used} of ${t.attr} left)`));
  }));

  const log = document.getElementById('log');
  log.replaceChildren(...S.log.map((l) => el('li', { class: l.head ? 'head' : '' },
    l.head ? null : el('span', { class: 'lv' }, l.level),
    l.text,
    l.note ? el('span', { class: 'bonus' }, ` — ${l.note}`) : null)));
  log.scrollTop = log.scrollHeight;
}

function renderTrees() {
  const grid = document.getElementById('treeGrid');
  grid.replaceChildren(...S.open.map(renderTree));

  const add = document.getElementById('addBranch');
  add.replaceChildren(
    el('option', { value: '' }, '+ add a skill tree…'),
    ...DATA.branches
      .filter((b) => !S.open.includes(b.key))
      .map((b) => el('option', { value: b.key }, b.name.replace(/_/g, ' '))));
}

function renderTree(key) {
  const b = DATA.branches.find((x) => x.key === key);
  const scale = 3;

  // Габарит ветки, чтобы панель была ровно по содержимому.
  const xs = b.nodes.map((n) => n.x - n.geom[2]);
  const ys = b.nodes.map((n) => n.y - n.geom[3]);
  const minX = Math.min(...xs) - 12;
  const minY = Math.min(...ys) - 12;
  const w = Math.max(...b.nodes.map((n) => n.x - n.geom[2] + n.geom[0])) - minX + 12;
  const h = Math.max(...b.nodes.map((n) => n.y - n.geom[3] + n.geom[1])) - minY + 12;

  const body = el('div', {
    class: 'tree-body',
    style: `width:${w * scale}px;height:${h * scale}px`,
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
        class: `order${got.pool ? ' bonus' : ''}`,
      }, got.pool ? got.pool[0].toUpperCase() : got.level));
    }
    body.append(node);
  }

  return el('section', { class: 'tree' },
    el('div', { class: 'tree-head' },
      el('span', { class: 'tree-title' }, b.name.replace(/_/g, ' ')),
      el('button', {
        class: 'tree-close',
        title: 'Close',
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
  const raw = node.desc.en || '';
  const out = document.createElement('div');

  for (const chunk of raw.split('##')) {
    const p = el('p', {});
    for (const piece of chunk.split('#')) {
      if (p.childNodes.length) p.append(el('br', {}));
      // ~lg~текст~/~ — цветной кусок.
      const parts = piece.split(/~(\w+)~|~\/~/);
      let cls = '';
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i];
        if (t === undefined) { cls = ''; continue; }
        if (/^(lg|w|sy|r|y|b)$/.test(t) && i % 2 === 1) { cls = t; continue; }
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
  const mods = (node.modifiedBy || []).map((a) => ATTR_NAME[ATTR_ALIAS[a] || a] || a.replace(/_/g, ' '));

  // replaceChildren превращает null в текстовый узел «null», поэтому пустые
  // строки надо отсеять, а не просто вернуть null вместо элемента.
  const rows = [
    el('h4', {}, node.name.en),
    el('div', { class: 'kind' }, node.passive ? 'Passive' : 'Active'),
    el('hr', {}),
    !node.tier1 && node.level > 1
      ? el('div', { class: 'row' }, el('span', {}, 'Unlocks at level'), el('b', {}, node.level))
      : null,
    !node.tier1 && node.level > 1 && node.attrValue > 0
      ? el('div', { class: 'row alt' }, el('span', {}, 'or'), el('b', {}, ''))
      : null,
    !node.tier1 && node.attrValue > 0
      ? el('div', { class: 'row' },
          el('span', {}, `${node.attrs.map((a) => ATTR_ALIAS[a] || a).join(' + ')} over 10`),
          el('b', {}, `≥ ${node.attrValue} (now ${attrOver(node)})`))
      : null,
    mods.length ? el('div', { class: 'row' }, el('span', {}, 'Modified by'), el('b', {}, mods.join(', '))) : null,
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

/* --- запуск ------------------------------------------------------------- */

function render() { renderHero(); renderTrees(); }

function boot() {
  DATA = window.CALC_DATA;
  DATA.characters.sort((a, b) => a.key.localeCompare(b.key));

  const pick = document.getElementById('character');
  pick.replaceChildren(...DATA.characters.map((c) =>
    el('option', { value: c.key }, `${c.key} — ${c.class}`)));

  S = freshState(DATA.characters[0].key);

  pick.addEventListener('change', () => {
    const open = S.open;
    S = freshState(pick.value);
    S.open = open;
    render();
  });
  document.getElementById('levelUp').addEventListener('click', levelUp);
  document.getElementById('reset').addEventListener('click', () => {
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
