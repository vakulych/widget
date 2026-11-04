const cfg = require("./feedConfig");
const USED_PRODUCT_RE = /(?:^|[^\p{L}\p{N}])(?:б\s*[\/\\-]\s*[увв]|б\s+[увв]|бв|вживан|уживан|подержан|юзан|юзаний|refurbished|cpo|used|second\s*hand)(?=$|[^\p{L}\p{N}])/iu;

 
 
 
 
const TRANSLIT_MAP = {
  про: "pro",
  макс: "max",
  плюс: "plus",
  міні: "mini",
  мини: "mini",
  ультра: "ultra",
  дуо: "duo",
  ейр: "air",
  эйр: "air",
  аір: "air",
  нео: "neo",
  лайт: "lite",
  ноут: "note",
  ноте: "note",
  вотч: "watch",
  бадс: "buds",
  повер: "power",
  плейстейшн: "playstation",
  дисководом: "дисковод",
  самсунг: "samsung",
  гелексі: "galaxy",
  галаксі: "galaxy",
  галактика: "galaxy",
  ксіаомі: "xiaomi",
  ксиаоми: "xiaomi",
  оппо: "oppo",
  редми: "redmi",
  епл: "apple",
  эпл: "apple",
  аппл: "apple",
  чехол: "чохол",
  ремешок: "ремінець",
  наушники: "навушники",
  наушник: "навушник",
  пылесос: "пилосос",
  телевизор: "телевізор",
  беспроводной: "бездротовий",
  беспроводные: "бездротові",
  зарядка: "зарядний",
  зарядное: "зарядний",
  умные: "розумні",
  умный: "розумний",
  синий: "blue",
  синего: "blue",
  голубой: "blue",
  айфон: "iphone",
  айпад: "ipad",
  макбук: "macbook",
};

// У фіді трапляються "змішані" слова, де латинська літера замінена схожою кирилицею
// ("iPhone 15 Prо" з українською "о", "Сhip" з українською "С"). Для пошуку такі слова
// приводимо до латиниці, інакше "Prо Max" не збігається з "Pro Max".
const HOMOGLYPH_MAP = { а: "a", е: "e", о: "o", р: "p", с: "c", х: "x", у: "y", і: "i" };
function foldHomoglyphs(str) {
  return String(str || "").replace(/[\p{L}\p{N}]+/gu, (w) =>
    /[a-z]/i.test(w) && /[аеорсхуі]/i.test(w) ? w.replace(/[аеорсхуі]/gi, (m) => HOMOGLYPH_MAP[m.toLowerCase()]) : w
  );
}

function normalize(str) {
  return foldHomoglyphs(String(str || ""))
    .toLowerCase()
    .replace(/["'’«»]/g, "")
    // Supplier titles commonly glue values to units ("256GB", "1TB", "20000mAh").
    // Split them before tokenization so explicit customer constraints are never lost.
    .replace(/(\d+)\s*(gb|tb|гб|тб|mah|маг|ма\s*г)\b/giu, "$1 $2")
    .replace(/гб\b/giu, " gb ")
    .replace(/тб\b/giu, " tb ")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/playstation\s*5/g, "ps5")
    .replace(/playstation\s*4/g, "ps4")
    .replace(/playstation\s*3/g, "ps3")
    .replace(/xbox\s*series\s*x/g, "xboxseriesx")
    .replace(/xbox\s*series\s*s/g, "xboxseriess");
}

function tokens(str) {
  return normalize(str)
    .split(" ")
    .filter(Boolean)
    .map((t) => TRANSLIT_MAP[t] || t);
}

// A customer sees a word on a product card, hears it from a friend, or types it
// in another keyboard layout. They should not have to know the supplier's Latin
// spelling. This key intentionally makes Cyrillic phonetic input and the common
// Latin spelling comparable ("техвовен" → "tehvoven", "TechWoven" → "tehvoven").
// It is used only for distinctive long words and never for short model codes.
const CYRILLIC_LATIN = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye", ё: "yo", ж: "zh", з: "z",
  и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya",
};

function phoneticKey(value) {
  let word = String(value || "").toLowerCase().replace(/[а-яіїєґёъыьэюя]/giu, (c) => CYRILLIC_LATIN[c] || c);
  return word
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

function phoneticWordMatch(queryToken, productWords) {
  if (queryToken.length < 6 || /\d/.test(queryToken)) return false;
  const queryKey = phoneticKey(queryToken);
  return queryKey.length >= 5 && productWords.some((word) => {
    const productKey = phoneticKey(word);
    // Latin spelling can retain a silent vowel/diphthong (FineWoven vs «файнвовен»).
    // A tiny edit allowance after phonetic folding handles that without fuzzy matching
    // arbitrary short codes or model numbers.
    return productKey === queryKey || (queryKey.length >= 7 && productKey.length >= 7 && wordsClose(queryKey, productKey));
  });
}

function extractStorage(str) {
  const n = normalize(str);
  const m = n.match(/(\d+)\s*(gb|tb)\b/);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  const unit = m[2];
  return unit === "tb" ? value * 1024 : value;
}

function productStorage(product) {
  const storageParamKeys = ["пам'ять", "пам'ять вбудована", "вбудована пам'ять", "storage", "об'єм пам'яті", "память"];
  for (const key of storageParamKeys) {
    if (product.params[key]) {
      const v = extractStorage(product.params[key]);
      if (v) return v;
    }
  }
  return extractStorage(product.name);
}

// Пошук токена в тексті. Довгі слова (>4 символів) шукаємо як підрядок (щоб працювали
// закінчення: "чохли"/"чохол"), а КОРОТКІ (pro, max, air, se, 15, s24...) — лише як окреме слово.
// Інакше "pro" знаходиться всередині "proof" (Shock Proof Case), "air" — в "AirPods" тощо.
// Числа допускають одиниці одразу після цифр ("45" знаходить "45mm", "256" — "256gb").
const _tokenReCache = new Map();
function hasToken(hay, t) {
  if (!t) return false;
  if (t.length > 4) return hay.includes(t);
  let re = _tokenReCache.get(t);
  if (!re) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tail = /^\d+$/.test(t) ? "(?=$|[^\\p{L}\\p{N}]|mm|мм|gb|tb|гб|тб)" : "(?=$|[^\\p{L}\\p{N}])";
    re = new RegExp("(?:^|[^\\p{L}\\p{N}])" + esc + tail, "u");
    _tokenReCache.set(t, re);
  }
  return re.test(hay);
}

function scoreTextMatch(product, queryTokens) {
  if (queryTokens.length === 0) return 0;
  const hay = product._haystack;
  let hits = 0;
  for (const t of queryTokens) {
    if (t.length < 2) continue;
    if (hasToken(hay, t)) hits += 1;
  }
  return hits / queryTokens.length;
}

 
 
 
 
 
 
 
 
 
 
function numericTokensMatch(product, queryTokens) {
   
   
   
   
   
  const hay = normalize(`${product.name} ${product.categoryName || ""}`);
  // A standalone "5" after PS5 is not an independent constraint. Treat it as
  // part of the model token, otherwise "PlayStation 5" cannot match "PS5".
  const nums = queryTokens.filter(
    (t) => /^\d+$/.test(t) && !queryTokens.some((other) => other !== t && /\D/.test(other) && other.includes(t))
  );
   
   
   
  // `hasToken` accepts adjacent units such as 256GB and 55mm. The old strict
  // word-boundary expression made an exact model + capacity query return zero results.
  return nums.every((n) => hasToken(hay, n));
}

 





