 








module.exports = {
   
  offersPath: "price.items.item",

   
  categoriesPath: "price.categories.category",

   
   
  categoryIdField: "id",

   
  fields: {
    id: "id",  
    available: undefined,  
    name: "name",
    price: "priceRUAH",  
    oldPrice: "oldpriceRUAH",  
    currency: null,  
    categoryId: "categoryId",
    vendor: "vendor",
    vendorCode: "code",
    url: "url",
    picture: "image",  
    description: "description",
    quantity: "quantity",  
    stock: "stock",  
    condition: "condition",  
     
    paramsTag: "param",
  },

   
   
   
   
   
   
   
   
   
  accessoryKeywords: [
    "чохол", "чехол", "case для", "чохол-книжка",
    "скло", "плівка", "захисне скло", "стекло",
    "кабель", "адаптер", "переходник",
    "airpods case",
    "тримач", "підставка", "ремінець", "ремешок",
  ],

   
   
   
   
   
   
   
  genericStopWords: [
    "для", "від", "до", "на", "з", "із", "та", "і", "й", "або", "чи",
    "є", "есть", "немає", "нема",
    "товар", "товари", "аксесуар", "аксесуари", "аксессуар", "аксессуары",
    "купити", "купить", "ціна", "цена", "оригінал", "оригинал",
  ],

   
  deviceKeywords: [
    "iphone", "samsung", "galaxy", "xiaomi", "redmi", "poco",
    "смартфон", "телефон", "планшет", "ipad", "ноутбук", "macbook",
    "watch", "годинник", "навушники"  ,
    "телевізор", "монітор", "колонка",
  ],

   
   
   
   
  companionMap: [
    {
      category: "смартфон",
      triggerKeywords: ["iphone", "samsung", "galaxy", "xiaomi", "redmi", "poco", "смартфон", "телефон"],
      companions: ["чохол", "скло", "захисне скло"],
    },
    {
      category: "консоль",
      triggerKeywords: ["playstation", "ps5", "ps4", "xbox", "приставка", "консоль", "nintendo switch"],
      companions: ["джойстик", "геймпад", "гра", "підписка", "plus"],
    },
    {
      category: "ноутбук",
      triggerKeywords: ["macbook", "ноутбук", "laptop", "notebook"],
      companions: ["сумка", "мишка", "миша", "зарядк", "рюкзак"],
    },
    {
      category: "навушники",
      triggerKeywords: ["airpods", "навушники", "buds", "headphones"],
      companions: ["чохол", "кейс"],
    },
    {
      category: "годинник",
      triggerKeywords: ["watch", "годинник", "band", "браслет"],
      companions: ["ремінець", "ремешок", "скло", "зарядк"],
    },
    {
      category: "планшет",
      triggerKeywords: ["ipad", "планшет", "tab"],
      companions: ["чохол", "скло", "стилус", "клавіатура"],
    },
    {
      category: "пилосос",
      triggerKeywords: ["пилосос", "робот-пилосос", "vacuum"],
      companions: ["мішок", "фільтр", "щітка", "запасн"],
    },
    {
      category: "кавоварка",
      triggerKeywords: ["кавоварка", "кавомашина", "coffee"],
      companions: ["фільтр", "чистяч", "капсул"],
    },
    {
      category: "принтер",
      triggerKeywords: ["принтер", "мфу", "printer"],
      companions: ["картридж", "тонер", "папір"],
    },
    {
      category: "дрон",
      triggerKeywords: ["дрон", "квадрокоптер", "dji", "drone"],
      companions: ["акумулятор", "пропелер", "карта пам'яті", "кейс"],
    },
    {
      category: "екшн-камера",
      triggerKeywords: ["gopro", "екшн-камера", "action cam"],
      companions: ["кріплення", "карта пам'яті", "кейс", "акумулятор"],
    },
    {
      category: "фотоапарат",
      triggerKeywords: ["фотоапарат", "камера", "дзеркал", "беззеркал", "canon", "nikon", "sony alpha"],
      companions: ["карта пам'яті", "чохол", "штатив", "акумулятор"],
    },
    {
      category: "робот-іграшка",
      triggerKeywords: ["конструктор", "lego", "лего"],
      companions: ["фігурк", "додаток"],
    },
  ],

   
   
  slangDictionary: {
    "пска": "PlayStation 5",
    "пску": "PlayStation 5",
    "пской": "PlayStation 5",
    "пске": "PlayStation 5",
    "пс5": "PlayStation 5",
    "пс 5": "PlayStation 5",
    "плойка": "PlayStation",
    "плойки": "PlayStation",
    "плейстейшн": "PlayStation",
    "иксбокс": "Xbox",
    "ексбокс": "Xbox",
    "макось": "MacBook",
    "мак": "MacBook",
    "ноут": "ноутбук",
    "ноуты": "ноутбук",
    "айфон": "iPhone",
    "айпад": "iPad",
    "самса": "Samsung",
    "санек": "Samsung",
    "ксяоми": "Xiaomi",
    "сяоми": "Xiaomi",
    "вотч": "Apple Watch",
    "эйрподсы": "AirPods",
    "аірподи": "AirPods",
    "самсунг": "Samsung",
    "редми": "Redmi",
    "галаксі": "Galaxy",
    "гелексі": "Galaxy",
    "епл": "Apple",
    "аппл": "Apple",
    "дайсон": "Dyson",
  },
};
