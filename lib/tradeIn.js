// Трейд-ін: оцінка б/у iPhone за прайсом (data/tradein_prices.csv) і діалог з уточненнями.
//
// Потік: клієнт називає модель → уточнення: пам'ять (якщо не назвав) → стан дисплея →
// батарея → корпус → попередня оцінка. Ціна в прайсі — базова (стан «ідеальний»), далі
// множники стану. Валюту прайсу файл не вказує (ймовірно USD) — курс і множники в конфігу.
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PRICE_FILE = path.join(DATA_DIR, "tradein_prices.csv");
const CONFIG_FILE = path.join(DATA_DIR, "tradein.config.json");

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map(); // sessionId -> { state, touchedAt }

// ── Прайс ──────────────────────────────────────────────────────────────

// "Apple iPhone 17 Pro Max 256GB e-SIM" → { model:"17 Pro Max", gb:256, sim:"esim", name }
function parseName(name) {
  const m = String(name).match(/iPhone\s+(.+?)\s+(\d+)\s*(GB|TB)\s*(e-?SIM|SIM)?\s*$/i);
  if (!m) return null;
  const gb = m[3].toUpperCase() === "TB" ? Number(m[2]) * 1024 : Number(m[2]);
  let sim = "none";
  if (m[4]) sim = /e-?sim/i.test(m[4]) ? "esim" : "sim";
  return { model: m[1].trim(), gb, sim };
}

let _table = null;
function loadPriceTable(file = PRICE_FILE) {
  if (_table) return _table;
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  const bad = [];
  for (const line of lines.slice(1)) {
    // формат: ID;"Name RU";"Name UA";Price
    const cols = line.match(/^(\d+);"([^"]*)";"([^"]*)";(\d+(?:\.\d+)?)$/);
    if (!cols) { bad.push(line); continue; }
    const parsed = parseName(cols[2]);
    if (!parsed) { bad.push(line); continue; }
    rows.push({ id: Number(cols[1]), name: cols[2], ...parsed, usd: Number(cols[4]) });
  }
  _table = { rows, bad };
  return _table;
}

function loadConfig(file = CONFIG_FILE) {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const envRate = Number(process.env.TRADEIN_USD_UAH);
  if (Number.isFinite(envRate) && envRate > 0) cfg.usdToUah = envRate;
  return cfg;
}

// Базова ціна для моделі+пам'яті. Якщо є і SIM, і eSIM — беремо нижчу (консервативно).
function basePrice(model, gb, table = loadPriceTable()) {
  const hits = table.rows.filter((r) => r.model === model && r.gb === gb);
  if (!hits.length) return null;
  return hits.reduce((a, b) => (b.usd < a.usd ? b : a));
}

function modelsAvailable(table = loadPriceTable()) {
  return [...new Set(table.rows.map((r) => r.model))];
}

// ── Розбір відповідей клієнта ──────────────────────────────────────────

// "13 про макс" / "13 pro max" / "айфон 13 pro" → "13 Pro Max" / "13 Pro"
function parseModel(text) {
  const t = String(text || "").toLowerCase();
  const m = t.match(/(?:iphone|айфон\w*|ifone)\s*(1[0-7]|[7-9])(?!\d)\s*(pro\s*max|про\s*макс|pro|про|plus|плюс|mini|мини|air|эйр|ейр|e|se)?/iu)
    || t.match(/(?<![\d.])(1[0-7]|[7-9])(?!\d)\s*(pro\s*max|про\s*макс|pro|про|plus|плюс|mini|мини|air|эйр|ейр|se)(?![\p{L}])/iu);
  if (!m) return null;
  const suffix = (m[2] || "").replace(/\s+/g, " ");
  const map = {
    "pro max": " Pro Max", "про макс": " Pro Max", pro: " Pro", про: " Pro",
    plus: " Plus", плюс: " Plus", mini: " mini", мини: " mini",
    air: " Air", эйр: " Air", ейр: " Air", e: "", se: " SE",
  };
  return `${m[1]}${map[suffix] ?? ""}`;
}

