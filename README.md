# Skay AI widget

Node.js API and embeddable chat widget for skay.ua.

## Deploy

Requires Node.js 18 or newer.

```bash
npm ci
cp .env.example .env
# Set GEMINI_API_KEY and ALLOWED_ORIGINS in .env
npm start
```

Before a release, run the catalog regression suite (it verifies exact models,
memory sizes, common Russian/Ukrainian wording, typos and accessory isolation
against the locally cached feed):

```bash
npm test
```

The service listens on `PORT` (3000 by default). Check it after launch:

```bash
curl http://127.0.0.1:3000/api/health
```

## Search

Search is hybrid by default. A deterministic catalogue layer first enforces
availability, model, price and numeric attributes; semantic vectors then
reorder that safe candidate set for natural requests such as “ноутбук для
навчання”. Keep the embedding setting enabled and provide the Gemini API key
to build the vector index after the first catalogue refresh. If it is
temporarily unavailable, search still uses the deterministic catalogue index.

Add the widget to the site before `</body>`:

```html
<script src="https://YOUR-DOMAIN/widget/widget.js"
        data-api-base="https://YOUR-DOMAIN"></script>
```

`FEED_URL` must point to the current product XML feed. The catalog and Gemini caches are generated automatically in `data/` and are intentionally excluded from version control.
