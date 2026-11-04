// Призначення → характеристики.
//
// Фінкер знаходить товари за словами, ціною і наявністю. Але «ноутбук для навчання» і
// «ноутбук для ігор» — це різні речі: для навчання потрібно достатньо ОЗП і нормальний процесор,
// для ігор — дискретна відеокарта. Цей модуль читає реальні характеристики з параметрів товару
// (ОЗП, процесор, накопичувач, відеокарта), відсіває те, що явно не підходить під призначення,
// і сортує решту за відповідністю. Працює лише з ноутбуками; для інших категорій нічого не змінює.

const PURPOSES = {
  study: {
    noun: "навчання",
    // Мінімум для навчання: 8 ГБ ОЗП (якщо характеристика відома)
    minRam: 8,
    matches: /(?:навч\p{L}*|учеб\p{L}*|універ\p{L}*|универ\p{L}*|студент\p{L}*|школ\p{L}*|уроки|робот\p{L}*|офіс\p{L}*|офис\p{L}*)/iu,
    ok: (f) => (f.ram == null || f.ram >= 8),
    // Для навчання пам'ять важить більше: 16 ГБ краще за 8 ГБ при близькому процесорі
    score: (f) => 3 * (f.cpuTier ?? 2) + 2 * ramPts(f.ram) + (f.ssd ? 1 : 0),
  },
  gaming: {
    noun: "ігор",
    matches: /(?:ігр\p{L}*|игр\p{L}*|гейм\p{L}*|game\p{L}*|gaming)/iu,
    ok: (f) => f.gpuTier >= 2,
    score: (f) => 4 * f.gpuTier + ramPts(f.ram) + (f.cpuTier ?? 2),
  },
  creative: {
    noun: "монтажу та дизайну",
    matches: /(?:монтаж\p{L}*|монтаж|дизайн\p{L}*|відео\p{L}*|видео\p{L}*|графік\p{L}*|график\p{L}*|фотошоп|photoshop|premiere|blender)/iu,
    ok: (f) => (f.ram ?? 0) >= 16 || f.gpuTier >= 2,
    score: (f) => 2 * (f.cpuTier ?? 2) + ramPts(f.ram) * 1.5 + 2 * f.gpuTier,
  },
};

const LAPTOP_NAME_RE = /^(?:б\/[вв]\s+)?(?:ноутбук|notebook|apple\s+macbook|macbook|chromebook)(?!\p{L})/iu;
const NOT_LAPTOP_RE = /чохол|чехол|сумк|рюкзак|підставк|подставк|кабел|адаптер|блок живлення|стилус|шкірян|плівк|скло/iu;

// Слова, які треба прибрати з запиту перед фінкером, щоб вони не стали «нерозпізнаними»
const PURPOSE_PHRASE_RE = /(?<!\p{L})(?:для|на)?\s*(?:навчання|учеб\p{L}*|універ\p{L}*|студент\p{L}*|школ\p{L}*|робот\p{L}*|офіс\p{L}*|офис\p{L}*|ігр\p{L}*|игр\p{L}*|монтаж\p{L}*|дизайн\p{L}*)(?!\p{L})/giu;
const ADVICE_VERB_RE = /(?<!\p{L})(?:посоветуй\p{L}*|порекомендуй\p{L}*|порадь\p{L}*|підкажи\p{L}*|подскажи\p{L}*|підбери\p{L}*|подбери\p{L}*)(?!\p{L})/giu;

function ramPts(ram) {
  if (ram == null) return 0;
  if (ram >= 16) return 2;
  if (ram >= 8) return 1;
  return 0;
}

function parseParam(params, re) {
  if (!params || typeof params !== "object") return null;
  for (const [k, v] of Object.entries(params)) {
    if (re.test(k) && v != null) return String(v);
  }
  return null;
}

function parseRam(p) {
  const v = parseParam(p.params, /оперативн|оперативная|ram/i);
  const m = v && v.match(/(\d+)\s*(?:гб|gb|гігабайт)/i);
  if (m) return Number(m[1]);
  // Формат назви "16/512GB": перша цифра — ОЗП
  const n = p.name.match(/\b(\d{1,2})\s*\/\s*\d{3,4}\s*gb\b/i);
  return n ? Number(n[1]) : null;
}