function findSpecificProduct(products, { queryText, storageGb, excludeAccessories = true, usedOnly = false, newOnly = false }) {
  // Службові слова ("на", "для", "є", "купити"...) і дублікати не мають впливати на збіг: раніше "на"
  // випадково знаходилось як підрядок у назвах, а тепер (слова шукаються цілими) без цього фільтра
  // будь-яке "чохол на айфон" нічого б не знаходило.
  const stopSet = new Set([...(cfg.genericStopWords || []), "с", "по", "the", "with"].flatMap((k) => tokens(k)));
  const qTokens = [...new Set(tokens(queryText))].filter((t) => !stopSet.has(t));
  const meaningfulQueryTokens = qTokens.filter((t) => t.length >= 2 || /^\d$/.test(t));
   
   
   
  let candidates = products.filter((p) => !p.isService);
  if (excludeAccessories) candidates = candidates.filter((p) => !p.isAccessory);
  if (usedOnly) {
    candidates = candidates.filter((p) => p.isUsed === true || USED_PRODUCT_RE.test(`${p.name} ${p.categoryName}`));
  }
  if (newOnly) candidates = candidates.filter((p) => !isUsedProduct(p));

   
   
   
   
  const nameTokensCache = new Map();
  function nameScore(p) {
    if (!nameTokensCache.has(p.id)) {
       
       
       
       
       
       
       
      const nameHay = normalize(`${p.name} ${p.categoryName || ""} ${p.vendor || ""}`);
      const nameWords = nameHay.split(" ");
      let hits = 0;
      for (const t of meaningfulQueryTokens) {
         
         
         
         
        if (hasToken(nameHay, t)) {
          hits += 1;
          continue;
        }
        // Tolerate one small typo or inflection in a long product term, while keeping
        // short abbreviations exact to avoid unsafe false positives (UPS ≠ GPS).
        if (t.length >= 4 && nameWords.some((word) => wordsClose(t, word))) hits += 0.85;
        else if (phoneticWordMatch(t, nameWords)) hits += 0.92;
      }
       
       
       
       
      nameTokensCache.set(p.id, meaningfulQueryTokens.length ? hits / meaningfulQueryTokens.length : 0);
    }
    return nameTokensCache.get(p.id);
  }

   
   
   
   
   
   
  const PERIPHERAL_OR_GAME_WORDS = /^гра\s|\sгра\s|геймпад|контролер|джойстик|амбушюр|руль|кермо|чохол|скло|кабель|зарядн|адаптер|стенд|підставка|дисковод|пульт|кронштейн|тримач/i;
  function isMainDevice(p) {
    return !PERIPHERAL_OR_GAME_WORDS.test(normalize(p.name));
  }

  let scored = candidates
    .map((p) => ({ p, score: nameScore(p) }))
    .filter((x) => x.score >= 0.8 && numericTokensMatch(x.p, qTokens))  
     
     
    .sort(
      (a, b) =>
        (b.p.available !== false) - (a.p.available !== false) ||
        isMainDevice(b.p) - isMainDevice(a.p) ||
        b.score - a.score
    );

  // Supplier categories are imperfect: controllers, ear-tips and steering wheels can
  // be regular products. A device request should still favour the actual device.
  const deviceResults = scored.filter((x) => isMainDevice(x.p));
  if (deviceResults.length) scored = deviceResults;

  if (scored.length === 0) return { exact: [], alternatives: [], unavailable: [] };

  if (!storageGb) {
     
     
     
    const live = scored.filter((x) => x.p.available !== false);
    return {
      exact: live.slice(0, 12).map((x) => x.p),
      alternatives: [],
      unavailable: live.length ? [] : scored.slice(0, 12).map((x) => x.p),
    };
  }

  const withStorage = scored.map((x) => ({ ...x, storage: productStorage(x.p) }));
  const exactAll = withStorage.filter((x) => x.storage === storageGb);
  const exactLive = exactAll.filter((x) => x.p.available !== false);
  const exact = exactLive.map((x) => x.p);
  const alternativesAll = withStorage
    .filter((x) => x.storage && x.storage !== storageGb)
    .sort((a, b) => Math.abs(a.storage - storageGb) - Math.abs(b.storage - storageGb))
  const alternativesLive = alternativesAll.filter((x) => x.p.available !== false);
  const alternatives = alternativesLive.slice(0, 5).map((x) => x.p);

  return {
    exact,
    alternatives,
    unavailable: exactLive.length ? [] : exactAll.map((x) => x.p),
  };
}

 






 
 
 
 
 
const AMBIGUOUS_BRAND_WORDS = new Set(["samsung", "xiaomi", "apple", "lg", "sony", "huawei", "honor"]);

const CATEGORY_KEYWORDS = (() => {
  const map = {};
  for (const entry of cfg.companionMap) {
    map[entry.category] = entry.triggerKeywords.filter(
      (kw) => !AMBIGUOUS_BRAND_WORDS.has(normalize(kw))
    );
  }
  return map;
})();

function resolveCategoryKeywords(categoryText) {
  if (!categoryText) return null;
  const norm = normalize(categoryText);
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (norm.includes(cat) || kws.some((kw) => norm.includes(kw))) return kws;
  }
  return null;
}

 






const ACCESSORY_CATEGORY_STOPWORDS = [
  "аксесуар", "чохол", "чехол", "скло", "кабель", "зарядк", "ремінець",
  "ремешок", "підставка", "повербанк", "павербанк", "захисн", "стедикам", "стабілізатор",
  "гімбал", "тримач", "бампер", "плівка", "переходник", "адаптер",
];

 
 
 
 
 
 
 
function looksLikeForDevice(name) {
  const n = normalize(name);
  return ACCESSORY_CATEGORY_STOPWORDS.some((sw) => n.includes(sw));
}

 
 
 
 
 
 
 
 
 
const PHONE_NAME_POSITIVE = new RegExp(
  [
    "iphone\\s*\\d",
    "galaxy\\s*(s|a|z|m|note|fold|flip)\\s*\\d",
    "\\bredmi\\b",
    "\\bpoco\\b",
    "pixel\\s*\\d",
    "\\brealme\\b",
    "moto(rola)?\\s*(edge|g|e)\\b",
    "nothing\\s*phone",
    "\\boukitel\\b",
    "\\bblackview\\b",
    "\\bulefone\\b",
    "sigma\\s*mobile",
    "мобільний\\s*телефон",
    "honor\\s*(magic|x\\d|\\d)",
    "\\bvivo\\b",
    "\\boppo\\b",
    "\\btecno\\b",
    "\\binfinix\\b",
    "\\bzte\\b",
    "\\bnokia\\b",
  ].join("|"),
  "i"
);
const PHONE_NAME_NEGATIVE = new RegExp(
  [
    "watch", "годинник", "band\\b", "buds", "навушник", "гарнітур",
    "\\btab\\b", "планшет", "\\btv\\b", "телевізор", "монітор",
    "ноутбук", "laptop", "колонк", "speaker", "зарядн", "кабель",
    "чохол", "чехол", "скло", "повербанк", "павербанк", "стедикам", "стабілізатор",
    "тримач", "пилосос", "чайник", "лампа", "датчик", "шлюз", "hub",
    "камера\\s*спостереж", "ремінець", "ремешок", "плівка",
    "стіл", "стілець", "крісло", "меблі",
  ].join("|"),
  "i"
);

function isLikelyPhoneName(name) {
  const n = normalize(name);
  return PHONE_NAME_POSITIVE.test(n) && !PHONE_NAME_NEGATIVE.test(n);
}

 
 
 
 
function isLikelyWatchName(name) {
  const n = normalize(name);
  return /\bwatch\b|годинник|смартгодинник/.test(n) && !/ремінец|ремешок|захисн|чохол|скло|зарядн/.test(n);
}

function isLikelyHeadphonesName(name) {
  const n = normalize(name);
  return /airpods|навушник|гарнітур|headphones|\bbuds?\b|earbuds/.test(n) && !/чохол|чехол|кейс|case для|захист/.test(n);
}

