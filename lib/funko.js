const ASK_MIN_TOTAL = Number(process.env.FUNKO_ASK_MIN_TOTAL) || 20;
const MIN_GROUP_SIZE = 3;
const PICKS_LIMIT = 8;

const GROUPS = [
  { key: "marvel", label: "Marvel", aliases: ["марвел"],
    re: /marvel|avengers|spider-?man|deadpool|venom|x-men|guardians of the galaxy|iron man|black panther|\bthor\b|\bhulk\b|captain america|wolverine|eternals|endgame|thanos|black widow/i },
  { key: "dc", label: "DC", aliases: ["дс", "dc comics", "дс комікс"],
    re: /(?:^|[^a-z])dc(?:[^a-z]|$)|batman|superman|joker|wonder woman|aquaman|harley quinn|justice league|\bflash\b|suicide squad|black adam|hawkwoman/i },
  { key: "starwars", label: "Star Wars", aliases: ["зоряні війни", "звездные войны"],
    re: /star wars|mandalorian|\bsw\b|\byoda\b|darth|vader|boba fett|grogu|ahsoka|stormtrooper/i },
  { key: "hp", label: "Гаррі Поттер", aliases: ["harry potter", "гарри поттер"],
    re: /harry potter|fantastic beasts|hogwarts|dementor/i },
  { key: "disney", label: "Disney та Pixar", aliases: ["disney", "pixar", "дісней", "дисней"],
    re: /disney|pixar|mickey|minnie|frozen|stitch|toy story|moana|lion king|winnie|nightmare before|aladdin|\bwish\b|minions|encanto/i },
  { key: "sanrio", label: "Hello Kitty та Sanrio", aliases: ["hello kitty", "sanrio", "хелоу кітті", "хелло кітті"],
    re: /sanrio|hello kitty|kuromi|melody|cinnamoroll|retsuko/i },
  { key: "cartoons", label: "Мультфільми", aliases: ["мультики", "мультсеріали", "cartoons"],
    re: /spongebob|futurama|south park|simpsons|rick & morty|avatar|korra|httyd|how to train|looney|tom & jerry|scooby|flintstones|adventure time|powerpuff/i },
  { key: "anime", label: "Аніме", aliases: ["anime", "аниме"],
    re: /animation|anime|naruto|boruto|dragon ball|one piece|my hero|demon slayer|jujutsu|sailor moon|attack on titan|pokemon|pok[eé]mon|bleach|death note|black clover|dandadan|chainsaw|spy x family|solo leveling|frieren|kaiju/i },
  { key: "games", label: "Ігри", aliases: ["games", "відеоігри", "ігри"],
    re: /games|fortnite|overwatch|fallout|halo|cyberpunk|zelda|mario|minecraft|diablo|sonic|call of duty|god of war|witcher|street fighter|mortal kombat|resident evil|among us|roblox|pac-?man|arcane|league of legends|yu-gi-oh/i },
  { key: "music", label: "Музика", aliases: ["music", "рок", "rocks"],
    re: /rocks|album|metallica|black sabbath|\bqueen\b|nirvana|gn.r|\bkiss\b|beatles|ac\/dc|bon jovi|rolling stones|pink floyd|ozzy|k-pop/i },
  { key: "sport", label: "Спорт", aliases: ["sport", "футбол", "баскетбол"],
    re: /\bnba\b|football|\bnfl\b|\bmlb\b|\bwwe\b|\bnhl\b|soccer|formula|manchester/i },
  { key: "movies", label: "Кіно та серіали", aliases: ["кіно", "серіали", "фільми", "movies", "tv"],
    re: /movies|(?:^|[^a-z])tv(?:[^a-z]|$)|friends|game of thrones|stranger things|lord of the rings|lotr|hobbit|back to the future|ghostbusters|jurassic|terminator|\balien\b|predator|breaking bad|walking dead|wednesday|addams|transformers|shrek|godzilla|tron|bridgerton|mistery minis/i },
];
const OTHER = { key: "other", label: "Інше", aliases: ["other"] };

