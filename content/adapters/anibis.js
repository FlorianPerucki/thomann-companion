/* anibis.ch adapter: search result cards ([data-private-srp-listing-item-id]) and the ad page (/xx/vi/...). Prices are CHF like "45.-". */
(function () {
  'use strict';
  const U = globalThis.__thcUtil;
  if (globalThis.__thcAdapters.some((a) => a.name === 'anibis')) return;

  const CHF_RE = /^\s*(?:CHF\s*)?\d{1,3}(?:['\s]?\d{3})*(?:[.,]\d{2}|\.[-–])?\s*(?:CHF)?\s*$/;

  function titleOf(card) {
    const img = card.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    const links = [...card.querySelectorAll('a[href*="/vi/"]')].map((a) => a.textContent.trim()).filter((t) => t.length > 3);
    return links[0] || '';
  }

  function fromCard(card) {
    const id = card.getAttribute('data-private-srp-listing-item-id') || card.getAttribute('data-srp-listing-item-id');
    const link = card.querySelector('a[href*="/vi/"]');
    const key = id || U.idFromHref(link && link.getAttribute('href'), /(\d{6,})\/?$/) || (link && link.getAttribute('href'));
    const title = titleOf(card);
    if (!title || !key) return null;
    const priceEl = U.findPriceLeaves(card, CHF_RE)[0] || null;
    const price = priceEl ? U.parsePrice(priceEl.textContent) : null;
    return { key: 'ani:' + key, title, priceEl, priceValue: price ? price.value : null, currency: 'CHF', mount: priceEl || card };
  }

  function fromAdPage() {
    const h1 = document.querySelector('h1');
    if (!h1) return [];
    const key = U.idFromHref(location.pathname, /(\d{6,})\/?$/) || location.pathname;
    const scope = h1.closest('main') || document.body;
    const priceEl = U.findPriceLeaves(scope, CHF_RE).find(U.isVisible) || null;
    const price = priceEl ? U.parsePrice(priceEl.textContent) : null;
    return [{ key: 'ani:' + key, title: h1.textContent.trim(), priceEl, priceValue: price ? price.value : null, currency: 'CHF', mount: priceEl || h1 }];
  }

  globalThis.__thcAdapters.push({
    name: 'anibis',
    matches: (loc) => /(^|\.)anibis\.ch$/.test(loc.hostname),
    findProducts(root) {
      if (/^\/[a-z]{2}\/vi\//.test(location.pathname)) return fromAdPage();
      const cards = [...(root || document).querySelectorAll('[data-private-srp-listing-item-id], [data-srp-listing-item-id]')];
      return cards.map(fromCard).filter(Boolean);
    }
  });
})();