function isLikelyTabletName(name) {
  const n = normalize(name);
  return (
    /\bipad\b|\btab\b|\btablet\b|\bпланшет\b/.test(n) &&
    !/графічн|graphic|монітор|стилус|чохол|чехол|клавіатур/.test(n)
  );
}

function isLikelyConsoleName(name) {
  const n = normalize(name);
  return (
    /ігрова консоль|ігрова приставк|playstation\s*[345]|\bps[345]\b|nintendo switch|xbox/.test(n) &&
    !/гра\s|ігри|game\b|підписк|контролер|геймпад|джойстик|гарнітур|чохол|карта поповнення|накопичувач|важіль|кермо|мікрофон/.test(n)
  );
}

function categoryKind(category) {
  const n = normalize(category);
   
   
  if (/ігри|гра\s|графічн|graphic|ігрові приставк/.test(n)) return null;
  if (/смартфон|телефон|мобілк/.test(n)) return "phone";
  if (/годинник|\bwatch\b|смартвотч/.test(n)) return "watch";
  if (/навушник|гарнітур|airpods|\bbuds?\b|headphones/.test(n)) return "headphones";
  if (/планшет|\bipad\b|\btablet\b/.test(n)) return "tablet";
  if (/консоль|приставк|playstation|\bps[345]\b|xbox|nintendo switch/.test(n)) return "console";
  return null;
}

function matchesCategoryKind(product, kind) {
  if (kind === "phone") return isLikelyPhoneName(product.name);
  if (kind === "watch") return isLikelyWatchName(product.name);
  if (kind === "headphones") return isLikelyHeadphonesName(product.name);
  if (kind === "tablet") return isLikelyTabletName(product.name);
  if (kind === "console") return isLikelyConsoleName(product.name);
  return false;
}

 
 
 
const CATEGORY_GENERIC_TOKENS = new Set([
  "смарт", "смартфон", "телефон", "мобільний", "мобілк", "мобильный", "мобилка", "годинник", "часы", "watch", "смартвотч",
  "навушники", "навушник", "наушники", "наушник", "гарнітура", "гарнитура", "headphones", "планшет", "tablet", "консоль", "приставка",
  "ігрова", "ігровий", "для", "та", "і", "був", "бв",
]);

function categoryAnchors(category, kind) {
  if (!kind) return [];
  return tokens(category).filter((t) => t.length > 2 && !CATEGORY_GENERIC_TOKENS.has(t));
}

 
 
 
 
 
 
