// Дерево категорій каталогу (lib/categoryTree.json, зібране зі skay_categories_UA_RU.xlsx).
//
// Що вміє цей модуль:
//   1) matchBroad()  — «широкий» запит рівня «Товари для тварин» → замість випадкових товарів
//                      віддаємо кнопки підкатегорій (лише ті, де є товари В НАЯВНОСТІ).
//   2) browse()      — що показати після натискання на кнопку: ще кнопки глибше або товари.
//   3) route()       — точний запит («іграшка для собаки») → яка саме гілка дерева йому відповідає;
//                      потім пошук (лексичний + векторний) іде ТІЛЬКИ серед товарів цієї гілки.
//
// Нічого тут не змінює наявну логіку чату: chatController звертається до модуля лише там, де
// раніше нічого розумного зробити не міг, а CATEGORY_TREE=0 у .env повністю вимикає модуль.

const TREE = require("./categoryTree.json");
const { isUsedProduct } = require("./search");

const ENABLED = process.env.CATEGORY_TREE !== "0";
const MAX_CHIPS = 16;

// ── Вузли ──────────────────────────────────────────────────────────────────────

const nodes = TREE.nodes.map((n) => ({
  ...n,
  ids: [n.id, ...(n.xids || [])].filter((v) => v != null).map(String),
}));
const byKey = new Map(nodes.map((n) => [n.k, n]));
const childrenOf = new Map();
for (const n of nodes) {
  if (n.p) {
    if (!childrenOf.has(n.p)) childrenOf.set(n.p, []);
    childrenOf.get(n.p).push(n);
  }
}

const nodeByCatId = new Map();
for (const n of nodes) {
  if (n.skip) continue;
  for (const id of n.ids) {
    const prev = nodeByCatId.get(id);
    if (!prev || (prev.hid && !n.hid)) nodeByCatId.set(id, n);
  }
}
// Вузол дерева, у якому лежить товар (за id категорії з фіда).
function nodeOfProduct(p) {
  return p ? nodeByCatId.get(String(p.categoryId)) || null : null;
}

function getNode(key) {
  return key ? byKey.get(String(key)) || null : null;
}
function parentOf(node) {
  return node && node.p ? byKey.get(node.p) || null : null;
}
function chain(node) {
  const out = [];
  let cur = node;
  while (cur) {
    out.unshift(cur);
    cur = parentOf(cur);
  }
  return out; // від розділу до самого вузла
}
function pathLabel(node) {
  return chain(node).map((n) => n.ua).join(" › ");
}

const subtreeCache = new Map();
function subtreeIds(node) {
  let set = subtreeCache.get(node.k);
  if (set) return set;
  set = new Set(node.ids);
  for (const ch of childrenOf.get(node.k) || []) for (const id of subtreeIds(ch)) set.add(id);
  subtreeCache.set(node.k, set);
  return set;
}

function isUsedNode(node) {
  return chain(node).some((n) => /б\s*\/\s*[ув]/iu.test(n.ua) || /б\s*\/\s*у/iu.test(n.ru));
}

// ── Токени ─────────────────────────────────────────────────────────────────────

const GENERIC = new Set([
  "товар", "товари", "товару", "товарів", "товаров", "товары", "для", "та", "і", "й", "и", "або", "или",
  "на", "з", "із", "зі", "від", "до", "в", "у", "по", "про", "the", "and", "of", "for",
]);
// Слова-«сміття» у запиті, які не описують сам товар.
const FILLER = new Set([
  "є", "есть", "покажи", "покажіть", "показати", "покажите", "хочу", "хочемо", "шукаю", "шукаємо", "ищу",
  "потрібен", "потрібна", "потрібно", "потрібні", "треба", "нужен", "нужна", "нужно", "нужны",
  "підбери", "підберіть", "підібрати", "порадь", "порадьте", "дай", "дайте", "мені", "мне", "будь", "ласка",
  "пожалуйста", "купити", "купить", "придбати", "замовити", "який", "яка", "яке", "які", "какой", "какая",
  "какие", "що", "что", "вас", "вам", "наявність", "наявності", "наличии", "ціна", "цена", "дешевий",
  "недорого", "недорогий", "кращий", "найкращий", "щось", "якийсь", "якусь", "якісь", "шото", "шось",
  "цікавить", "грн", "гривень", "uah", "тис", "тисяч", "бюджет", "дешевше", "дорожче", "ще", "ще?", "або",
  "мой", "мою", "моя", "мій", "моє", "ваш", "ваші", "мені", "собі", "щоб", "чи", "ли", "это", "це", "цей",
]);

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[’'`ʼ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(s) {
  return norm(s).split(" ").filter(Boolean);
}

