/*
 * Thomann search client: fetch + parse + cache + polite queue.
 * No cookies are ever sent (credentials: "omit") unless allowCookies is set.
 * Injectable fetch/storage so the parsing and queue logic is unit-testable.
 */
(function (root) {
  'use strict';

  const AJAX_PATH = '/search_searchAjax.html';
  const HTML_PATH = '/search_dir.html';

  function searchUrl(domain, query, ajax) {
    return 'https://' + domain + (ajax ? AJAX_PATH : HTML_PATH) + '?sw=' + encodeURIComponent(query);
  }

  /** Bracket-match the JSON literal that follows `tho.bootstrapModule('<name>', ` in Thomann HTML. */
  function extractBootstrapJson(html, moduleName) {
    const marker = "tho.bootstrapModule('" + moduleName + "', ";
    const s = html.indexOf(marker);
    if (s < 0) return null;
    let i = s + marker.length;
    let depth = 0, inStr = false, esc = false;
    const start = i;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    try { return JSON.parse(html.slice(start, i)); } catch (e) { return null; }
  }

  function toCandidate(a, domain) {
    const p = a.price && a.price.primary ? a.price.primary : null;
    const av = a.availability || {};
    const link = String(a.relativeLink || (a.fileName ? a.fileName + '.htm' : '')).split('?')[0];
    return {
      id: String(a.number || a.id || ''),
      manufacturer: a.manufacturer || '',
      model: a.model || '',
      name: ((a.manufacturer || '') + ' ' + (a.model || '')).trim(),
      price: p && p.rawPrice != null ? Number(p.rawPrice) : null,
      currency: p && p.currency ? (p.currency.key || p.currency.symbol || '') : '',
      url: 'https://' + domain + '/' + link.replace(/^\//, ''),
      inStock: !!av.isAvailable,
      availabilityText: av.textShort || av.label || '',
      bstock: !!a.isBstock,
      archived: !!a.isArchived,
      image: a.mainImage && (a.mainImage.url || a.mainImage.src) || null
    };
  }

  /** Accepts either the ajax JSON object or the bootstrap array wrapping it. */
  function parseSearchPayload(payload, domain) {
    const obj = Array.isArray(payload) ? payload[0] : payload;
    const list = obj && obj.articleListsSettings && obj.articleListsSettings.articles;
    if (!Array.isArray(list)) return null;
    return list.map((a) => toCandidate(a, domain)).filter((c) => c.price != null && !c.archived);
  }

  /** Single-hit searches may land on a product page: read its JSON-LD Product. */
  function parseProductPage(html, url, domain) {
    const re = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      let data;
      try { data = JSON.parse(m[1]); } catch (e) { continue; }
      const nodes = Array.isArray(data) ? data : (data['@graph'] || [data]);
      for (const n of nodes) {
        if (!n || (n['@type'] !== 'Product' && !(Array.isArray(n['@type']) && n['@type'].includes('Product')))) continue;
        const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers;
        if (!offer || offer.price == null) continue;
        const brand = n.brand && (n.brand.name || n.brand) || '';
        const name = String(n.name || '');
        const model = brand && name.toLowerCase().startsWith(String(brand).toLowerCase())
          ? name.slice(String(brand).length).trim() : name;
        return [{
          id: String(n.sku || n.productID || n.mpn || ''),
          manufacturer: String(brand),
          model,
          name: (brand ? brand + ' ' : '') + model,
          price: Number(offer.price),
          currency: offer.priceCurrency || '',
          url: (offer.url || n.url || url).split('?')[0],
          inStock: /InStock/i.test(offer.availability || ''),
          availabilityText: '',
          bstock: false,
          archived: false,
          image: Array.isArray(n.image) ? n.image[0] : (n.image || null)
        }];
      }
    }
    return null;
  }

  class Queue {
    constructor(opts) {
      this.concurrency = Math.max(1, opts.concurrency || 2);
      this.spacingMs = Math.max(0, opts.spacingMs || 300);
      this.running = 0;
      this.lastStart = 0;
      this.pending = [];
    }
    configure(opts) {
      if (opts.concurrency) this.concurrency = Math.max(1, opts.concurrency);
      if (opts.spacingMs != null) this.spacingMs = Math.max(0, opts.spacingMs);
    }
    push(task, priority) {
      return new Promise((resolve, reject) => {
        this.pending.push({ task, resolve, reject, priority: priority || 0 });
        this.pending.sort((a, b) => b.priority - a.priority);
        this._drain();
      });
    }
    _drain() {
      if (this.running >= this.concurrency || !this.pending.length) return;
      const wait = Math.max(0, this.lastStart + this.spacingMs - Date.now());
      if (wait > 0) { setTimeout(() => this._drain(), wait); return; }
      const job = this.pending.shift();
      this.running++;
      this.lastStart = Date.now();
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => { this.running--; this._drain(); });
      this._drain();
    }
  }

  class ThomannClient {
    /**
     * @param {object} deps
     * @param {Function} deps.fetch
     * @param {{get: Function, set: Function}} deps.cache  async get(key) / set(key, value)
     * @param {object} [deps.queue]  {concurrency, spacingMs}
     */
    constructor(deps) {
      this.fetch = deps.fetch;
      this.cache = deps.cache;
      this.queue = new Queue(deps.queue || {});
      this.memo = new Map(); // in-flight de-duplication
    }

    /**
     * @param {string} domain e.g. "www.thomannmusic.ch"
     * @param {string} query cleaned query
     * @param {object} [opts] {ttlMs, allowCookies, force, priority}
     * @returns {Promise<{candidates: object[]|null, searchUrl: string, fromCache: boolean, error?: string}>}
     */
    async search(domain, query, opts) {
      opts = opts || {};
      const key = domain + '|' + query.toLowerCase();
      const url = searchUrl(domain, query, false);
      const ttl = opts.ttlMs == null ? 24 * 3600 * 1000 : opts.ttlMs;

      if (!opts.force && ttl > 0) {
        const hit = await this.cache.get(key);
        if (hit && Date.now() - hit.ts < ttl) return { candidates: hit.candidates, searchUrl: url, fromCache: true, ts: hit.ts };
      }
      if (this.memo.has(key)) return this.memo.get(key);

      const p = this.queue.push(() => this._fetchWithRetry(domain, query, opts), opts.priority)
        .then(async (candidates) => {
          if (ttl > 0) await this.cache.set(key, { ts: Date.now(), candidates });
          return { candidates, searchUrl: url, fromCache: false, ts: Date.now() };
        })
        .catch((e) => ({ candidates: null, searchUrl: url, fromCache: false, error: String(e && e.message || e) }))
        .finally(() => this.memo.delete(key));
      this.memo.set(key, p);
      return p;
    }

    async _fetchWithRetry(domain, query, opts) {
      let delay = 800;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this._fetchOnce(domain, query, opts);
        } catch (e) {
          if (!e.retryable || attempt === 2) throw e;
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
        }
      }
      throw new Error('unreachable');
    }

    async _fetchOnce(domain, query, opts) {
      const init = {
        credentials: opts.allowCookies ? 'include' : 'omit',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json, text/html;q=0.8' },
        redirect: 'follow'
      };
      const res = await this.fetch(searchUrl(domain, query, true), init);
      if (res.status === 429 || res.status >= 500) {
        const err = new Error('HTTP ' + res.status); err.retryable = true; throw err;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ctype = res.headers.get('content-type') || '';
      const text = await res.text();

      if (/json/i.test(ctype)) {
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new Error('bad JSON'); }
        const c = parseSearchPayload(data, domain);
        if (c) return c;
      }
      // HTML: either the classic search page, a product page (single hit), or a challenge.
      const boot = extractBootstrapJson(text, 'search.index');
      if (boot) {
        const c = parseSearchPayload(boot, domain);
        if (c) return c;
      }
      const prod = parseProductPage(text, res.url || searchUrl(domain, query, false), domain);
      if (prod) return prod;

      // Last resort: plain HTML search page without the ajax header.
      const res2 = await this.fetch(searchUrl(domain, query, false), { credentials: init.credentials, redirect: 'follow' });
      if (!res2.ok) throw new Error('HTTP ' + res2.status);
      const html2 = await res2.text();
      const boot2 = extractBootstrapJson(html2, 'search.index');
      if (boot2) { const c = parseSearchPayload(boot2, domain); if (c) return c; }
      const prod2 = parseProductPage(html2, res2.url || '', domain);
      if (prod2) return prod2;
      if (/turnstile|cf-chl|challenge-platform/i.test(html2)) throw new Error('blocked by anti-bot challenge');
      throw new Error('unrecognized response');
    }
  }

  const api = { ThomannClient, Queue, extractBootstrapJson, parseSearchPayload, parseProductPage, searchUrl };
  root.ThomannClientLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