const CATEGORY_HINT_WORDS = {
  "смартфон": ["телефон", "смартфон", "мобілк", "мобільний", "iphone", "айфон", "галаксі", "galaxy", "oppo", "оппо"],
  "сумка/рюкзак": ["рюкзак", "сумка для ноутбук", "сумка через плече", "поясна сумка"],
  "ноутбук": ["ноутбук", "лептоп", "макбук", "macbook", "моноблок", "ігровий пк", "пк в зборі", "комплектуюч", "комп'ютер", "системний блок"],
  "навушники": ["навушник", "наушник", "гарнітур", "airpods", "аірподи", "buds"],
  "годинник": ["годинник", "часы", "смартвотч", "watch"],
  "планшет": ["планшет", "таблет", "ipad", "айпад"],
  "консоль": ["консоль", "приставк", "playstation", "ps5", "ps4", "xbox", "switch", "нінтендо", "nintendo"],
  "телевізор": ["телевізор", "смарт тв", "smart tv"],
  "колонка": ["колонк", "динамік", "саундбар", "акустик"],
  "монітор": ["монітор", "monitor"],
  "витратні матеріали для принтера": ["картридж", "тонер", "витратні матеріали для принтер", "чорнило для принтер"],
  "принтер": ["принтер", "мфу", "printer", "бфп"],
  "пилосос": ["пилосос", "робот-пилосос", "vacuum", "швабра"],
  "кавоварка": ["кавоварк", "кавомашин", "coffee", "кавомолк", "рожкова"],
  "мультиварка": ["мультиварк", "мультиварка", "скороварк", "мультипіч"],
  "праска": ["праск", "відпарювач", "парогенератор"],
  "зволожувач": ["зволожувач", "очищувач повітря", "осушувач повітря", "мийка повітря", "іонізатор повітря"],
  "кондиціонер": ["кондиціонер", "спліт-систем", "спліт систем"],
  "мікрохвильовка": ["мікрохвильов", "мікрохвильовка"],
  "холодильник": ["холодильник"],
  "пральна машина": ["пральна машин", "пралька"],
  "дрон": ["дрон", "квадрокоптер", "drone"],
  "екшн-камера": ["екшн-камер", "gopro"],
  "фотоапарат": ["фотоапарат", "дзеркал", "беззеркал", "миттєвого друку", "моментальної печат"],
  "веб-камера": ["веб-камер", "webcam"],
  "розумний дім": [
    "розумний дім", "розумна лампа", "розумна розетка", "датчик руху", "відеонагляд",
    "камера відеоспостереження", "відеодомофон", "розумний замок", "датчик диму",
    "розумна колонка", "голосовий помічник", "трекер gps", "нічне бачення",
    "розумний вимикач", "датчик протічки", "радіоняня",
  ],
  "електротранспорт": ["самокат", "гіроскутер", "електровелосипед", "моноколесо"],
  "товари для тварин": [
    "для тварин", "для собак", "для котів", "для кота", "для собаки", "годівниц", "поїлк",
    "акваріум", "нашийник", "лоток для кота", "когтеточк", "переноска для кота", "шампунь для собак",
    "корм для", "ласощі для", "одяг для тварин", "повідок",
  ],
  "товари для дітей": ["дитяч", "для дітей", "для немовлят", "коляск", "автокрісл", "беговел", "біговел", "снігокат"],
  "іграшки": [
    "іграшк", "конструктор", "лего", "lego", "лялька", "ляльков", "будиночок для ляльк",
    "батут", "настільна гра", "радіокеруванн", "пазл", "машинка для дитин", "колекційна машинк",
    "м'яка іграшк", "мяка іграшк", "плюшев", "кінетичний пісок", "юла", "дзиґа",
  ],
  "фен": ["фен ", "фен для волосся", "стайлер", "фен-щітк", "плойка"],
  "бритва": ["бритв", "тример", "епілятор", "машинка для стрижки"],
  "зарядний пристрій": [
    "зарядний пристрій", "зарядка", "бездротова зарядка",
    "блок живлення", "блочок", "блочки", "блоки живлення", "зарядний блок",
  ],
  "зовнішній акумулятор": [
    "павербанк", "повербанк", "пауэрбанк", "поверб'янк", "паурбанк", "поурбанк",
    "power bank", "powerbank", "зовнішній акумулятор", "зовнішні акумулятори",
    "зовнішня батарея", "внешний аккумулятор", "внешние аккумуляторы", "внешняя батарея",
  ],
  "клавіатура": ["клавіатур", "keyboard"],
  "мишка": ["мишк", "миша", "mouse"],
  "гарнітура": ["гарнітур", "headset"],
  "ігрове крісло": ["ігрове крісло", "геймерське крісло"],
  "блендер": ["блендер", "кухонний комбайн", "міксер", "м'ясорубк", "мясорубк", "соковижималк", "соковитискач"],
  "тостер": ["тостер", "вафельниц"],
  "чайник": ["чайник електрич", "чайник зі скл"],
  "фритюрниця": ["фритюрниц", "аерогриль", "пароварк"],
  "хлібопіч": ["хлібопіч", "хлібопечк"],
  "кухонні ваги": ["кухонні ваги", "ваги електронн"],
  "відеокарта": ["відеокарт", "graphic card", "gpu"],
  "ssd/hdd": ["ssd", "hdd", "жорсткий диск", "накопичувач", "зовнішній диск"],
  "охолодження пк": ["кулер для ноутбук", "охолодження для ноутбук", "охолоджуюча підставк"],
  "bluetooth-адаптер": ["bluetooth-адаптер", "bluetooth адаптер", "bluetooth-передавач", "bluetooth передавач"],
  "ігрові аксесуари": [
    "ігровий руль", "vr-окуляр", "vr окуляр", "джойстик", "геймпад", "ігровий килимок",
    "карта поповнення", "накопичувач для ps5",
  ],
  "епілятор/масажер": [
    "масажер", "машинка для стрижки", "іригатор", "зубна щітка електрич", "фотоепілятор",
    "випрямляч для волосс", "тонометр", "термометр безконтактн", "аналіз складу тіла",
    "манікюрний набір", "чищення обличчя", "маска для обличчя", "пензл", "лімфодренаж", "spa",
  ],
  "інструменти та сад": [
    "газонокосарк", "тример для трав", "шуруповерт", "дриль", "болгарк", "генератор бензинов",
    "сонячна панель", "насос для поливу", "насос для басейн", "насосне обладнанн", "обприскувач",
    "бензопил", "шредер для", "інвертор", "подовжувач", "мережевий фільтр", "аптечка", "стремянк",
    "драбин", "органайзер для інструмент", "гайковерт", "світильник на сонячній батаре",
  ],
  "спорт": [
    "велотренажер", "гантел", "штанга", "турнік", "килимок для йоги", "скейтборд", "велосипед",
    "шолом захисн", "наколінник", "налокітник", "ракетка", "м'яч футбольн", "боксерська груш",
    "боксерські рукавич", "туристичний рюкзак", "намет", "термос", "фляг", "спальний мішок",
    "ролик", "ковзан", "лижі", "сноуборд", "спортивний інвентар", "захисне спорядженн",
  ],
  "меблі": [
    "крісло", "крісла", "комп'ютерне крісло", "офісне крісло", "стіл письмов", "журнальний столик",
    "комп'ютерний стіл",
  ],
  "парасолька": ["парасольк", "зонт"],
  "блогерське обладнання": [
    "кільцева лампа", "штатив", "мікрофон петличк", "стедикам", "селфі-палк", "світлодіодна панель",
    "графічний планшет", "диктофон", "карта пам'яті", "монопод",
  ],
  "телевізор-аксесуари": ["кронштейн для телевізор", "медіаплеєр", "проектор", "apple tv"],
  "дбж": [
    "дбж", "ибп", "ібп", "ups", "безперебійник", "бесперебойник", "безперебойник", "безперебійні",
    "джерело безперебійного живлення", "источник бесперебойного питания", "источник бесперебойного",
  ],

   
   
   
  "освітлення": [
    "лампочк", "led-лампа", "led лампа", "світлодіодна лампа", "люстра", "прожектор",
    "гірлянд", "нічник", "торшер", "настільна лампа", "настінний світильник",
  ],
  "вентилятор": ["вентилятор", "кулер для кімнати", "підлоговий вентилятор", "настільний вентилятор"],
  "обігрівач": [
    "обігрівач", "конвектор", "керамічна панель", "тепловентилятор", "інфрачервоний обігрівач",
    "масляний радіатор",
  ],
  "розумні ваги": ["розумні ваги", "смарт ваги", "смарт-ваги", "ваги для тіла", "підлогові ваги"],
  "смарт-кільце": ["смарт-кільце", "смарт кільце", "розумний перстень", "smart ring"],
  "смарт-окуляри": ["смарт-окуляри", "смарт окуляри", "розумні окуляри", "smart glasses"],
  "фітнес браслет": ["фітнес браслет", "фітнес-браслет", "фітнес трекер", "фітнес-трекер"],
  "мінімийка": ["мінімийка", "міні-мийка", "мийка високого тиску", "автомийка портативна"],
  "пусковий пристрій": [
    "пусковий пристрій", "джамп-стартер", "джампстартер", "бустер для акумулятора",
    "пускозарядний пристрій",
  ],
  "пароочищувач": ["пароочищувач", "пароочисник"],
  "гриль": ["гриль", "барбекю", "електрогриль"],
  "мікрофон": ["мікрофон ", "мікрофони для", "конденсаторний мікрофон", "usb мікрофон"],
  "килимок для миші": ["килимок для миші", "ігровий килимок для миші", "мишпад"],
  "usb флеш-пам'ять": ["флешка", "usb флеш", "флеш-накопичувач", "usb-накопичувач"],
  "портативна зарядна станція": [
    "портативна зарядна станція", "зарядна станція", "power station", "резервне джерело живлення",
  ],
  "мережеве обладнання": ["роутер", "wifi роутер", "wi-fi роутер", "комутатор", "свіч ", "мережева карта", "модем", "wifi підсилювач", "wi-fi підсилювач"],
  "вінілові програвачі": ["вініловий програвач", "вінілпрогравач", "програвач вінілових платівок", "вінілова платівка"],
  "mp3-плеєри": ["mp3 плеєр", "мп3 плеєр", "mp3-плеєр"],
  "прибиральні машини": ["прибиральна машина", "поломийна машина"],
  "м'ячі": ["м'яч", "мяч", "мячик", "м'ячик"],
};

 
 
 
 
 
 
 
// Категорії-"парасольки": у клієнта в каталозі товари цієї теми розкидані по КІЛЬКОМ реальним
// категоріям одразу (напр. "товари для тварин" — це окремо "Товари для тварин", "Одяг для
// тварин", "Годівниці та поїлки", "Аксесуари для тварин" тощо) — тому для широкого запиту типу
// "товари для тварин" чи "іграшки" без уточнення треба зібрати ВСІ дотичні ключові слова разом,
// а не тільки буквальну назву категорії.
const WIDE_MATCH_CATEGORIES = new Set(["консоль", "електротранспорт", "товари для тварин", "іграшки", "товари для дітей"]);
// Ключ = точна назва категорії каталогу. Повертаємо саме її (без слова-тригера), щоб
// resolveCategoryIds знайшов категорію за точним збігом назви, а не нечітким підбором.
const EXACT_TITLE_CATEGORIES = new Set(["м'ячі"]);

function guessCategoryFromText(rawText) {
  const norm = normalize(rawText);
  const queryToks = norm.split(" ").filter(Boolean);
  // Дозволяємо скорочені/недописані слова (мін. 4 значущі літери після відкидання типової
  // словозміни на 0-2 літери в кінці), напр. "павер"/"паверы"/"паверов" мають так само
  // знаходити ключове слово "павербанк" — люди рідко дописують слово повністю чи ставлять
  // правильне закінчення.
  function hasPartialOverlap(hintWordNorm, queryToken) {
    // ТІЛЬКИ для однослівних ключових слів (без пробілу): інакше "машинка" (повне, реальне
    // слово з запиту "машинка для дитини") тривіально є префіксом будь-якої фрази, що починається
    // з "машинка " — напр. "машинка для стрижки" — і помилково тягнула іграшкові машинки в
    // категорію бритв/тримерів. Обрізання кінця (0-2 літери) має сенс лише як компенсація
    // словозміни ОДНОГО слова, не для збігу з першим словом довгої фрази.
    if (hintWordNorm.includes(" ")) return false;
    if (hintWordNorm.length <= queryToken.length) return false;
    for (let cut = 0; cut <= 2 && queryToken.length - cut >= 4; cut++) {
      if (hintWordNorm.startsWith(queryToken.slice(0, queryToken.length - cut))) return true;
    }
    return false;
  }
  for (const [cat, words] of Object.entries(CATEGORY_HINT_WORDS)) {
    const hit = words.find((w) => {
      const nw = normalize(w);
      if (norm.includes(nw)) return true;
      return queryToks.some((qt) => qt.length >= 5 && hasPartialOverlap(nw, qt));
    });
    if (!hit) continue;
    if (EXACT_TITLE_CATEGORIES.has(cat)) return cat;
    if (WIDE_MATCH_CATEGORIES.has(cat)) return `${cat} ${words.join(" ")}`;
     
     
     
     
     
    return `${cat} ${hit}`;
  }
  return null;
}

