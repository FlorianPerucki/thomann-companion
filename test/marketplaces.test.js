'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const M = require('../background/matcher.js');

// The providers use globalThis.__thcUtil / __thcAdapters (content helpers) and DOMParser.
function setupGlobals() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'moz-extension://x/_generated_background_page.html' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.DOMParser = dom.window.DOMParser;
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 1, height: 1 });
  delete globalThis.__thcUtil; globalThis.__thcAdapters = [];
  const dir = path.join(__dirname, '..', 'content');
  for (const f of ['util.js', 'adapters/ricardo.js']) new Function(fs.readFileSync(path.join(dir, f), 'utf8'))();
  delete require.cache[require.resolve('../background/marketplaces.js')];
  return require('../background/marketplaces.js');
}

const MP = setupGlobals();
const { PROVIDERS, fetchListings } = MP;

function nextDataHtml(obj) {
  return '<html><head></head><body><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(obj) + '</script></body></html>';
}

// Shapes captured from the real sites (September 2026).
const LBC = nextDataHtml({ props: { pageProps: { searchData: { ads: [
  { list_id: 3213384335, subject: 'Doepfer A-131 exponential VCA', body: 'VCA en très bon état', ad_type: 'offer', price: [50], price_cents: 5000, url: 'https://www.leboncoin.fr/ad/instruments_de_musique/3213384335', location: { city: 'Rennes', department_name: 'Ille-et-Vilaine' }, first_publication_date: '2026-09-01 10:00:00' },
  { list_id: 3213384336, subject: 'Recherche Doepfer A-131', ad_type: 'demand', price: [1], price_cents: 100, url: 'https://www.leboncoin.fr/ad/instruments_de_musique/3213384336', location: { city: 'Paris' }, first_publication_date: '2026-09-02 10:00:00' },
  { list_id: 3213384337, subject: 'Doepfer A-140 ADSR', ad_type: 'offer', price: [45], price_cents: 4500, url: 'https://www.leboncoin.fr/ad/instruments_de_musique/3213384337', location: { city: 'Lyon' }, first_publication_date: '2026-08-20 10:00:00' }
] } } } });

const RIC = `<html><body><div data-testid="regular-results"><div>
<a class="MuiBox-root" href="/fr/a/doepfer-a-131-vca-1328920578/"><img alt="Doepfer A-131 VCA" src="x"><span>Doepfer A-131 VCA</span><span>Doepfer</span><span>40.00</span><span>Achat direct</span></a>
<a class="MuiBox-root" href="/fr/a/doepfer-a-140-1328071298/"><img alt="Doepfer A-140" src="x"><span>Doepfer A-140</span><span>99.00</span><span>(0 enchère)</span><span>109.00</span><span>Achat direct</span></a>
</div></div></body></html>`;

const ANI = nextDataHtml({ props: { pageProps: { dehydratedState: { queries: [{ state: { data: { listings: { totalCount: 2, edges: [
  { node: { listingID: '54040379', localization: { title: 'Doepfer A-131 VCA exponentiel', body: 'Comme neuf' }, formattedPrice: '45.-', timestamp: '2026-09-05T10:00:00Z', postcodeInformation: { locationName: 'Lausanne', postcode: 1000 } } },
  { node: { listingID: '54040380', localization: { title: 'Cherche Doepfer A-131', body: '' }, formattedPrice: '1.-', timestamp: '2026-09-05T10:00:00Z', postcodeInformation: {} } }
] } } } }] } } } });

function fakeFetch(html) {
  return async (url, init) => ({ ok: true, status: 200, url, text: async () => html, _init: init });
}

test('leboncoin provider parses __NEXT_DATA__ ads and flags wanted ads', async () => {
  const p = PROVIDERS.leboncoin;
  assert.equal(p.searchUrl('doepfer a-131', { lbcCategory: '30' }), 'https://www.leboncoin.fr/recherche?text=doepfer%20a-131&category=30');
  const listings = await fetchListings(p, 'doepfer a-131', { lbcCategory: '30' }, fakeFetch(LBC));
  assert.equal(listings.length, 3);
  assert.deepEqual(listings[0], { id: '3213384335', source: 'leboncoin', title: 'Doepfer A-131 exponential VCA', body: 'VCA en très bon état', price: 50, currency: 'EUR', url: 'https://www.leboncoin.fr/ad/instruments_de_musique/3213384335', place: 'Rennes', date: '2026-09-01 10:00:00', wanted: false });
  assert.equal(listings[1].wanted, true);
});

