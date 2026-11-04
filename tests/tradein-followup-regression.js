const assert = require("assert");
const chatController = require("../lib/chatController");

async function ask(sessionId, message) {
  return chatController.handleMessage({
    sessionId,
    message,
    catalog: { products: [], categories: [] },
  });
}

async function run() {
  const sessionId = "tradein-followup-regression";

  await ask(sessionId, "у меня айфон 14 про макс хочу сдать его в трейд ин");
  await ask(sessionId, "128 GB");
  await ask(sessionId, "Є подряпини, скло ціле");
  await ask(sessionId, "Нижче 80%");
  const estimate = await ask(sessionId, "Є вм'ятини або сколи");
  assert.match(estimate.reply, /Орієнтовна ціна викупу/, "trade-in flow must produce an estimate");

  const priceConcern = await ask(sessionId, "а чего так дешево");
  assert.strictEqual(priceConcern.intent.source, "tradein-followup");
  assert.strictEqual(priceConcern.products.length, 0, "price concern must never trigger catalog cards");
  assert.match(priceConcern.reply, /батарея нижче 80%/i);

  const frustration = await ask(sessionId, "ты несешь какую то дичь");
  assert.strictEqual(frustration.intent.source, "tradein-followup");
  assert.strictEqual(frustration.products.length, 0, "frustration after trade-in must never trigger catalog cards");
  assert.match(frustration.reply, /неправильно зрозуміла контекст/i);
}

run()
  .then(() => console.log("Trade-in follow-up regression checks passed."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
