/* ricardo.ch adapter: search/category result cards and the article page. Prices are CHF without symbol ("749.00"). */
(function () {
  'use strict';
  const U = globalThis.__thcUtil;
  if (globalThis.__thcAdapters.some((a) => a.name === 'ricardo')) return;

  const NUM_RE = /^\s*\d{1,3}(?:['\s]?\d{3})*(?:[.,]\d{2}|\.–|\.-)?\s*(?:CHF)?\s*$/;
  const BUY_NOW_RE = /^(achat direct|sofortkauf|buy now|acquisto immediato)$/i;

  function fromCard(a) {
    const href = a.getAttribute('href') || '';
    const key = U.idFromHref(href, /-(\d{6,})\/?$/) || href;
    const img = a.querySelector('img[alt]');
    const title = ((img && img.alt) || (a.querySelector('span') && a.querySelector('span').textContent) || '').trim();
    if (!title) return null;
    const leaves = U.findPriceLeaves(a, NUM_RE);
    if (!leaves.length) return null;
    // Auctions show "<bid> (n enchères) <buy-now> Achat direct": prefer the price right before the buy-now label.
    let priceEl = leaves[0];
    const all = [...a.querySelectorAll('span, div')].filter((e) => !e.children.length);
    const buyIdx = all.findIndex((e) => BUY_NOW_RE.test(e.textContent.trim()));
    if (buyIdx > 0) {
      const before = all.slice(0, buyIdx).reverse().find((e) => NUM_RE.test(e.textContent.trim()));
      if (before) priceEl = before;
    }
    const price = U.parsePrice(priceEl.textContent);
    return { key: 'ric:' + key, title, priceEl, priceValue: price ? price.value : null, currency: 'CHF', mount: priceEl };
  }

  function fromArticlePage() {
    const h1 = document.querySelector('h1');
    if (!h1) return [];
    const key = U.idFromHref(location.pathname, /-(\d{6,})\/?$/) || location.pathname;
    const scope = h1.closest('main') || document.body;
    const priceEl = U.findPriceLeaves(scope, /^\s*(?:CHF\s*)?\d{1,3}(?:['\s]?\d{3})*(?:[.,]\d{2}|\.–)?\s*(?:CHF)?\s*$/).find(U.isVisible) || null;
    const price = priceEl ? U.parsePrice(priceEl.textContent) : null;
    return [{ key: 'ric:' + key, title: h1.textContent.trim(), priceEl, priceValue: price ? price.value : null, currency: 'CHF', mount: priceEl || h1 }];
  }

  globalThis.__thcAdapters.push({
    name: 'ricardo',
    matches: (loc) => /(^|\.)ricardo\.ch$/.test(loc.hostname),
    findProducts(root, opts) {
      if (!(opts && opts.listOnly) && /^\/[a-z]{2}\/a\//.test(location.pathname)) return fromArticlePage();
      const anchors = [...(root || document).querySelectorAll('a[href*="/a/"]')].filter((a) => /-\d{6,}\/?$/.test(a.getAttribute('href') || ''));
      const seen = new Set();
      const out = [];
      for (const a of anchors) {
        const href = a.getAttribute('href');
        if (seen.has(href)) continue;
        seen.add(href);
        const p = fromCard(a);
        if (p) out.push(p);
      }
      return out;
    }
  });
})();
