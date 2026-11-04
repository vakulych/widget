require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const catalogService = require("./lib/catalogService");
const chatController = require("./lib/chatController");
const embeddings = require("./lib/embeddings");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "200kb" }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : true,
  })
);

app.use("/widget", express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  const c = catalogService.getCatalog();
  res.json({
    ok: true,
    productsLoaded: c.products.length,
    lastUpdated: c.lastUpdated,
    lastError: c.lastError,
     
     
     
     
    embeddings: embeddings.status(),
  });
});

const RATE_LIMIT_PER_IP_PER_MIN = Number(process.env.RATE_LIMIT_PER_IP_PER_MIN) || 15;
const RATE_LIMIT_PER_SESSION_PER_MIN = Number(process.env.RATE_LIMIT_PER_SESSION_PER_MIN) || 20;
const DAILY_GLOBAL_LIMIT = Number(process.env.DAILY_GLOBAL_LIMIT) || 8000;

const ipHits = new Map();  // ip -> [timestamps]
const sessionHits = new Map();  // sessionId -> [timestamps]
let dailyCount = 0;
let dailyResetAt = nextMidnightKyiv();

function nextMidnightKyiv() {
  const nowKyiv = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const midnightKyiv = new Date(nowKyiv);
  midnightKyiv.setHours(24, 0, 0, 0);
  return Date.now() + (midnightKyiv.getTime() - nowKyiv.getTime());
}

function withinWindow(map, key, windowMs, limit) {
  const now = Date.now();
  const hits = (map.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  map.set(key, hits);
  return hits.length <= limit;
}

// Періодично чистимо мапи, інакше вони теж ростимуть необмежено (як і сесії).
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, hits] of ipHits) {
    const fresh = hits.filter((t) => t > cutoff);
    if (fresh.length) ipHits.set(k, fresh);
    else ipHits.delete(k);
  }
  for (const [k, hits] of sessionHits) {
    const fresh = hits.filter((t) => t > cutoff);
    if (fresh.length) sessionHits.set(k, fresh);
    else sessionHits.delete(k);
  }
}, 5 * 60 * 1000).unref();