// Слова, які самі по собі не задають серію ("покажи funko pop", "є фанко?").
const GENERIC_WORDS = new Set([
  "funko", "funco", "фанко", "фанка", "фанку", "фанкі", "фанк", "pop", "поп", "попс", "pops",
  "фігурка", "фігурки", "фігурок", "фигурка", "фигурки", "фигурок", "колекційна", "колекційні", "колекційних",
  "іграшка", "іграшки", "вінілова", "вінілові", "вініловий", "серія", "серії", "серію", "серий",
  "купити", "купить", "хочу", "покажи", "покажіть", "показати", "покажите", "шукаю", "ищу", "треба", "потрібно", "потрібні", "потрібна", "нужны", "нужно",
  "є", "є?", "есть", "мені", "мне", "будь", "ласка", "пожалуйста", "у", "вас", "вас?", "які", "яка", "який", "что", "що", "які", "какие", "є",
  "для", "мене", "мою", "колекцію", "коллекцию", "наявності", "наявні", "наявність", "в", "на", "і", "та", "or", "a", "the", "цікавить",
]);

function stripGeneric(s) {
  return norm(s).split(" ").filter((t) => t && !GENERIC_WORDS.has(t)).join(" ");
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[’'`ʼ]/g, "")
    .replace(/[^\p{L}\p{N}& ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFunkoProduct(p) {
  return p && p.available !== false && p.price != null && !p.isAccessory && !p.isService && /funko/i.test(p.name || "");
}

function groupOf(product) {
  const name = product.name || "";
  for (const g of GROUPS) if (g.re.test(name)) return g;
  return OTHER;
}

// Усі наявні Funko, розкладені по серіях. Дрібні серії йдуть у "Інше".
function buildIndex(products) {
  const funko = (products || []).filter(isFunkoProduct);
  const map = new Map();
  for (const p of funko) {
    const g = groupOf(p);
    if (!map.has(g.key)) map.set(g.key, { group: g, items: [] });
    map.get(g.key).items.push(p);
  }
  const other = map.get(OTHER.key) || { group: OTHER, items: [] };
  for (const [key, entry] of [...map.entries()]) {
    if (key !== OTHER.key && entry.items.length < MIN_GROUP_SIZE) {
      other.items.push(...entry.items);
      map.delete(key);
    }
  }
  if (other.items.length) map.set(OTHER.key, other);
  const list = [...map.values()].sort((a, b) => {
    if (a.group.key === OTHER.key) return 1;
    if (b.group.key === OTHER.key) return -1;
    return b.items.length - a.items.length;
  });
  return { total: funko.length, list };
}

// Що лишилось у повідомленні після прибирання "funko / pop / покажи / фігурка ..."
function leftover(message) {
  const tokens = norm(message).split(" ").filter(Boolean);
  const hasFunko = tokens.some((t) => /^(funko|funco|фанко|фанка|фанку|фанкі|фанк)$/.test(t));
  if (!hasFunko) return null;
  return tokens.filter((t) => !GENERIC_WORDS.has(t)).join(" ");
}

// Повертає null, якщо це не "загальний Funko" — тоді працює звичайний пошук.
//   { type: "ask",   options, total }            — питаємо, яка серія цікавить
//   { type: "group", group, picks, total }       — показуємо товари обраної серії
function handle(message, products) {
  const rest = leftover(message);
  if (rest === null) return null;

  const { total, list } = buildIndex(products);
  if (total <= ASK_MIN_TOTAL) return null;

  if (rest === "") {
    return {
      type: "ask",
      total,
      options: list.map((e) => ({
        label: `${e.group.label} (${e.items.length})`,
        q: `Funko POP! ${e.group.label}`,
      })),
    };
  }

  // Клієнт натиснув кнопку серії (або сам написав її назву) — і більше нічого не уточнював.
  const entry = list.find((e) => {
    const names = [e.group.label, ...(e.group.aliases || [])].map(stripGeneric);
    return names.includes(rest);
  });
  if (!entry) return null; // конкретний персонаж/бюджет/інше — це вже справа звичайного пошуку

  return { type: "group", group: entry.group, total: entry.items.length, picks: entry.items.slice(0, PICKS_LIMIT) };
}

module.exports = { handle, buildIndex, leftover };
