/* Shared helpers for content-script adapters. Loaded first. */
(function () {
  'use strict';
  if (globalThis.__thcUtil) return;

  const PRICE_RE = /(?:(CHF|EUR|€|Fr\.?)\s*)?(\d{1,3}(?:[\s  '.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:\.–|\.-|–|-))?(?:\s*(CHF|EUR|€|Fr\.?))?/;

  function parsePrice(text) {
    const t = String(text || '').replace(/ | /g, ' ').trim();
    const m = PRICE_RE.exec(t);
    if (!m) return null;
    let num = m[2].replace(/[\s']/g, '');
    // "1.234,56" or "1,234.56" or "1234.56"
    if (/[.,]\d{3}(?:[.,]\d{1,2})?$/.test(num) && /[.,].*[.,]/.test(num)) {
      num = num.replace(/[.,](?=\d{3})/g, '').replace(',', '.');
    } else if (/,\d{1,2}$/.test(num)) num = num.replace(',', '.');
    else if (/\.\d{3}$/.test(num)) num = num.replace('.', '');
    const value = Number(num);
    if (!isFinite(value)) return null;
    const cur = (m[1] || m[3] || '').replace('€', 'EUR').replace(/^Fr\.?$/, 'CHF');
    return { value, currency: cur || null };
  }

  /** Leaf-ish elements (no element children, or only inline formatting) whose text looks like a price. */
  function findPriceLeaves(root, re) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (el.closest('[data-thc-host]') || ['SCRIPT', 'STYLE', 'SVG', 'IMG', 'PICTURE'].includes(el.tagName)) return NodeFilter.FILTER_REJECT;
        const hasBlockChild = [...el.children].some((c) => !['SPAN', 'B', 'STRONG', 'I', 'EM', 'SUP', 'SUB'].includes(c.tagName));
        if (hasBlockChild) return NodeFilter.FILTER_SKIP;
        const txt = (el.textContent || '').trim();
        if (txt.length > 40 || !re.test(txt)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    // Prefer the innermost element when a wrapper and its child both match.
    return out.filter((el) => !out.some((other) => other !== el && el.contains(other)));
  }

  function idFromHref(href, re) {
    const m = re.exec(href || '');
    return m ? m[1] : null;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  globalThis.__thcUtil = { parsePrice, findPriceLeaves, idFromHref, isVisible, PRICE_RE };
  globalThis.__thcAdapters = globalThis.__thcAdapters || [];
})();
