async function searchWeb(query) {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`,
      {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.web && data.web.results) || [];
    return results
      .slice(0, 3)
      .map((r) => `${r.title}: ${r.description || ""}`)
      .join("\n");
  } catch (err) {
    console.warn("[webSearch] помилка пошуку:", err.message);
    return null;
  }
}

module.exports = { searchWeb };