// Повний перелік "переглядових" категорій каталогу (без службових "для iPhone"/"аксесуари"
// тощо) — використовується як список варіантів для LLM-фолбеку, коли CATEGORY_HINT_WORDS
// мовчить (нове/незвичне формулювання, якого немає в словнику).
function listBrowsableCategories(categories) {
  if (!categories) return [];
  const seen = new Set();
  const names = [];
  for (const name of Object.values(categories)) {
    const n = String(name || "").trim();
    if (!n || seen.has(n) || looksLikeForDevice(n)) continue;
    seen.add(n);
    names.push(n);
  }
  return names.sort((a, b) => a.localeCompare(b, "uk"));
}

function guessBrandFromText(rawText, products) {
  const queryTokens = new Set(tokens(rawText).filter((t) => t.length > 2));
  if (!queryTokens.size) return null;
  const vendors = new Map();
  for (const product of products || []) {
    const vendor = String(product.vendor || "").trim();
    if (!vendor || vendors.has(vendor.toLowerCase())) continue;
    const vendorTokens = tokens(vendor).filter((t) => t.length > 2);
    if (vendorTokens.length) vendors.set(vendor.toLowerCase(), { vendor, vendorTokens });
  }
  for (const { vendor, vendorTokens } of vendors.values()) {
    if (vendorTokens.every((token) => queryTokens.has(token))) return vendor;
  }
  return null;
}

 
 
 
 
 
 
 
 
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

 
 
 
 
function wordsClose(a, b) {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  // Для 3-літерних слів/абревіатур (ups, gps, ssd, tv...) одна відмінна літера — це ВЖЕ 33%
  // слова, тож нечіткий збіг тут занадто ризикований (саме так "ups" одного разу "склеївся" з
  // "gps" і в підбірку ДБЖ підмішались дитячі годинники). Для 3 літер вимагаємо точний збіг.
  if (shorter < 4) return false;  
  if (longer - shorter > 3) return false;  
  const dist = levenshtein(a, b);
   
   
   
   
  if (shorter <= 7) return dist <= 1;
  return dist <= 2;
}

 
 
 
 
 
function containsCloseWord(longWord, shortWord) {
  if (shortWord.length < 4) return false;  
  if (longWord.length <= shortWord.length) return false;
  for (let i = 0; i <= longWord.length - shortWord.length; i++) {
    for (const wl of [shortWord.length, shortWord.length + 1]) {
      if (i + wl > longWord.length) continue;
      if (wordsClose(shortWord, longWord.slice(i, i + wl))) return true;
    }
  }
  return false;
}

// Пари (короткеСлово, фрагментДовгогоСлова), де фонетично/буквено коротке слово ВИПАДКОВО є
// підрядком довгого, хоча семантично це геть різні речі — напр. "спорт" літерально є суфіксом
// "транСПОРТ"/"електротранспорт", тож без цього блок-листа запит про спортивні товари тягнув
// категорію електротранспорту. Список короткий і доповнюється за фактом знайдених колізій.
const FUZZY_COLLISION_BLOCKLIST = [
  ["спорт", "транспорт"],
  // "кота" (родовий відмінок від "кіт") випадково за відстанню Левенштейна=1 збігається з
  // "коса" всередині "газонокосарка" — через це "товари для тварин" (куди входить фраза
  // "лоток для кота") підмішував газонокосарки.
  ["кота", "косар"],
];
function isFuzzyBlocked(shortTok, longTok) {
  return FUZZY_COLLISION_BLOCKLIST.some(
    ([short, longSub]) => shortTok === short && longTok.includes(longSub)
  );
}

function resolveCategoryIds(categories, categoryText) {
  if (!categoryText || !categories) return null;
  const normalizedCategory = normalize(categoryText);
   
   
   
   
  const exactTitleIds = Object.entries(categories)
    .filter(([, name]) => normalize(name) === normalizedCategory)
    .map(([id]) => id);
  if (exactTitleIds.length) return new Set(exactTitleIds);

  // "для" (3 літери) проходило фільтр length>2 і саме по собі "точно" збігалося з КОЖНОЮ
  // категорією, чия назва містить слово "для" (а таких, як "Для Apple iPhone", "Для Samsung" —
  // сотні). Через це майже будь-який запит із прийменником "для" ловив 100+ випадкових категорій.
  const stopSet = new Set((cfg.genericStopWords || []).flatMap((w) => tokens(w)));
  const qTokens = tokens(categoryText).filter((t) => t.length > 2 && !stopSet.has(t));
  if (!qTokens.length) return null;

   
   
   
   
  const realCategories = Object.entries(categories).filter(
    ([, name]) => !looksLikeForDevice(name)
  );

  // Рахуємо, СКІЛЬКИ РІЗНИХ qTokens взагалі влучає в кожну категорію (байдуже, точно чи нечітко —
  // важлива саме КІЛЬКІСТЬ різних слів запиту, що підтвердились), а не просто "хоч один влучив".
  // Це навмисно НЕ зважена сума (exact=2/fuzzy=1 тут не підходить): для "парасолькових" категорій
  // (WIDE_MATCH_CATEGORIES, напр. "товари для тварин") категоріям на кшталт "Одяг для тварин" чи
  // "Годівниці та поїлки" природно дістається лише 1 влучання ("тварин"/"поїлк"), і коли лідер —
  // "Товари для тварин" — також усього 2 влучання (товари+тварин), зважений поріг їх відсікав би.
  // А для шумних одно-фрагментних збігів (напр. "електрич" з фрази "зубна щітка електрична", що
  // тягнув усі категорії "Електро-") кількість РІЗНИХ влучань — рівно той сигнал, що відрізняє
  // "Зубні щітки електричні" (влучили зубна+щітка+електрич, 3 різних слова) від однослівного шуму.
  const hitCounts = new Map();
  for (const [id, name] of realCategories) {
    const nameTokens = tokens(name);
    let hits = 0;
    for (const qt of qTokens) {
      const matched = nameTokens.some((nt) => {
        if (nt === qt) return true;
        if (isFuzzyBlocked(qt, nt)) return false;
        if (wordsClose(qt, nt)) return true;
        if (containsCloseWord(nt, qt)) return true;
        if (!nt.includes(qt) && !qt.includes(nt)) return false;
        const shorter = Math.min(nt.length, qt.length);
        const longer = Math.max(nt.length, qt.length);
        return shorter / longer >= 0.8;
      });
      if (matched) hits += 1;
    }
    if (hits > 0) hitCounts.set(id, hits);
  }
  if (!hitCounts.size) return null;

  const maxHits = Math.max(...hitCounts.values());
  // Лідер влучив у 2+ РІЗНИХ слова запиту — відсікаємо категорії, що влучили суттєво менше
  // (нижче maxHits-1), це майже завжди одно-фрагментний шум. Якщо лідер сам влучив лише в 1
  // слово — запит і так розмитий, лишаємо все, що взагалі знайшлось.
  const threshold = maxHits >= 2 ? maxHits - 1 : maxHits;
  const ids = [...hitCounts.entries()].filter(([, h]) => h >= threshold).map(([id]) => id);
  return ids.length ? new Set(ids) : null;
}

 
 
 
 
const CATEGORY_NEGATIVE_WORDS = {
  "ноутбук": ["планшет", "\\btab\\b"],
  "планшет": ["ноутбук", "laptop"],
  "телевізор": ["монітор", "пульт"],
};

function excludeCategoryNegatives(list, category) {
  if (!category) return list;
  const norm = normalize(category);
  for (const [cat, words] of Object.entries(CATEGORY_NEGATIVE_WORDS)) {
    if (norm.includes(cat)) {
      const re = new RegExp(words.join("|"), "i");
      return list.filter((p) => !re.test(normalize(p.name)));
    }
  }
  return list;
}

 









