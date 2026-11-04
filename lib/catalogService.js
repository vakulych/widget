const { XMLParser } = require("fast-xml-parser");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const cfg = require("./feedConfig");
const embeddings = require("./embeddings");
const { foldHomoglyphs } = require("./search");

const FEED_URL = process.env.FEED_URL;
const FEED_FILE = process.env.FEED_FILE;
const CACHE_FILE = path.join(__dirname, "..", "data", "catalog.cache.json");

let catalog = {
  products: [],  
  categories: {},  
  lastUpdated: null,
  lastError: null,
};

function getByPath(obj, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function textOf(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
   
  if (typeof v === "object" && "#text" in v) return String(v["#text"]);
  return "";
}

 
 
 
 
 
 
 
const ACCESSORY_CATEGORY_RE =
  /^для\s|аксесуар|^чохли(\s|$)|^кейси?(\s|$)|захисні плівки|захисне скло|перехідник|переходник|адаптер|автотримач|кріплення|оригінальні чохли|ремінц|ремешк|підставк|підставки для|^зарядка,\s*кабель/iu;
 
 
 
 
const SERVICE_PRODUCT_RE =
  /(^|\s)(захист|страховк|страхування|гарантія|гарантия|сервісн(ий|а)? пакет|service plan|extended warranty)(\s|$)/iu;
 
 
 
const USED_PRODUCT_RE = /(?:^|[^\p{L}\p{N}])(?:б\s*[\/\\-]\s*[увв]|б\s+[увв]|бв|вживан|уживан|подержан|юзан|юзаний|refurbished|cpo|used|second\s*hand)(?=$|[^\p{L}\p{N}])/iu;
 
 
 
 
 

function isAccessoryName(name, categoryName) {
  if (categoryName) {
    if (ACCESSORY_CATEGORY_RE.test(categoryName)) return true;
     
     
     
     
    return false;
  }
   
  const n = name.toLowerCase();
  return cfg.accessoryKeywords.some((kw) => n.includes(kw));
}

function isServiceProduct(name, categoryName) {
  return SERVICE_PRODUCT_RE.test(`${name || ""} ${categoryName || ""}`);
}

function normalizeOffer(offer, categories) {
  const f = cfg.fields;
  const name = textOf(getByPath(offer, f.name)).trim();
  if (!name) return null;

  const params = {};
  for (const p of asArray(offer[f.paramsTag])) {
    if (p && typeof p === "object") {
      const key = p["@_name"];
      const val = textOf(p);
      if (key) params[key.trim().toLowerCase()] = val.trim();
    }
  }

  const categoryId = textOf(getByPath(offer, f.categoryId));
  const price = parseFloat(textOf(getByPath(offer, f.price))) || null;
  const oldPrice = f.oldPrice ? parseFloat(textOf(getByPath(offer, f.oldPrice))) || null : null;
  const availableAttr = f.available ? getByPath(offer, f.available) : undefined;
  const quantity = f.quantity ? parseInt(textOf(getByPath(offer, f.quantity)), 10) : NaN;
  const stockText = f.stock ? textOf(getByPath(offer, f.stock)).trim() : "";
  const stockKnown = /(?:^|\s)in\s+stock(?:\s|$)/iu.test(stockText)
    ? true
    : /(?:^|\s)out\s+of\s+stock(?:\s|$)/iu.test(stockText)
    ? false
    : null;

  return {
    id: textOf(getByPath(offer, f.id)) || name,
    name,
    price,
    oldPrice,
    currency: (f.currency && textOf(getByPath(offer, f.currency))) || "UAH",
    categoryId,
    categoryName: categories[categoryId] || "",
    vendor: textOf(getByPath(offer, f.vendor)),
    vendorCode: f.vendorCode ? textOf(getByPath(offer, f.vendorCode)) : "",
    url: textOf(getByPath(offer, f.url)),
    picture: asArray(offer[f.picture]).map(textOf).filter(Boolean)[0] || "",
    description: textOf(getByPath(offer, f.description)),
    params,
    quantity: Number.isFinite(quantity) ? quantity : null,
    stock: stockText,
    condition: f.condition ? textOf(getByPath(offer, f.condition)) : "",
     
     
     
     
    available:
      stockKnown !== null
        ? stockKnown
        : availableAttr !== undefined
        ? String(availableAttr).toLowerCase() === "true"
        : Number.isFinite(quantity)
        ? quantity > 0
        : f.stock
        ? !!stockText && !/out\s*of\s*stock|нема|нет в наличии|закінч|отсутству/i.test(stockText)
        : true,
    isAccessory: isAccessoryName(name, categories[categoryId] || ""),
    isService: isServiceProduct(name, categories[categoryId] || ""),
     
     
     
     
    isUsed: USED_PRODUCT_RE.test(`${name} ${categories[categoryId] || ""}`),
     
     
     
    _haystack: foldHomoglyphs(
      [name, textOf(getByPath(offer, f.vendor)), categories[categoryId] || "", Object.values(params).join(" ")].join(" ")
    ).toLowerCase(),
  };
}

function parseFeedXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: true,
    trimValues: true,
     
     
     
     
     
     
     
    processEntities: { maxTotalExpansions: 200000, maxExpandedLength: 500000 },
  });
  const parsed = parser.parse(xml);

  const categories = {};
  const catIdField = cfg.categoryIdField || "@_id";
  for (const c of asArray(getByPath(parsed, cfg.categoriesPath))) {
    if (c && typeof c === "object") {
      const id = textOf(c[catIdField]);
      const name = textOf(c);
      if (id) categories[id] = name;
    }
  }

  const rawOffers = asArray(getByPath(parsed, cfg.offersPath));
  const products = rawOffers
    .map((o) => normalizeOffer(o, categories))
    .filter(Boolean);

  return { products, categories };
}