function chatRateLimiter(req, res, next) {
  const now = Date.now();
  if (now > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = now + 24 * 60 * 60 * 1000;
  }
  dailyCount++;
  if (dailyCount > DAILY_GLOBAL_LIMIT) {
    // Це основний запобіжник від несподіваного рахунку за Gemini — краще відмовити в чаті,
    // ніж мовчки спалити бюджет. Побачиш це в логах — варто підняти ALLOWED ORIGINS/ліміт
    // або перевірити, чи немає скрапера/накрутки.
    console.error(`[rate-limit] Досягнуто денний ліміт ${DAILY_GLOBAL_LIMIT} запитів до /api/chat.`);
    return res.status(503).json({ error: "Зараз завеликий потік запитів. Спробуйте, будь ласка, трохи пізніше." });
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (!withinWindow(ipHits, ip, 60 * 1000, RATE_LIMIT_PER_IP_PER_MIN)) {
    return res.status(429).json({ error: "Забагато повідомлень поспіль. Зачекайте хвилину і спробуйте ще раз." });
  }

  const sessionId = req.body && typeof req.body.sessionId === "string" ? req.body.sessionId : null;
  if (sessionId && !withinWindow(sessionHits, sessionId, 60 * 1000, RATE_LIMIT_PER_SESSION_PER_MIN)) {
    return res.status(429).json({ error: "Забагато повідомлень поспіль. Зачекайте хвилину і спробуйте ще раз." });
  }

  next();
}

app.post("/api/chat", chatRateLimiter, async (req, res) => {
  try {
    const { message, sessionId, categoryKey, categoryMode } = req.body || {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Порожнє повідомлення" });
    }
    const sid = sessionId && typeof sessionId === "string" ? sessionId : crypto.randomUUID();
    const catalog = catalogService.getCatalog();

    const result = await chatController.handleMessageSafe({
      sessionId: sid,
      message: message.trim().slice(0, 1000),
      catalog,
      // кнопки підкатегорій: ключ вузла дерева категорій і режим ("browse" | "direct")
      categoryKey: typeof categoryKey === "string" ? categoryKey.slice(0, 16) : null,
      categoryMode: categoryMode === "browse" || categoryMode === "direct" ? categoryMode : null,
    });

    res.json({ sessionId: sid, ...result });
  } catch (err) {
    console.error("[api/chat] error:", err);
    res.status(500).json({
      error: "Сталася помилка на сервері. Спробуйте ще раз або звʼяжіться з оператором.",
    });
  }
});

// Передача повної історії чату менеджерам у Telegram за кнопкою "Звʼязатися з оператором".
// ВАЖЛИВО: TELEGRAM_OPERATOR_BOT_TOKEN має бути ОКРЕМИМ ботом від того, що прив'язаний до
// Бітрікс24 Відкритих ліній. Використовується лише метод sendMessage (односторонньо, без
// webhook/getUpdates) — сам по собі він нічого не ламає, але якщо взяти той самий токен, що
// й у Бітрікс-бота, є два реальні ризики:
//  1) якщо якась бібліотека тут (або хтось пізніше) викличе setWebhook на цьому токені —
//     це миттєво знімає вебхук Бітрікса, і ліди з Telegram перестануть приходити.
//  2) якщо слати транскрипт у той самий чат/групу, куди Бітрікс слухає вхідні повідомлення,
//     відповіді менеджерів звідти можуть потрапляти в Бітрікс як повідомлення "від клієнта".
// Тому нижче — окремі змінні середовища, і в .env вони мають вказувати на СВІЙ бот.
const TELEGRAM_OPERATOR_BOT_TOKEN = process.env.TELEGRAM_OPERATOR_BOT_TOKEN || "";
const TELEGRAM_OPERATOR_CHAT_ID = process.env.TELEGRAM_OPERATOR_CHAT_ID || "";

function formatHandoffMessage({ sessionId, pageUrl, messages }) {
  const lines = [];
  lines.push(`🆘 Запит на оператора (сесія ${sessionId || "?"})`);
  if (pageUrl) lines.push(`Сторінка: ${pageUrl}`);
  lines.push("");
  const safeMessages = Array.isArray(messages) ? messages.slice(-40) : [];
  for (const m of safeMessages) {
    const who = m.role === "user" ? "Клієнт" : "Бот";
    const text = String(m.text || "").slice(0, 500);
    if (text) lines.push(`${who}: ${text}`);
  }
  return lines.join("\n").slice(0, 4000);
}

app.post("/api/handoff", async (req, res) => {
  if (!TELEGRAM_OPERATOR_BOT_TOKEN || !TELEGRAM_OPERATOR_CHAT_ID) {
    return res.status(503).json({ error: "Передача оператору не налаштована на сервері." });
  }
  try {
    const { sessionId, pageUrl, messages } = req.body || {};
    const text = formatHandoffMessage({ sessionId, pageUrl, messages });
    const tgRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_OPERATOR_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TELEGRAM_OPERATOR_CHAT_ID, text }),
      }
    );
    if (!tgRes.ok) {
      const errBody = await tgRes.text().catch(() => "");
      console.error("[api/handoff] Telegram API error:", tgRes.status, errBody);
      return res.status(502).json({ error: "Не вдалося передати оператору." });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[api/handoff] error:", err);
    res.status(500).json({ error: "Сталася помилка на сервері." });
  }
});

app.post("/api/feedback", (req, res) => {
  try {
    const { sessionId, vote, botReply, userMessage } = req.body || {};
    if (vote !== "up" && vote !== "down") {
      return res.status(400).json({ error: "Некоректна оцінка" });
    }
     
     
     
    console.log(
      `[feedback] ${vote === "up" ? "👍" : "👎"} session=${sessionId || "?"}\n  user: ${
        userMessage || "(?)"
      }\n  bot:  ${(botReply || "").slice(0, 300)}`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("[api/feedback] error:", err);
    res.status(500).json({ error: "Сталася помилка" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Skay AI widget server запущено на порту ${PORT}`);
  catalogService.start();
});