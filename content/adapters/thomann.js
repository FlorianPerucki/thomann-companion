/* Thomann shop adapter (reverse mode): product lists (search, categories) and the product page.
 * Looks up the enabled second-hand marketplaces instead of Thomann. */
(function () {
  'use strict';
  const U = globalThis.__thcUtil;
  if (globalThis.__thcAdapters.some((a) => a.name === 'thomann')) return;

  const SOURCES = ['leboncoin', 'ricardo', 'anibis'];

  function fromEntry(el) {
    const id = el.getAttribute('data-product-id') || el.id;
    const man = el.querySelector('.title__manufacturer');
    const name = el.querySelector('.title__name');
    const title = ((man ? man.textContent : '') + ' ' + (name ? name.textContent : '')).replace(/\s+/g, ' ').trim()
      || (el.querySelector('img[alt]') || {}).alt || '';
    if (!title || !id) return null;
    const priceEl = el.querySelector('.product__price-primary, .fx-price-group__primary') || null;
    const price = priceEl ? U.parsePrice(priceEl.textContent) : null; // empty until Thomann's JS fills it
    const titleEl = el.querySelector('.product__title') || null;
    return { key: 'tho:' + id, title, brand: man ? man.textContent.trim() : '', titleEl, priceEl, priceValue: price ? price.value : null, currency: price && price.currency || 'CHF', mount: priceEl || titleEl || el };
  }

  function fromProductPage() {
    const h1 = document.querySelector('h1');
    if (!h1) return [];
    const title = h1.textContent.replace(/\s+/g, ' ').trim();
    // Thomann renders the price several times (a hidden meta block, the visible details block,
    // and recommendation boxes further down): take the first visible one outside product boxes.
    const candidates = [...document.querySelectorAll('.details__price .fx-price-group__primary, .price-and-availability .fx-price-group__primary, .fx-price-group__primary')]
      .filter((el) => !el.closest('.fx-product-box, .fx-product-list-entry, .js-product'));
    const priceEl = candidates.find((el) => U.isVisible(el) && (!el.ownerDocument.defaultView || el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden')) || candidates[0] || null;
    const price = priceEl ? U.parsePrice(priceEl.textContent) : null;
    const key = 'tho:' + location.pathname.replace(/\.htm.*$/, '');
    return [{ key, title, titleEl: h1, priceEl, priceValue: price ? price.value : null, currency: price && price.currency || 'CHF', mount: priceEl || h1 }];
  }

  globalThis.__thcAdapters.push({
    name: 'thomann',
    sources: SOURCES,
    matches: (loc) => /(^|\.)(thomann\.[a-z]{2,3}|thomannmusic\.(ch|com))$/.test(loc.hostname),
    findProducts(root) {
      const entries = [...(root || document).querySelectorAll('.fx-product-list-entry')];
      if (entries.length) return entries.map(fromEntry).filter(Boolean);
      if (/\.htm(\?|$)/.test(location.pathname) && document.querySelector('.price-and-availability, .details__price, .fx-price-group__primary')) return fromProductPage();
      return [];
    }
  });
})();
