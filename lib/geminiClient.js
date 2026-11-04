const fs = require("fs");
const path = require("path");

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const CACHE_STATE_FILE = path.join(__dirname, "..", "data", "gemini-cache.json");
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;  
const CACHE_MIN_REFRESH_MARGIN_MS = 5 * 60 * 1000;  

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY не задано (перевірте .env)");
  return key;
}

function modelName() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Таймаут на КОЖЕН окремий HTTP-запит до Gemini. Без нього підвислий запит (мережа, збій API)
// тримав би клієнта нескінченно на "Опрацьовую ваш запит..." — сервер чекав би вічно.
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 20000;

async function fetchWithTimeout(url, options, timeoutMs = GEMINI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Gemini API timeout після ${timeoutMs}мс`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

 
 
function loadCacheState() {
  try {
    if (fs.existsSync(CACHE_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_STATE_FILE, "utf8"));
    }
  } catch (e) {
    console.warn("[gemini] не вдалось прочитати кеш-стан з диска:", e.message);
  }
  return {};
}

function saveCacheState(state) {
  try {
    fs.mkdirSync(path.dirname(CACHE_STATE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.warn("[gemini] не вдалось записати кеш-стан на диск:", e.message);
  }
}

 
const cacheState = loadCacheState();

 





async function ensureCachedContent(cacheKey, systemInstructionText, ttlSeconds = DEFAULT_TTL_SECONDS) {
  const entry = cacheState[cacheKey];
  const now = Date.now();

   
   
   
  if (entry && entry.disabledUntil && entry.disabledUntil > now) {
    return null;
  }

  const promptHash = simpleHash(systemInstructionText);
  if (entry && entry.name && entry.promptHash === promptHash && entry.expiresAt - now > CACHE_MIN_REFRESH_MARGIN_MS) {
    return entry.name;
  }

  try {
    const res = await fetchWithTimeout(`${API_BASE}/cachedContents?key=${apiKey()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${modelName()}`,
        systemInstruction: { role: "system", parts: [{ text: systemInstructionText }] },
        ttl: `${ttlSeconds}s`,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
       
       
       
       
      console.warn(`[gemini] не вдалось створити cachedContent(${cacheKey}): ${res.status} ${text.slice(0, 300)}`);
      cacheState[cacheKey] = { disabledUntil: now + 60 * 60 * 1000 };
      saveCacheState(cacheState);
      return null;
    }

    const data = await res.json();
    cacheState[cacheKey] = {
      name: data.name,
      promptHash,
      expiresAt: now + ttlSeconds * 1000,
    };
    saveCacheState(cacheState);
    console.log(`[gemini] Кеш системного промпту "${cacheKey}" створено: ${data.name} (TTL ${ttlSeconds}с)`);
    return data.name;
  } catch (err) {
    console.warn(`[gemini] помилка створення cachedContent(${cacheKey}):`, err.message);
    cacheState[cacheKey] = { disabledUntil: now + 10 * 60 * 1000 };
    saveCacheState(cacheState);
    return null;
  }
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return String(h);
}

 


function toGeminiContents(history, userText) {
  const contents = (history || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }],
  }));
  contents.push({ role: "user", parts: [{ text: userText }] });
  return contents;
}

 








async function chat({
  cacheKey,
  systemInstruction,
  history = [],
  userText,
  jsonMode = false,
  responseSchema = null,
  temperature = 0.4,
  maxTokens = 800,
  retries = 2,
}) {
  const cachedName = await ensureCachedContent(cacheKey, systemInstruction).catch(() => null);

  const generationConfig = {
    temperature,
    maxOutputTokens: maxTokens,
  };
  if (jsonMode) {
    generationConfig.responseMimeType = "application/json";
    if (responseSchema) generationConfig.responseSchema = responseSchema;
  }

  const body = {
    contents: toGeminiContents(history, userText),
    generationConfig,
  };
  if (cachedName) {
    body.cachedContent = cachedName;
  } else {
     
    body.systemInstruction = { role: "system", parts: [{ text: systemInstruction }] };
  }

  const url = `${API_BASE}/models/${modelName()}:generateContent?key=${apiKey()}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
         
         
         
        if (cachedName && (res.status === 400 || res.status === 404) && /cach/i.test(text)) {
          console.warn(`[gemini] cachedContent(${cacheKey}) недійсний, перестворюємо наступного разу`);
          delete cacheState[cacheKey];
          saveCacheState(cacheState);
          delete body.cachedContent;
          body.systemInstruction = { role: "system", parts: [{ text: systemInstruction }] };
          continue;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          lastErr = new Error(`Gemini API error ${res.status}: ${text}`);
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw new Error(`Gemini API error ${res.status}: ${text}`);
      }

      const data = await res.json();
      const candidate = data.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason === "SAFETY" || finishReason === "RECITATION") {
        console.warn(`[gemini] відповідь заблокована (${finishReason})`);
        return "";
      }
      const text = (candidate?.content?.parts || []).map((p) => p.text || "").join("");
      return text;
    } catch (err) {
      lastErr = err;
      // Таймаут не повторюємо: якщо Gemini вже 20с не відповідає, ще одна спроба
      // тільки додає клієнту чекання, а не підвищує шанс на успіх.
      const isTimeout = /timeout/i.test(err.message || "");
      if (!isTimeout && attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

module.exports = { chat };