const assert = require("assert");
const chatController = require("../lib/chatController");

async function run() {
  const result = await chatController.handleMessage({
    sessionId: "operator-connect-regression",
    message: "Зʼєднай мене з оператором",
    catalog: { products: [], categories: [] },
  });

  assert.strictEqual(result.intent.source, "operator-connect");
  assert.deepStrictEqual(result.products, []);
  assert.match(result.reply, /оператор/iu);

  const opinion = await chatController.handleMessage({
    sessionId: "opinion-regression",
    message: "синий неплохой",
    catalog: { products: [], categories: [] },
  });
  assert.strictEqual(opinion.intent.source, "conversational-opinion");
  assert.deepStrictEqual(opinion.products, []);
  assert.match(opinion.reply, /попередньої добірки/iu);

  assert.strictEqual(chatController.isConversationalOpinion("синий неплохой"), true);
  assert.strictEqual(chatController.isConversationalOpinion("синий есть?"), false);
}

run()
  .then(() => console.log("Operator-connect regression check passed."))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
