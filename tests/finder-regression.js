const assert = require("assert");
const fs = require("fs");
const path = require("path");
const finder = require("../lib/productFinder");

const cachePath = path.join(__dirname, "..", "data", "catalog.cache.json");
if (!fs.existsSync(cachePath)) {
  throw new Error("Catalog cache is required for finder regression tests. Run a feed refresh first.");
}
const catalog = JSON.parse(fs.readFileSync(cachePath, "utf8"));

function found(query) {
  const result = finder.find(catalog, query);
  assert(result && result.picks.length, "Expected results for: " + query);
  return result;
}

// Purchase intent must not behave as another required product keyword.
const studyLaptop = found("ноутбук для навчання до 20000");
assert(studyLaptop.picks.every((p) => /ноутбук|laptop|macbook|chromebook/i.test(String(p.name) + " " + String(p.categoryName))));
assert(studyLaptop.picks.every((p) => p.price <= 20000));

// A device query must not turn into accessories merely because their title
// mentions the same brand/model.
const samsungPhone = found("смартфон Samsung до 10000");
assert(samsungPhone.picks.every((p) => /смартфон|телефон|iphone|galaxy|pixel|xiaomi|redmi|poco|oppo|oneplus/i.test(String(p.name) + " " + String(p.categoryName))));
assert(samsungPhone.picks.every((p) => !/чохо?л|чехо?л|заряд|кабел|підставк/i.test(p.name)));

// A request for a home appliance should not lead with an automotive variant.
const homeVacuum = found("пылесос для дома");
assert(homeVacuum.picks.every((p) => !/автомобільн|автомобильн|car\s/i.test(String(p.name) + " " + String(p.categoryName))));

// Human-written units are strict filters, not weak ranking hints.
const monitor144 = found("монітор 144 герц");
assert(monitor144.picks.every((p) => /144\s*(?:hz|гц|герц)/i.test(String(p.name) + " " + Object.values(p.params || {}).join(" "))));

// Model numbers and the Cyrillic spelling of iPhone must remain part of a
// product query, otherwise an iPhone 18 request can be replaced by iPhone 17.
for (const query of ["iPhone 18 Pro", "iPhone 18 Pro Max", "айфон 18 про", "айфон 18 про макс"]) {
  const result = found(query);
  assert(result.picks.length > 0, "Expected available iPhone 18 results for: " + query);
  assert(result.picks.every((p) => /iPhone 18 Pro(?: Max)?\b/i.test(p.name)), "Expected only iPhone 18 Pro models for: " + query);
  assert(result.picks.every((p) => p.available), "Expected only in-stock iPhone 18 models for: " + query);
}

console.log("Finder regression checks passed against " + catalog.products.length + " catalog products.");
