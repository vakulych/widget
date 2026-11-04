// Детермінований пошук по каталогу — без LLM.
//
// Навіщо: раніше будь-який «звичайний» запит («кастрюли», «сковородки», «шредер», «нож») ішов через
// ланцюжок LLM-інтент → словник категорій → дерево → LLM-відповідь. Якщо хоч одна ланка не впізнала
// слово, чат казав «такого немає», хоча товар у каталозі є. Тут запит розбирається напряму по каталогу:
//   1) слова запиту приводяться до «основ» (рос./укр. словозміна, ы/і, э/е, ё/е, ь, ю/у → одна основа);
//   2) кожне слово розгортається в слова, що реально існують у каталозі: точний збіг, початок слова,
//      одруківка (відстань Левенштейна), фонетика (тефаль → Tefal), словник синонімів (нож → ніж);
//   3) шукаємо у назві, бренді, параметрах І в назвах категорій дерева (UA+RU) — «шредер» знаходить
//      «Знищувач документів», бо лежить у розділі «Шредери»;
//   4) якщо точного збігу нема, але є БЛИЗЬКИЙ замінник (кастрюля → гусятниця) — повертаємо його
//      з чесною позначкою «саме такого нема, але є схоже».
//
// Результат — об'єкт зі списком товарів і готовою відповіддю (compose), тож найчастіші запити
// обробляються миттєво й без вигадок.

const categoryTree = require("./categoryTree");
const { foldHomoglyphs } = require("./search");

// ── Нормалізація ───────────────────────────────────────────────────────────────

const FILLER = new Set(
  (
    "є есть наявність наявності наличии наличие покажи покажіть показати покажите хочу хочемо шукаю шукаємо ищу ищем " +
    "потрібен потрібна потрібно потрібні треба нужен нужна нужно нужны підбери підберіть підібрати порадь порадьте посоветуй посоветуйте порекомендуй порекомендуйте подскажи " +
    "дай дайте мені мне будь ласка пожалуйста купити купить придбати замовити який яка яке які какой какая какие какое " +
    "що что вас вам вы ви у чи ли нет немає нема а и і й в на для з із зі та або или к по про це этот эта это цей " +
    "якісь якийсь якусь какие-то будьте можна можно цікавить цікавлять интересует дешевий недорого недорогий дорогий " +
    "хороший хороша гарний гарна найкращий кращий лучший топ ще еще там тут ось просто типу короче шо шось шото ну " +
    "ку привіт привет здрастуйте добрий день вечір ранку скажіть підкажіть подскажите скажи підкажи мої мой моя моё " +
    "наш ваш ваші собі себе щоб чтобы из от щось что-то якісь інші другие інший другой ще чи є? " +
    "товар товари товару товарів товары товаров товаре асортимент ассортимент каталог розділ раздел категорія категория " +
    "модель моделі модели скільки сколько ціна цена цены ціни коштує стоит продаєте продаете продаёте продаете " +
    "бюджет грн гривень гривен гривні uah тис тисяч тыс тысяч"
  ).split(/\s+/)
);

// These words describe the *reason* for buying a product, not the product
// itself. They are valuable to the semantic ranker, but must not turn a
// perfectly understandable request such as "ноутбук для навчання" into an
// empty AND-query when the feed does not literally contain "навчання".
const SOFT_INTENT_RE = /^(?:для|учеб\p{L}*|навчан\p{L}*|работ\p{L}*|робот\p{L}*|игр\p{L}*|ігор\p{L}*|гейм\p{L}*|подар\p{L}*|подрост\p{L}*|дитин\p{L}*|ребен\p{L}*|дом\p{L}*|дому|путеш\p{L}*|подорож\p{L}*|профес\p{L}*|офіс\p{L}*|офис\p{L}*)$/iu;
const ACCESSORY_QUERY_RE = /чохо?л|чехо?л|кейс|case|кабел|заряд|адаптер|перехідник|переходник|плівк|пленк|скл[оа]|стекл|ремін|ремеш|підставк|подставк|кріплен|держател|тримач/iu;
const ACCESSORY_NAME_RE = /чохо?л|чехо?л|кейс|case|сумк|рюкзак|підставк|подставк|заряд|кабел|адаптер|перехідник|переходник|ремін|ремеш|кріплен|держател|тримач/iu;

const ENDINGS = [
  "ського", "ськими", "ових", "ами", "ями", "ого", "ому", "ими", "ыми", "ість", "ості", "ів", "ов", "ей", "ах", "ях",
  "ою", "ею", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ие", "ые", "ую", "юю", "ом", "ем", "ам", "ям", "ок", "ек",
  "а", "я", "и", "ы", "у", "ю", "е", "о", "і", "ь",
].sort((a, b) => b.length - a.length);