function hybridScore(product, queryTokens, vectorScores, { keywordWeight = 0.5, vectorWeight = 0.5 } = {}) {
  const kw = scoreTextMatch(product, queryTokens);
  const vec = vectorScores ? Math.max(vectorScores.get(product.id) || 0, 0) : 0;
  const exactBoost = kw >= 0.999 ? 1000 : 0;  
  return exactBoost + kw * keywordWeight + vec * vectorWeight;
}

 






function isUsedProduct(product) {
  return Boolean(
    product &&
      (product.isUsed === true ||
        USED_PRODUCT_RE.test(`${product.name || ""} ${product.categoryName || ""}`))
  );
}

// Товари типу зарядок/кабелів/чохлів позначені isAccessory=true в каталозі (щоб, наприклад,
// пошук "iPhone" не підмішував кабель до самих телефонів) — але коли клієнт шукає САМЕ такий
// товар ("зарядний пристрій", "чохол", "кабель", "блок живлення"), виключати isAccessory не
// можна: інакше в каталозі СТРУКТУРНО неможливо знайти жоден такий товар, хоч би як точно він
// був названий (саме це ховало всі зарядні пристрої Xiaomi від "recommendation"-пошуку).
const ACCESSORY_CATEGORY_QUERY_RE =
  /чохол\p{L}*|чехол\p{L}*|кейс\p{L}*|захисн\p{L}*\s*(?:скл\p{L}*|плівк\p{L}*|пленк\p{L}*)|скл[оа]|плівк\p{L}*|пленк\p{L}*|ремінц\p{L}*|ремешк\p{L}*|підставк\p{L}*|подставк\p{L}*|зарядн\p{L}*|зарядк\p{L}*|блок\s*живленн\p{L}*|блочок|блочки|кабел\p{L}*|повербанк\p{L}*|power\s*bank|адаптер\p{L}*|переходник\p{L}*|перехідник\p{L}*|автотримач\p{L}*|кріплення\p{L}*/iu;
function isAccessoryTypeQuery(categoryText) {
  return Boolean(categoryText) && ACCESSORY_CATEGORY_QUERY_RE.test(categoryText);
}

// resolveCategoryIds зіставляє запит із назвою категорії лише через близькість словоформ
// (Левенштейн), а "зарядний пристрій"/"блочок"/"блок живлення" і реальна назва категорії в
// фіді — "Зарядка, кабель, станція" — настільки різні слова, що жодна евристика їх не зблизить
// (дистанція між "зарядний" і "зарядка" = 3, а поріг — 1). Тому для таких відомих розбіжностей
// тримаємо окремий невеликий alias-список замість покладатись на фаззі-збіг.
// categoryNameIncludes порівнюється з normalize(name) — normalize() знімає пунктуацію,
// тож "Зарядка, кабель, станція" стає "зарядка кабель станція" (без коми); порівнювати
// треба з тим самим нормалізованим виглядом, інакше підрядок ніколи не знайдеться.
const CATEGORY_NAME_ALIASES = [
  {
    matches: /зарядн\p{L}*|зарядк\p{L}*|блок\s*живленн\p{L}*|блочок|блочки|адаптер\s*живленн\p{L}*/iu,
    categoryNameIncludes: ["зарядка кабель"],
  },
];
function aliasedCategoryIds(categories, categoryText) {
  if (!categoryText || !categories) return null;
  const hit = CATEGORY_NAME_ALIASES.find((a) => a.matches.test(categoryText));
  if (!hit) return null;
  const ids = Object.entries(categories)
    .filter(([, name]) => hit.categoryNameIncludes.some((sub) => normalize(name).includes(sub)))
    .map(([id]) => id);
  return ids.length ? new Set(ids) : null;
}

function filterByBudgetCriteria(products, { category, brand, categories, minPrice, maxPrice, usedOnly = false, newOnly = false }) {
  const allowAccessories = isAccessoryTypeQuery(category);
  let candidates = products.filter(
    (p) => p.available !== false && (allowAccessories || !p.isAccessory) && !p.isService && p.price != null
  );
  if (minPrice != null) candidates = candidates.filter((p) => p.price >= minPrice);
  if (maxPrice != null) candidates = candidates.filter((p) => p.price <= maxPrice);
   
   
   
  if (usedOnly) candidates = candidates.filter(isUsedProduct);
  if (newOnly) candidates = candidates.filter((p) => !isUsedProduct(p));

  if (category) {
     
     
     
    const kind = categoryKind(category);
    const merged = new Map();
    const add = (items) => items.forEach((p) => merged.set(p.id, p));

    if (kind) add(candidates.filter((p) => matchesCategoryKind(p, kind)));

    const resolvedIds = resolveCategoryIds(categories, category);
    const aliasIds = aliasedCategoryIds(categories, category);
    const catIds =
      resolvedIds || aliasIds ? new Set([...(resolvedIds || []), ...(aliasIds || [])]) : null;
    if (catIds) add(candidates.filter((p) => p.categoryId && catIds.has(String(p.categoryId))));

    const catKeywords = resolveCategoryKeywords(category);
    if (catKeywords) {
      add(candidates.filter((p) => catKeywords.some((kw) => normalize(p.name).includes(kw))));
    }


     
     
     
     
    let matched = [...merged.values()]
      .filter(
        (p) =>
          (p.categoryId && catIds && catIds.has(String(p.categoryId))) ||
          !looksLikeForDevice(p.name)
      );
     
     
     
    if (kind) matched = matched.filter((p) => matchesCategoryKind(p, kind));
    matched = excludeCategoryNegatives(matched, category);

     
     
     
    const anchors = categoryAnchors(category, kind);
    if (anchors.length) {
      matched = matched.filter((p) => {
        const hay = normalize(`${p.name} ${p.vendor || ""} ${p.categoryName || ""}`);
        return anchors.every((anchor) => hay.includes(anchor));
      });
    }

    candidates = matched;
  }

  if (brand) {
    const brandTokens = tokens(brand);
    candidates = candidates.filter((p) =>
      brandTokens.some((t) => t.length > 1 && p._haystack.includes(t))
    );
  }

  return candidates;
}

 






function rankAndDiversify(candidates, { queryText, brand, vectorScores, preferLowerPrice = false, limit = 8 }) {
  const qTokens = tokens(queryText);
  let scored;
  if (vectorScores && vectorScores.size) {
    scored = candidates
      .map((p) => ({ p, score: hybridScore(p, qTokens, vectorScores) }))
      .sort((a, b) => b.score - a.score || (preferLowerPrice ? a.p.price - b.p.price : b.p.price - a.p.price));
  } else {
    scored = candidates
      .map((p) => ({ p, score: scoreTextMatch(p, qTokens) }))
      .sort((a, b) => b.score - a.score || (preferLowerPrice ? a.p.price - b.p.price : b.p.price - a.p.price));
  }

  if (!scored.length) return [];

   
   
  if (brand) {
    return scored.slice(0, limit).map((x) => x.p);
  }

   
   
  const byVendor = new Map();
  for (const { p } of scored) {
    const key = (p.vendor || "інше").toLowerCase();
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key).push(p);
  }
  const vendors = [...byVendor.keys()];
  const result = [];
  let i = 0;
  while (result.length < limit && vendors.some((v) => byVendor.get(v).length)) {
    const v = vendors[i % vendors.length];
    const arr = byVendor.get(v);
    if (arr.length) result.push(arr.shift());
    i += 1;
  }
  return result;
}

 













function findByBudget(products, { category, brand, categories, queryText, minPrice, maxPrice, usedOnly = false, newOnly = false, limit = 8 }) {
  const candidates = filterByBudgetCriteria(products, { category, brand, categories, minPrice, maxPrice, usedOnly, newOnly });
  return rankAndDiversify(candidates, { queryText, brand, limit });
}

 