function parseStorage(p) {
  const v = parseParam(p.params, /накопичувач|накопитель|storage|ssd|hdd/i) || "";
  const ssd = /ssd/i.test(v) || /ssd/i.test(p.name);
  const m = v.match(/(\d+)\s*(гб|gb|tb|тб)/i);
  if (m) return { gb: /tb|тб/i.test(m[2]) ? Number(m[1]) * 1024 : Number(m[1]), ssd };
  // Запасний варіант: найбільший об'єм у назві, який не схожий на ОЗП (≥128 ГБ)
  let best = null;
  for (const x of p.name.matchAll(/(?<![\d\/])(\d+)\s*(гб|gb|tb|тб)\b/giu)) {
    const gb = /tb|тб/i.test(x[2]) ? Number(x[1]) * 1024 : Number(x[1]);
    if (gb >= 128 && (best == null || gb > best)) best = gb;
  }
  return { gb: best, ssd };
}

function parseCpuTier(p) {
  // Якщо процесор є в характеристиках — дивимось лише туди: назва містить артикули (N0876), що
  // схожі на моделі Intel N-серії. Назву беремо тільки як запасний варіант.
  const param = parseParam(p.params, /процесор|cpu|processor/i);
  const v = param || p.name;
  if (/celeron|pentium|atom|athlon\s*3|\bn\d{4}\b|kompanio|mediatek|snapdragon/i.test(v)) return 1;
  if (/core\s*i3|ryzen\s*3|\bi3-|\br3\b/i.test(v)) return 2;
  if (/core\s*i5|core\s*ultra\s*5|ryzen\s*5|\bi5-|\br5\b/i.test(v)) return 3;
  if (/core\s*i[79]|core\s*ultra\s*[79]|ryzen\s*[79]|\bi[79]-|\br[79]\b/i.test(v)) return 4;
  if (/\bm[2-9]\b/i.test(v)) return 4;
  if (/\bm1\b/i.test(v)) return 3;
  return null;
}

function parseGpuTier(p) {
  const v = (parseParam(p.params, /відеокарт|видеокарт|graphics|gpu/i) || "") + " " + p.name;
  const rtx = v.match(/rtx\s*(\d{4})/i);
  if (rtx) return Number(rtx[1]) >= 3060 ? 3 : 2;
  const gtx = v.match(/gtx\s*(\d{4})/i);
  if (gtx) return Number(gtx[1]) >= 1650 ? 2 : 1;
  const rx = v.match(/rx\s*(\d{4})/i);
  if (rx) return Number(rx[1]) >= 6600 ? 3 : 2;
  if (/\bmx\d{3}/i.test(v)) return 1;
  if (/arc\s/i.test(v)) return 2;
  if (/дискрет|discrete|radeon\s*rx|quadro/i.test(v)) return 2;
  return 0; // інтегрована або невідомо
}

function specsOf(p) {
  const storage = parseStorage(p);
  return {
    ram: parseRam(p),
    storage: storage.gb,
    ssd: storage.ssd,
    cpuTier: parseCpuTier(p),
    gpuTier: parseGpuTier(p),
  };
}

function isLaptop(p) {
  const name = String(p.name || "").trim();
  return LAPTOP_NAME_RE.test(name) && !NOT_LAPTOP_RE.test(name);
}

// Ноутбучний контекст: без нього «ігри» і «навчання» не змінюють пошук (наприклад, «Ігри» — це консолі).
function isLaptopQuery(text) {
  return /ноут|laptop|macbook|chromebook|нетбук|ноутбу/iu.test(String(text || ""));
}

// Визначає призначення із запиту (або null).
function detect(text) {
  if (!isLaptopQuery(text)) return null;
  for (const [kind, def] of Object.entries(PURPOSES)) {
    if (def.matches.test(String(text))) return kind;
  }
  return null;
}