// "256 гб", "1tb", "512" → 256 / 1024 / 512
function parseStorageGb(text) {
  const t = String(text || "").toLowerCase();
  const tb = t.match(/(?<!\d)([12])\s*(tb|тб)\b/iu);
  if (tb) return Number(tb[1]) * 1024;
  const gb = t.match(/(?<!\d)(64|128|256|512)(?!\d)/);
  return gb ? Number(gb[1]) : null;
}

function parseScreen(text) {
  const t = String(text || "").toLowerCase();
  if (/тріщ|трещ|трісн|треснул|трещин|тріщин|розбит|разбит|битое|битий|cracked/.test(t)) return "cracked";
  if (/не працю|не работ|чорний екран|черный экран|не показ|broken/.test(t)) return "broken";
  if (/подряп|царап|скол|відкол|сколы|scratch/.test(t)) return "scratches";
  if (/ідеал|идеал|без подряп|без царап|нормальн|(?<!\p{L})ок(?!\p{L})|(?<![a-z])ok(?![a-z])|хорош|чистий|чистый|ideal/iu.test(t)) return "ideal";
  return null;
}

function parseBattery(text) {
  const t = String(text || "").toLowerCase();
  if (/не знаю|не знаю|незнаю|unknown/.test(t)) return "unknown";
  const pct = t.match(/(\d{2,3})\s*%?/);
  if (pct) {
    const n = Number(pct[1]);
    if (n >= 90) return "90plus";
    if (n >= 80) return "80to89";
    if (n >= 1 && n < 80) return "below80";
  }
  return null;
}

function parseBody(text) {
  const t = String(text || "").toLowerCase();
  // Спочатку «все в порядку» (включно з «без вм'ятин»), потім пошкодження
  if (/все ок|всё ок|нормал|(?<!\p{L})ок(?!\p{L})|(?<![a-z])ok(?![a-z])|без пошкод|без вм|без скол|ідеал|идеал|чистий|чистый/iu.test(t)) return "ok";
  if (/згин|погнут|изогнут|bent|задн.*трещ|задн.*тріщ|задн.*трісн/iu.test(t)) return "bent";
  if (/вм.?ятин|вмятин|сколи|сколы|скол|дент|dent|подряп.*корпус|корпус.*подряп/iu.test(t)) return "dents";
  return null;
}

const OFFTOPIC_RE = /ноут|навуш|наушн|чохол|чехол|павер|power ?bank|телевіз|телевиз|пилосос|пылесос|кухн|айпад|ipad|макбук|macbook|watch|годин|рюкзак|кабел|покаж|покажи|знайд|найди|підбери|подбери/iu;

// Чи це початок трейд-ін: є слово про здачу/оцінку і є модель iPhone
const TRADEIN_INTENT_RE = /трейд|trade[\s-]?in|трейдін|трейдин|здат|сдат|обмін|обмен|оціни|оцени|оцінк|оценк|скуп|продат.*(айф|iphone)|сдам|здам|хочу продати/iu;

function isTradeInIntent(text) {
  return TRADEIN_INTENT_RE.test(String(text || ""));
}

// ── Оцінка ─────────────────────────────────────────────────────────────

function estimate({ model, gb, screen, battery, body }, { table = loadPriceTable(), config = loadConfig() } = {}) {
  const row = basePrice(model, gb, table);
  if (!row) return { ok: false, reason: "no_price" };
  if (screen === "broken") {
    return { ok: false, reason: "needs_check", row };
  }
  const m = config.multipliers;
  const k = (m.screen[screen] ?? 1) * (m.battery[battery] ?? m.battery.unknown) * (m.body[body] ?? 1);
  const usd = Math.round(row.usd * k);
  const uah = config.usdToUah
    ? Math.round((usd * config.usdToUah) / config.roundUahTo) * config.roundUahTo
    : null;
  return { ok: true, row, usd, uah, factor: Number(k.toFixed(3)), currency: config.currency };
}

// ── Діалог ─────────────────────────────────────────────────────────────

