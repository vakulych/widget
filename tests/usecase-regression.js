const assert = require("assert");
const path = require("path");
const uc = require("../lib/useCase");

const { products } = require(path.join(__dirname, "..", "data", "catalog.cache.json"));

// 1. Розпізнавання призначення — лише в ноутбучному контексті
assert.strictEqual(uc.detect("посоветуй ноут для учебы до 25к"), "study");
assert.strictEqual(uc.detect("ноут для игр до 30к"), "gaming");
assert.strictEqual(uc.detect("ноутбук для монтажа"), "creative");
assert.strictEqual(uc.detect("игры"), null, "«игры» без ноутбука — не призначення (це консолі/ігри)");
assert.strictEqual(uc.detect("ps5 игры"), null);

// 2. Слова призначення прибираються з пошуку
assert.strictEqual(uc.stripPurpose("посоветуй ноут для учебы до 25к"), "ноут до 25к");
assert.strictEqual(uc.stripPurpose("ноутбук для игр до 30000"), "ноутбук до 30000");

// 3. Аксесуари до ноутбуків не вважаються ноутбуками
const laptops = products.filter(uc.isLaptop);
assert(laptops.length > 100, "laptops must be detected in the catalogue");
assert(laptops.every((p) => !/чохол|чехол|сумк|рюкзак/i.test(p.name)));

// 4. Характеристики: CPU береться з параметра, а не з артикулу в назві
const lenovo = products.find((p) => /Lenovo Gaming 3/.test(p.name) && p.available);
if (lenovo) assert.notStrictEqual(uc.specsOf(lenovo).cpuTier, 1, "Ryzen 5 must not be read as a weak CPU");

// 5. Ігри: лише з дискретною відеокартою, коли такі є
const inStock30k = laptops.filter((p) => p.available && p.price <= 30000);
const gaming = uc.applyFit({ kind: "gaming", r: { items: inStock30k }, catalog: { products }, maxBudget: 30000 });
if (!gaming.relaxed) {
  assert(gaming.picks.every((p) => uc.specsOf(p).gpuTier >= 2), "gaming picks must have a discrete GPU");
}
assert(gaming.picks.every((p) => !/chromebook/i.test(p.name)), "Chromebook (integrated GPU) is never a gaming pick");

// 6. Навчання: немає ноутбуків з ОЗП < 8 ГБ серед рекомендацій, коли є інші
const study = uc.applyFit({ kind: "study", r: { items: inStock30k }, catalog: { products }, maxBudget: 30000 });
assert(study.picks.every((p) => uc.specsOf(p).ram == null || uc.specsOf(p).ram >= 8));

// 7. Текст відповіді: без дубля «для для», без службових приміток про нерозпізнані слова
for (const r of [gaming, study]) {
  assert(!/для\s+для/i.test(r.reply), "no duplicated preposition: " + r.reply);
  assert(!/не розпізнав/i.test(r.reply));
  assert(r.reply.length < 400, "reply must stay short");
}

// 8. Каталог не мутує: картки отримують копії з _fit/_why, а не змінюють спільні об'єкти
assert(inStock30k.every((p) => p._fit === undefined && p._why === undefined), "catalog objects must not be mutated");

// 9. Сортування для дерева категорій не губить товари і не чіпає не-ноутбуки
const mixed = [...inStock30k.slice(0, 5), products.find((p) => /Чохол/.test(p.name))];
const sorted = uc.sortByFit(mixed, "gaming");
assert.strictEqual(sorted.length, mixed.length);
assert.strictEqual(sorted[sorted.length - 1], mixed[mixed.length - 1], "non-laptops keep their position");

console.log(`Use-case regression checks passed against ${products.length} catalog products.`);