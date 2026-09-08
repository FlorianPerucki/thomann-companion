# Thomann Price Companion

Firefox extension that shows the Thomann price next to products on the page you are looking at. It is **off by default**. The toolbar button cycles through four states: **ON** (light green — this page only; a new page load turns it off), **KEEP** (green — stays on across reloads and links within the same site in that tab; Firefox asks once for access to that site, dropped again when you turn it off or leave the site), **ALWAYS** (dark green — every tab and every site until you turn it off, even after a browser restart; Firefox asks once for access to all sites), then **OFF**.

Supported sites with dedicated adapters: leboncoin.fr, ricardo.ch, anibis.ch. Any other page falls back to a generic adapter (JSON-LD product pages, or a card heuristic), plus a right-click "Search on Thomann" item for selected text.

**Extra pills (options, on by default), shown next to the product name:** `yt ↗` searches YouTube for the product name; `mg ↗` links straight to the ModularGrid module page when the search has exactly one hit (no tooltip), otherwise to the search page with the modules listed in the tooltip (grey when nothing matches; the search is retried without the brand, e.g. "Pico Output"). Hovering a result row for 300 ms shows the listing's photo to the left of the tooltip, to check it is the same product. On Thomann pages a green dot appears in front of a product name when at least one marketplace has a listing, and marketplace pills with no listing are greyed out; leboncoin listings marked "Achat en cours" are ignored (option).

**Reverse mode:** enable it on a Thomann page (search results, category list or product page) and each product gets one pill per marketplace — `lbc 3 · from 50 EUR`, `ric 1 · from 40 CHF`, `ani 0 ↗` — showing how many second-hand listings match and the cheapest one. Hover for the listings (title, price, place, age) with links and a **hide** button for false positives. Firefox asks once for access to the marketplaces when you first enable it on a Thomann page.

## Install for development

1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.
2. On first click of the toolbar button Firefox asks for access to the Thomann shop domain (MV3 host permissions are opt-in). You can also grant it from the options page.
3. Open a leboncoin search, click the toolbar button: badges appear next to prices.

Or, with Node installed: `npm install && npm start` (runs Firefox with the extension via `web-ext`).

## Options

`about:addons` → Thomann Price Companion → Preferences. Shop domain (thomannmusic.ch, thomannmusic.com/fr-ch, thomann.fr, thomann.de or custom — a host optionally followed by a locale path), cache lifetime, B-stock handling, skip words (titles containing them are never looked up; default `recherche`), extra stop words, match threshold, request pacing, cookie policy (off by default — requests are anonymous), clear cache / clear manual matches.

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

Reverse mode queries the marketplaces directly, without cookies: leboncoin's search page (`/recherche?text=…&category=30`) and anibis's (`/fr/q/?query=…`) embed their results as JSON in `__NEXT_DATA__`; ricardo's search page is server-rendered and parsed with the same card logic as the ricardo page adapter. The Thomann product name is the query; a listing counts only if every word of that name with 3+ characters appears in its title (model codes also accept their base form, A-140 ~ A-140-1); wanted ads are dropped. Each pill has its own hover panel. One request at a time per marketplace, ≥ 800 ms apart, cached 2 h.


The background script calls `https://<shop>/search_searchAjax.html?sw=<query>` with `credentials: "omit"`, which returns the same JSON the search page embeds (`articleListsSettings.articles[]` with model, price, availability, link). If that fails it falls back to parsing the HTML search page's `tho.bootstrapModule('search.index', …)` blob, then to a product page's JSON-LD. Results are cached in `storage.local` (24 h by default), requests are queued (2 parallel, ≥300 ms apart) and only cards near the viewport trigger lookups.