function detectCompanionKinds(product) {
  // Тип пристрою визначаємо ЛИШЕ за назвою й категорією товару. Раніше дивились ще й у params
  // (там у AirPods є "Сумісність: iPhone, MacBook"), тому навушники вважались смартфоном і до них
  // чіплялись чохли на iPhone та MacBook.
  const hay = `${product.name || ""} ${product.categoryName || ""}`.toLowerCase();
  for (const entry of cfg.companionMap) {
    if (entry.triggerKeywords.some((kw) => hasToken(hay, kw))) {
      return entry.companions;
    }
  }
  return [];
}

// Слова, які НЕ визначають модель (тип пристрою, бренд, кольори, службові) — їх ігноруємо,
// коли шукаємо "чи підходить аксесуар до цього товару".
const NON_MODEL_WORDS = new Set([
  "бездротові", "бездротовий", "навушники", "смартфон", "смарт", "годинник", "планшет", "ноутбук", "телефон",
  "мобільний", "apple", "samsung", "xiaomi", "with", "and", "for", "usb", "wi", "fi", "gps", "cellular", "lte",
  "gb", "tb", "mm", "new", "black", "white", "red", "blue", "green", "pink", "purple", "orange", "yellow",
  "gray", "grey", "silver", "gold", "midnight", "starlight", "graphite", "titanium", "natural", "desert",
  "space", "rose", "teal", "ultramarine", "lavender", "sage", "cosmic", "deep", "sky", "cloud",
]);

// Ознаки моделі товару, які МАЄ містити сумісний аксесуар. Повертає null, якщо надійно визначити не вдалось —
// тоді краще не чіпляти нічого, ніж чіпляти чужий аксесуар.
function modelAnchors(product) {
  const name = String(product.name || "").toLowerCase().replace(/\([^)]*\)/g, " ");
  if (/airpods/.test(name)) {
    const anchors = ["airpods"];
    if (/\bpro\b/.test(name)) anchors.push("pro");
    if (/\bmax\b/.test(name)) anchors.push("max");
    const gen = /airpods\s*(?:pro|max)?\s*(\d)\b/.exec(name);
    if (gen) anchors.push(gen[1]);
    return anchors;
  }
  if (/apple\s*watch/.test(name)) return ["watch"];
  if (/macbook/.test(name)) {
    const anchors = ["macbook"];
    const size = /\b(13|14|15|16)\b/.exec(name);
    if (size) anchors.push(size[1]);
    return anchors;
  }
  const distinct = tokens(name).filter(
    (t) =>
      (t.length > 1 || /^\d$/.test(t)) &&
      !NON_MODEL_WORDS.has(t) &&
      !/^\d+(gb|tb|mm)$/.test(t) &&
      !/^\d{3,}$/.test(t)
  );
  return distinct.length ? distinct : null;
}

function accessoryFitsProduct(accessory, product) {
  const iphone = iphoneModelInText(product.name || "");
  if (iphone) return matchesIphoneVariant(accessory, iphone);
  const anchors = modelAnchors(product);
  if (!anchors || !anchors.length) return false;
  const hay = normalize(`${accessory.name || ""} ${accessory.categoryName || ""}`);
  return anchors.every((t) => hasToken(hay, t));
}

