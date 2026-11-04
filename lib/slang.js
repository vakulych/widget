const cfg = require("./feedConfig");

const dictEntries = Object.entries(cfg.slangDictionary).sort(
  (a, b) => b[0].length - a[0].length
);

function normalizeSlang(text) {
  let normalized = text;
  const matches = [];
  const lower = text.toLowerCase();

  for (const [slang, canonical] of dictEntries) {
    // межі слова, щоб не зачепити частину іншого слова
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${slang}([^\\p{L}\\p{N}]|$)`, "giu");
    if (re.test(lower)) {
      normalized = normalized.replace(re, (m, p1, p2) => `${p1}${canonical}${p2}`);
      matches.push({ from: slang, to: canonical });
    }
  }

  return { normalizedText: normalized, matches };
}

module.exports = { normalizeSlang };