function rawWords(text) {
  return foldHomoglyphs(String(text || ""))
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[’'`ʼ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const isCyr = (w) => /[а-яіїєґё]/iu.test(w);

// «Скелет» слова: рос. та укр. написання зводяться до однієї форми.
function skel(w) {
  return w.replace(/[іїы]/g, "и").replace(/[єэ]/g, "е").replace(/ґ/g, "г").replace(/[ъь]/g, "");
}

// закінчення порівнюються вже зі «скелетом» слова (і→и, є→е...), тож приводимо їх до тієї ж форми
const ENDINGS_SK = [...new Set(ENDINGS.map((e) => skel(e)).filter(Boolean))].sort((a, b) => b.length - a.length);

function stem(word) {
  const w = String(word || "").toLowerCase();
  if (!isCyr(w) || /\d/.test(w)) return w;
  let s = skel(w);
  for (const e of ENDINGS_SK) {
    if (s.length - e.length >= 3 && s.endsWith(e)) {
      s = s.slice(0, -e.length);
      break;
    }
  }
  return s;
}

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Вага збігу двох основ (0 — не збіг).
function stemMatch(q, v) {
  if (q === v) return 1;
  const [s, l] = q.length <= v.length ? [q, v] : [v, q];
  if (s.length < 4 || /\d/.test(s)) return 0;
  const diff = l.length - s.length;
  if (l.startsWith(s) && diff <= 3 && s.length >= 4) return 0.92;
  if (s.length >= 5 && s[0] === l[0] && diff <= 2) {
    const max = s.length >= 9 ? 2 : 1;
    if (editDistance(s, l, max) <= max) return 0.8;
  }
  return 0;
}

// ── Фонетика (кирилична вимова ↔ латинська назва бренду) ───────────────────────

const CYR_LAT = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ё: "yo", ж: "zh", з: "z", и: "y", і: "i", ї: "yi",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
function phon(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[а-яіїєґёъыьэюя]/gu, (c) => CYR_LAT[c] || c)
    .replace(/[^a-z0-9]/g, "")
    .replace(/sch|shch/g, "sh")
    .replace(/ph/g, "f")
    .replace(/qu/g, "k")
    .replace(/ck/g, "k")
    .replace(/ch/g, "h")
    .replace(/kh/g, "h")
    .replace(/th/g, "t")
    .replace(/w/g, "v")
    .replace(/x/g, "ks")
    .replace(/y/g, "i")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/([aeiou])\1+/g, "$1");
}

// ── Словник синонімів: те, що словозміною й опечатками не лікується ──────────────
// q    — як кажуть клієнти (рос./укр./розмовно);
// same — те саме, але як воно називається в каталозі;
// near — БЛИЗЬКИЙ замінник (показуємо лише коли точного нема і чесно про це кажемо), label — як його назвати.

const SYNONYMS = [
  { q: ["кастрюля", "каструля", "кастрюлька", "каструлька", "кострюля"], same: ["каструля"], near: ["гусятниця", "казан", "сотейник"], label: "гусятниці (чавунний посуд з кришкою для тушкування й запікання)" },
  { q: ["сковорода", "сковородка", "сковорідка", "сковородочка"], same: ["сковорідка", "сковорода"] },
  { q: ["нож", "ножи", "ножик", "ніж", "ножі", "ножик"], same: ["ніж", "ножі", "ножів"] },
  { q: ["вилка", "вилки"], same: ["виделка"] },
  { q: ["тарелка", "тарелки"], same: ["тарілка"] },
  { q: ["чашка", "кружка", "кружки"], same: ["чашка", "кружка", "термокружка"] },
  { q: ["стакан"], same: ["склянка", "стакан"] },
  { q: ["утюг", "утюжок"], same: ["праска"] },
  { q: ["пылесос", "пилесос"], same: ["пилосос"] },
  { q: ["кофеварка"], same: ["кавоварка"] },
  { q: ["кофемашина"], same: ["кавомашина"] },
  { q: ["кофемолка"], same: ["кавомолка"] },
  { q: ["кофе"], same: ["кава", "кавовий"] },
  { q: ["микроволновка", "микроволновая", "свч"], same: ["мікрохвильова", "мікрохвильовка", "мікрохвильові"] },
  { q: ["стиралка", "стиральная", "стиральные"], same: ["пральна", "пральні"] },
  { q: ["сушилка", "сушильная"], same: ["сушарка", "сушильна", "сушильні"] },
  { q: ["обогреватель", "нагреватель", "тепловентилятор"], same: ["обігрівач", "тепловентилятор"] },
  { q: ["увлажнитель", "зволожувач"], same: ["зволожувач"] },
  { q: ["очиститель", "очищувач"], same: ["очищувач", "очисник"] },
  { q: ["мясорубка"], same: ["мясорубка"] },
  { q: ["соковыжималка", "соковыжималки"], same: ["соковитискач"] },
  { q: ["хлебопечка"], same: ["хлібопічка"] },
  { q: ["тостер", "бутербродница"], same: ["тостер", "бутербродниця"] },
  { q: ["электрочайник"], same: ["електрочайник"] },
  { q: ["чайник"], same: ["чайник", "електрочайник"] },
  { q: ["весы", "весов", "весами"], same: ["ваги"] },
  { q: ["термос"], same: ["термос", "термоc"] },
  { q: ["бутылка", "бутылочка"], same: ["пляшка"] },
  { q: ["мышь", "мышка", "мишка"], same: ["миша"] },
  { q: ["наушники", "наушник", "ушки"], same: ["навушники", "навушник"] },
  // Характеристики теж мають бути частиною пошуку, а не приводом віддати запит LLM.
  // У фіді майже всюди використовується латинське Bluetooth, тоді як покупці часто
  // пишуть «блютуз» або «блютузні».
  { q: ["блютуз", "блютус", "bluetooth"], same: ["bluetooth"] },
  { q: ["часы", "часики"], same: ["годинник"] },
  { q: ["зарядка", "зарядник", "зарядное", "зарядный"], same: ["зарядка", "зарядний", "зарядне", "зарядна"] },
  { q: ["провод", "шнур"], same: ["кабель"] },
  { q: ["флешка", "флэшка"], same: ["флешка", "флеш", "накопичувач"] },
  { q: ["пауэрбанк", "повербанк", "павербанк", "powerbank", "пауербанк"], same: ["powerbank", "павербанк", "повербанк"] },
  { q: ["роутер", "маршрутизатор"], same: ["роутер", "маршрутизатор", "router"] },
  { q: ["вайфай", "вайфаю", "wifi"], same: ["wi-fi", "wifi", "wi", "fi"] },
  { q: ["удлинитель", "подовжувач"], same: ["подовжувач", "мережевий"] },
  { q: ["фонарик", "фонарь", "ліхтарик"], same: ["ліхтар", "ліхтарик"] },
  { q: ["лампочка", "лампа"], same: ["лампа", "лампочка"] },
  { q: ["аккумулятор", "аккумуляторы", "акумулятор"], same: ["акумулятор"] },
  { q: ["батарейка", "батарейки"], same: ["батарейка", "батарейки", "елемент", "живлення"] },
  { q: ["игрушка", "игрушки", "іграшка"], same: ["іграшка", "іграшки"] },
  { q: ["кукла", "куклы"], same: ["лялька", "ляльки"] },
  { q: ["конструктор"], same: ["конструктор"] },
  { q: ["самокат"], same: ["самокат", "електросамокат"] },
  { q: ["коляска"], same: ["візок", "коляска"] },
  { q: ["подгузники", "подгузник", "памперсы"], same: ["підгузки", "підгузок"] },
  { q: ["ошейник"], same: ["нашийник"] },
  { q: ["поводок"], same: ["повідець"] },
  { q: ["лежанка", "лежак"], same: ["лежак", "лежанка", "ліжко"] },
  { q: ["когтеточка"], same: ["кігтеточка", "дряпка"] },
  { q: ["наполнитель"], same: ["наповнювач"] },
  { q: ["аквариум"], same: ["акваріум"] },
  { q: ["кондиционер"], same: ["кондиціонер"] },
  { q: ["холодильник"], same: ["холодильник"] },
  { q: ["плойка", "щипцы", "щипці"], same: ["плойка", "щипці"] },
  { q: ["выпрямитель", "утюжок"], same: ["випрямляч", "випрямлювач"] },
  { q: ["расческа", "щетка", "щётка"], same: ["щітка", "гребінець"] },
  { q: ["бритва"], same: ["бритва", "електробритва"] },
  { q: ["триммер"], same: ["тример"] },
  { q: ["эпилятор"], same: ["епілятор"] },
  { q: ["шредер", "уничтожитель", "знищувач"], same: ["шредер", "знищувач"] },
  { q: ["розетка"], same: ["розетка"] },
  { q: ["камера", "видеокамера"], same: ["камера", "відеокамера"] },
  { q: ["рюкзак"], same: ["рюкзак"] },
  { q: ["сумка"], same: ["сумка"] },
  { q: ["коврик", "килимок"], same: ["килимок", "килим"] },
  // кольори
  { q: ["красный", "красная", "красное", "красные", "червоний"], same: ["червоний", "червона", "червоне", "red"] },
  { q: ["черный", "чёрный", "чорний", "черная"], same: ["чорний", "чорна", "чорне", "black"] },
  { q: ["белый", "белая", "білий"], same: ["білий", "біла", "біле", "white"] },
  { q: ["зеленый", "зеленая", "зелений"], same: ["зелений", "зелена", "зелене", "green"] },
  { q: ["синий", "синяя", "синій"], same: ["синій", "синя", "синє", "blue"] },
  { q: ["серый", "серая", "сірий"], same: ["сірий", "сіра", "сіре", "gray", "grey"] },
  { q: ["розовый", "розовая", "рожевий"], same: ["рожевий", "рожева", "pink"] },
  { q: ["фиолетовый", "фіолетовий"], same: ["фіолетовий", "фіолетова", "purple"] },
  { q: ["золотой", "золотий"], same: ["золотий", "золота", "gold"] },
];

