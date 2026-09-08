/*
 * Second-hand marketplace providers (reverse mode: Thomann page -> listings elsewhere).
 * Each provider: { id, label, currency, searchUrl(q, cfg), parse(text, cfg) -> listings[] }.
 * Listing: { id, source, title, body?, price, currency, url, place, date, wanted }.
 * Fetches never send cookies. Parsing is pure so it can be unit-tested with fixtures.
 */
(function (root) {
  'use strict';

  function nextData(html) {
    const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
  }

  function parsePriceText(text) {
    const U = root.__thcUtil;
    return U ? U.parsePrice(text) : null;
  }

  // ---------- leboncoin.fr ----------
  const leboncoin = {
    id: 'leboncoin',
    label: 'lbc',
    currency: 'EUR',
    origin: 'https://www.leboncoin.fr',
    searchUrl(q, cfg) {
      const cat = cfg && cfg.lbcCategory ? '&category=' + encodeURIComponent(cfg.lbcCategory) : '';
      return 'https://www.leboncoin.fr/recherche?text=' + encodeURIComponent(q) + cat;
    },
    parse(html) {
      const j = nextData(html);
      const ads = j && j.props && j.props.pageProps && j.props.pageProps.searchData && j.props.pageProps.searchData.ads;
      if (!Array.isArray(ads)) return null;
      // "Achat en cours" (a sale is being finalized) is only visible in the rendered cards.
      const inProgress = new Set();
      if (typeof DOMParser !== 'undefined') {
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          for (const card of doc.querySelectorAll('article[aria-label]')) {
            if (!/achat en cours/i.test(card.textContent)) continue;
            const a = card.querySelector('a[href*="/ad/"]');
            const m = a && /\/ad\/[^/]+\/(\d+)/.exec(a.getAttribute('href') || '');
            if (m) inProgress.add(m[1]);
          }
        } catch (e) { /* ignore */ }
      }
      return ads.map((a) => ({
        unavailable: inProgress.has(String(a.list_id)),
        id: String(a.list_id),
        source: 'leboncoin',
        title: a.subject || '',
        body: a.body || '',
        price: a.price_cents != null ? a.price_cents / 100 : (Array.isArray(a.price) ? a.price[0] : null),
        currency: 'EUR',
        url: a.url || ('https://www.leboncoin.fr/ad/x/' + a.list_id),
        place: a.location && (a.location.city || a.location.department_name) || '',
        date: a.first_publication_date || a.index_date || null,
        image: a.images && (a.images.small_url || a.images.thumb_url || (Array.isArray(a.images.urls) && a.images.urls[0])) || null,
        wanted: a.ad_type === 'demand'
      }));
    }
  };

  // ---------- ricardo.ch (server-rendered cards, parsed with the content adapter) ----------
  const ricardo = {
    id: 'ricardo',
    label: 'ricardo',
    currency: 'CHF',
    origin: 'https://www.ricardo.ch',
    searchUrl(q, cfg) {
      const lang = (cfg && cfg.marketLang) || 'fr';
      return 'https://www.ricardo.ch/' + lang + '/s/' + encodeURIComponent(q) + '/';
    },
    parse(html) {
      const adapter = (root.__thcAdapters || []).find((a) => a.name === 'ricardo');
      if (!adapter || typeof DOMParser === 'undefined') return null;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let products;
      try { products = adapter.findProducts(doc, { listOnly: true }); } catch (e) { return null; }
      return products.map((p) => {
        const a = p.mount && p.mount.closest ? p.mount.closest('a[href]') : null;
        const href = a ? a.getAttribute('href') : '';
        return {
          id: p.key.replace(/^ric:/, ''),
          source: 'ricardo',
          title: p.title,
          body: '',
          price: p.priceValue,
          currency: 'CHF',
          url: href && /^https?:/.test(href) ? href : 'https://www.ricardo.ch' + href,
          place: '',
          date: null,
          image: p.image || null,
          wanted: false
        };
      });
    }
  };

  // ---------- anibis.ch ----------
  function findListings(o, depth) {
    if (!o || typeof o !== 'object' || depth > 8) return null;
    if (o.listings && Array.isArray(o.listings.edges)) return o.listings;
    for (const k of Object.keys(o)) {
      const f = findListings(o[k], depth + 1);
      if (f) return f;
    }
    return null;
  }

  const anibis = {
    id: 'anibis',
    label: 'anibis',
    currency: 'CHF',
    origin: 'https://www.anibis.ch',
    searchUrl(q, cfg) {
      const lang = (cfg && cfg.marketLang) || 'fr';
      return 'https://www.anibis.ch/' + lang + '/q/?query=' + encodeURIComponent(q);
    },
    parse(html, cfg) {
      const j = nextData(html);
      const listings = j && findListings(j.props && j.props.pageProps, 0);
      if (!listings) return null;
      const lang = (cfg && cfg.marketLang) || 'fr';
      return listings.edges.map((e) => e.node).filter(Boolean).map((n) => {
        const p = parsePriceText(n.formattedPrice || '');
        const pc = n.postcodeInformation || {};
        return {
          id: String(n.listingID),
          source: 'anibis',
          title: (n.localization && n.localization.title) || '',
          body: (n.localization && n.localization.body) || '',
          price: p ? p.value : null,
          currency: 'CHF',
          url: 'https://www.anibis.ch/' + lang + '/vi/' + n.listingID,
          place: pc.locationName || pc.city || pc.name || (pc.postcode ? String(pc.postcode) : ''),
          date: n.timestamp || null,
          image: (n.thumbnail && ((n.thumbnail.normalRendition && n.thumbnail.normalRendition.src) || n.thumbnail.src || (typeof n.thumbnail === 'string' ? n.thumbnail : null))) || null,
          wanted: /^(cherche|recherche|suche|gesucht|cerco)\b/i.test((n.localization && n.localization.title) || '')
        };
      });
    }
  };

  const PROVIDERS = { leboncoin, ricardo, anibis };

  /**
   * Fetch + parse one marketplace. `fetchFn(url, init)`.
   * @returns {Promise<listing[]>} throws on HTTP/parse failure
   */
  async function fetchListings(provider, query, cfg, fetchFn) {
    const url = provider.searchUrl(query, cfg);
    const init = (credentials) => ({
      credentials,
      redirect: 'follow',
      headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': ((cfg && cfg.marketLang) || 'fr') + ',en;q=0.7' }
    });
    let res = await fetchFn(url, init(cfg && cfg.allowMarketCookies ? 'include' : 'omit'));
    // Anti-bot systems (DataDome on leboncoin) sometimes reject anonymous requests but accept
    // the browser's own cookies, which carry the clearance obtained while browsing the site.
    if ((res.status === 403 || res.status === 401) && !(cfg && cfg.allowMarketCookies) && (cfg == null || cfg.marketCookieFallback !== false)) {
      res = await fetchFn(url, init('include'));
      res.usedCookies = true;
    }
    if (res.status === 429 || res.status >= 500) { const e = new Error('HTTP ' + res.status); e.retryable = true; throw e; }
    if (res.status === 403) throw new Error('HTTP 403 — blocked by the site\'s anti-bot protection; open ' + provider.origin + ' in a tab once, then refresh');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const listings = provider.parse(text, cfg);
    if (!listings) {
      if (/datadome|captcha-delivery|cf-chl|turnstile/i.test(text)) throw new Error('blocked by anti-bot challenge; open ' + provider.origin + ' in a tab once, then refresh');
      throw new Error('unrecognized response');
    }
    if (res.usedCookies) listings.usedCookies = true;
    return listings;
  }

  const api = { PROVIDERS, fetchListings, nextData };
  root.ThomannMarketplaces = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