// Прибирає слова призначення і звернення («посоветуй», «для навчання») з тексту для фінкера.
function stripPurpose(text) {
  return String(text || "")
    .replace(ADVICE_VERB_RE, " ")
    .replace(PURPOSE_PHRASE_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortName(p) {
  let n = String(p.name || "")
    .replace(/\s*\([^)]*\)\s*$/, "")                 // артикул у дужках
    .replace(/\s+\d{1,2}(?:[.,]\d)?\s*(?:["”]|дюйм\p{L}*|inch).*$/iu, "") // діагональ і все після неї
    .replace(/\s+\d+\s*(?:GB|ГБ)\b.*$/i, "")         // ОЗП/накопичувач, якщо лишились
    .replace(/,\s*$/, "")
    .trim();
  const used = /^Б\/В\s+/i.test(n);
  n = n.replace(/^Б\/В\s+/i, "");
  return used ? `${n} (б/в)` : n;
}

function cpuShort(p) {
  const v = parseParam(p.params, /процесор|cpu|processor/i);
  if (!v) return null;
  return v.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim().slice(0, 32);
}

// Короткі причини, чому товар підходить: лише те, що справді є в характеристиках
function reasonsOf(f, p) {
  const out = [];
  if (f.ram != null) out.push(`${f.ram} ГБ ОЗП`);
  const cpu = p ? cpuShort(p) : null;
  if (cpu) out.push(cpu);
  else if (f.cpuTier != null && f.cpuTier <= 1) out.push("слабкий процесор");
  if (f.gpuTier >= 2) out.push("дискретна відеокарта");
  else if (f.gpuTier === 1) out.push("слабка дискретна відеокарта");
  if (f.storage != null) out.push(`${f.storage >= 1024 ? Math.round(f.storage / 1024) + " ТБ" : f.storage + " ГБ"}${f.ssd ? " SSD" : ""}`);
  return out.slice(0, 3).join(", ");
}

// Головна функція: r — результат фінкера. Повертає { picks, relaxed, upsell, reply }.
// picks — товари для карток (уже відсортовані); upsell — варіанти трохи дорожчі за бюджет.
function applyFit({ kind, r, catalog, maxBudget }) {
  const def = PURPOSES[kind];
  const laptops = r.items.filter(isLaptop);
  const scored = laptops.map((p) => ({ p, f: specsOf(p) }));

  const suitable = scored.filter((x) => def.ok(x.f));
  const pool = suitable.length ? suitable : scored;
  const relaxed = !suitable.length;
  pool.sort((a, b) => def.score(b.f) - def.score(a.f) || a.p.price - b.p.price);

  const picks = pool.slice(0, 6).map((x) => Object.assign({}, x.p, { _fit: x.f, _why: reasonsOf(x.f, x.p) }));

  // Якщо в бюджеті мало підходящих — показуємо найкраще трохи дорожче (до +20%), чесно позначивши
  let upsell = [];
  if (!relaxed && suitable.length < 3 && maxBudget && catalog && catalog.products) {
    const limit = Math.round(maxBudget * 1.2);
    const seen = new Set(picks.map((p) => p.id));
    upsell = catalog.products
      .filter((p) => p.available && !seen.has(p.id) && isLaptop(p))
      .filter((p) => p.price > maxBudget && p.price <= limit)
      .map((p) => ({ p, f: specsOf(p) }))
      .filter((x) => def.ok(x.f))
      .sort((a, b) => def.score(b.f) - def.score(a.f) || a.p.price - b.p.price)
      .slice(0, 2)
      .map((x) => Object.assign({}, x.p, { _fit: x.f, _why: reasonsOf(x.f, x.p), _tag: "трохи дорожче" }));
  }

  return { kind, noun: def.noun, picks, relaxed, upsell, reply: composeReply({ noun: def.noun, picks, relaxed, upsell, maxBudget }) };
}

function composeReply({ noun, picks, relaxed, upsell, maxBudget }) {
  const budget = maxBudget ? ` до ${maxBudget} грн` : "";
  if (!picks.length) return "";
  const best = picks[0];
  const bestLine = `${shortName(best)} — ${best._why || "підійде"}.`;

  if (relaxed) {
    return `Ноутбуків для ${noun}${budget} з потрібною конфігурацією зараз немає. Найближче: ${bestLine} Слабше, але з чим зможе.`;
  }
  if (upsell.length) {
    const u = upsell[0];
    return `Для ${noun}${budget} в наявності небагато. Найкращий: ${bestLine} Трохи дорожче (${u.price} грн) є ${shortName(u)} — ${u._why || "краща конфігурація"}.`;
  }
  return `Для ${noun}${budget} найкращий вибір: ${bestLine}`;
}

// Для шляху через дерево категорій: прибрати ноутбуки, що явно не підходять, якщо є придатні;
// решту товарів (не ноутбуки) не чіпаємо.
function restrictToFit(items, kind) {
  const def = PURPOSES[kind];
  const laptops = items.filter(isLaptop);
  const suitable = laptops.filter((p) => def.ok(specsOf(p)));
  if (!suitable.length) return items;
  const keep = new Set(suitable.map((p) => p.id));
  return items.filter((p) => !isLaptop(p) || keep.has(p.id));
}

// Сортує ноутбуки за відповідністю призначенню (інші товари лишаються на своїх місцях).
function sortByFit(items, kind) {
  const def = PURPOSES[kind];
  const sortFn = (a, b) => def.score(b.f) - def.score(a.f) || a.p.price - b.p.price;
  const laps = items.filter(isLaptop).map((p) => ({ p, f: specsOf(p) })).sort(sortFn).map((x) => x.p);
  let k = 0;
  return items.map((p) => (isLaptop(p) ? laps[k++] : p));
}

// ── Ознака «з підсвіткою клавіатури» (у каталозі немає окремого параметра — шукаємо в описі) ──
const WANTS_BACKLIGHT_RE = /підсвіт|подсвет|підсвіч|подсвеч/iu;
const BACKLIGHT_TEXT_RE = /підсвіт|подсвет|підсвіч|подсвеч|backlit|backlight/iu;

function hasBacklight(p) {
  const params = Object.values(p.params || {}).map(String).join(" ");
  return BACKLIGHT_TEXT_RE.test(`${p.name || ""} ${p.description || ""} ${params}`);
}

// Якщо клієнт просить підсвітку — ноутбуки без згадки про неї відсіюємо (якщо є хоч один з нею).
function filterBacklight(items, message) {
  if (!WANTS_BACKLIGHT_RE.test(String(message || ""))) return items;
  const laptops = items.filter(isLaptop);
  const lit = laptops.filter(hasBacklight);
  if (!lit.length) return items;
  const keep = new Set(lit.map((p) => p.id));
  return items.filter((p) => !isLaptop(p) || keep.has(p.id));
}

// Аксесуари, які містять слово «ноутбук» («Рюкзак для ноутбука»), не є ноутбуками.
// Коли клієнт шукає ноутбук і сам не просив аксесуар — такі позиції відкидаємо.
const LAPTOP_ACCESSORY_NAME_RE = /для\s+(ноутбук|macbook|chromebook|notebook)|рюкзак|сумк|чохол|чехол|кейс|\bcase\b|кабел|адаптер|блок\s+живлен|підставк|подставк|скл[оа]|плівк|пленк|стекл/iu;
const ASKS_ACCESSORY_RE = /чохол|чехол|кейс|\bcase\b|рюкзак|сумк|кабел|кабель|аксесуар|аксессуар|скл[оа]|стекл|плівк|пленк|зарядк|зарядн|адаптер|павер|power ?bank|повербанк|тримач|держател|підставк|подставк|ремінець|ремешок/iu;

function dropLaptopAccessories(items, message) {
  if (!isLaptopQuery(message) || ASKS_ACCESSORY_RE.test(String(message || ""))) return items;
  return items.filter((p) => isLaptop(p) || !LAPTOP_ACCESSORY_NAME_RE.test(String(p.name || "")));
}

// Застосовує призначення і підсвітку до масиву товарів на місці (зберігає властивості масиву,
// які використовує чат, наприклад treePool). Викликається для будь-якої гілки пошуку.
function applyInPlace(arr, message) {
  if (!Array.isArray(arr) || !arr.length) return arr;
  let items = dropLaptopAccessories(arr, message);
  items = filterBacklight(items, message);
  const kind = detect(message);
  if (kind && items.some(isLaptop)) items = sortByFit(restrictToFit(items, kind), kind);
  if (items.length !== arr.length || items.some((p, i) => p !== arr[i])) {
    arr.length = 0;
    arr.push(...items);
  }
  return arr;
}

module.exports = { detect, stripPurpose, isLaptopQuery, isLaptop, specsOf, applyFit, restrictToFit, sortByFit, PURPOSES, filterBacklight, dropLaptopAccessories, applyInPlace, WANTS_BACKLIGHT_RE };