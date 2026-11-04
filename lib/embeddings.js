 

































const fs = require("fs");
const path = require("path");

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DATA_DIR = path.join(__dirname, "..", "data");
const META_FILE = path.join(DATA_DIR, "embeddings.meta.json");
const VEC_FILE = path.join(DATA_DIR, "embeddings.bin");

 
 
 
 
const DIM = parseInt(process.env.EMBEDDING_DIM || "256", 10);
const BATCH_SIZE = 100;  
const BATCH_DELAY_MS = parseInt(process.env.EMBEDDING_BATCH_DELAY_MS || "200", 10);
const DESC_MAX_CHARS = 400;

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY не задано (перевірте .env)");
  return key;
}

function modelName() {
  return process.env.EMBEDDING_MODEL || "gemini-embedding-001";
}

function enabled() {
  return (process.env.EMBEDDINGS_ENABLED || "true").toLowerCase() !== "false";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashText(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return String(h);
}

 
const vectors = new Map();
const hashes = new Map();  
let syncInProgress = false;
let lastSyncError = null;

function embeddingTextOf(product) {
  const paramsText = Object.entries(product.params || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  const desc = String(product.description || "").slice(0, DESC_MAX_CHARS);
  return [
    product.name,
    product.vendor ? `Бренд: ${product.vendor}` : "",
    product.categoryName ? `Категорія: ${product.categoryName}` : "",
    paramsText,
    desc,
  ]
    .filter(Boolean)
    .join(". ");
}

 
function loadFromDisk() {
  try {
    if (!fs.existsSync(META_FILE) || !fs.existsSync(VEC_FILE)) return;
    const meta = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
    if (meta.dim !== DIM || meta.model !== modelName()) {
       
       
       
      console.warn(
        `[embeddings] Кеш на диску під іншу модель/розмірність (${meta.model}/${meta.dim} vs ${modelName()}/${DIM}) — ігноруємо, почнемо перебудову.`
      );
      return;
    }
    const buf = fs.readFileSync(VEC_FILE);
    const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    meta.items.forEach((item, i) => {
      vectors.set(item.id, floats.slice(i * DIM, (i + 1) * DIM));
      hashes.set(item.id, item.hash);
    });
    console.log(`[embeddings] Завантажено з диска: ${vectors.size} векторів (dim=${DIM}, модель ${meta.model}).`);
  } catch (e) {
    console.warn("[embeddings] не вдалось прочитати кеш ембеддингів з диска:", e.message);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistToDisk();
  }, 3000);
}

function persistToDisk() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const items = [];
    const buf = Buffer.alloc(vectors.size * DIM * 4);
    let i = 0;
    for (const [id, vec] of vectors.entries()) {
      items.push({ id, hash: hashes.get(id) });
      Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).copy(buf, i * DIM * 4);
      i += 1;
    }
    fs.writeFileSync(VEC_FILE, buf);
    fs.writeFileSync(META_FILE, JSON.stringify({ dim: DIM, model: modelName(), items }));
  } catch (e) {
    console.warn("[embeddings] не вдалось зберегти кеш ембеддингів на диск:", e.message);
  }
}

 
async function postWithRetry(url, body, { retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          lastErr = new Error(`Gemini embed API ${res.status}: ${text.slice(0, 200)}`);
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw new Error(`Gemini embed API ${res.status}: ${text.slice(0, 300)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

async function embedBatch(texts, taskType) {
  const model = modelName();
  const body = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: DIM,
    })),
  };
  const data = await postWithRetry(`${API_BASE}/models/${model}:batchEmbedContents?key=${apiKey()}`, body);
  return (data.embeddings || []).map((e) => Float32Array.from(e.values || []));
}

 




async function embedQuery(text) {
  if (!enabled() || !process.env.GEMINI_API_KEY || !text || !text.trim()) return null;
  try {
    const model = modelName();
    const body = {
      model: `models/${model}`,
      content: { parts: [{ text: text.trim() }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: DIM,
    };
    const data = await postWithRetry(`${API_BASE}/models/${model}:embedContent?key=${apiKey()}`, body, {
      retries: 1,
    });
    const values = data.embedding && data.embedding.values;
    return values ? Float32Array.from(values) : null;
  } catch (err) {
    console.warn("[embeddings] embedQuery помилка (працюємо без вектору цього запиту):", err.message);
    return null;
  }
}

function cosineSim(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

 







function scoreAgainst(queryVector, products) {
  const scores = new Map();
  if (!queryVector) return scores;
  for (const p of products) {
    const vec = vectors.get(p.id);
    if (!vec) continue;
    const sim = cosineSim(queryVector, vec);
    if (sim > 0) scores.set(p.id, sim);
  }
  return scores;
}

function isReady() {
  return vectors.size > 0;
}

function status() {
  return {
    ready: isReady(),
    count: vectors.size,
    dim: DIM,
    model: modelName(),
    syncInProgress,
    lastSyncError,
  };
}

 






async function syncIndex(products) {
  if (!enabled() || !process.env.GEMINI_API_KEY) return;
  if (syncInProgress) return;  
  syncInProgress = true;
  lastSyncError = null;
  try {
    const currentIds = new Set(products.map((p) => p.id));

     
    for (const id of [...vectors.keys()]) {
      if (!currentIds.has(id)) {
        vectors.delete(id);
        hashes.delete(id);
      }
    }

    const toEmbed = [];
    for (const p of products) {
      const text = embeddingTextOf(p);
      const hash = hashText(text);
      if (hashes.get(p.id) !== hash) {
        toEmbed.push({ id: p.id, text, hash });
      }
    }

    if (!toEmbed.length) {
      scheduleSave();
      return;
    }

    console.log(`[embeddings] Синхронізація: ${toEmbed.length} товар(ів) потребують (пере)ембеддингу з ${products.length}.`);

    let done = 0;
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const chunk = toEmbed.slice(i, i + BATCH_SIZE);
      try {
        const embedded = await embedBatch(chunk.map((c) => c.text), "RETRIEVAL_DOCUMENT");
        chunk.forEach((c, idx) => {
          if (embedded[idx] && embedded[idx].length) {
            vectors.set(c.id, embedded[idx]);
            hashes.set(c.id, c.hash);
          }
        });
      } catch (err) {
        console.warn(
          `[embeddings] batch ${i}-${i + chunk.length} не вдався, пропускаємо (спробуємо наступної синхронізації):`,
          err.message
        );
        lastSyncError = err.message;
      }
      done += chunk.length;
      if (done % (BATCH_SIZE * 10) === 0 || done === toEmbed.length) {
        console.log(`[embeddings] ...ембеддинг ${done}/${toEmbed.length}`);
        scheduleSave();  
      }
      await sleep(BATCH_DELAY_MS);
    }

    scheduleSave();
    console.log(`[embeddings] Синхронізацію завершено. У індексі ${vectors.size} векторів.`);
  } catch (err) {
    lastSyncError = err.message;
    console.error("[embeddings] помилка синхронізації індексу:", err.message);
  } finally {
    syncInProgress = false;
  }
}

loadFromDisk();

module.exports = {
  syncIndex,
  isReady,
  embedQuery,
  scoreAgainst,
  status,
  cosineSim,
};