async function fetchAndParseFeed() {
  if (FEED_FILE) {
    const xml = fs.readFileSync(path.resolve(FEED_FILE), "utf8");
    return parseFeedXml(xml);
  }
  if (!FEED_URL) throw new Error("FEED_URL or FEED_FILE must be set");
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": "SkayAIWidget/1.0 (+https://skay.ua)" },
  });
  if (!res.ok) {
    throw new Error(`Feed request failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  return parseFeedXml(xml);
}

async function refreshCatalog() {
  try {
    const { products, categories } = await fetchAndParseFeed();
    catalog = {
      products,
      categories,
      lastUpdated: new Date().toISOString(),
      lastError: null,
    };
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(catalog), "utf8");
    } catch (e) {
      console.warn("[catalog] could not write disk cache:", e.message);
    }
    console.log(
      `[catalog] Оновлено ${new Date().toLocaleString("uk-UA")}: ${products.length} товарів.`
    );
    if (products[0]) {
      console.log("[catalog] Приклад товару з фіда:", JSON.stringify(products[0], null, 2));
    }
     
     
     
     
    embeddings.syncIndex(products).catch((e) => console.warn("[catalog] embeddings.syncIndex:", e.message));
    // Індекс детермінованого пошуку будуємо одразу після оновлення, а не на першому запиті клієнта.
    setImmediate(() => require("./productFinder").warm(catalog));
  } catch (err) {
    catalog.lastError = err.message;
    console.error("[catalog] Помилка оновлення фіда:", err.message);
  }
}

function loadDiskCacheIfAny() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf8");
      catalog = JSON.parse(raw);
      console.log(
        `[catalog] Завантажено кеш з диска (${catalog.products.length} товарів, оновлено ${catalog.lastUpdated}).`
      );
      setImmediate(() => require("./productFinder").warm(catalog));
    }
  } catch (e) {
    console.warn("[catalog] Не вдалося прочитати дисковий кеш:", e.message);
  }
}

function start() {
  loadDiskCacheIfAny();
   
  refreshCatalog();
   
  cron.schedule("46 7-23 * * *", refreshCatalog, { timezone: "Europe/Kyiv" });
  console.log("[catalog] Cron заплановано: щогодини о :46, з 07:00 до 23:00 (Europe/Kyiv).");
}

function getCatalog() {
  return catalog;
}

module.exports = { start, getCatalog, refreshCatalog, parseFeedXml };