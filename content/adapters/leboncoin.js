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
    const titleEl = [...article.querySelectorAll('p, span, h2, h3, div')].find((e) => !e.children.length && e.textContent.trim() === title && e.getAttribute('aria-hidden') !== 'true') || null;
    return { key: 'lbc:' + key, title, titleEl, priceEl, priceValue: price ? price.value : null, currency: 'EUR', mount: priceEl || article.querySelector('[data-qa-id="aditem_container"]') || article };
  }

  // Ad page: the price appears in the main block (p.text-headline-1) and again in a sticky
  // header; both get a badge. Prices inside the "other ads" cards further down are excluded.
  function fromAdPage() {
    const h1 = document.querySelector('h1');
    if (!h1) return [];
    const id = U.idFromHref(location.pathname, /\/ad\/[^/]+\/(\d+)/) || location.pathname;
    const title = h1.textContent.trim();
    const scope = h1.closest('main') || document.body;
    const firstCard = scope.querySelector('article[aria-label]');
    const leaves = U.findPriceLeaves(scope, EURO_RE).filter((el) => !el.closest('article[aria-label]') && (!firstCard || (firstCard.compareDocumentPosition(el) & 2)));
    if (!leaves.length) return [{ key: 'lbc:' + id, title, titleEl: h1, priceEl: null, priceValue: null, currency: 'EUR', mount: h1 }];
    // The main price is the one that follows the h1 in document order (or the first one). 2/4 = DOCUMENT_POSITION_PRECEDING/FOLLOWING.
    const primary = leaves.find((el) => h1.compareDocumentPosition(el) & 4) || leaves[0];
    const value = U.parsePrice(primary.textContent);
    return leaves
      .filter((el) => { const p = U.parsePrice(el.textContent); return p && value && p.value === value.value; })
      .map((el, i) => ({ key: 'lbc:' + id + (el === primary ? '' : ':' + i), title, titleEl: el === primary ? h1 : null, priceEl: el, priceValue: value.value, currency: 'EUR', mount: el }));
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