for (const g of SYNONYMS) {
  g.qStems = [...new Set(g.q.map(stem))];
  g.sameStems = [...new Set(g.same.map(stem))];
  g.nearStems = [...new Set((g.near || []).map(stem))];
}

// ── Індекс каталогу ────────────────────────────────────────────────────────────

const F_VENDOR = 0.95;
const F_CAT = 0.86;
const F_ANC = 0.46;
// A value in a compatibility field is useful, but is never as strong as the
// product name or its category: a headphone stand compatible with a laptop is
// not a laptop.
const F_PARAM = 0.28;
// Слова після «для/з/на…» — це уточнення (аксесуар «для пилососа»), а не сам товар.
const PREPS = new Set(["для", "до", "з", "зі", "із", "на", "під", "with", "for", "від", "при", "у", "в", "по", "без", "над", "між", "про", "без"]);

const indexCache = new WeakMap();

let nodeById = null;
function getNodeById() {
  if (nodeById) return nodeById;
  nodeById = new Map();
  for (const n of categoryTree.allNodes()) {
    for (const id of n.ids || []) if (!nodeById.has(id)) nodeById.set(id, n);
  }
  return nodeById;
}

function chainOf(node) {
  const out = [];
  let cur = node;
  while (cur) {
    out.unshift(cur);
    cur = categoryTree.parentOf(cur);
  }
  return out;
}

function stemsOf(text) {
  const out = [];
  for (const w of rawWords(text)) {
    if (w.length < 2) continue;
    out.push(stem(w));
  }
  return out;
}