// Токени назви/синоніма вузла (без службових слів і чисел).
function nameTokens(s) {
  const seen = new Set();
  const out = [];
  for (const t of words(s)) {
    if (GENERIC.has(t) || /\d/.test(t) || t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// Токени ЗАПИТУ: без службових слів, «сміття», чисел (моделі/бюджет) та переданих виключень (бренд).
function contentTokens(text, dropTokens = []) {
  const seen = new Set();
  const out = [];
  for (const t of words(text)) {
    if (GENERIC.has(t) || FILLER.has(t) || /\d/.test(t) || t.length < 3 || seen.has(t)) continue;
    if (dropTokens.some((d) => tokMatch(t, d))) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// Нечіткий збіг слів із урахуванням закінчень («іграшка»/«іграшки», «тварин»/«тварини»).
// Різниця в довжині обмежена, щоб «корм» не збігалось із «кормушка».
function tokMatch(a, b, strict = false) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  const diff = l.length - s.length;
  if (s.length <= 3) return s.length === 3 && l.startsWith(s) && diff <= 1;
  if (s.length === 4) return l.startsWith(s) && diff <= 2;
  // складні слова: «самокат» усередині «електросамокати» (від 6 літер, щоб не ловити випадкові збіги)
  if (!strict && s.length >= 6 && diff <= 10 && l.includes(s)) return true;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i += 1;
  if (i >= Math.max(4, s.length - 2) && diff <= 4) return true;
  // одруківка в слові від 6 літер ("пилесос", "иргушка"): та сама перша літера, різниця в 1 символ
  return !strict && s.length >= 6 && diff <= 1 && s[0] === l[0] && editDistance(s, l) <= 1;
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Підготовка вузлів: власні токени (UA + RU + синоніми) та «вузькі» набори для точного збігу назви.
for (const n of nodes) {
  n.uaTok = nameTokens(n.ua);
  n.ruTok = nameTokens(n.ru);
  const alias = n.al || [];
  n.aliasTok = [...new Set(alias.flatMap(nameTokens))];
  n.aliasSingle = alias.map(norm).filter((a) => a && !a.includes(" "));
  n.ownTok = [...new Set([...n.uaTok, ...n.ruTok, ...n.aliasTok])];
}

function anyMatch(tok, list) {
  return list.some((x) => tokMatch(tok, x));
}

// ── Контекст запиту (для кого) та синоніми предметів (що саме) ─────────────────
// Вид тварини / «для дитини» — НЕ предмет пошуку: він лише відсікає чуже (товар «для котів»
// не показуємо тому, хто шукає для собаки) і піднімає в рейтингу свої товари.
const CONTEXT_GROUPS = {
  dog: { query: ["собак", "пес", "песик", "цуцик", "цуценя", "щеня", "щенок", "dog", "dogs", "пса", "псов"], product: [/^собак/, /^пес$/, /^песик/, /^пса$/, /^цуц/, /^щен/, /^dog/] },
  cat: { query: ["кіт", "кота", "коти", "котів", "котик", "кішка", "кішки", "кішок", "кошеня", "кошка", "кошки", "котенок", "cat", "cats"], product: [/^кіт$/, /^кот/, /^кіш/, /^кош/, /^cat/] },
  kid: { query: ["дитина", "дитини", "дитину", "дитячий", "дитяча", "дитячі", "діти", "дітей", "малюк", "малюка", "ребенок", "детский", "дети", "kid", "kids"], product: [] },
  pet: { query: ["тварин", "тварина", "тварини", "тваринка", "животное", "животных", "pet", "pets", "питомець", "улюбленець"], product: [] },
};
function contextGroupOf(tok) {
  for (const [g, def] of Object.entries(CONTEXT_GROUPS)) {
    if (def.query.some((q) => tokMatch(tok, q))) return g;
  }
  return null;
}

// Предмет пошуку може називатись у товарі інакше — стеми-синоніми (початок слова).
const ITEM_SYNONYMS = [
  ["лоток", "туалет", "лотк"],
  ["миск", "годівниц", "поїлк", "миска"],
  ["нашийник", "ошийник", "шлейк"],
  ["повідець", "повідк", "поводок", "рулетк"],
  ["іграшк", "игрушк"],
  ["ліжк", "лежак", "лежанк", "спальн"],
  ["переноск", "рюкзак-переноск", "сумка-переноск"],
  ["корм", "ласощ", "смаколик"],
  ["павербанк", "повербанк", "power", "акумулятор"],
  ["наповнювач", "наполнитель"],
  ["електрич", "електро", "electric"],
];
function itemStems(tok) {
  for (const g of ITEM_SYNONYMS) if (g.some((x) => tokMatch(tok, x) || x.startsWith(tok) || tok.startsWith(x))) return g;
  return null;
}

// ── Живий індекс по поточному фіду (лише товари в наявності) ───────────────────

const indexCache = new WeakMap(); // масив products -> індекс

function listable(p) {
  return p && p.available !== false && p.price != null && !p.isService;
}

function getIndex(catalog) {
  const products = (catalog && catalog.products) || [];
  let idx = indexCache.get(products);
  if (idx) return idx;
  const byCat = new Map();
  for (const p of products) {
    if (!listable(p)) continue;
    const id = String(p.categoryId);
    if (!byCat.has(id)) byCat.set(id, []);
    byCat.get(id).push(p);
  }
  idx = { byCat, memo: new Map() };
  indexCache.set(products, idx);
  return idx;
}

// Усі товари вузла (з усіх підкатегорій). Вживані товари — лише у «б/в» гілках.
function nodeProducts(node, catalog, { allowUsed = null } = {}) {
  const idx = getIndex(catalog);
  const used = allowUsed == null ? isUsedNode(node) : allowUsed;
  const memoKey = `${node.k}|${used ? 1 : 0}`;
  if (idx.memo.has(memoKey)) return idx.memo.get(memoKey);
  const out = [];
  for (const id of subtreeIds(node)) {
    const arr = idx.byCat.get(id);
    if (arr) for (const p of arr) if (used || !isUsedProduct(p)) out.push(p);
  }
  idx.memo.set(memoKey, out);
  return out;
}

// Товари, що лежать безпосередньо в категорії вузла (не в підкатегоріях).
function directProducts(node, catalog) {
  const idx = getIndex(catalog);
  const used = isUsedNode(node);
  const out = [];
  for (const id of node.ids) {
    const arr = idx.byCat.get(id);
    if (arr) for (const p of arr) if (used || !isUsedProduct(p)) out.push(p);
  }
  return out;
}

function countOf(node, catalog) {
  return nodeProducts(node, catalog).length;
}

function nonEmptyChildren(node, catalog) {
  return (childrenOf.get(node.k) || []).filter((c) => !c.skip && countOf(c, catalog) > 0);
}

// ── 1. Широкий запит → кнопки підкатегорій ─────────────────────────────────────

// Точний збіг набору слів — без складних слів і опечаток («Епілятори» ≠ «Фотоепілятори»).
function sameSet(q, dist) {
  const m = (a, list) => list.some((x) => tokMatch(a, x, true));
  return dist.length > 0 && q.every((t) => m(t, dist)) && dist.every((d) => m(d, q));
}

function matchBroad(message, catalog) {
  if (!ENABLED) return null;
  const q = contentTokens(message);
  if (!q.length || q.length > 4) return null;

  let best = null;
  for (const n of nodes) {
    if (n.skip) continue;
    const named = sameSet(q, n.uaTok) || sameSet(q, n.ruTok);
    const aliased = q.length === 1 && n.aliasSingle.some((a) => tokMatch(q[0], a));
    if (!named && !aliased) continue;

    const kids = nonEmptyChildren(n, catalog);
    const direct = directProducts(n, catalog).length;
    if (kids.length + (kids.length && direct ? 1 : 0) < 2) continue; // вибирати нема з чого

    const cand = { node: n, count: countOf(n, catalog) };
    const better =
      !best ||
      (n.hid ? 1 : 0) < (best.node.hid ? 1 : 0) ||
      ((n.hid ? 1 : 0) === (best.node.hid ? 1 : 0) &&
        (n.d < best.node.d || (n.d === best.node.d && cand.count > best.count)));
    if (better) best = cand;
  }
  return best ? best.node : null;
}

function chip(node, catalog, extra = {}) {
  const count = countOf(node, catalog);
  // name + count окремо: віджет малює назву й лічильник охайною кнопкою; label лишається для старих клієнтів
  return { label: `${node.ua} (${count})`, name: node.ua, count, q: node.ua, key: node.k, mode: "browse", ...extra };
}

// Верхні розділи каталогу (для відповіді «такого нема — ось що є»).
function topSections(catalog) {
  if (!ENABLED) return [];
  return nodes
    .filter((n) => n.d === 0 && !n.skip && !n.hid && countOf(n, catalog) > 0)
    .map((n) => chip(n, catalog));
}

function capChips(list, catalog) {
  if (list.length <= MAX_CHIPS) return list;
  const keep = new Set(
    [...list].sort((a, b) => countOf(b, catalog) - countOf(a, catalog)).slice(0, MAX_CHIPS).map((n) => n.k)
  );
  return list.filter((n) => keep.has(n.k));
}

function backChip(node) {
  const parent = parentOf(node);
  if (!parent) return null;
  return { label: `← ${parent.ua}`, name: parent.ua, q: parent.ua, key: parent.k, mode: "browse", kind: "back" };
}

// Що показати для вузла: { type: "ask" | "list" | "empty", node, ... }
function browse(node, catalog, { mode = "browse" } = {}) {
  let cur = node;
  if (mode === "direct") {
    return { type: "list", node: cur, products: directProducts(cur, catalog), direct: true };
  }
  for (let guard = 0; guard < 6; guard += 1) {
    const kids = nonEmptyChildren(cur, catalog);
    const direct = directProducts(cur, catalog).length;
    if (!kids.length) break;
    if (kids.length === 1 && !direct) {
      cur = kids[0]; // єдиний варіант — не змушуємо клієнта тицяти
      continue;
    }
    const options = capChips(kids, catalog).map((k) => chip(k, catalog));
    if (direct) {
      const directName = cur.dl || "Інше";
      options.push({ label: `${directName} (${direct})`, name: directName, count: direct, q: `${cur.ua} — ${directName}`, key: cur.k, mode: "direct", kind: "direct" });
    }
    const back = backChip(cur);
    if (back) options.push(back);
    return { type: "ask", node: cur, total: countOf(cur, catalog), options };
  }
  const products = nodeProducts(cur, catalog);
  if (!products.length) return { type: "empty", node: cur, options: emptyOptions(cur, catalog) };
  return { type: "list", node: cur, products, back: backChip(cur) };
}

// Якщо в гілці порожньо — пропонуємо найближчі гілки, де товари є.
function emptyOptions(node, catalog) {
  let cur = parentOf(node);
  while (cur) {
    const kids = nonEmptyChildren(cur, catalog).filter((k) => k.k !== node.k);
    if (kids.length) return capChips(kids, catalog).map((k) => chip(k, catalog));
    cur = parentOf(cur);
  }
  return [];
}

// ── 2. Точний запит → гілка дерева ─────────────────────────────────────────────

function lca(list) {
  const chains = list.map((n) => chain(n));
  let common = null;
  for (let i = 0; ; i += 1) {
    const k = chains[0][i] && chains[0][i].k;
    if (!k || !chains.every((c) => c[i] && c[i].k === k)) break;
    common = chains[0][i];
  }
  return common;
}

function evalNode(node, q) {
  const anc = chain(node).slice(0, -1);
  const ancTok = anc.flatMap((a) => a.ownTok);
  let own = 0;
  let viaPath = 0;
  const hit = new Set();
  for (const t of q) {
    if (anyMatch(t, node.ownTok)) {
      own += 1;
      hit.add(t);
    } else if (anyMatch(t, ancTok)) {
      viaPath += 1;
      hit.add(t);
    }
  }
  return { own, viaPath, coverage: (own + viaPath) / q.length, hit };
}

// texts — варіанти тексту запиту (сире повідомлення, переписаний LLM-запит тощо).
// Повертає { node, nodes, coverage, strictTokens } або null, якщо однозначної гілки нема.
//   node          — головна гілка (для кнопок «назад», фільтрів і пам'яті розмови)
//   nodes         — усі рівноцінні гілки, серед товарів яких шукаємо (напр. «Акваріуми» + «Аксесуари для акваріумів»)
//   strictTokens  — слова запиту, які дерево не пояснило: вони мають бути в самому товарі
function route(texts, { dropTokens = [], catalog = null } = {}) {
  if (!ENABLED) return null;
  let winner = null;

  for (const text of [...new Set(texts.filter(Boolean))]) {
    let q = contentTokens(text, dropTokens);
    // «електричний» — опис, а не предмет: у назвах він зашитий у «електро-» («Електросамокати»)
    if (q.length > 1) {
      const rest = q.filter((t) => !/^(електрич|электрич|electric)/.test(t));
      if (rest.length) q = rest;
    }
    if (!q.length) continue;

    let top = [];
    let topScore = null;
    for (const n of nodes) {
      if (n.skip) continue;
      const ev = evalNode(n, q);
      if (ev.own < 1) continue; // гілка має сама «впізнаватись» у запиті
      const stock = catalog ? (countOf(n, catalog) > 0 ? 1 : 0) : 0;
      const score = [ev.coverage, ev.own, n.hid ? 0 : 1, stock];
      if (!topScore) {
        topScore = score;
        top = [n];
        continue;
      }
      let cmp = 0;
      for (let i = 0; i < score.length && !cmp; i += 1) cmp = score[i] - topScore[i];
      if (cmp > 0) {
        topScore = score;
        top = [n];
      } else if (cmp === 0) top.push(n);
    }
    if (!top.length) continue;

    // Точний збіг назви гілки з запитом («Крісла», «Монітори») перемагає частковий («Ігрові крісла»).
    const exact = top.filter((n) => sameSet(q, n.uaTok) || sameSet(q, n.ruTok));
    if (exact.length) top = exact;

    // Однакові категорії в кількох місцях меню (однаковий id) — це один кандидат.
    const uniq = [];
    const seenIds = new Set();
    for (const n of top) {
      const sig = n.ids.join(",") || n.k;
      if (!seenIds.has(sig)) {
        seenIds.add(sig);
        uniq.push(n);
      }
    }
    let primary = uniq[0];
    if (uniq.length > 1) {
      primary = lca(uniq); // рівноцінні гілки мають спільний розділ, інакше запит неоднозначний
      if (!primary) {
        // одна й та сама категорія в різних розділах меню (напр. «Телевізори») — це не неоднозначність
        if (!uniq.every((n) => n.ua === uniq[0].ua)) continue;
        primary = [...uniq].sort((a, b) => (catalog ? countOf(b, catalog) - countOf(a, catalog) : 0))[0];
      }
    }

    const hit = new Set();
    for (const n of uniq) for (const t of evalNode(n, q).hit) hit.add(t);
    const coverage = topScore[0];
    if (!(coverage >= 1 || coverage >= 0.5)) continue;

    // Класифікація слів запиту:
    //   item    — предмет пошуку (названий у самій гілці: «іграшка», «блендер», або її синонім «лоток»)
    //   context — для кого (собака/кіт/дитина/тварина): лише відсікає чуже, не вимагається в назві
    //   strict  — слова, яких дерево не пояснило («лампа» в запиті про акваріум): мають бути в товарі
    const itemTokens = [];
    const aliasItemTokens = []; // предмет, названий синонімом (не словом з назви гілки): «лоток», «нашийник»
    const contextTokens = [];
    for (const t of q) {
      if (!hit.has(t)) continue;
      const byName = uniq.some((n) => anyMatch(t, n.uaTok) || anyMatch(t, n.ruTok));
      const grp = byName ? null : contextGroupOf(t);
      if (grp) contextTokens.push(t);
      else if (!byName && contextGroupOf(t) === null && uniq.every((n) => !anyMatch(t, n.aliasTok))) contextTokens.push(t); // збіг лише через предка
      else {
        itemTokens.push(t);
        if (!byName) aliasItemTokens.push(t);
      }
    }

    // «посуда», «шредер» — запит це просто назва розділу: товари не мусять містити це слово в назві
    const pure = uniq.some((n) => sameSet(q, n.uaTok) || sameSet(q, n.ruTok));
    const cand = { node: primary, nodes: uniq, coverage, itemTokens, aliasItemTokens, contextTokens, strictTokens: q.filter((t) => !hit.has(t)), text, pure };
    if (!winner || cand.coverage > winner.coverage) winner = cand;
  }
  return winner;
}

// ── 3. Відбір товарів у гілці ──────────────────────────────────────────────────

const wordsCache = new WeakMap();
function productWords(p) {
  let w = wordsCache.get(p);
  if (!w) {
    // Назва + бренд + параметри, БЕЗ назви категорії (інакше слово «Іграшки» збігається з будь-яким
    // товаром категорії «Іграшки та амуніція», навіть з переносками).
    const raw = `${p.name || ""} ${p.vendor || ""} ${Object.values(p.params || {}).join(" ")}`;
    w = norm(raw).split(" ").filter(Boolean);
    wordsCache.set(p, w);
  }
  return w;
}

function productHasToken(p, tok) {
  const ws = productWords(p);
  const stems = itemStems(tok);
  if (stems) return ws.some((w) => stems.some((st) => w.startsWith(st) || tokMatch(w, st)));
  return ws.some((w) => tokMatch(tok, w));
}

// Товар має містити всі слова (з урахуванням закінчень і синонімів); якщо їх 3+ — достатньо половини.
function filterByTokens(list, tokens) {
  if (!tokens.length) return list;
  const strict = list.filter((p) => tokens.every((t) => productHasToken(p, t)));
  if (strict.length || tokens.length < 3) return strict;
  const need = Math.ceil(tokens.length / 2);
  return list.filter((p) => tokens.filter((t) => productHasToken(p, t)).length >= need);
}

// «Для собаки»: прибираємо товари, які явно призначені лише для іншого виду тварин.
function applyContext(list, contextTokens) {
  const groups = new Set(contextTokens.map(contextGroupOf).filter((g) => g === "dog" || g === "cat"));
  if (!groups.size || groups.size > 1) return list;
  const want = [...groups][0];
  const other = want === "dog" ? "cat" : "dog";
  const mentions = (p, g) => productWords(p).some((w) => CONTEXT_GROUPS[g].product.some((re) => re.test(w)));
  return list.filter((p) => !(mentions(p, other) && !mentions(p, want)));
}

function collect(node, catalog, { brand, minPrice, maxPrice, condition } = {}) {
  let list = nodeProducts(node, catalog, { allowUsed: condition === "used" ? true : null });
  if (condition === "used") list = list.filter(isUsedProduct);
  if (minPrice != null) list = list.filter((p) => p.price >= minPrice);
  if (maxPrice != null) list = list.filter((p) => p.price <= maxPrice);
  if (brand) {
    const bt = words(brand).filter((t) => t.length > 1);
    if (bt.length) list = list.filter((p) => bt.some((t) => String(p._haystack || "").includes(t)));
  }
  return list;
}

// Те саме для кількох рівноцінних гілок одразу (без дублів).
function collectMany(list, catalog, opts = {}) {
  const merged = new Map();
  for (const n of list) for (const p of collect(n, catalog, opts)) merged.set(p.id, p);
  return [...merged.values()];
}

// Список для LLM-підказки (фолбек, коли словник і дерево не впізнали запит).
function listForLLM(catalog) {
  const seen = new Set();
  const lines = [];
  for (const n of nodes) {
    if (n.skip || !n.ids.length) continue;
    const sig = n.ids.join(",");
    if (seen.has(sig) || countOf(n, catalog) === 0) continue;
    seen.add(sig);
    lines.push(`${n.k} | ${pathLabel(n)}`);
  }
  return lines;
}

module.exports = {
  enabled: () => ENABLED,
  getNode,
  nodeOfProduct,
  allNodes: () => nodes,
  parentOf,
  pathLabel,
  matchBroad,
  topSections,
  browse,
  emptyOptions,
  route,
  collect,
  collectMany,
  filterByTokens,
  applyContext,
  countOf,
  nodeProducts,
  listForLLM,
  chip,
};