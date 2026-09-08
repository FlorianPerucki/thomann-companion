# Thomann Price Companion

Firefox extension. On leboncoin, ricardo.ch and anibis.ch it shows the Thomann price next to each listing; on Thomann it shows the second-hand listings from those three sites next to each product. Off by default, enabled per tab with the toolbar button.

## Install (temporary, for development)

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.
2. Open a leboncoin search or a Thomann page and click the toolbar button. Firefox asks once for access to the sites the lookups need.
3. After each code change: **Reload** on the same page. The lookup cache is cleared on reload.

The temporary install disappears when Firefox quits. `npm install && npm test` runs the unit tests; `npm run build` produces a zip.

## Toolbar button

Each click moves to the next state: **OFF → ON** (light green, this page only) **→ ON** (green, kept on for this site in this tab, across reloads and links) **→ ON** (dark green, always on, every tab and site, survives restarts) **→ OFF**.

## Badges

- `t 127 CHF` — Thomann price (green: confident; amber `≈ 127 CHF?`: uncertain; dark green: cheaper than the listing; `B` = B-stock; `similar` = from Thomann's "similar searches"). Hover for the candidates and click **use** to fix a wrong match.
- `lbc 3 · from 50 EUR`, `ric …`, `ani …` — on Thomann pages: number of matching listings and the cheapest one; greyed when none. Hover for the listings, **hide** for a false positive. A green dot before the product name means at least one site has a listing.
- `yt ↗`, `mg ↗` — next to the product name: YouTube search, and ModularGrid (direct module page when the search has one hit, with its specs in the tooltip; otherwise the search page and the modules in the tooltip).
- `skipped` — the title contains a skip word (see below).

Hovering a result for 300 ms shows its photo.

## Preferences (`about:addons` → Thomann Price Companion → Preferences)

**Shop**
- *Thomann shop* / *Custom domain* — where prices come from (thomannmusic.ch by default; a host optionally followed by a locale path such as `www.thomannmusic.com/fr-ch`).
- *Language for thomannmusic.ch* — `fr-ch` (default), `en`, `en-ch` or none: links and searches then go through `thomannmusic.com/<locale>/`, same shop and CHF prices.

**Matching**
- *Hide B-stock offers* — off by default: the cheapest offer of the matched product wins, B-stock included.
- *Skip titles containing* — listings whose title contains one of these words are not looked up (default `recherche`, i.e. wanted ads).
- *Extra stop words* — removed from titles before searching (a built-in list already drops words like neuf, occasion, eurorack, b-stock).
- *Confident match threshold* — 0–1; lower shows more confident badges and more mistakes.
- *EUR → CHF rate* — enables the "cheaper on Thomann / cheaper second-hand" highlight across currencies; 0 disables it.

**Second-hand prices on Thomann pages**
- *leboncoin.fr / ricardo.ch / anibis.ch* — sources to query, with their access status.
- *Listing match threshold* — score below which a listing is not counted (every word of the product name with 3+ letters must be in the listing title in any case).
- *Cache lifetime for listings* — 2 h by default.
- *leboncoin category id* — 30 = Instruments de musique; empty = all.
- *ricardo / anibis language* — `fr`, `de`, `it` or `en`.
- *Send cookies to marketplaces* — off: requests are anonymous.
- *Retry with cookies when blocked* — on: if a site answers 403 to an anonymous request (leboncoin's DataDome), retry once with your browser's cookies for that site.
- *Ignore leboncoin listings marked "Achat en cours"* — on: items being sold are not counted.

**Extra links**
- *YouTube search link*, *ModularGrid link* — the `yt` / `mg` pills (on by default).

**Requests & cache**
- *Cache lifetime (hours)* — Thomann lookups, 24 h by default; 0 disables caching.
- *Parallel requests* / *Minimum spacing* — pacing of Thomann requests. Marketplaces are always one request at a time (ricardo 2 s apart, leboncoin 1 s, anibis 0.8 s) and back off when a site answers 429.
- *Send cookies to Thomann* — off: requests are anonymous.
- *Clear cache* / *Clear manual matches* / *Clear hidden listings*.

Defaults only apply to preferences you never saved; **Reset to defaults** then **Save** restores them.
