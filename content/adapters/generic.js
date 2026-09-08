/* Generic fallback adapter: JSON-LD / OpenGraph product pages, then a card heuristic for unknown listing sites. */
(function () {
  'use strict';
  const U = globalThis.__thcUtil;
  if (globalThis.__thcAdapters.some((a) => a.name === 'generic')) return;

  const ANY_PRICE_RE = /^\s*(?:(?:CHF|EUR|€|Fr\.?)\s*)?\d{1,3}(?:[\s  '.,]?\d{3})*(?:[.,]\d{1,2}|\.[-–])?\s*(?:CHF|EUR|€|Fr\.?)?\s*$/;

  function jsonLdProduct() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data; try { data = JSON.parse(s.textContent); } catch (e) { continue; }
      const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const n of nodes) {
        const t = n && n['@type'];
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) return n;
      }
    }
    return null;
  }

  function singleProduct() {
    const ld = jsonLdProduct();
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogPrice = document.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
    const ogCur = document.querySelector('meta[property="product:price:currency"], meta[property="og:price:currency"]');
    if (!ld && !ogPrice) return null;

    let title = '', priceValue = null, currency = null;
    if (ld) {
      const brand = ld.brand && (ld.brand.name || ld.brand) || '';
      title = String(ld.name || '');
      if (brand && !title.toLowerCase().includes(String(brand).toLowerCase())) title = brand + ' ' + title;
      const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
      if (offer && offer.price != null) { priceValue = Number(offer.price); currency = offer.priceCurrency || null; }
    }
    if (!title && ogTitle) title = ogTitle.content;
    if (priceValue == null && ogPrice) { priceValue = Number(ogPrice.content); currency = ogCur ? ogCur.content : null; }
    if (!title) return null;

    // Find where that price is rendered so the badge sits next to it.
    const h1 = document.querySelector('h1');
    const scope = (h1 && h1.closest('main')) || document.body;
    let priceEl = null;
    if (priceValue != null) {
      priceEl = U.findPriceLeaves(scope, ANY_PRICE_RE).find((el) => {
        const p = U.parsePrice(el.textContent);
        return p && Math.abs(p.value - priceValue) < 0.01 && U.isVisible(el);
      }) || null;
    }
    if (!priceEl) priceEl = U.findPriceLeaves(scope, ANY_PRICE_RE).find(U.isVisible) || null;
    return { key: 'gen:' + location.href.split('#')[0], title, titleEl: h1 || null, priceEl, priceValue, currency, mount: priceEl || h1 || null };
  }

  /** Cards = anchors with an id-looking href that contain a title-ish text and a price-ish leaf. */
  function cardHeuristic(root) {
    const out = [];
    const seen = new Set();
    for (const a of (root || document).querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (!/\d{5,}/.test(href) || seen.has(href)) continue;
      const priceEl = U.findPriceLeaves(a, ANY_PRICE_RE)[0];
      if (!priceEl) continue;
      const img = a.querySelector('img[alt]');
      const title = (img && img.alt.trim()) || [...a.querySelectorAll('*')].map((e) => e.children.length ? '' : e.textContent.trim()).find((t) => t.length > 8 && !ANY_PRICE_RE.test(t)) || '';
      if (!title) continue;
      seen.add(href);
      const price = U.parsePrice(priceEl.textContent);
      out.push({ key: 'gen:' + href, title, priceEl, priceValue: price ? price.value : null, currency: price ? price.currency : null, mount: priceEl });
    }
    return out;
  }

  globalThis.__thcAdapters.push({
    name: 'generic',
    matches: () => true,
    findProducts(root) {
      const single = singleProduct();
      if (single && single.mount) return [single];
      return cardHeuristic(root);
    }
  });
})();
