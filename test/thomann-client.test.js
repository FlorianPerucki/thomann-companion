'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ThomannClient, extractBootstrapJson, parseSearchPayload, parseProductPage, searchUrl } = require('../background/thomann-client.js');
const fixture = require('./fixtures/search_doepfer_a110.json');

function memCache() {
  const m = new Map();
  return { get: async (k) => m.get(k) || null, set: async (k, v) => { m.set(k, v); }, map: m };
}
function jsonResponse(obj, status = 200) {
  return { ok: status < 400, status, url: '', headers: { get: () => 'application/json;charset=UTF-8' }, text: async () => JSON.stringify(obj) };
}
function htmlResponse(html, status = 200, url = '') {
  return { ok: status < 400, status, url, headers: { get: () => 'text/html;charset=UTF-8' }, text: async () => html };
}

test('parseSearchPayload maps articles to candidates', () => {
  const c = parseSearchPayload(fixture, 'www.thomannmusic.ch');
  assert.equal(c.length, 8);
  assert.deepEqual(Object.keys(c[0]).sort(), ['archived', 'availabilityText', 'bstock', 'currency', 'id', 'internalId', 'aStockId', 'image', 'inStock', 'manufacturer', 'model', 'name', 'price', 'url', 'alternative'].sort());
  assert.equal(c[0].price, 127);
  assert.equal(c[0].currency, 'CHF');
  assert.equal(c[0].url, 'https://www.thomannmusic.ch/doepfer_a_110_4_thru_zero_quad_vco_se.htm');
  assert.equal(c.find((x) => x.model.includes('B-Stock')).bstock, true);
});

test('extractBootstrapJson bracket-matches the embedded array', () => {
  const html = '<html><script>tho.bootstrapModule(\'search.index\', [' + JSON.stringify(fixture) + ']);</script><script>tho.bootstrapModule(\'other\', {"a":"]"})</script></html>';
  const data = extractBootstrapJson(html, 'search.index');
  assert.ok(Array.isArray(data));
  assert.equal(parseSearchPayload(data, 'www.thomann.fr').length, 8);
});

test('parseProductPage reads JSON-LD Product', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Doepfer A-110-1', sku: '200001',
    brand: { '@type': 'Brand', name: 'Doepfer' },
    offers: { '@type': 'Offer', price: '118', priceCurrency: 'CHF', availability: 'https://schema.org/InStock', url: 'https://www.thomannmusic.ch/doepfer_a_110_1.htm' }
  }) + '</script>';
  const c = parseProductPage(html, 'https://www.thomannmusic.ch/doepfer_a_110_1.htm', 'www.thomannmusic.ch');
  assert.equal(c.length, 1);
  assert.equal(c[0].model, 'A-110-1');
  assert.equal(c[0].price, 118);
  assert.equal(c[0].inStock, true);
});

test('client uses the ajax endpoint, omits credentials, and caches', async () => {
  const calls = [];
  const cache = memCache();
  const client = new ThomannClient({ fetch: async (u, i) => { calls.push({ u, i }); return jsonResponse(fixture); }, cache, queue: { spacingMs: 0 } });
  const r1 = await client.search('www.thomannmusic.ch', 'doepfer a-110');
  assert.equal(r1.fromCache, false);
  assert.equal(r1.candidates.length, 8);
  assert.equal(calls[0].u, 'https://www.thomannmusic.ch/search_searchAjax.html?sw=doepfer%20a-110');
  assert.equal(calls[0].i.credentials, 'omit');
  assert.equal(calls[0].i.headers['X-Requested-With'], 'XMLHttpRequest');
  const r2 = await client.search('www.thomannmusic.ch', 'doepfer a-110');
  assert.equal(r2.fromCache, true);
  assert.equal(calls.length, 1);
  const r3 = await client.search('www.thomannmusic.ch', 'doepfer a-110', { force: true });
  assert.equal(r3.fromCache, false);
  assert.equal(calls.length, 2);
});

test('client falls back to the HTML bootstrap blob', async () => {
  const html = '<html><script>tho.bootstrapModule(\'search.index\', [' + JSON.stringify(fixture) + ']);</script></html>';
  const client = new ThomannClient({ fetch: async () => htmlResponse(html), cache: memCache(), queue: { spacingMs: 0 } });
  const r = await client.search('www.thomann.fr', 'doepfer a-110', { ttlMs: 0 });
  assert.equal(r.candidates.length, 8);
});

test('client reports errors instead of throwing, and retries 5xx', async () => {
  let n = 0;
  const client = new ThomannClient({ fetch: async () => { n++; return jsonResponse({}, 503); }, cache: memCache(), queue: { spacingMs: 0 } });
  const r = await client.search('www.thomannmusic.ch', 'x', { ttlMs: 0 });
  assert.equal(r.candidates, null);
  assert.match(r.error, /503/);
  assert.equal(n, 3);
});

test('client de-duplicates in-flight lookups', async () => {
  let n = 0;
  const client = new ThomannClient({ fetch: async () => { n++; await new Promise((r) => setTimeout(r, 20)); return jsonResponse(fixture); }, cache: memCache(), queue: { spacingMs: 0 } });
  const [a, b] = await Promise.all([client.search('d', 'q'), client.search('d', 'q')]);
  assert.equal(n, 1);
  assert.equal(a.candidates.length, b.candidates.length);
});

test('searchUrl encodes the query', () => {
  assert.equal(searchUrl('www.thomann.fr', 'make noise maths', false), 'https://www.thomann.fr/search_dir.html?sw=make%20noise%20maths');
});

test('alternativeArticles ("similar searches") are returned as flagged candidates', () => {
  const payload = {
    articleListsSettings: {
      articles: [],
      alternativeArticles: [{ id: 51096, number: '166483', relativeLink: 'doepfer_a131.htm?type=quickSearch', manufacturer: 'Doepfer', model: 'A-131', price: { primary: { rawPrice: '68.0000', currency: { key: 'CHF' } } }, availability: { isAvailable: true } }],
      resultCount: 0
    }
  };
  const c = parseSearchPayload(payload, 'www.thomannmusic.ch');
  assert.equal(c.length, 1);
  assert.equal(c[0].alternative, true);
  assert.equal(c[0].url, 'https://www.thomannmusic.ch/doepfer_a131.htm');
});

test('Queue.pauseUntil holds queued tasks and resumes afterwards', async () => {
  const { Queue } = require('../background/thomann-client.js');
  const q = new Queue({ concurrency: 1, spacingMs: 0 });
  const t0 = Date.now();
  q.pauseUntil(t0 + 120);
  const done = await q.push(async () => Date.now());
  assert.ok(done - t0 >= 100, 'task ran too early: ' + (done - t0) + 'ms');
});
