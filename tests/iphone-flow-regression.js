const assert = require("assert");
const fs = require("fs");
const path = require("path");
const chatController = require("../lib/chatController");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "catalog.cache.json"), "utf8"));

async function run() {
  const exact = await chatController.handleMessage({
    sessionId: "iphone-variants-regression",
    message: "є айфон 17 про макс?",
    catalog,
  });
  assert.strictEqual(exact.intent.source, "iphone-variants");
  assert(exact.products.length > 0, "known iPhone model must return its variants");
  assert(exact.products.every((p) => /iPhone 17 Pro Max/i.test(p.name)));
  assert.strictEqual(exact.filters.groups.length, 2, "storage and SIM controls must be present");

  const absent = await chatController.handleMessage({
    sessionId: "iphone-duo-regression",
    message: "а айфон дуо есть?",
    catalog,
  });
  assert.strictEqual(absent.intent.source, "iphone-exact-miss");
  assert.deepStrictEqual(absent.products, []);

  const tradeSession = "tradein-regression";
  const start = await chatController.handleMessage({ sessionId: tradeSession, message: "хочу сдать айфон в трейдин", catalog });
  assert.strictEqual(start.intent.source, "tradein-flow");
  const model = await chatController.handleMessage({ sessionId: tradeSession, message: "17 про макс", catalog });
  assert.strictEqual(model.intent.source, "tradein-flow");
  assert.match(model.reply, /пам'ять/i);
}

run()
  .then(() => console.log("iPhone flow regression checks passed."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