const SCREEN_CHIPS = [
  { label: "Ідеальний, без подряпин", value: "ideal" },
  { label: "Є подряпини, скло ціле", value: "scratches" },
  { label: "Скло тріснуте", value: "cracked" },
  { label: "Дисплей не працює", value: "broken" },
];
const BATTERY_CHIPS = [
  { label: "90% і вище", value: "90plus" },
  { label: "80–89%", value: "80to89" },
  { label: "Нижче 80%", value: "below80" },
  { label: "Не знаю", value: "unknown" },
];
const BODY_CHIPS = [
  { label: "Корпус без пошкоджень", value: "ok" },
  { label: "Є вм'ятини або сколи", value: "dents" },
  { label: "Погнутий або тріснута задня панель", value: "bent" },
];
const STORAGE_CHIPS = [
  { label: "64 GB", value: "64" }, { label: "128 GB", value: "128" },
  { label: "256 GB", value: "256" }, { label: "512 GB", value: "512" },
  { label: "1 TB", value: "1024" },
];

function storageChipsFor(model, table = loadPriceTable()) {
  const gbs = new Set(table.rows.filter((r) => r.model === model).map((r) => r.gb));
  return STORAGE_CHIPS.filter((c) => gbs.has(Number(c.value)));
}

function askStorage(model) {
  return {
    stage: "storage",
    reply: `Оцінимо ваш iPhone ${model}. Яка в нього пам'ять?`,
    quickReplies: storageChipsFor(model).map((c) => ({ label: c.label, text: c.label })),
  };
}
function askScreen() {
  return { stage: "screen", reply: "Питання 1 з 3: який стан дисплея?", quickReplies: SCREEN_CHIPS.map((c) => ({ label: c.label, text: c.label })) };
}
function askBattery() {
  return { stage: "battery", reply: "Питання 2 з 3: яке здоров'я батареї? (Налаштування → Акумулятор → Стан акумулятора)", quickReplies: BATTERY_CHIPS.map((c) => ({ label: c.label, text: c.label })) };
}
function askBody() {
  return { stage: "body", reply: "Питання 3 з 3: корпус у стані?", quickReplies: BODY_CHIPS.map((c) => ({ label: c.label, text: c.label })) };
}

function resultReply(model, gb, res) {
  const name = `iPhone ${model} ${gb >= 1024 ? gb / 1024 + " TB" : gb + " GB"}`;
  if (!res.ok && res.reason === "needs_check") {
    return `Для ${name} з несправним дисплеєм ціну викупу визначать у магазині після огляду. Приносьте пристрій, оцінимо на місці.`;
  }
  // Ціни викупу в прайсі — в доларах. Показуємо приблизну суму, округлену до $5.
  const usd = Math.round(res.usd / 5) * 5;
  const uahPart = res.uah ? ` (≈ ${res.uah} грн)` : "";
  return `Орієнтовна ціна викупу за ${name}: ~$${usd}${uahPart}. Це приблизна оцінка: точну суму в магазині визначать після огляду пристрою.`;
}