test('ricardo provider parses server-rendered cards through the shared adapter', async () => {
  const p = PROVIDERS.ricardo;
  assert.equal(p.searchUrl('doepfer a-131', { marketLang: 'fr' }), 'https://www.ricardo.ch/fr/s/doepfer%20a-131/');
  const listings = await fetchListings(p, 'doepfer a-131', { marketLang: 'fr' }, fakeFetch(RIC));
  assert.equal(listings.length, 2);
  assert.equal(listings[0].id, '1328920578');
  assert.equal(listings[0].title, 'Doepfer A-131 VCA');
  assert.equal(listings[0].price, 40);
  assert.equal(listings[0].url, 'https://www.ricardo.ch/fr/a/doepfer-a-131-vca-1328920578/');
  assert.equal(listings[1].price, 109); // buy-now, not the current bid
});

test('anibis provider parses dehydrated listings', async () => {
  const p = PROVIDERS.anibis;
  assert.equal(p.searchUrl('doepfer a-131', { marketLang: 'fr' }), 'https://www.anibis.ch/fr/q/?query=doepfer%20a-131');
  const listings = await fetchListings(p, 'doepfer a-131', { marketLang: 'fr' }, fakeFetch(ANI));
  assert.equal(listings.length, 2);
  assert.equal(listings[0].id, '54040379');
  assert.equal(listings[0].price, 45);
  assert.equal(listings[0].place, 'Lausanne');
  assert.equal(listings[0].url, 'https://www.anibis.ch/fr/vi/54040379');
  assert.equal(listings[1].wanted, true);
});

test('fetchListings never sends cookies by default and reports anti-bot pages', async () => {
  let init;
  await fetchListings(PROVIDERS.leboncoin, 'x', {}, async (u, i) => { init = i; return { ok: true, status: 200, text: async () => LBC }; });
  assert.equal(init.credentials, 'omit');
  await assert.rejects(fetchListings(PROVIDERS.leboncoin, 'x', {}, fakeFetch('<html>captcha-delivery.com datadome</html>')), /anti-bot/);
});

test('pickMatches is strict: every 3+ letter word of the product name must be in the title', () => {
  const ls = [
    { id: '1', title: 'Doepfer A-131 exponential VCA', price: 50 },
    { id: '2', title: 'A-131 VCA', price: 40 },                 // brand missing -> out
    { id: '3', title: 'Doepfer A-140 ADSR', price: 45 },        // wrong code -> out
    { id: '4', title: 'doepfer a131', price: 60 },              // spelling variants are normalized
    { id: '5', title: 'Recherche Doepfer A-131', price: 1, wanted: true }
  ];
  assert.deepEqual(M.pickMatches('doepfer a-131', ls).map((l) => l.id), ['1', '4']);
  // multi-word names: all words required, "-1" and base code are interchangeable
  const ls2 = [{ id: 'a', title: 'Doepfer A-110-4 Thru Zero Quad VCO', price: 100 }, { id: 'b', title: 'Doepfer A-110-4', price: 90 }];
  assert.deepEqual(M.pickMatches('doepfer a-110-4 thru zero quad vco', ls2).map((l) => l.id), ['a']);
  assert.deepEqual(M.pickMatches('doepfer a-140-1', [{ id: 'c', title: 'Doepfer A-140 ADSR', price: 45 }]).map((l) => l.id), ['c']);
});

test('pickMatches keeps the right product only, cheapest first, and ignores wanted ads', async () => {
  const lbc = await fetchListings(PROVIDERS.leboncoin, 'doepfer a-131', {}, fakeFetch(LBC));
  const ric = await fetchListings(PROVIDERS.ricardo, 'doepfer a-131', {}, fakeFetch(RIC));
  const ani = await fetchListings(PROVIDERS.anibis, 'doepfer a-131', {}, fakeFetch(ANI));
  const all = lbc.concat(ric, ani);
  const m = M.pickMatches('doepfer a-131', all, { min: 0.5 });
  assert.deepEqual(m.map((l) => l.source + ':' + l.price), ['ricardo:40', 'anibis:45', 'leboncoin:50']); // all titles carry "Doepfer A-131"
});

test('marketQueries: brand + code, then base code, then brand (anibis: base code first)', () => {
  assert.deepEqual(M.marketQueries('Doepfer A-140-1'), ['doepfer a-140-1', 'doepfer a-140', 'doepfer']);
  assert.deepEqual(M.marketQueries('Doepfer A-140-1', { baseOnly: true }), ['doepfer a-140', 'doepfer']);
  assert.deepEqual(M.marketQueries('Make Noise Maths'), ['make noise maths', 'make']);
});
