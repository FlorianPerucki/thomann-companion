/* leboncoin.fr adapter: search results, category pages, seller pages and the single-ad page. */
(function () {
  'use strict';
  const U = globalThis.__thcUtil;
  if (globalThis.__thcAdapters.some((a) => a.name === 'leboncoin')) return;

  const EURO_RE = /^\s*\d[\d\s  .]*\s*€/;

  function fromCard(article) {
    const link = article.querySelector('a[href*="/ad/"]');
    const key = U.idFromHref(link && link.getAttribute('href'), /\/ad\/[^/]+\/(\d+)/) || null;
    const title = (article.getAttribute('aria-label') || '').trim();
    if (!title || !key) return null;
    const priceEl = U.findPriceLeaves(article, EURO_RE)[0] || null;
    const price = priceEl ? U.parsePrice(priceEl.textContent) : null;
    return { key: 'lbc:' + key, title, priceEl, priceValue: price ? price.value : null, currency: 'EUR', mount: priceEl || article.querySelector('[data-qa-id="aditem_container"]') || article };
  }

  function fromAdPage() {
    const h1 = document.querySelector('h1');
    if (!h1) return [];
    const key = U.idFromHref(location.pathname, /\/ad\/[^/]+\/(\d+)/) || location.pathname;
    const scope = h1.closest('main') || document.body;
    const priceEl = U.findPriceLeaves(scope, EURO_RE).find((el) => U.isVisible(el)) || null;
    const price = priceEl ? U.parsePrice(priceEl.textContent) : null;
    return [{ key: 'lbc:' + key, title: h1.textContent.trim(), priceEl, priceValue: price ? price.value : null, currency: 'EUR', mount: priceEl || h1 }];
  }

  globalThis.__thcAdapters.push({
    name: 'leboncoin',
    matches: (loc) => /(^|\.)leboncoin\.fr$/.test(loc.hostname),
    findProducts(root) {
      if (/^\/ad\//.test(location.pathname)) return fromAdPage();
      const cards = [...(root || document).querySelectorAll('article[aria-label]')]
        .filter((a) => a.querySelector('[data-qa-id="aditem_container"], a[href*="/ad/"]'));
      return cards.map(fromCard).filter(Boolean);
    }
  });
})();