// Основи назви товару з вагою за позицією: головне слово (тип товару) — на початку назви.
function nameStemsPos(name) {
  const out = [];
  let idx = 0;
  let afterPrep = false;
  const parts = foldHomoglyphs(String(name || ""))
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[’'`ʼ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  for (const part of parts) {
    const compound = /[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(part);
    const subs = part.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    subs.forEach((w, k) => {
      if (PREPS.has(w)) {
        afterPrep = true;
        return;
      }
      if (w.length < 2) return;
      let wgt = afterPrep ? 0.3 : idx <= 2 ? 1.0 : idx === 3 ? 0.85 : 0.7;
      if (compound && k > 0 && !afterPrep) wgt = Math.min(wgt, 0.75);
      out.push({ s: stem(w), w: wgt });
    });
    idx += 1;
  }
  return out;
}

function getIndex(catalog) {
  const products = (catalog && catalog.products) || [];
  let idx = indexCache.get(products);
  if (idx) return idx;

  const byId = getNodeById();
  const catCache = new Map(); // categoryId -> { leaf:[stems], anc:[stems], node }
  function catInfo(p) {
    const key = String(p.categoryId);
    let info = catCache.get(key);
    if (info) return info;
    const node = byId.get(key) || null;
    const leaf = new Set(stemsOf(p.categoryName || ""));
    const anc = new Set();
    if (node) {
      const ch = chainOf(node);
      ch.forEach((n, i) => {
        const target = i === ch.length - 1 ? leaf : anc;
        for (const s of stemsOf(`${n.ua} ${n.ru || ""} ${(n.al || []).join(" ")}`)) target.add(s);
      });
    }
    for (const s of leaf) anc.delete(s);
    info = { leaf: [...leaf], anc: [...anc], node };
    catCache.set(key, info);
    return info;
  }

  const postings = new Map(); // stem -> Map(productIndex -> bestFieldWeight)
  const vocab = new Map(); // stem -> { df, vendor }
  const items = [];

  const vendorDf = new Map();
  function add(stemKey, pi, fw, flag) {
    if (!stemKey || stemKey.length < 2) return;
    let m = postings.get(stemKey);
    if (!m) {
      m = new Map();
      postings.set(stemKey, m);
    }
    const prev = m.get(pi);
    if (!prev || prev[0] < fw) m.set(pi, [fw, flag]);
  }

  products.forEach((p, i) => {
    if (!p || p.isService || p.price == null) return;
    const info = catInfo(p);
    const pi = items.length;
    items.push({ p, node: info.node, avail: p.available !== false });
    for (const { s, w } of nameStemsPos(p.name)) add(s, pi, w, "n");
    for (const s of new Set(stemsOf(p.vendor))) {
      add(s, pi, F_VENDOR, "v");
      vendorDf.set(s, (vendorDf.get(s) || 0) + 1);
    }
    for (const s of info.leaf) add(s, pi, F_CAT, "c");
    for (const s of info.anc) add(s, pi, F_ANC, "a");
    for (const [k, v] of Object.entries(p.params || {})) {
      if (/гарант/iu.test(k)) continue;
      // A value without its label is ambiguous: "144" can be a price, a
      // model number or refresh rate. Indexing both makes human requests such
      // as "монітор 144 Гц" and "телефон з NFC" discoverable.
      for (const s of stemsOf(k)) add(s, pi, F_PARAM, "p");
      for (const s of stemsOf(v)) add(s, pi, F_PARAM, "p");
    }
  });

  // словник по першій літері (швидкий нечіткий пошук) та фонетичний словник латиниці
  const buckets = new Map();
  const phonMap = new Map();
  for (const [s, m] of postings) {
    let avail = 0;
    for (const pi of m.keys()) if (items[pi].avail) avail += 1;
    vocab.set(s, { df: m.size, avail });
    const b = buckets.get(s[0]) || [];
    b.push(s);
    buckets.set(s[0], b);
    if (/^[a-z]{4,}$/.test(s)) {
      const k = phon(s);
      if (k.length >= 4) {
        const arr = phonMap.get(k) || [];
        arr.push(s);
        phonMap.set(k, arr);
      }
    }
  }

  idx = { items, postings, vocab, vendorDf, buckets, phonMap, total: items.length };
  indexCache.set(products, idx);
  return idx;
}

// ── Запит ──────────────────────────────────────────────────────────────────────

// Бюджет з тексту: «до 3000», «від 1000 до 5000 грн», «до 5 тис».
function parseBudget(text) {
  const t = String(text || "").toLowerCase().replace(/\u00a0/g, " ");
  const num = (s, unit) => {
    const n = Number(String(s).replace(/[\s,.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return null;
    return /^(к|k|тис|тыс|тисяч|thousand)/.test(unit || "") ? n * 1000 : n;
  };
  let min = null;
  let max = null;
  let rest = t;
  const both = /(?:від|от|from)\s*(\d[\d\s.,]*)\s*(к|k|тис\.?|тыс\.?)?\s*(?:до|по|-|–|—|to)\s*(\d[\d\s.,]*)\s*(к|k|тис\.?|тыс\.?)?(?:\s*(?:грн|₴|uah))?/iu.exec(t);
  if (both) {
    min = num(both[1], both[2]);
    max = num(both[3], both[4] || both[2]);
    rest = t.replace(both[0], " ");
  } else {
    const mx = /(?:до|не\s+дорожче|не\s+дороже|не\s+більше|не\s+более|бюджет(?:ом)?(?:\s+до)?|under)\s*(\d[\d\s.,]*)\s*(к|k|тис\.?|тыс\.?|тисяч[іи]?|thousand)?(?:\s*(?:грн|₴|uah))?/iu.exec(t);
    const mn = /(?:від|от|from|дорожче|дороже)\s*(\d[\d\s.,]*)\s*(к|k|тис\.?|тыс\.?|тисяч[іи]?|thousand)?(?:\s*(?:грн|₴|uah))?/iu.exec(t);
    if (mx) {
      max = num(mx[1], mx[2]);
      rest = rest.replace(mx[0], " ");
    }
    if (mn) {
      min = num(mn[1], mn[2]);
      rest = rest.replace(mn[0], " ");
    }
  }
  return { min, max, rest };
}

// Числа в назві моделі не можна змішувати з числами-характеристиками. Наприклад,
// "S24" — це модель, але "20000 mAh", "256 GB" та "55\"" — чіткі вимоги
// покупця. Вони мають відсікати кандидатів ДО ранжування, а не давати невідповідному
// товару шанс опинитися вище лише через схожі слова в назві.
function parseHardConstraints(text) {
  const source = foldHomoglyphs(String(text || "")).toLowerCase().replace(/,/g, ".");
  const out = { storageGb: null, capacityMah: null, diagonalInches: null, refreshHz: null };
  const storage = /(?:^|[^\p{L}\p{N}])(\d{1,5})\s*(gb|гб|tb|тб)(?=$|[^\p{L}\p{N}])/iu.exec(source);
  if (storage) {
    const n = Number(storage[1]);
    out.storageGb = /tb|тб/iu.test(storage[2]) ? n * 1024 : n;
  }
  const mah = /(?:^|[^\p{L}\p{N}])(\d{3,6})\s*(?:mah|ма\s*г)(?=$|[^\p{L}\p{N}])/iu.exec(source);
  if (mah) out.capacityMah = Number(mah[1]);

  const quotedDiagonal = /(?:^|[^\p{L}\p{N}])(\d{1,2}(?:\.\d)?)\s*(?:["″]|дюйм\p{L}*|inch(?:es)?)(?=$|[^\p{L}\p{N}])/iu.exec(source);
  if (quotedDiagonal) out.diagonalInches = Number(quotedDiagonal[1]);
  // У розмові діагональ телевізора майже завжди пишуть без символу дюйма:
  // «телевізор 55». Застосовуємо це правило лише для типів товарів з діагоналлю,
  // щоб не перетворити будь-яке число на фільтр.
  if (out.diagonalInches == null && /телевізор|телевизор|tv\b|монітор|монитор|ноутбук|laptop|macbook/iu.test(source)) {
    const bare = /(?:^|[^\p{L}\p{N}])(\d{2}(?:\.\d)?)(?=$|[^\p{L}\p{N}])/u.exec(source);
    if (bare) out.diagonalInches = Number(bare[1]);
  }
  const hz = /(?:^|[^\p{L}\p{N}])(\d{2,3})\s*(?:hz|гц|герц)(?=$|[^\p{L}\p{N}])/iu.exec(source);
  if (hz) out.refreshHz = Number(hz[1]);
  return out;
}

function numbersWithUnit(text, re) {
  const out = [];
  for (const match of String(text || "").matchAll(re)) out.push(Number(match[1]));
  return out.filter(Number.isFinite);
}

function productMeetsHardConstraints(product, constraints) {
  if (!constraints.storageGb && !constraints.capacityMah && !constraints.diagonalInches && !constraints.refreshHz) return true;
  const text = `${product.name || ""} ${product.categoryName || ""} ${Object.values(product.params || {}).join(" ")}`;
  if (constraints.storageGb != null) {
    const values = numbersWithUnit(text, /(\d{1,5})\s*(?:gb|гб|tb|тб)\b/giu)
      .map((n, i, all) => {
        // Convert only values that were written in TB. The small loop keeps the
        // parsing local and works for both product names and arbitrary feed params.
        const raw = [...String(text).matchAll(/(\d{1,5})\s*(gb|гб|tb|тб)\b/giu)][i];
        return raw && /tb|тб/iu.test(raw[2]) ? n * 1024 : n;
      });
    if (!values.includes(constraints.storageGb)) return false;
  }
  if (constraints.capacityMah != null) {
    const values = numbersWithUnit(text, /(\d{3,6})\s*(?:mah|ма\s*г)\b/giu);
    if (!values.includes(constraints.capacityMah)) return false;
  }
  if (constraints.diagonalInches != null) {
    const values = numbersWithUnit(text, /(\d{1,2}(?:[.,]\d)?)\s*(?:["″]|дюйм\p{L}*|inch(?:es)?)/giu);
    if (!values.some((n) => Math.abs(n - constraints.diagonalInches) < 0.11)) return false;
  }
  if (constraints.refreshHz != null) {
    const values = numbersWithUnit(text, /(\d{2,3})\s*(?:hz|гц|герц)\b/giu);
    if (!values.includes(constraints.refreshHz)) return false;
  }
  return true;
}

function queryWords(text) {
  const out = [];
  const seen = new Set();
  const raw = rawWords(text);
  const phoneModelQuery = raw.some((w) => /^(?:iphone|айфон|samsung|galaxy|pixel|xiaomi|redmi|poco|oppo|oneplus)$/.test(w));
  for (let i = 0; i < raw.length; i += 1) {
    let w = raw[i];
    // Люди часто называют модель кириллицей: «айфон 18 про макс». Эти слова
    // должны быть поисковыми маркерами модели, а не служебными словами.
    if (phoneModelQuery && w === "айфон") w = "iphone";
    if (phoneModelQuery && w === "про" && /^\d+$/.test(raw[i - 1] || "")) w = "pro";
    if (phoneModelQuery && w === "макс") w = "max";
    // Одиниці виміру вже обробляються як строгі фасети вище; як звичайні слова
    // вони лише штучно занижують релевантність.
    const modelNumber = phoneModelQuery && /^\d{1,3}$/.test(w);
    if (w.length < 2 || FILLER.has(w) || SOFT_INTENT_RE.test(w) || (!modelNumber && /^(?:\d+|gb|гб|tb|тб|mah|маг|hz|гц|герц|дюйм(?:ів|и)?|inch(?:es)?)$/iu.test(w))) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// Розгортання слова запиту в основи, які існують у каталозі.
function expandToken(word, idx) {
  const q = stem(word);
  const alts = new Map(); // stem -> { w, kind }
  const put = (s, w, kind) => {
    const prev = alts.get(s);
    if (!prev || prev.w < w) alts.set(s, { w, kind });
  };
  // основа → усі близькі основи, що реально є в каталозі (форми слова, одруківки)
  const spread = (base, weight, kind, { fuzzy = true } = {}) => {
    if (!base || base.length < 2) return;
    if (idx.postings.has(base)) put(base, weight, kind);
    if (!fuzzy || base.length < 4 || /\d/.test(base)) return;
    for (const v of idx.buckets.get(base[0]) || []) {
      if (v === base) continue;
      const m = stemMatch(base, v);
      if (m) put(v, weight * m, kind === "exact" ? (m >= 0.92 ? "prefix" : "fuzzy") : kind);
    }
  };

  // 1) синоніми («кастрюля» → «каструля», «утюг» → «праска»)
  for (const g of SYNONYMS) {
    if (!g.qStems.some((k) => k === q || stemMatch(q, k) >= 0.92)) continue;
    for (const s of g.sameStems) spread(s, 0.95, "syn");
    for (const s of g.nearStems) spread(s, 0.5, "near", { fuzzy: false });
  }

  // 2) словник каталогу: точно / початок слова / одруківка
  spread(q, 1, "exact");

  // 3) фонетика: «тефаль» → tefal, «браун» → braun
  if (isCyr(word) && word.length >= 4 && ![...alts.values()].some((a) => a.kind === "exact" || a.kind === "prefix")) {
    // «г» у запозичених назвах читається і як h, і як g (лего → Lego, гоpro → GoPro)
    for (const k of new Set([phon(word), phon(word.replace(/г/g, "ґ"))])) {
      if (k.length >= 4) for (const s of idx.phonMap.get(k) || []) put(s, 0.88, "phon");
    }
  }

  return [...alts.entries()].filter(([s]) => idx.postings.has(s)).map(([s, a]) => ({ stem: s, ...a }));
}

function rankItems(matches, tokenCount) {
  return matches.sort((a, b) => b.score - a.score || a.p.price - b.p.price);
}

// Показуємо різні бренди, а не 8 однакових.
function diversify(sorted, limit) {
  if (sorted.length <= limit) return sorted.slice(0, limit);
  // Never sacrifice relevance merely to show another brand. This used to let
  // a headphone stand compatible with a laptop appear after an actual laptop.
  const floor = sorted[0].score * 0.45;
  const strong = sorted.filter((m) => m.score >= floor);
  const weak = sorted.filter((m) => m.score < floor);
  const preferred = strong.length ? strong : sorted;
  const out = [];
  const perVendor = new Map();
  const rest = [];
  const cap = Math.max(2, Math.ceil(limit / 3));
  for (const m of preferred) {
    const v = String(m.p.vendor || "").toLowerCase();
    const n = perVendor.get(v) || 0;
    if (n < cap && out.length < limit) {
      out.push(m);
      perVendor.set(v, n + 1);
    } else rest.push(m);
  }
  for (const m of rest) {
    if (out.length >= limit) break;
    out.push(m);
  }
  // A narrow, highly relevant result set is better than padding the visible
  // cards with unrelated products. Only backfill when we genuinely have no
  // strong candidates.
  if (!strong.length) {
    for (const m of weak) {
      if (out.length >= limit) break;
      out.push(m);
    }
  }
  // порядок за релевантністю
  const pos = new Map(preferred.map((m, i) => [m, i]));
  return out.sort((a, b) => pos.get(a) - pos.get(b));
}

/**
 * Головний пошук.
 * @returns {null | {
 *   tier: "exact"|"brand_relaxed"|"related"|"unavailable",
 *   items: Array<product>, picks: Array<product>, total, priceMin, priceMax,
 *   phrase, tokens, ignored, relaxedBrand, nearLabel, brands, viaCategory, node
 * }}
 * null — слова запиту каталогу невідомі (тоді працює решта пайплайна: LLM, уточнення тощо).
 */
function find(catalog, query, { limit = 8 } = {}) {
  const idx = getIndex(catalog);
  const budget = parseBudget(query);
  const constraints = parseHardConstraints(budget.rest);
  const words = queryWords(budget.rest);
  if (!words.length || words.length > 6) return null;

  const tokens = words.map((w) => ({ word: w, alts: expandToken(w, idx) }));
  const known = tokens.filter((t) => t.alts.length);
  const ignored = tokens.filter((t) => !t.alts.length).map((t) => t.word);
  if (!known.length) return null;
  // Unknown words are often a purchase purpose ("для навчання", "у
  // подарунок"), a colour/style, or a new model not yet in the feed.  They
  // should not erase a confidently recognised product type. Exact model
  // matching remains protected by the specialised branch in chatController.
  const wantsAccessory = ACCESSORY_QUERY_RE.test(query);
  const forHome = /(?:дома|дому|домашн\p{L}*)/iu.test(query);
  const productTypeRe = /(?:ноутбук|laptop|macbook|chromebook)/iu.test(query)
    ? /ноутбук|laptop|macbook|chromebook/iu
    : /(?:смартфон|телефон|iphone|айфон)/iu.test(query)
    ? /смартфон|телефон|iphone|айфон|galaxy|pixel|xiaomi|redmi|poco|oppo|oneplus/iu
    : /(?:монітор|монитор)/iu.test(query)
    ? /монітор|монитор/iu
    : /(?:пилосос|пылесос)/iu.test(query)
    ? /пилосос|пылесос|vacuum/iu
    : null;

  const N = idx.total || 1;
  const priceOk = (p) => (budget.min == null || p.price >= budget.min) && (budget.max == null || p.price <= budget.max);

  // Для кожного слова: товар → найкращий збіг ({ w, near, cat, kind })
  const perToken = known.map((t) => {
    const m = new Map();
    let vendorHits = 0;
    for (const a of t.alts) {
      const post = idx.postings.get(a.stem);
      if (!post) continue;
      for (const [pi, [fw, flag]] of post) {
        const w = a.w * fw;
        const prev = m.get(pi);
        if (!prev || prev.w < w) m.set(pi, { w, near: a.kind === "near", cat: flag === "c" || flag === "a", kind: a.kind });
      }
      const vdf = idx.vendorDf.get(a.stem) || 0;
      if (vdf >= 2 && a.kind !== "near" && vdf >= 0.6 * post.size) vendorHits += 1;
    }
    return { t, m, idf: Math.log(1 + N / Math.max(1, m.size)), isBrand: vendorHits > 0 };
  });

  function collect(selected, { allowNear, includeUnavailable, noFuzzy = false }) {
    if (!selected.length) return [];
    const [first, ...others] = [...selected].sort((a, b) => a.m.size - b.m.size);
    const out = [];
    for (const [pi, hit] of first.m) {
      const it = idx.items[pi];
      if (!includeUnavailable && !it.avail) continue;
      // "Смартфон Samsung" must not silently become a list of Samsung cases.
      // Conversely, an explicitly requested cable/case/charger is allowed.
      if (!wantsAccessory && it.p.isAccessory) continue;
      if (forHome && /автомобільн|автомобильн|car\s/iu.test(String(it.p.name || "") + " " + String(it.p.categoryName || ""))) continue;
      if (productTypeRe && !productTypeRe.test(String(it.p.name || "") + " " + String(it.p.categoryName || ""))) continue;
      if (productTypeRe && ACCESSORY_NAME_RE.test(String(it.p.name || ""))) continue;
      if (!priceOk(it.p)) continue;
      if (!productMeetsHardConstraints(it.p, constraints)) continue;
      if (noFuzzy && hit.kind === "fuzzy") continue;
      let score = first.idf * hit.w;
      let near = hit.near;
      let viaCat = hit.cat;
      let ok = true;
      for (const o of others) {
        const h = o.m.get(pi);
        if (!h || (noFuzzy && h.kind === "fuzzy")) {
          ok = false;
          break;
        }
        score += o.idf * h.w;
        near = near || h.near;
        viaCat = viaCat && h.cat;
      }
      if (!ok) continue;
      if (near !== allowNear) continue;
      out.push({ p: it.p, node: it.node, score, near, viaCat });
    }
    return out;
  }

  const brandTokens = perToken.length > 1 ? perToken.filter((x) => x.isBrand) : [];
  const withoutBrand = brandTokens.length && brandTokens.length < perToken.length ? perToken.filter((x) => !x.isBrand) : null;
  const phraseOf = (list) => list.map((x) => x.t.word).join(" ");
  let result = null;
  const attempt = (tier, selected, opts, extra = {}) => {
    if (result) return;
    const hits = collect(selected, opts);
    if (hits.length) result = { tier, hits, used: selected, ...extra };
  };

  // 1) точний збіг по всіх словах
  attempt("exact", perToken, { allowNear: false, includeUnavailable: false });
  // 2) без бренду: «чайник tefal», а Tefal-чайників у наявності нема → чайники інших брендів
  if (withoutBrand) attempt("brand_relaxed", withoutBrand, { allowNear: false, includeUnavailable: false }, { relaxedBrand: phraseOf(brandTokens) });
  // 3) близький замінник (кастрюля → гусятниця)
  attempt("related", perToken, { allowNear: true, includeUnavailable: false });
  if (withoutBrand) attempt("related", withoutBrand, { allowNear: true, includeUnavailable: false });
  // 4) у каталозі є, але зараз немає в наявності (лише впевнені збіги, не випадкові «банан» в LEGO)
  if (!result) {
    const hits = collect(perToken, { allowNear: false, includeUnavailable: true, noFuzzy: true });
    const viaCat = hits.some((m) => m.viaCat);
    if (hits.length >= 2 || (hits.length && viaCat)) result = { tier: "unavailable", hits, used: perToken };
  }
  if (!result) return null;

  // Релевантність: відкидаємо «хвіст» (аксесуари «для пилососа», згадка слова десь у кінці назви)
  const sortedAll = rankItems(result.hits, perToken.length);
  const top = sortedAll[0].score;
  const sorted = result.tier === "unavailable" ? sortedAll : sortedAll.filter((m) => m.score >= top * 0.45);
  const maxPossible = result.used.reduce((sum, x) => sum + x.idf, 0) || 1;
  const strength = top / maxPossible;
  // Згадка шуканого слова в хвості назви не робить товар результатом пошуку:
  // «підставка ДЛЯ каструль» не є каструлею. Раніше такий одиничний слабкий
  // збіг перетворювався на "схожий товар" і виглядав для покупця як помилка.
  // Збіг у параметрі (0.56), категорії (0.86) або на початку назви лишається
  // валідним, тож це не приховує нормальні каталожні результати.
  if (strength < 0.5 && sortedAll.length <= 3) return null;
  // Єдиний збіг «десь у назві» (Сумка-холодильник на запит «холодильник») — це не те, що шукали
  let tier = result.tier;
  if (tier === "exact" && strength < 0.8 && sorted.length <= 3) tier = "related";

  const items = sorted.map((m) => m.p);
  const prices = items.map((p) => p.price).filter((n) => Number.isFinite(n));

  const nodes = new Map();
  for (const m of sorted) if (m.node) nodes.set(m.node.k, (nodes.get(m.node.k) || 0) + 1);
  const topNode = [...nodes.entries()].sort((a, b) => b[1] - a[1])[0];
  const commonNode = topNode && nodes.size === 1 ? categoryTree.getNode(topNode[0]) : null;

  let nearLabel = null;
  if (tier === "related") {
    for (const g of SYNONYMS) {
      if (!g.nearStems.length) continue;
      if (known.some((t) => g.qStems.some((k) => stemMatch(stem(t.word), k) >= 0.92 || k === stem(t.word)))) {
        nearLabel = g.label || null;
        break;
      }
    }
  }

  const topSet = diversify(sorted, limit);
  return {
    tier,
    items,
    picks: topSet.map((m) => m.p),
    total: items.length,
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    phrase: result.used.map((x) => x.t.word).join(" "),
    tokens: result.used.map((x) => x.t.word),
    ignored,
    relaxedBrand: result.relaxedBrand || null,
    nearLabel,
    viaCategory: sorted.length > 0 && sorted.every((m) => m.viaCat),
    node: commonNode,
    budget: { min: budget.min, max: budget.max },
    constraints,
  };
}

// ── Відповіді ──────────────────────────────────────────────────────────────────

function countWord(n) {
  const a = n % 100;
  if (a >= 11 && a <= 14) return "товарів";
  const b = n % 10;
  if (b === 1) return "товар";
  if (b >= 2 && b <= 4) return "товари";
  return "товарів";
}

function rangeText(r) {
  return r.priceMin != null && r.priceMax != null && r.priceMin !== r.priceMax ? `, ціни від ${r.priceMin} до ${r.priceMax} грн` : r.priceMin != null && r.total === 1 ? ` — ${r.priceMin} грн` : "";
}

function pick(list, seed) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

function composeReply(r, message) {
  const shown = r.picks.length;
  const label = r.viaCategory && r.node ? `«${r.node.ua}»` : `«${r.phrase}»`;
  const budgetNote =
    r.budget.max != null && r.budget.min != null
      ? ` у межах ${r.budget.min}–${r.budget.max} грн`
      : r.budget.max != null
      ? ` до ${r.budget.max} грн`
      : r.budget.min != null
      ? ` від ${r.budget.min} грн`
      : "";
  const more = r.total > shown ? ` Показую ${shown} — напишіть бренд чи бюджет, і я підберу точніше.` : "";
  const ignoredNote = r.ignored.length ? ` (слово «${r.ignored.join("», «")}» не розпізнав — шукав за рештою запиту)` : "";

  if (r.tier === "exact") {
    const open = pick(["Так, є!", "Так, у нас є!", "Є, зараз покажу!"], message);
    if (r.total === 1) return `${open} ${label}${budgetNote}${rangeText(r)}, в наявності.${ignoredNote}`;
    return `${open} ${label}${budgetNote}: в наявності ${r.total} ${countWord(r.total)}${rangeText(r)}.${more}${ignoredNote}`;
  }
  if (r.tier === "brand_relaxed") {
    return `Саме «${r.relaxedBrand}» у категорії ${label} зараз немає в наявності, але є інші бренди — ${r.total} ${countWord(r.total)}${rangeText(r)}.${more}`;
  }
  if (r.tier === "related") {
    const what = r.nearLabel ? `${r.nearLabel}` : "найближче з наявного";
    return `Саме ${label}${budgetNote} у каталозі зараз немає 🤷 Зате є схоже — ${what}: ${r.total} ${countWord(r.total)}${rangeText(r)}. Подивіться, чи підходить.${ignoredNote}`;
  }
  // unavailable
  return `${label} в каталозі є, але зараз немає в наявності. Можу підібрати схожий варіант або передати запит менеджеру 😊`;
}

// ── Нічого не знайдено: чесно і з гумором ──────────────────────────────────────

// Як назвати запит у відповіді «саме X не знайшов»: слова клієнта без службових («а», «є?», «чи є у вас»),
// але з прийменниками, щоб було «іграшка для собаки», а не «іграшка собаки».
const KEEP_PREPS = new Set(["для", "на", "з", "зі", "із", "до", "по", "про", "від", "без", "при"]);
function askedPhrase(text) {
  const words = rawWords(parseBudget(text).rest).filter((w) => !/^\d+$/.test(w) && (KEEP_PREPS.has(w) || !FILLER.has(w)));
  while (words.length && KEEP_PREPS.has(words[0])) words.shift();
  while (words.length && KEEP_PREPS.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

const NOT_OURS = [
  (w) => `Ха-ха, «${w}» у нас немає 😄 Ми про техніку, гаджети та товари для дому. Подивіться, що є за розділами:`,
  (w) => `Ну «${w}» — це точно не до нас 😅 У нас електроніка, побутова техніка й товари для дому. Оберіть розділ:`,
  (w) => `«${w}»? Такого в нас не водиться 🙈 Зате є багато іншого — оберіть розділ:`,
];
const NOT_FOUND = [
  (w) => `Не знайшов «${w}» у каталозі 🤔 Перевірте написання або оберіть розділ — підкажу, що є:`,
  (w) => `Саме «${w}» не бачу в наявності. Можливо, інакше називається — оберіть розділ або напишіть детальніше:`,
];

function composeNotFound(message, { vocabKnown }) {
  const phrase = askedPhrase(message) || String(message || "").trim().slice(0, 40);
  // жодне слово запиту не схоже на щось у каталозі → це не наш асортимент (бананів нема)
  return vocabKnown ? pick(NOT_FOUND, message)(phrase) : pick(NOT_OURS, message)(phrase);
}

// Чи хоч одне слово запиту схоже на слово з каталогу (для вибору тону «нема»).
function anyWordKnown(catalog, query) {
  const idx = getIndex(catalog);
  const words = queryWords(parseBudget(query).rest);
  return words.some((w) =>
    expandToken(w, idx).some((a) => a.kind !== "fuzzy" && a.kind !== "near" && ((idx.vocab.get(a.stem) || {}).avail || 0) > 0)
  );
}

function warm(catalog) {
  try {
    getIndex(catalog);
  } catch (e) {
    console.warn("[finder] warm failed:", e.message);
  }
}

// Запити, де клієнт уточнює «для кого» (собака, кіт, дитина): тут краще працює дерево категорій із контекстом.
const CONTEXT_RE = /(?:^|[^\p{L}\p{N}])(?:собак\p{L}*|пс[аиуо]\p{L}*|пес\p{L}*|цуц\p{L}*|щен\p{L}*|кот[аиуе]?\p{L}*|кіт\p{L}*|кіш\p{L}*|кош\p{L}*|котик\p{L}*|дитин\p{L}*|дітей|діт\p{L}*|ребен\p{L}*|детск\p{L}*|дитяч\p{L}*|малюк\p{L}*|тварин\p{L}*|животн\p{L}*)(?=$|[^\p{L}\p{N}])/iu;
function hasContextWord(text) {
  return CONTEXT_RE.test(String(text || ""));
}

module.exports = { askedPhrase, hasContextWord, find, composeReply, composeNotFound, anyWordKnown, parseBudget, parseHardConstraints, queryWords, stem, warm };