// Крок діалогу. Повертає відповідь або null, якщо повідомлення не стосується трейд-іну.
function step({ sessionId, message, now = Date.now() }) {
  const text = String(message || "").trim();
  const cur = sessions.get(sessionId);
  const live = cur && now - cur.touchedAt < SESSION_TTL_MS ? cur : null;

  // Якщо клієнт на питання трейд-іну відповів не по суті двічі — вважаємо, що він змінив тему
  // і віддаємо повідомлення звичайному пошуку.
  // Явна згадка іншої категорії («ноут», «навушники», «покажи») — одразу виходимо з діалогу.
  if (live && !parseAnyAnswer(live.state.stage, text) && (live.misses >= 2 || OFFTOPIC_RE.test(text))) {
    sessions.delete(sessionId);
    return null;
  }

  if (!live) {
    if (!isTradeInIntent(text)) return null;
    const model = parseModel(text);
    const gb = parseStorageGb(text);
    if (!model) {
      sessions.set(sessionId, { state: { stage: "model" }, touchedAt: now });
      return { reply: "Яка модель iPhone? Напишіть, наприклад, «13 Pro» або «15 Pro Max».", quickReplies: [], tradeIn: true };
    }
    const st = { stage: "start", model, gb, screen: null, battery: null, body: null };
    return advance(sessionId, st, now);
  }

  const st = live.state;
  if (st.stage === "model") {
    const model = parseModel(text);
    if (!model) return miss(sessionId, st, () => ({ reply: "Не розпізнав модель. Напишіть, наприклад, «13 Pro» або «15 Pro Max»." }));
    return advance(sessionId, { stage: "start", model, gb: null, screen: null, battery: null, body: null }, now);
  }
  if (st.stage === "storage") {
    const gb = parseStorageGb(text);
    if (!gb) return miss(sessionId, st, () => ({ reply: "Оберіть пам'ять з варіантів.", quickReplies: storageChipsFor(st.model).map((c) => ({ label: c.label, text: c.label })) }));
    return advance(sessionId, { ...st, gb }, now);
  }
  if (st.stage === "screen") {
    const screen = parseScreen(text);
    if (!screen) return miss(sessionId, st, askScreen);
    return advance(sessionId, { ...st, screen }, now);
  }
  if (st.stage === "battery") {
    const battery = parseBattery(text);
    if (!battery) return miss(sessionId, st, askBattery);
    return advance(sessionId, { ...st, battery }, now);
  }
  if (st.stage === "body") {
    const body = parseBody(text);
    if (!body) return miss(sessionId, st, askBody);
    return advance(sessionId, { ...st, body }, now);
  }
  sessions.delete(sessionId);
  return null;
}

// Відповідь розпізнана хоча б за одним питанням (для виходу з діалогу)
function parseAnyAnswer(stage, text) {
  if (stage === "model") return !!parseModel(text);
  if (stage === "storage") return !!parseStorageGb(text);
  if (stage === "screen") return !!parseScreen(text);
  if (stage === "battery") return !!parseBattery(text);
  if (stage === "body") return !!parseBody(text);
  return true;
}

// Повторне питання з лічильником промахів
function miss(sessionId, st, ask) {
  const misses = (st.misses || 0) + 1;
  sessions.set(sessionId, { state: { ...st }, touchedAt: Date.now(), misses });
  return { ...ask(), tradeIn: true };
}

// Просуває стан до наступного питання або видає оцінку.
function advance(sessionId, st, now) {
  if (!st.gb && st.model) {
    sessions.set(sessionId, { state: { ...st, stage: "storage" }, touchedAt: now });
    return { ...askStorage(st.model), tradeIn: true };
  }
  if (!st.screen) {
    sessions.set(sessionId, { state: { ...st, stage: "screen" }, touchedAt: now });
    return { ...askScreen(), tradeIn: true };
  }
  if (st.screen !== "broken" && !st.battery) {
    sessions.set(sessionId, { state: { ...st, stage: "battery" }, touchedAt: now });
    return { ...askBattery(), tradeIn: true };
  }
  if (st.screen !== "broken" && !st.body) {
    sessions.set(sessionId, { state: { ...st, stage: "body" }, touchedAt: now });
    return { ...askBody(), tradeIn: true };
  }
  sessions.delete(sessionId);
  const res = estimate({ model: st.model, gb: st.gb, screen: st.screen, battery: st.battery || "unknown", body: st.body || "ok" });
  if (!res.ok && res.reason === "no_price") {
    return {
      reply: `Для iPhone ${st.model} ${st.gb} GB у прайсі трейд-ін немає позиції. Уточніть у менеджера.`,
      quickReplies: [], tradeIn: true, estimate: null,
    };
  }
  return {
    reply: resultReply(st.model, st.gb, res),
    quickReplies: [{ label: "Оцінити інший iPhone", text: "хочу здати айфон у трейд-ін" }],
    tradeIn: true,
    estimate: res.ok ? { usd: res.usd, uah: res.uah, factor: res.factor, currency: res.currency } : null,
  };
}

module.exports = {
  step, estimate, parseName, parseModel, parseStorageGb, parseScreen, parseBattery, parseBody,
  isTradeInIntent, loadPriceTable, loadConfig, modelsAvailable, basePrice, sessions,
};