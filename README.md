# Thomann Price Companion

Firefox extension that shows the Thomann price next to products on the page you are looking at. It is **off by default**: click the toolbar button to enable it on the current tab, click again to disable. A real navigation (new page load) turns it off again.

Supported sites with dedicated adapters: leboncoin.fr, ricardo.ch, anibis.ch. Any other page falls back to a generic adapter (JSON-LD product pages, or a card heuristic), plus a right-click "Search on Thomann" item for selected text.

## Install for development

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.
2. On first click of the toolbar button Firefox asks for access to the Thomann shop domain (MV3 host permissions are opt-in). You can also grant it from the options page.
3. Open a leboncoin search, click the toolbar button: badges appear next to prices.

Or, with Node installed: `npm install && npm start` (runs Firefox with the extension via `web-ext`).

## Options

`about:addons` → Thomann Price Companion → Preferences. Shop domain (thomannmusic.ch / thomann.fr / thomann.de or custom), cache lifetime, B-stock handling, extra stop words, match threshold, request pacing, cookie policy (off by default — requests are anonymous), clear cache / clear manual matches.

## Badge states

- `t 127 CHF` green: confident match. Dark green: cheaper than the listing (same currency, or via the EUR→CHF rate in options).
- `t ≈ 127 CHF?` amber: uncertain — hover to see alternatives and click **use** to remember the right one.
- `t no match ↗` / `t error ↗`: links to the Thomann search page instead.
- Tags: `B` = B-stock, `⏳` = not in stock. Matching identifies the *product*; among that product's offers (new and B-stock, linked via Thomann's `aStockArticleId`) the cheapest one is shown, and the hover panel lists the others.

Hover any badge for the query used, the top 5 candidates with scores, a **refresh** button (bypasses the cache) and a search link.

## Development

```
npm test          # unit tests (matcher, Thomann client, adapters via jsdom)
npm run lint      # web-ext lint
npm run build     # zip into web-ext-artifacts/
```

Layout: `background/` (Thomann client, matcher, message router), `content/` (adapters + badge rendering), `options/`, `test/`.

## How lookups work

The background script calls `https://<shop>/search_searchAjax.html?sw=<query>` with `credentials: "omit"`, which returns the same JSON the search page embeds (`articleListsSettings.articles[]` with model, price, availability, link). If that fails it falls back to parsing the HTML search page's `tho.bootstrapModule('search.index', …)` blob, then to a product page's JSON-LD. Results are cached in `storage.local` (24 h by default), requests are queued (2 parallel, ≥300 ms apart) and only cards near the viewport trigger lookups.