function findAccessoriesFor(products, product, { kinds = null, limit = 3 } = {}) {
  const resolvedKinds = kinds || detectCompanionKinds(product);
  if (!resolvedKinds.length) return [];

  const accessories = products.filter(
    (p) => p.available !== false && p.isAccessory && accessoryFitsProduct(p, product)
  );

  const out = [];
  const usedIds = new Set();
  for (const kind of resolvedKinds) {
    const forKind = accessories.filter((p) => p.name.toLowerCase().includes(kind) && !usedIds.has(p.id));
    if (forKind[0]) {
      out.push(forKind[0]);
      usedIds.add(forKind[0].id);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

 


function findNewest(products, { limit = 8 } = {}) {
  return products
    .filter((p) => p.available !== false && !p.isAccessory)
    .slice()
    .sort((a, b) => {
      const ai = parseInt(a.id, 10);
      const bi = parseInt(b.id, 10);
      if (Number.isFinite(ai) && Number.isFinite(bi)) return bi - ai;
      return 0;
    })
    .slice(0, limit);
}

 




function findByCategoryKeyword(products, categories, { keywordRe, limit = 8, requireDiscount = false }) {
  const matchingIds = new Set(
    Object.entries(categories || {})
      .filter(([, name]) => keywordRe.test(name))
      .map(([id]) => id)
  );
  if (!matchingIds.size) return [];
  return products
    .filter(
      (p) =>
        p.available !== false &&
        !p.isService &&
        matchingIds.has(p.categoryId) &&
        (!requireDiscount || (p.price != null && p.oldPrice != null && p.oldPrice > p.price))
    )
    .slice(0, limit);
}

 
 
 
 
 
function findDiscountedProducts(
  products,
  { category, brand, categories, minPrice, maxPrice, usedOnly = false, newOnly = false, limit = 100 } = {}
) {
  const scoped = filterByBudgetCriteria(products, {
    category,
    brand,
    categories,
    minPrice,
    maxPrice,
    usedOnly,
    newOnly,
  });
  return scoped
    .filter((p) => p.oldPrice != null && p.oldPrice > p.price)
    .sort(
      (a, b) =>
        (b.oldPrice - b.price) / b.oldPrice - (a.oldPrice - a.price) / a.oldPrice ||
        b.oldPrice - b.price
    )
    .slice(0, limit);
}

 
 
 
function findSaleProducts(products, categories, options = {}) {
  return findDiscountedProducts(products, { ...options, categories });
}

 








function iphoneModelInText(text) {
   
   
  const norm = tokens(text).join(" ");
  const match =
    /(?:^|\s)iphone\s*(\d{1,2})(?:\s*(e)|\s+(pro\s+max|pro|max|plus|mini|air))?(?=$|\s)/iu.exec(norm) ||
    /(?:^|\s)(\d{1,2})\s+iphone(?=$|\s)/iu.exec(norm);
  if (match) return { generation: match[1], variant: (match[2] || match[3] || "base").replace(/\s+/g, " ") };
   
   
  if (/(?:^|\s)iphone\s+se(?=$|\s)/iu.test(norm)) return { generation: "se", variant: "base" };
  return null;
}

function matchesIphoneVariant(product, requested) {
  if (!requested) return true;
  const hay = normalize(`${product.name || ""} ${product.categoryName || ""}`);
  if (requested.generation === "se") return /(?:^|\s)iphone\s+se(?=$|\s)/iu.test(hay);
  if (requested.variant === "e") {
    return new RegExp(`(?:^|\\s)iphone\\s*${requested.generation}\\s*e(?=$|\\s)`, "iu").test(hay);
  }
  const generationRe = new RegExp(`(?:^|\\s)iphone\\s*${requested.generation}(?=$|\\s)`, "iu");
  if (!generationRe.test(hay)) return false;
  const variantRe = new RegExp(
    `(?:^|\\s)iphone\\s*${requested.generation}\\s+(pro\\s+max|pro|max|plus|mini|air)(?=$|\\s)`,
    "iu"
  );
  const candidateVariant = variantRe.exec(hay)?.[1]?.replace(/\s+/g, " ") || "base";
  return candidateVariant === requested.variant;
}

// Кожна група: перша регулярка — як розпізнати запит цього типу ("зарядка", "джойстик"...),
// друга — якою має бути НАЗВА товару, щоб рахуватись цим типом. Порядок важливий для
// неоднозначних слів немає — груп не перетинаються за словами.
const ACCESSORY_TYPE_GROUPS = [
  [/чохо?л|чехо?л|\bcase\b/iu, /чохо?л|чехо?л|\bcase\b/iu],
  [/скло|скла|стекл|\bglass\b|плівк|пленк/iu, /скло|скла|стекл|\bglass\b|плівк|пленк/iu],
  [/ремінец|ремінц|ремеш|\bstrap\b|\bband\b/iu, /ремінец|ремінц|ремеш|\bstrap\b|\bband\b/iu],
  [
    /зарядк|зарядн|адаптер\s*живлення|power\s*adapter|блок\s*живлення|\bкабель\b|\bcable\b|переходник|перехідник/iu,
    /зарядн|адаптер|power\s*adapter|\bкабель\b|\bcable\b|переходник|перехідник/iu,
  ],
  [/джойстик|геймпад|\bcontroller\b|\bgamepad\b/iu, /джойстик|геймпад|controller|gamepad/iu],
  [/тримач|підставк|подставк|кріпленн|\bholder\b|\bmount\b|\bstand\b/iu, /тримач|підставк|подставк|кріпленн|holder|mount|stand/iu],
  [/павербанк|повербанк|пауэрбанк|power\s*bank|зовнішн\S*\s*акумулятор/iu, /павербанк|повербанк|пауэрбанк|power\s*bank|зовнішн\S*\s*акумулятор/iu],
];

function requestedAccessoryType(queryText) {
  const text = String(queryText || "").toLowerCase();
  for (const [queryRe, productRe] of ACCESSORY_TYPE_GROUPS) {
    if (queryRe.test(text)) return productRe;
  }
  return null;
}

const COLOR_WORDS = [
  ["blue", /(?:^|\s)(?:blue|синій|синя|синє|синий|синяя|блакитн\S*|голуб\S*)(?=\s|$)/iu],
  ["black", /(?:^|\s)(?:black|чорн\S*|черн\S*)(?=\s|$)/iu],
  ["white", /(?:^|\s)(?:white|біл\S*|бел\S*)(?=\s|$)/iu],
  ["red", /(?:^|\s)(?:red|червон\S*|красн\S*)(?=\s|$)/iu],
  ["green", /(?:^|\s)(?:green|зелен\S*)(?=\s|$)/iu],
  ["pink", /(?:^|\s)(?:pink|рожев\S*|розов\S*)(?=\s|$)/iu],
  ["purple", /(?:^|\s)(?:purple|фіолетов\S*|фиолетов\S*)(?=\s|$)/iu],
  ["orange", /(?:^|\s)(?:orange|помаранч\S*|оранжев\S*)(?=\s|$)/iu],
  ["yellow", /(?:^|\s)(?:yellow|жовт\S*|желт\S*)(?=\s|$)/iu],
  ["gray", /(?:^|\s)(?:gr[ae]y|сір\S*|сер\S*)(?=\s|$)/iu],
];

function requestedColor(queryText) {
  const text = tokens(queryText).join(" ");
  for (const [eng, re] of COLOR_WORDS) {
    if (re.test(text)) return new RegExp(eng === "gray" ? "gr[ae]y" : eng, "iu");
  }
  return null;
}

 
 
 
 
function filterAccessoriesForQuery(products, queryText) {
  const iphone = iphoneModelInText(queryText);
  const typeRe = requestedAccessoryType(queryText);
  const colorRe = requestedColor(queryText);
  let filtered = products.filter(
    (p) =>
      p.available !== false &&
      p.isAccessory &&
      matchesIphoneVariant(p, iphone) &&
      (!typeRe || typeRe.test(`${p.name || ""} ${p.categoryName || ""}`))
  );
  if (colorRe) {
    const colorMatches = filtered.filter((p) => colorRe.test(`${p.name || ""} ${Object.values(p.params || {}).join(" ")}`));
    if (colorMatches.length) filtered = colorMatches;
  }
  return filtered;
}

const FAMILY_TOKENS = new Set([
  "iphone", "ipad", "macbook", "imac", "airpods", "airtag", "watch", "galaxy", "pixel", "redmi", "poco",
  "ps5", "ps4", "xbox", "switch", "gopro", "dji",
]);

function findAccessoryLoose(products, queryText, { limit = 5 } = {}) {
   
   
   
   
   
   
   
   
  // НЕ використовуємо cfg.accessoryKeywords тут: там є фрази на кшталт "airpods case" — і
  // "airpods" помилково потрапляв би у "загальні" слова, які прибираються з запиту, через що
  // з "чохол на airpods pro" лишалось тільки "pro" — і збігалось з "MacBook PRO", "iPhone 11 PRO" тощо.
  const ACCESSORY_TYPE_WORDS = [
    "чохол", "чехол", "case", "скло", "плівка", "захисне", "стекло",
    "кабель", "адаптер", "переходник", "тримач", "підставка", "ремінець", "ремешок",
  ];
  const genericWords = new Set(
    [...ACCESSORY_TYPE_WORDS, ...(cfg.genericStopWords || [])].flatMap((k) => tokens(k))
  );
  // Однознакові числа ("4" в AirPods 4, "2" в MacBook 2) не можна відкидати за довжиною —
  // інакше "чохол на airpods 4" не відрізнявся б від запиту без покоління взагалі.
  const allTokens = tokens(queryText).filter((t) => t.length > 1 || /^\d$/.test(t));
  const modelTokens = allTokens.filter((t) => !genericWords.has(t));
   
   
   
  if (!modelTokens.length) return [];

  // Слова-"родини" пристрою (iphone, ipad, macbook, airpods, watch, galaxy, ps5...) і токени з цифрами
  // (a54, s24, 15, 45mm) — обов'язкові: аксесуар для iPad не показуємо на запит про MacBook,
  // а скло для Galaxy A02 — на запит про A54. Краще чесно "нічого не знайдено", ніж чужа модель.
  const familyTokens = [...new Set(modelTokens.filter((t) => FAMILY_TOKENS.has(t)))];
  const numberTokens = [
    ...new Set(modelTokens.filter((t) => /\d/.test(t) && !/^\d{3,}$/.test(t) && !/^\d+(gb|tb|гб|тб)$/.test(t))),
  ];
  const mustHave = [...familyTokens, ...numberTokens];
  const candidates = filterAccessoriesForQuery(products, queryText).filter((p) =>
    mustHave.every((t) => hasToken(p._haystack, t))
  );
  const scored = candidates
    .map((p) => {
      const productWords = normalize(`${p.name || ""} ${p.categoryName || ""} ${p.vendor || ""}`).split(" ");
      let score = 0;
      for (const token of modelTokens) {
        if (hasToken(p._haystack, token)) score += 1;
        else if (phoneticWordMatch(token, productWords)) score += 0.92;
      }
      return { p, score: modelTokens.length ? score / modelTokens.length : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // Лишаємо тільки найкращий "рівень" збігу: якщо є аксесуари, що підходять під ВСІ слова моделі,
  // то тих, що збігаються лише частково (наприклад тільки "airpods", але не "pro"), не показуємо.
  if (!scored.length) return [];
  const top = scored[0].score;
  const out = scored.filter((x) => x.score === top).slice(0, limit).map((x) => x.p);
  out.topScore = top;  // 1 = збігаються всі слова моделі; <1 = лише частково
  return out;
}

module.exports = {
  foldHomoglyphs,
  normalize,
  iphoneModelInText,
  tokens,
  extractStorage,
  productStorage,
  findSpecificProduct,
  findByBudget,
  filterByBudgetCriteria,
  rankAndDiversify,
  hybridScore,
  findAccessoriesFor,
  findAccessoryLoose,
  filterAccessoriesForQuery,
  findNewest,
  findByCategoryKeyword,
  findDiscountedProducts,
  findSaleProducts,
  isUsedProduct,
  guessCategoryFromText,
  listBrowsableCategories,
  guessBrandFromText,
};