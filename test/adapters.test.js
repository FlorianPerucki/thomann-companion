'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// Markup captured from the real sites (September 2026), trimmed to what the adapters rely on.
const LBC_HTML = `
<main>
<article aria-label="(eurorack) Doepfer a-148"><div data-qa-id="aditem_container">
  <a class="absolute inset-0" aria-label="Voir l’annonce" href="/ad/instruments_de_musique/3263022871"></a>
  <p class="text-callout font-bold"><span class="text-success">50 €</span></p>
</div></article>
<article aria-label="Doepfer A-140-1"><div data-qa-id="aditem_container">
  <a href="/ad/instruments_de_musique/3263022872"></a>
  <p><span class="text-success">1 250 €</span></p>
</div></article>
<article aria-label="Not an ad (no link)"><div>nothing</div></article>
</main>`;

const RICARDO_HTML = `
<div data-testid="regular-results"><div>
<a class="MuiBox-root" href="/fr/a/doepfer-a-156-ve-1328920578/"><img alt="Doepfer A-156 VE" src="x">
  <span>Doepfer A-156 VE</span><span>Doepfer</span><span>70.00</span><span>Achat direct</span><span>Dim 4 oct, 16:09</span></a>
<a class="MuiBox-root" href="/fr/a/eurorack-modul-doepfer-a-110-standard-vco-1328071298/"><img alt="Eurorack Modul - Doepfer - A-110 Standard VCO" src="x">
  <span>Eurorack Modul - Doepfer - A-110 Standard VCO</span><span>Doepfer</span><span>99.00</span><span>(0 enchère)</span><span>109.00</span><span>Achat direct</span><span>Lun 14 sept</span></a>
</div></div>`;

const ANIBIS_HTML = `
<div data-private-srp-listing-item-id="54530781"><a tabindex="0" href="/fr/vi/1073912570"><img alt="Doepfer A-118 Noise" src="x"></a>
  <span>Seftigen, 3662, Aujourd'hui 11:49</span><div><a href="/fr/vi/1073912570">Doepfer A-118 Noise</a></div><span>Very nice</span><span>45.-</span></div>
<div data-private-srp-listing-item-id="54530782"><a href="/fr/vi/1073912571"><img alt="Gratuit thing" src="x"></a><span>Gratuit</span></div>`;

function load(html, url) {
  const dom = new JSDOM(html, { url });
  const g = globalThis;
  const saved = { window: g.window, document: g.document, location: g.location, NodeFilter: g.NodeFilter, __thcUtil: g.__thcUtil, __thcAdapters: g.__thcAdapters };
  g.window = dom.window; g.document = dom.window.document; g.location = dom.window.location; g.NodeFilter = dom.window.NodeFilter;
  delete g.__thcUtil; g.__thcAdapters = [];
  // getBoundingClientRect is zero in jsdom; treat everything as visible.
  dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 1, height: 1 });
  const dir = path.join(__dirname, '..', 'content');
  for (const f of ['util.js', 'adapters/leboncoin.js', 'adapters/ricardo.js', 'adapters/anibis.js', 'adapters/generic.js']) {
    new Function(fs.readFileSync(path.join(dir, f), 'utf8'))();
  }
  const adapters = g.__thcAdapters;
  const adapter = adapters.find((a) => a.matches(dom.window.location));
  const products = adapter.findProducts(dom.window.document);
  Object.assign(g, saved);
  return { adapter, products };
}

test('leboncoin adapter reads cards', () => {
  const { adapter, products } = load(LBC_HTML, 'https://www.leboncoin.fr/recherche?text=doepfer');
  assert.equal(adapter.name, 'leboncoin');
  assert.equal(products.length, 2);
  assert.equal(products[0].key, 'lbc:3263022871');
  assert.equal(products[0].title, '(eurorack) Doepfer a-148');
  assert.equal(products[0].priceValue, 50);
  assert.equal(products[0].currency, 'EUR');
  assert.equal(products[0].mount.textContent, '50 €');
  assert.equal(products[1].priceValue, 1250);
});

test('ricardo adapter reads cards and prefers the buy-now price', () => {
  const { adapter, products } = load(RICARDO_HTML, 'https://www.ricardo.ch/fr/s/doepfer/');
  assert.equal(adapter.name, 'ricardo');
  assert.equal(products.length, 2);
  assert.equal(products[0].key, 'ric:1328920578');
  assert.equal(products[0].title, 'Doepfer A-156 VE');
  assert.equal(products[0].priceValue, 70);
  assert.equal(products[0].currency, 'CHF');
  assert.equal(products[1].priceValue, 109);
});

test('anibis adapter reads cards', () => {
  const { adapter, products } = load(ANIBIS_HTML, 'https://www.anibis.ch/fr/q/doepfer');
  assert.equal(adapter.name, 'anibis');
  assert.equal(products.length, 2);
  assert.equal(products[0].key, 'ani:54530781');
  assert.equal(products[0].title, 'Doepfer A-118 Noise');
  assert.equal(products[0].priceValue, 45);
  assert.equal(products[1].priceValue, null); // "Gratuit": badge still shown, no price to compare
});

test('generic adapter handles a JSON-LD product page', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Maths', brand: { name: 'Make Noise' }, offers: { price: '299', priceCurrency: 'EUR' } })}</script>
    <main><h1>Make Noise Maths</h1><div><span class="price">299,00 €</span></div></main>`;
  const { adapter, products } = load(html, 'https://shop.example.com/p/123');
  assert.equal(adapter.name, 'generic');
  assert.equal(products.length, 1);
  assert.equal(products[0].title, 'Make Noise Maths');
  assert.equal(products[0].priceValue, 299);
  assert.equal(products[0].mount.className, 'price');
});
