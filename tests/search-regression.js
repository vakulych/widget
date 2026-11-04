const assert = require("assert");
const fs = require("fs");
const path = require("path");
const search = require("../lib/search");

const cachePath = path.join(__dirname, "..", "data", "catalog.cache.json");
if (!fs.existsSync(cachePath)) {
  throw new Error("Catalog cache is required for search regression tests. Run a feed refresh first.");
}
const { products } = JSON.parse(fs.readFileSync(cachePath, "utf8"));

function allSpecific(query, options = {}) {
  const result = search.findSpecificProduct(products, { queryText: query, ...options });
  return [...result.exact, ...result.unavailable];
}

assert.deepStrictEqual(search.tokens("iPhone 16 Pro Max 256GB"), ["iphone", "16", "pro", "max", "256", "gb"]);
assert.strictEqual(search.extractStorage("iPhone 16 Pro Max 256GB"), 256);
assert.strictEqual(search.extractStorage("Samsung 1TB"), 1024);

const iphone256 = allSpecific("айфон 16 про макс 256 гб");
assert(iphone256.length > 0, "An exact iPhone + capacity request must return catalog matches");
assert(iphone256.every((p) => /iphone 16 pro max/i.test(p.name) && /256\s*gb/i.test(p.name)));

const airpods = allSpecific("airpods pro 2");
assert(airpods.length > 0, "AirPods model must be searchable");
assert(airpods.every((p) => !/амбушюр/i.test(p.name)), "Ear-tips must not outrank the requested headphones");

const ps5 = allSpecific("ps5");
assert(ps5.length > 0, "PS5 must be searchable");
assert(ps5.every((p) => !/кермо|руль|геймпад|контролер/i.test(p.name)), "Gaming peripherals must not be returned as consoles");

const russianVacuum = allSpecific("пылесос");
assert(russianVacuum.length > 0, "Common Russian spelling must resolve to Ukrainian catalog titles");
assert(russianVacuum.every((p) => /пилосос/i.test(p.name)));

const techwoven = search.findAccessoryLoose(products, "чехол техвовен", { limit: 8 });
assert(techwoven.length > 0, "Phonetic Cyrillic TechWoven request must return cases");
assert(techwoven.every((p) => /techwoven/i.test(p.name)), "TechWoven search must not mix in unrelated cases");
const techwovenAfterBadRewrite = search.findAccessoryLoose(products, "Technowow техвовен чехол", { limit: 8 });
assert(techwovenAfterBadRewrite.length > 0, "An LLM spelling mistake must not erase the customer's original catalog term");
assert(techwovenAfterBadRewrite.every((p) => /techwoven/i.test(p.name)));

const finewoven = search.findAccessoryLoose(products, "чехол файнвовен", { limit: 8 });
assert(finewoven.length > 0, "Catalog-driven phonetic matching must work beyond one named product");
assert(finewoven.every((p) => /finewoven/i.test(p.name)), "FineWoven search must not mix in unrelated cases");

const partialModel = allSpecific("iphonee 16 pro max");
assert(partialModel.length > 0, "A minor model typo must keep an otherwise exact request searchable");

console.log(`Search regression checks passed against ${products.length} catalog products.`);
